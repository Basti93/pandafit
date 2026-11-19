/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import type { BlePort, DeviceKind } from './device-port';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

type Spec = { services: string[]; notify: string; write?: string; status?: string; indicate?: string; handshake?: { char: string; bytes: Buffer } };
const clickUuid = (n: number) => `0000000${n}19ca465186e5fa29dcdd09d1`;
const SERVICES: Partial<Record<DeviceKind, Spec>> = {
  trainer: { services: ['1826'], notify: '2ad2', write: '2ad9', status: '2ada' },
  hr: { services: ['180d'], notify: '2a37' },
  // According to BikeControl and zwiftplay: buttons on 0002, responses on 0004, RideOn on 0003 starts the messages.
  clicker: {
    services: [clickUuid(1), 'fc82'], notify: clickUuid(2), indicate: clickUuid(4),
    handshake: { char: clickUuid(3), bytes: Buffer.from('RideOn') },
  },
};
// Zwift Inc., device type BC1 = first-generation Click. The Click does not reliably advertise its service.
const ZWIFT_COMPANY = [0x4a, 0x09];
const CLICK_V1 = 0x09;
const isClickV1 = (p: any): boolean => {
  const m: Buffer | undefined = p.advertisement?.manufacturerData;
  return !!m && m[0] === ZWIFT_COMPANY[0] && m[1] === ZWIFT_COMPANY[1] && m[2] === CLICK_V1;
};
const PRIORITY: Record<DeviceKind, number> = { trainer: 0, hr: 1, clicker: 2 };
const SCAN_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 15_000;
// Cleanup calls (disconnect, stop scan) can hang in noble: never wait for them longer than this.
const CLEANUP_TIMEOUT_MS = 3000;
// Upper bound for one whole attempt, so that `busy` is always released.
const ATTEMPT_TIMEOUT_MS = 60_000;

/** Resolves with the result, or rejects with `message` after `ms`. The late result is ignored. */
const limit = <T>(work: () => Promise<T> | T, ms: number, message: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve().then(work).then(resolve, reject).finally(() => clearTimeout(timer));
  });
// The Click is usually asleep: search briefly so that it does not hold up trainer and strap.
const CLICKER_SCAN_MS = 4000;

/**
 * Real Bluetooth connection. Remembers the last used device UUID per device type,
 * because macOS returns UUIDs instead of addresses.
 */
export class NobleBlePort implements BlePort {
  private subs = new Map<DeviceKind, (b: Buffer) => void>();
  private peripherals = new Map<DeviceKind, any>();
  private writers = new Map<DeviceKind, any>();
  private disconnectCb: (kind: DeviceKind) => void = () => {};
  private controlCb: (b: Buffer) => void = () => {};
  private connectTimeoutMs: number;
  private known: Partial<Record<DeviceKind, string>> = {};
  private knownFile: string;
  private noble: any;
  private waiting: { kind: DeviceKind; run: () => void }[] = [];
  private busy = false;
  private clickerScanMs: number;
  private cleanupTimeoutMs: number;
  private attemptTimeoutMs: number;

  constructor(dataDir: string, nobleImpl?: unknown, opts: { connectTimeoutMs?: number; clickerScanMs?: number; cleanupTimeoutMs?: number; attemptTimeoutMs?: number } = {}) {
    this.cleanupTimeoutMs = opts.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
    this.clickerScanMs = opts.clickerScanMs ?? CLICKER_SCAN_MS;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.noble = nobleImpl;
    this.knownFile = path.join(dataDir, 'devices.json');
    try { this.known = JSON.parse(fs.readFileSync(this.knownFile, 'utf8')); } catch { /* first start */ }
  }

  /**
   * One after the other, because a new scan replaces the running one and the devices would otherwise
   * starve each other. The trainer goes first, so that a running ride gets it back quickly.
   */
  connect(kind: DeviceKind): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ kind, run: () => { limit(() => this.connectNow(kind), this.attemptTimeoutMs, `${kind}: Zeitüberschreitung beim Verbindungsversuch`).then(resolve, reject).finally(() => { this.busy = false; this.next(); }); } });
      this.next();
    });
  }

  private next(): void {
    if (this.busy || this.waiting.length === 0) return;
    this.waiting.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
    this.busy = true;
    this.waiting.shift()!.run();
  }

  private async connectNow(kind: DeviceKind): Promise<void> {
    const spec = SERVICES[kind];
    if (!spec) throw new Error(`${kind} wird in Stufe 1 nicht verbunden`);
    this.noble ??= ((await import('@stoprocent/noble')) as any).default;
    await this.noble.waitForPoweredOnAsync(SCAN_TIMEOUT_MS);
    const peripheral = await this.find(kind, spec.services);
    let ready = false;
    let dropped = false;
    peripheral.once('disconnect', () => {
      dropped = true;
      if (!ready) return;
      this.peripherals.delete(kind);
      this.writers.delete(kind);
      this.disconnectCb(kind);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.setUp(kind, spec, peripheral),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${kind}: Zeitüberschreitung beim Verbinden`)), this.connectTimeoutMs); }),
      ]);
      if (dropped) throw new Error(`${kind} während der Verbindung verloren`);
    } catch (e) {
      // Always disconnect: otherwise a half-open connection blocks the device for the next attempt.
      this.writers.delete(kind);
      await limit(() => peripheral.disconnectAsync?.(), this.cleanupTimeoutMs, 'disconnect').catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
    this.known[kind] = peripheral.id;
    // A failed save must not drop the connected device.
    try { writeJsonAtomic(this.knownFile, this.known); } catch (e) { console.error('devices.json could not be written', e); }
    ready = true;
    this.peripherals.set(kind, peripheral);
  }

  private async setUp(kind: DeviceKind, spec: Spec, peripheral: any): Promise<void> {
    await peripheral.connectAsync();
    // With several possible services, fetch all of them: noble aborts as soon as a requested service is missing.
    const { characteristics } = spec.services.length > 1
      ? await peripheral.discoverAllServicesAndCharacteristicsAsync()
      : await peripheral.discoverSomeServicesAndCharacteristicsAsync(
        spec.services,
        [spec.notify, spec.write, spec.status, spec.indicate, spec.handshake?.char].filter(Boolean),
      );
    const notify = characteristics.find((c: any) => c.uuid === spec.notify);
    notify.on('data', (b: Buffer) => this.subs.get(kind)?.(b));
    await notify.subscribeAsync();
    if (spec.write) {
      const writer = characteristics.find((c: any) => c.uuid === spec.write);
      writer.on('data', (b: Buffer) => this.controlCb(b));
      await writer.subscribeAsync().catch(() => {});
      this.writers.set(kind, writer);
    }
    const status = spec.status && characteristics.find((c: any) => c.uuid === spec.status);
    if (status) {
      status.on('data', (b: Buffer) => this.controlCb(b));
      await status.subscribeAsync().catch(() => {});
    }
    if (spec.indicate) await characteristics.find((c: any) => c.uuid === spec.indicate)?.subscribeAsync();
    if (spec.handshake) {
      const { char, bytes } = spec.handshake;
      await characteristics.find((c: any) => c.uuid === char).writeAsync(bytes, true);
    }
  }

  async disconnect(kind: DeviceKind): Promise<void> { await this.peripherals.get(kind)?.disconnectAsync(); }
  deviceName(kind: DeviceKind): string | null { return this.peripherals.get(kind)?.advertisement?.localName ?? null; }
  subscribe(kind: DeviceKind, cb: (b: Buffer) => void): void { this.subs.set(kind, cb); }
  onDisconnect(cb: (kind: DeviceKind) => void): void { this.disconnectCb = cb; }
  onControl(cb: (b: Buffer) => void): void { this.controlCb = cb; }

  async write(kind: DeviceKind, b: Buffer): Promise<void> {
    const writer = this.writers.get(kind);
    if (!writer) throw new Error('not connected');
    await writer.writeAsync(b, false);
  }

  private async find(kind: DeviceKind, services: string[]): Promise<any> {
    const clicker = kind === 'clicker';
    await this.noble.startScanningAsync(clicker ? [] : services, false);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.noble.removeListener('discover', onDiscover);
          reject(new Error(`${kind} nicht gefunden`));
        }, clicker ? this.clickerScanMs : SCAN_TIMEOUT_MS);
        const onDiscover = (p: any) => {
          if (this.known[kind] && p.id !== this.known[kind]) return;
          if (clicker && !isClickV1(p)) return;
          clearTimeout(timer);
          this.noble.removeListener('discover', onDiscover);
          resolve(p);
        };
        this.noble.on('discover', onDiscover);
      });
    } finally {
      await limit(() => this.noble.stopScanningAsync(), this.cleanupTimeoutMs, 'stopScanning').catch(() => {});
    }
  }
}
