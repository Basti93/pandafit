import fs from 'node:fs';
import path from 'node:path';
import { exportFit } from '../../ride-format/export/fit';
import { readRide } from '../../ride-format/read';
import { RIDE_FILE_NAMES, RIDE_ID, readRideFiles, rideHash } from '../ride-upload-format';
import { CoachHttpError, type CoachHttp } from './coach-http';
import { writeFileAtomic } from '../../shared/node/atomic-write';

/** After a failed run, a profile's restore waits this long. */
const RETRY_MS = 60_000;

export type RideRestoreOptions = {
  /** The recorder's rides folder. Rides are only ever added here, never changed or removed. */
  ridesDir: string;
  /** The upload ledger: a restored ride is marked, so it is never uploaded again. */
  uploads: { remember: (profileId: string, rideId: string, sha256: string) => void };
  /** The server coach's routes for a profile, or null without a link. */
  http: (profileId: string) => CoachHttp | null;
  /** False while a ride is open. Checked before every request. */
  noOpenRide: () => boolean;
  nowMs?: () => number;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const SAFE_ID = /^[A-Za-z0-9-]+$/;

const writeSynced = (file: string, data: string | Buffer): void => writeFileAtomic(file, data, { mode: 0o600 });
const isFit = (b: Buffer): boolean => b.length >= 14 && b.subarray(8, 12).toString('latin1') === '.FIT';

/**
 * Brings back what the server holds and this Mac does not: a moved profile's closed rides, by ride id. A ride already here, whatever
 * its content, is never touched. Each ride is checked against its hash, written to a hidden folder and renamed in one step, so a crash
 * leaves no half ride under the real name. Done once per profile (again after it was linked anew); a failure is tried again later.
 */
export class RideRestore {
  private done = new Set<string>();
  private failedMs = new Map<string, number>();
  private running: Promise<void> | null = null;
  private readonly nowMs: () => number;

  constructor(private readonly opts: RideRestoreOptions) { this.nowMs = opts.nowMs ?? (() => Date.now()); }

  /** The profile is not on the server (not linked or not moved): the next time it is, the restore runs again. */
  reset(profileId: string): void { this.done.delete(profileId); this.failedMs.delete(profileId); }

  /** Whether the restore ran through for this profile since it was last reset. */
  finished(profileId: string): boolean { return this.done.has(profileId); }

  /** Never rejects. */
  tick(profileId: string): Promise<void> {
    if (this.running) return this.running;
    if (this.done.has(profileId)) return Promise.resolve();
    const last = this.failedMs.get(profileId);
    if (last !== undefined && this.nowMs() - last < RETRY_MS) return Promise.resolve();
    const run = this.run(profileId).catch(() => { this.failedMs.set(profileId, this.nowMs()); }).finally(() => { if (this.running === run) this.running = null; });
    this.running = run;
    return run;
  }

  private may(): boolean { try { return this.opts.noOpenRide(); } catch { return false; } }

  private async run(profileId: string): Promise<void> {
    if (!SAFE_ID.test(profileId) || !this.may()) return;
    const http = this.opts.http(profileId);
    if (!http) return;
    const { ridesDir } = this.opts;
    let clean = true;
    for (const listed of await http.listRides()) {
      if (!RIDE_ID.test(listed.rideId) || fs.existsSync(path.join(ridesDir, listed.rideId))) continue;
      if (!this.may()) return;
      let u;
      try { u = await http.getRide(listed.rideId); } catch (e) {
        if (e instanceof CoachHttpError && e.kind === 'refused') { clean = false; continue; }
        if (e instanceof CoachHttpError && e.kind === 'stopped') return;
        throw e;
      }
      if (!this.may()) return;
      if (this.install(profileId, listed.rideId, listed.sha256, u)) this.opts.uploads.remember(profileId, listed.rideId, listed.sha256);
      else clean = false;
    }
    // A ride the server would not give or that failed its check is left for the next start; the rest is done.
    this.failedMs.delete(profileId);
    if (clean) this.done.add(profileId);
  }

  /** Writes one downloaded ride if it is what the server listed. False if it is rejected. */
  private install(profileId: string, rideId: string, listedSha: string, u: unknown): boolean {
    if (!isObj(u) || u.v !== 1 || u.rideId !== rideId || u.sha256 !== listedSha || !isObj(u.files)) return false;
    const f = u.files;
    if (RIDE_FILE_NAMES.some((n) => typeof f[n] !== 'string')) return false;
    const files = Object.fromEntries(RIDE_FILE_NAMES.map((n) => [n, f[n] as string])) as Parameters<typeof rideHash>[0];
    if (rideHash(files) !== listedSha) return false;
    try {
      const meta = JSON.parse(files['meta.json']) as unknown;
      JSON.parse(files['session.json']);
      if (!isObj(meta) || meta.rideId !== rideId || meta.profileId !== profileId || (meta.status !== 'finished' && meta.status !== 'aborted')) return false;
    } catch { return false; }

    const { ridesDir } = this.opts;
    const finalDir = path.join(ridesDir, rideId);
    const incoming = path.join(ridesDir, `.restore-${rideId}`);
    const exportsDir = path.join(ridesDir, 'exports');
    const fitFile = path.join(exportsDir, `${rideId}.fit`);
    const fitTmp = `${fitFile}.restore`;
    fs.mkdirSync(exportsDir, { recursive: true });
    // Only this job's own leftovers from a crash are removed, never a ride.
    fs.rmSync(incoming, { recursive: true, force: true });
    fs.mkdirSync(incoming, { mode: 0o700 });
    try {
      for (const n of RIDE_FILE_NAMES) writeSynced(path.join(incoming, n), files[n]);
      if (!fs.existsSync(fitFile)) {
        const decoded = typeof u.fit === 'string' ? Buffer.from(u.fit, 'base64') : null;
        try {
          writeSynced(fitTmp, decoded && isFit(decoded) ? decoded : exportFit(readRide(ridesDir, `.restore-${rideId}`)));
          fs.renameSync(fitTmp, fitFile);
        } catch { fs.rmSync(fitTmp, { force: true }); /* no FIT: it can be made later */ }
      }
      // Re-check right before the rename: a ride that appeared meanwhile is never replaced.
      if (fs.existsSync(finalDir)) { fs.rmSync(incoming, { recursive: true, force: true }); return false; }
      fs.renameSync(incoming, finalDir);
    } catch {
      fs.rmSync(incoming, { recursive: true, force: true });
      return false;
    }
    try { if (rideHash(readRideFiles(finalDir)) !== listedSha) return false; } catch { return false; }
    return true;
  }
}
