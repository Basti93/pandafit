import type { BlePort, DeviceKind } from './device-port';
import { encodeRequestControl, encodeSimulation, encodeTargetPower, parseIndoorBikeData } from './ftms-codec';
import { parseClick } from './click-codec';
import { parseHeartRate } from './hr-codec';

import type { DeviceStatus, Reading } from '../../shared/device-types';
export type { DeviceStatus, Reading };
type TrainerCommand = { kind: 'power'; w: number } | { kind: 'grade'; pct: number };

const KINDS: DeviceKind[] = ['trainer', 'hr', 'clicker'];
const CONTROL_RETRY_MS = 2000;
const RESULT_NOT_PERMITTED = 0x05;
/** A connected device that sends nothing for this long is treated like a lost connection. */
export const SILENT_MS = 10_000;
const WATCHDOG_TICK_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
/** The clicker only sends on a button press, so silence is normal for it. */
const WATCHED: DeviceKind[] = ['trainer', 'hr'];

export class DeviceManager {
  private status: DeviceStatus = { trainer: 'searching', hr: 'searching', clicker: 'searching' };
  private readingCb: (r: Reading) => void = () => {};
  private statusCb: (s: DeviceStatus) => void = () => {};
  private clickCb: (dir: 'up' | 'down') => void = () => {};
  private lastCommand: TrainerCommand | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;
  private connecting = new Set<DeviceKind>();
  private retryMs: number;
  private writeRetryMs: number;
  private pendingCommand: TrainerCommand | null = null;
  private pumping = false;
  private held = { plus: false, minus: false };
  private lastControlRequestMs = -Infinity;
  private nowMs: () => number;
  private lastDataAt: Partial<Record<DeviceKind, number>> = {};
  private retryTimers = new Map<DeviceKind, ReturnType<typeof setTimeout>>();
  private failures: Partial<Record<DeviceKind, number>> = {};
  /** Backoff applies to reconnecting after a loss; the first search keeps the flat interval. */
  private wasConnected = new Set<DeviceKind>();
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(private port: BlePort, opts: { retryMs?: number; writeRetryMs?: number; nowMs?: () => number } = {}) {
    this.nowMs = opts.nowMs ?? Date.now;
    this.retryMs = opts.retryMs ?? 2000;
    this.writeRetryMs = opts.writeRetryMs ?? 500;
    port.subscribe('trainer', (b) => this.safely(() => { this.lastDataAt.trainer = this.nowMs(); this.readingCb(parseIndoorBikeData(b)); }));
    port.subscribe('hr', (b) => this.safely(() => { this.lastDataAt.hr = this.nowMs(); this.readingCb({ hrBpm: parseHeartRate(b) }); }));
    port.subscribe('clicker', (b) => this.safely(() => this.handleClick(b)));
    port.onControl((b) => this.safely(() => this.handleControl(b)));
    port.onDisconnect((kind) => {
      if (kind === 'clicker') this.held = { plus: false, minus: false };
      if (this.status[kind] === 'off') return;
      if (this.status[kind] === 'searching' && this.retryTimers.has(kind)) return; // already reconnecting
      this.setStatus(kind, 'searching');
      this.schedule(kind);
    });
  }

  start(): void {
    this.statusCb({ ...this.status });
    for (const kind of KINDS) void this.tryConnect(kind);
    this.armWatchdog();
  }
  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.retryTimers.clear();
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private watchdogOn = false;

  private armWatchdog(): void {
    if (this.stopped) return;
    this.watchdog = setTimeout(() => {
      this.checkSilent();
      this.armWatchdog();
    }, WATCHDOG_TICK_MS);
  }

  /** The silence watchdog only matters during a ride; without one a quiet device is left alone. Default: off. */
  setWatchdog(on: boolean): void {
    if (on && !this.watchdogOn) {
      const now = this.nowMs();
      for (const kind of WATCHED) this.lastDataAt[kind] = now;
    }
    this.watchdogOn = on;
  }

  /** Only connected devices count: one that is off, searching or still connecting is not silent. */
  private checkSilent(): void {
    if (!this.watchdogOn) return;
    const now = this.nowMs();
    for (const kind of WATCHED) {
      if (this.status[kind] !== 'connected' || this.connecting.has(kind)) continue;
      if (now - (this.lastDataAt[kind] ?? now) < SILENT_MS) continue;
      // Same path as a real disconnect: status change (device-lost), then reconnect.
      this.setStatus(kind, 'searching');
      void this.port.disconnect(kind).catch(() => { /* already disconnected */ });
      this.schedule(kind);
    }
  }

  /** Stays disconnected until someone connects. This lets the clicker, for example, go to sleep. */
  async disconnect(kind: DeviceKind): Promise<void> {
    if (kind === 'clicker') this.held = { plus: false, minus: false };
    this.setStatus(kind, 'off');
    await this.port.disconnect(kind).catch(() => { /* already disconnected */ });
  }

  connect(kind: DeviceKind): void {
    if (this.status[kind] === 'connected') return;
    this.setStatus(kind, 'searching');
    void this.tryConnect(kind);
  }

  setTargetPower(w: number): void { this.send({ kind: 'power', w }); }
  setGrade(pct: number): void { this.send({ kind: 'grade', pct }); }
  onReading(cb: (r: Reading) => void): void { this.readingCb = cb; }
  onStatus(cb: (s: DeviceStatus) => void): void { this.statusCb = cb; }
  onClick(cb: (dir: 'up' | 'down') => void): void { this.clickCb = cb; }
  getStatus(): DeviceStatus { return { ...this.status }; }
  getNames(): Partial<Record<DeviceKind, string>> {
    const names: Partial<Record<DeviceKind, string>> = {};
    for (const kind of KINDS) {
      const name = this.status[kind] === 'connected' ? this.port.deviceName?.(kind) : null;
      if (name) names[kind] = name;
    }
    return names;
  }

  private send(c: TrainerCommand): void {
    this.lastCommand = c;
    this.pendingCommand = c;
    void this.pump();
  }

  /**
   * Only one write at a time, the newest command wins, and a failed one is
   * retried. Commands only go out on changes, so a lost one would otherwise have
   * no effect until the next section. The behavior follows the proven Auuki.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pendingCommand && this.status.trainer === 'connected' && !this.stopped) {
        const c = this.pendingCommand;
        try {
          await this.port.write('trainer', this.encode(c));
          if (this.pendingCommand === c) this.pendingCommand = null;
        } catch {
          await this.wait(this.writeRetryMs);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** The Click repeats messages while a button is held. Only the press counts. */
  private handleClick(b: Buffer): void {
    const now = parseClick(b);
    if (!now) return;
    const before = this.held;
    this.held = now;
    if (now.plus && !before.plus) this.clickCb('up');
    if (now.minus && !before.minus) this.clickCb('down');
  }

  /** If the trainer has taken control away from us, the target would otherwise have no effect until the next section. */
  private handleControl(b: Buffer): void {
    const lost = b[0] === 0xff || (b[0] === 0x80 && b[2] === RESULT_NOT_PERMITTED);
    const now = Date.now();
    if (!lost || now - this.lastControlRequestMs < CONTROL_RETRY_MS) return;
    this.lastControlRequestMs = now;
    void this.writeTrainer(encodeRequestControl()).then(() => {
      this.pendingCommand = this.lastCommand;
      return this.pump();
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.timers.delete(t); resolve(); }, ms);
      this.timers.add(t);
    });
  }
  private encode(c: TrainerCommand): Buffer {
    return c.kind === 'power' ? encodeTargetPower(c.w) : encodeSimulation(c.pct);
  }
  private writeTrainer(b: Buffer): Promise<void> {
    return this.port.write('trainer', b).catch(() => { /* reconnecting sends the last command again */ });
  }
  private async tryConnect(kind: DeviceKind): Promise<void> {
    if (this.stopped || this.connecting.has(kind) || this.status[kind] !== 'searching') return;
    this.connecting.add(kind);
    try {
      await this.port.connect(kind);
    } catch {
      this.connecting.delete(kind);
      if (this.status[kind] === 'searching') this.schedule(kind);
      return;
    }
    this.connecting.delete(kind);
    // Someone may have disconnected during the wait.
    if (this.getStatus()[kind] === 'off') {
      await this.port.disconnect(kind).catch(() => { /* already disconnected */ });
      return;
    }
    this.setStatus(kind, 'connected');
    this.lastDataAt[kind] = this.nowMs();
    this.failures[kind] = 0;
    this.wasConnected.add(kind);
    if (kind === 'trainer') {
      await this.writeTrainer(encodeRequestControl());
      this.pendingCommand = this.lastCommand;
      await this.pump();
    }
  }
  private schedule(kind: DeviceKind): void {
    if (this.stopped) return;
    const old = this.retryTimers.get(kind);
    if (old) { clearTimeout(old); this.timers.delete(old); }
    const n = this.failures[kind] ?? 0;
    this.failures[kind] = n + 1;
    const delay = this.wasConnected.has(kind) ? Math.min(MAX_BACKOFF_MS, this.retryMs * 2 ** n) : this.retryMs;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.retryTimers.delete(kind);
      void this.tryConnect(kind);
    }, delay);
    this.timers.add(t);
    this.retryTimers.set(kind, t);
  }
  private setStatus(kind: DeviceKind, s: DeviceStatus[DeviceKind]): void {
    this.status[kind] = s;
    this.statusCb({ ...this.status });
  }
  private safely(fn: () => void): void {
    try { fn(); } catch { /* a corrupt data packet never ends the ride */ }
  }
}
