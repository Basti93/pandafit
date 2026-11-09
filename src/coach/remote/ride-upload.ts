import fs from 'node:fs';
import path from 'node:path';
import { RIDE_ID, readRideUpload } from '../ride-upload-format';
import { CoachHttpError, type CoachHttp } from './coach-http';
import { remoteDir } from './home';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

/** After a failed run, a profile's uploads wait this long. */
const RETRY_MS = 60_000;
/** A ride the server refuses for good (too large) waits longer each time, up to this. */
const MAX_REFUSED_WAIT_MS = 6 * 3_600_000;
/** The api's limit for a ride upload. */
const MAX_RIDE_BYTES = 32 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9-]+$/;

export type RideUploadsOptions = {
  /** The recorder's rides folder. Only read, never written. */
  ridesDir: string;
  /** The local coach folder: the ledger lives in `<dir>/remote/<profileId>/rides.json`. */
  dir: string;
  /** The server coach's routes for a profile, or null without a link. */
  http: (profileId: string) => CoachHttp | null;
  /** False while a ride is open. Checked before every request. */
  noOpenRide: () => boolean;
  nowMs?: () => number;
  /** Default: the api's limit of 32 MiB. For tests. */
  maxBytes?: number;
};

/** A ride the server refused: why, how often, and when it is tried again. */
type Refused = { reason: 'too-large' | 'refused'; tries: number; nextMs: number };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A closed ride is one the recorder finished or aborted. Open and discarded rides stay on the Mac. */
const closedRide = (ridesDir: string, rideId: string, profileId: string): boolean => {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(ridesDir, rideId, 'meta.json'), 'utf8')) as unknown;
    return isObj(meta) && meta.rideId === rideId && meta.profileId === profileId && (meta.status === 'finished' || meta.status === 'aborted');
  } catch { return false; }
};

/**
 * Uploads a moved profile's finished rides after the ride, retried until the server confirmed the same hash. The ledger
 * remembers what the server holds. The ride files are only read: they stay on the Mac exactly as they are.
 */
export class RideUploads {
  private running: Promise<void> | null = null;
  private failedMs = new Map<string, number>();
  private readonly nowMs: () => number;

  constructor(private readonly opts: RideUploadsOptions) {
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  private ledgerFile(profileId: string): string { return path.join(remoteDir(this.opts.dir, profileId), 'rides.json'); }

  private refusedFile(profileId: string): string { return path.join(remoteDir(this.opts.dir, profileId), 'rides-refused.json'); }
  private refusals(profileId: string): Record<string, Refused> {
    try {
      const d = JSON.parse(fs.readFileSync(this.refusedFile(profileId), 'utf8')) as unknown;
      if (!isObj(d)) return {};
      return Object.fromEntries(Object.entries(d).filter((e): e is [string, Refused] => isObj(e[1]) && typeof e[1].tries === 'number' && typeof e[1].nextMs === 'number'
        && (e[1].reason === 'too-large' || e[1].reason === 'refused')));
    } catch { return {}; }
  }
  private saveRefusals(profileId: string, d: Record<string, Refused>): void {
    const f = this.refusedFile(profileId);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    writeJsonAtomic(f, d);
  }
  /** A refusal waits 1 min, then twice as long each time, up to six hours. */
  private refuse(profileId: string, rideId: string, reason: Refused['reason']): void {
    const d = this.refusals(profileId);
    const tries = (d[rideId]?.tries ?? 0) + 1;
    d[rideId] = { reason, tries, nextMs: this.nowMs() + Math.min(RETRY_MS * 2 ** (tries - 1), MAX_REFUSED_WAIT_MS) };
    this.saveRefusals(profileId, d);
  }

  /** Rides the server refused, for the coach view: why and how often. */
  refused(profileId: string): { rideId: string; reason: Refused['reason']; tries: number }[] {
    return Object.entries(this.refusals(profileId)).map(([rideId, r]) => ({ rideId, reason: r.reason, tries: r.tries }));
  }

  /** rideId → the hash the server confirmed. */
  private ledger(profileId: string): Record<string, string> {
    try {
      const d = JSON.parse(fs.readFileSync(this.ledgerFile(profileId), 'utf8')) as unknown;
      if (!isObj(d)) return {};
      return Object.fromEntries(Object.entries(d).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch { return {}; }
  }

  /** The server holds this ride with this hash. */
  remember(profileId: string, rideId: string, sha256: string): void {
    if (!SAFE_ID.test(profileId)) return;
    const f = this.ledgerFile(profileId);
    const d = { ...this.ledger(profileId), [rideId]: sha256 };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    writeJsonAtomic(f, d);
  }

  /** The profile's closed rides, oldest first. */
  closed(profileId: string): string[] {
    if (!SAFE_ID.test(profileId)) return [];
    let names: string[];
    try { names = fs.readdirSync(this.opts.ridesDir); } catch { return []; }
    return names.filter((n) => RIDE_ID.test(n) && closedRide(this.opts.ridesDir, n, profileId)).sort();
  }

  /** Closed rides the server does not hold yet. */
  pending(profileId: string): string[] {
    const have = this.ledger(profileId);
    return this.closed(profileId).filter((id) => have[id] === undefined);
  }

  /** One ride up. Throws CoachHttpError; the ledger changes only when the server confirms the same hash. */
  async upload(profileId: string, rideId: string, http: CoachHttp): Promise<void> {
    // Read again right before the request: only a closed ride of this profile goes.
    if (!closedRide(this.opts.ridesDir, rideId, profileId)) throw new CoachHttpError('refused', null, 'open');
    const u = readRideUpload(this.opts.ridesDir, rideId);
    // Over the api's limit it would be refused anyway: not sent at all.
    if (Buffer.byteLength(JSON.stringify(u)) > (this.opts.maxBytes ?? MAX_RIDE_BYTES)) throw new CoachHttpError('refused', 413, 'too-large');
    const out = await http.putRide(u);
    if (out.sha256 !== u.sha256) throw new CoachHttpError('refused', null, 'hash');
    this.remember(profileId, rideId, u.sha256);
    const d = this.refusals(profileId);
    if (d[rideId]) { delete d[rideId]; this.saveRefusals(profileId, d); }
  }

  /**
   * Uploads what is pending, one ride after the other. Safe to call from the scan without awaiting; never rejects. Stops at once
   * when a ride opens, and waits a minute after a failure.
   */
  tick(profileId: string): Promise<void> {
    if (this.running) return this.running;
    const last = this.failedMs.get(profileId);
    if (last !== undefined && this.nowMs() - last < RETRY_MS) return Promise.resolve();
    const run = this.run(profileId).catch(() => { this.failedMs.set(profileId, this.nowMs()); }).finally(() => { if (this.running === run) this.running = null; });
    this.running = run;
    return run;
  }

  private async run(profileId: string): Promise<void> {
    const may = (): boolean => { try { return this.opts.noOpenRide(); } catch { return false; } };
    if (!may()) return;
    const pending = this.pending(profileId);
    if (pending.length === 0) return;
    const http = this.opts.http(profileId);
    if (!http) return;
    const refused = this.refusals(profileId);
    for (const rideId of pending) {
      if ((refused[rideId]?.nextMs ?? 0) > this.nowMs()) continue;
      if (!may()) return;
      try { await this.upload(profileId, rideId, http); } catch (e) {
        // A ride opened: no failure, it goes on after the ride.
        if (e instanceof CoachHttpError && e.kind === 'stopped') return;
        // The server is not there or the link was refused: the rest waits too. A refused ride waits on its own and does not hold up the others.
        if (!(e instanceof CoachHttpError) || e.kind !== 'refused') throw e;
        this.refuse(profileId, rideId, e.status === 413 || e.reason === 'too-large' ? 'too-large' : 'refused');
      }
    }
    this.failedMs.delete(profileId);
  }
}
