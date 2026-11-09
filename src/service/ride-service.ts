import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseProfile, type Profile } from '../shared/profiles';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import type { RideEvent } from '../shared/sample';
import { parseSession, type Session } from '../shared/session';
import { DeviceManager, type DeviceStatus, type Reading } from './ble/device-manager';
import type { BlePort } from './ble/device-port';
import { RideEngine } from './engine';
import type { Diagnostics } from './diagnostics';
import { exportFit } from '../ride-format/export/fit';
import { RideRecorder } from './recorder';
import { readRide } from '../ride-format/read';
import { findOpenRides, resumePoint, type ResumePoint } from '../ride-format/recovery';
import { writeJsonAtomic } from '../shared/node/atomic-write';

type Active = {
  recorder: RideRecorder; engine: RideEngine; session: Session; ftpW: number; recovered: boolean;
  /** Waits for the user's decision after a long standstill and counts no time. */
  paused?: boolean;
  /** The ride is over, but not yet completely saved. */
  ending?: 'finished' | 'aborted' | 'discarded';
};
const STALE_READING_MS = 3000;
const CRASH_GAP_MS = 5000;
const LONG_DOWNTIME_MS = 5 * 60 * 1000;
const RIDE_ID = /^ride-[\w-]+$/;
const checkRideId = (id: string): void => { if (!RIDE_ID.test(id)) throw new Error('Ungültige Fahrt-ID.'); };
type Deps = { dir: string; ble: BlePort; nowMs: () => number; retryMs?: number; recorderFs?: typeof fs; onLive?: (line: object) => void; onRideChange?: (riding: boolean) => void; onRideStart?: () => void; diagnostics?: Diagnostics };

export class RideService {
  private devices: DeviceManager;
  private active: Active | null = null;
  private subs = new Set<(m: ServerMessage) => void>();
  private latest: Reading = {};
  private latestAt: Partial<Record<keyof Reading, number>> = {};
  private deviceStatus: DeviceStatus = { trainer: 'searching', hr: 'searching', clicker: 'searching' };

  constructor(private deps: Deps) {
    fs.mkdirSync(deps.dir, { recursive: true });
    this.devices = new DeviceManager(deps.ble, { retryMs: deps.retryMs });
    this.devices.onStatus((status) => this.onDeviceStatus(status));
    this.devices.onReading((r) => {
      this.latest = { ...this.latest, ...r };
      for (const key of Object.keys(r) as (keyof Reading)[]) this.latestAt[key] = this.deps.nowMs();
    });
    this.devices.onClick((dir) => {
      for (const cb of this.subs) this.guard(() => cb({ type: 'click', dir }));
    });
    this.devices.start();
    this.guard(() => this.recoverOpenRide());
  }

  subscribe(cb: (m: ServerMessage) => void): () => void {
    this.subs.add(cb);
    this.sendOffer(cb);
    return () => this.subs.delete(cb);
  }
  /** The active profile never affects an open ride; it keeps its original profile. */
  subscribeActiveProfile(_profileId: string): void { this.broadcastOffer(); }

  handle(msg: ClientMessage): void {
    try {
      this.dispatch(msg);
    } catch (e) {
      this.broadcast({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  tick(): void {
    const a = this.active;
    if (!a || a.paused) { this.broadcastState(); return; }
    if (a.ending) { this.tryFinish(a); return; }
    const { sample, command, events } = a.engine.tick(this.freshReadings());
    for (const e of events) this.logEvent(e);
    a.recorder.append(sample);
    this.guard(() => this.deps.onLive?.(sample));
    if (a.engine.isDone()) { this.end('finished'); return; }
    this.guard(() => {
      if (command?.targetW !== undefined) this.devices.setTargetPower(command.targetW);
    });
    this.broadcastState();
  }

  isRiding(): boolean { return this.active !== null; }
  close(): void { this.devices.stop(); }

  private dispatch(msg: ClientMessage): void {
    const a = this.active;
    switch (msg.type) {
      case 'start': {
        if (a) throw new Error('Es läuft bereits eine Fahrt.');
        const session = parseSession(msg.session);
        const rideId = `ride-${this.deps.nowMs()}-${randomUUID().slice(0, 8)}`;
        const recorder = RideRecorder.create(this.deps.dir, {
          rideId, profileId: msg.profileId, sessionId: session.id, startedAtMs: this.deps.nowMs(), status: 'open',
        }, this.deps.recorderFs);
        const sessionFile = path.join(this.deps.dir, rideId, 'session.json');
        writeJsonAtomic(sessionFile, { formatVersion: 1, profileId: msg.profileId, session, ftpW: msg.ftpW, maxHrBpm: msg.maxHrBpm, hrMaxBpm: msg.hrMaxBpm });
        this.guard(() => this.deps.onRideStart?.());
        this.setActive({ recorder, engine: this.newEngine(session, msg.ftpW, { maxHrBpm: msg.maxHrBpm, hrMaxBpm: msg.hrMaxBpm }), session, ftpW: msg.ftpW, recovered: false });
        return;
      }
      case 'adjust': if (a) this.logEvent(a.engine.adjustTarget(msg.deltaPct)); return;
      case 'mark': this.logEvent({ wallClockMs: this.deps.nowMs(), type: 'marker', detail: msg.note }); return;
      case 'skip': if (a && !a.paused && !a.ending) { const e = a.engine.skipStep(); if (e) this.logEvent(e); } return;
      case 'stop': if (a) this.end('aborted'); return;
      case 'discard': if (a) this.end('discarded'); return;
      case 'resume': if (a) { a.recovered = false; a.paused = false; } return;
      case 'discard-resume': if (a && a.recorder.getMeta().rideId === msg.rideId) this.end('aborted'); return;
      case 'export-fit': checkRideId(msg.rideId); this.writeFit(msg.rideId); return;
      case 'device-disconnect':
        // Without the trainer the target no longer holds, which is why it stays connected during a ride.
        if (msg.kind === 'trainer' && this.active) throw new Error('Der Trainer bleibt während einer Fahrt verbunden.');
        void this.devices.disconnect(msg.kind);
        this.broadcastState();
        break;
      case 'device-connect':
        this.devices.connect(msg.kind);
        this.broadcastState();
        break;
      case 'delete-profile': {
        // Only the profile entry goes: rides stay on disk, a ride is never lost.
        if (a && a.recorder.profileId === msg.profileId) throw new Error('Das Profil fährt gerade und kann nicht gelöscht werden.');
        const file = path.join(this.deps.dir, 'profiles.json');
        writeJsonAtomic(file, this.profiles().filter((x) => x.id !== msg.profileId));
        this.broadcastState();
        return;
      }
      case 'problem-report': {
        // In the background: the ride tick does not wait for it.
        const report = this.deps.diagnostics?.report(msg.note, { devices: this.devices.getStatus(), names: this.devices.getNames(), ride: a?.recorder.getMeta() ?? null, engine: a?.engine.state() ?? null });
        if (!report) throw new Error('Das Protokoll läuft gerade nicht.');
        void report.then(
          (file) => this.broadcast({ type: 'report-saved', path: file }),
          () => this.broadcast({ type: 'error', message: 'Der Problembericht konnte nicht gespeichert werden.' }),
        );
        return;
      }
      case 'save-profile': {
        const profile = parseProfile(msg.profile);
        const others = this.profiles().filter((x) => x.id !== profile.id);
        const file = path.join(this.deps.dir, 'profiles.json');
        writeJsonAtomic(file, [...others, profile]);
        this.broadcastState();
        return;
      }
    }
  }

  /** Stale values must not keep being recorded after a lost connection. */
  private onDeviceStatus(status: DeviceStatus): void {
    const prev = this.deviceStatus;
    this.deviceStatus = status;
    this.guard(() => this.deps.diagnostics?.write('status', status));
    for (const kind of ['trainer', 'hr'] as const) {
      if (prev[kind] === status[kind]) continue;
      if (status[kind] !== 'connected') {
        this.latest = kind === 'hr' ? { ...this.latest, hrBpm: undefined } : { hrBpm: this.latest.hrBpm };
      }
      if (status[kind] !== 'connected' && prev[kind] !== 'connected') continue;
      this.logEvent({ wallClockMs: this.deps.nowMs(), type: status[kind] === 'connected' ? 'device-back' : 'device-lost', detail: kind });
    }
  }

  private logEvent(e: RideEvent): void {
    this.active?.recorder.event(e);
    this.guard(() => this.deps.onLive?.(e));
  }

  private writeFit(rideId: string): void {
    const out = path.join(this.deps.dir, 'exports');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `${rideId}.fit`), exportFit(readRide(this.deps.dir, rideId)));
  }

  private profiles(): Profile[] {
    try { return JSON.parse(fs.readFileSync(path.join(this.deps.dir, 'profiles.json'), 'utf8')) as Profile[]; } catch { return []; }
  }

  private newEngine(session: Session, ftpW: number, extra: Partial<ResumePoint> & { maxHrBpm?: number; hrMaxBpm?: number } = {}): RideEngine {
    return new RideEngine({ session, ftpW, nowMs: this.deps.nowMs, ...extra });
  }

  /** An open ride continues recording immediately after the restart; the user decides afterwards. */
  private recoverOpenRide(): void {
    const open = findOpenRides(this.deps.dir);
    const [meta, ...others] = open.sort((x, y) => y.startedAtMs - x.startedAtMs);
    for (const old of others) this.guard(() => { RideRecorder.open(this.deps.dir, old.rideId).finish('aborted'); });
    if (!meta) return;
    const recorder = RideRecorder.open(this.deps.dir, meta.rideId, this.deps.recorderFs);
    let stored: { session: Session; ftpW: number; maxHrBpm?: number; hrMaxBpm?: number };
    try {
      stored = JSON.parse(fs.readFileSync(path.join(this.deps.dir, meta.rideId, 'session.json'), 'utf8')) as typeof stored;
    } catch {
      recorder.finish('aborted'); // Session unknown: the data is kept, continuing the ride is not possible.
      return;
    }
    const ride = readRide(this.deps.dir, meta.rideId);
    const point = resumePoint(ride, stored.session);
    const now = this.deps.nowMs();
    const lastMs = ride.samples.at(-1)?.wallClockMs ?? meta.startedAtMs;
    if (now - lastMs > CRASH_GAP_MS) {
      recorder.event({ wallClockMs: lastMs, type: 'gap-start' });
      recorder.event({ wallClockMs: now, type: 'gap-end' });
    }
    recorder.event({ wallClockMs: now, type: 'resumed', detail: `${point.resumeAtS}` });
    this.setActive({
      recorder, engine: this.newEngine(stored.session, stored.ftpW, { ...point, maxHrBpm: stored.maxHrBpm, hrMaxBpm: stored.hrMaxBpm }), session: stored.session, ftpW: stored.ftpW,
      recovered: true, paused: now - lastMs > LONG_DOWNTIME_MS,
    });
  }

  private setActive(a: Active | null): void {
    this.active = a;
    // A ride needs the trainer, even if it was disconnected by hand before.
    if (a && this.devices.getStatus().trainer === 'off') this.devices.connect('trainer');
    this.guard(() => this.deps.onRideChange?.(a !== null));
  }

  private end(status: 'finished' | 'aborted' | 'discarded'): void {
    const a = this.active;
    if (!a) return;
    a.ending ??= status;
    this.tryFinish(a);
  }

  private tryFinish(a: Active): void {
    if (a.recorder.finish(a.ending!)) {
      const { rideId } = a.recorder.getMeta();
      this.setActive(null);
      if (a.ending !== 'discarded') this.guard(() => this.writeFit(rideId));
    }
    this.broadcastState();
  }

  private freshReadings(): Reading {
    const now = this.deps.nowMs();
    const out: Reading = {};
    for (const key of Object.keys(this.latest) as (keyof Reading)[]) {
      if (now - (this.latestAt[key] ?? 0) <= STALE_READING_MS) out[key] = this.latest[key];
    }
    return out;
  }

  private sendOffer(cb: (m: ServerMessage) => void): void {
    const a = this.active;
    if (!a?.recovered) return;
    const meta = a.recorder.getMeta();
    this.guard(() => cb({
      type: 'recovery-offer', rideId: meta.rideId, profileId: meta.profileId,
      sessionName: a.session.name, rideElapsedS: a.engine.state().rideElapsedS,
    }));
  }
  private broadcastOffer(): void { for (const cb of this.subs) this.sendOffer(cb); }
  private broadcastState(): void {
    const a = this.active;
    this.broadcast({
      type: 'state', ride: a?.recorder.getMeta() ?? null, engine: a?.engine.state() ?? null,
      devices: this.devices.getStatus(), deviceNames: this.devices.getNames(), latest: this.freshReadings(),
      storageError: a?.recorder.hasStorageError() ?? false, recovered: a?.recovered ?? false, profiles: this.profiles(), session: a?.session ?? null,
    });
  }
  private broadcast(m: ServerMessage): void { for (const cb of this.subs) this.guard(() => cb(m)); }
  private guard(fn: () => void): void {
    try { fn(); } catch { /* UI and devices must never disturb the recording */ }
  }
}
