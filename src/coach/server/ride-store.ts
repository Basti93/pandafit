import fs from 'node:fs';
import path from 'node:path';
import { exportFit } from '../../service/export/fit';
import { readRide } from '../../service/recorder';
import { RIDE_FILE_NAMES, RIDE_ID, readRideFiles, readRideUpload, rideHash, type RideFiles, type RideUpload } from '../ride-upload-format';
import { writeFileAtomic } from '../../shared/node/atomic-write';

export type StoreResult = { ok: true; sha256: string; same: boolean } | { ok: false; reason: 'invalid' | 'hash' | 'open' | 'profile' };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const writeSynced = (file: string, data: string | Buffer): void => writeFileAtomic(file, data, { mode: 0o600 });

/** A FIT file starts with a header of at least 14 bytes that has `.FIT` at bytes 8 to 11. */
const isFit = (b: Buffer): boolean => b.length >= 14 && b.subarray(8, 12).toString('latin1') === '.FIT';

type Parsed = { rideId: string; files: RideFiles; fit: Buffer | null; sha256: string; meta: Record<string, unknown> };

const parseUpload = (upload: unknown): Parsed | null => {
  if (!isObj(upload) || upload.v !== 1 || typeof upload.rideId !== 'string' || !RIDE_ID.test(upload.rideId)) return null;
  if (typeof upload.sha256 !== 'string' || !isObj(upload.files)) return null;
  const f = upload.files;
  if (RIDE_FILE_NAMES.some((n) => typeof f[n] !== 'string')) return null;
  if (upload.fit !== null && typeof upload.fit !== 'string') return null;
  const files = Object.fromEntries(RIDE_FILE_NAMES.map((n) => [n, f[n] as string])) as RideFiles;
  let meta: unknown;
  try { meta = JSON.parse(files['meta.json']); JSON.parse(files['session.json']); } catch { return null; }
  if (!isObj(meta) || meta.rideId !== upload.rideId || typeof meta.profileId !== 'string' || typeof meta.status !== 'string') return null;
  // FIT bytes are not in the hash: anything that is no FIT file is dropped and made from the samples instead.
  const decoded = typeof upload.fit === 'string' ? Buffer.from(upload.fit, 'base64') : null;
  const fit = decoded && isFit(decoded) ? decoded : null;
  return { rideId: upload.rideId, files, fit, sha256: upload.sha256, meta };
};

/**
 * Stores a finished ride of the Mac in the recorder's layout. The files go to `.incoming-<rideId>` first and are renamed in one step,
 * so a crash leaves no half ride under the real name. A changed copy moves the old folder to `<rideId>.replaced-<ms>`; nothing is deleted.
 */
export const storeRide = (opts: { ridesDir: string; profileId: string; upload: unknown; nowMs: number }): StoreResult => {
  const u = parseUpload(opts.upload);
  if (!u) return { ok: false, reason: 'invalid' };
  if (rideHash(u.files) !== u.sha256) return { ok: false, reason: 'hash' };
  // Only a closed ride counts: open and discarded ones stay on the Mac.
  if (u.meta.status !== 'finished' && u.meta.status !== 'aborted') return { ok: false, reason: 'open' };
  if (u.meta.profileId !== opts.profileId) return { ok: false, reason: 'profile' };

  const { ridesDir } = opts;
  const finalDir = path.join(ridesDir, u.rideId);
  const incoming = path.join(ridesDir, `.incoming-${u.rideId}`);
  const fitFile = path.join(ridesDir, 'exports', `${u.rideId}.fit`);
  const fitTmp = `${fitFile}.incoming`;
  fs.mkdirSync(path.join(ridesDir, 'exports'), { recursive: true });

  if (fs.existsSync(finalDir)) {
    let same = false;
    try { same = rideHash(readRideFiles(finalDir)) === u.sha256; } catch { /* unreadable copy: replace it */ }
    if (same) {
      // A crash can leave the ride without its FIT; the retry makes it good again.
      let size = 0;
      try { size = fs.statSync(fitFile).size; } catch { /* missing */ }
      if (size === 0) {
        writeSynced(fitTmp, u.fit ?? exportFit(readRide(ridesDir, u.rideId)));
        fs.renameSync(fitTmp, fitFile);
      }
      return { ok: true, sha256: u.sha256, same: true };
    }
  }

  fs.rmSync(incoming, { recursive: true, force: true });
  fs.mkdirSync(incoming, { mode: 0o700 });
  try {
    for (const n of RIDE_FILE_NAMES) writeSynced(path.join(incoming, n), u.files[n]);
    // A FIT file from the Mac is kept; otherwise one is made from the samples.
    writeSynced(fitTmp, u.fit ?? exportFit(readRide(ridesDir, `.incoming-${u.rideId}`)));
    // The FIT goes first: a ride folder under its real name always has its FIT. The old FIT is kept next to the old folder.
    if (fs.existsSync(fitFile)) fs.renameSync(fitFile, path.join(ridesDir, 'exports', `${u.rideId}.replaced-${opts.nowMs}.fit`));
    fs.renameSync(fitTmp, fitFile);
    if (fs.existsSync(finalDir)) fs.renameSync(finalDir, path.join(ridesDir, `${u.rideId}.replaced-${opts.nowMs}`));
    fs.renameSync(incoming, finalDir);
  } catch (e) {
    fs.rmSync(incoming, { recursive: true, force: true });
    throw e;
  }
  return { ok: true, sha256: u.sha256, same: false };
};

export type StoredRide = { rideId: string; sha256: string; status: 'finished' | 'aborted'; startedAtMs: number };

/** The closed ride of this profile in the folder, or null: not there, not closed, another profile's, or unreadable. */
const closedMeta = (ridesDir: string, rideId: string, profileId: string): { status: 'finished' | 'aborted'; startedAtMs: number } | null => {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(ridesDir, rideId, 'meta.json'), 'utf8')) as unknown;
    if (!isObj(meta) || meta.rideId !== rideId || meta.profileId !== profileId) return null;
    if (meta.status !== 'finished' && meta.status !== 'aborted') return null;
    return { status: meta.status, startedAtMs: typeof meta.startedAtMs === 'number' ? meta.startedAtMs : 0 };
  } catch { return null; }
};

/** The profile's closed rides the server holds, oldest first. Folders like `.replaced-<ms>` and `.incoming-` do not count. */
export const listRides = (ridesDir: string, profileId: string): StoredRide[] => {
  let names: string[] = [];
  try { names = fs.readdirSync(ridesDir); } catch { return []; }
  const out: StoredRide[] = [];
  for (const rideId of names.filter((n) => RIDE_ID.test(n)).sort()) {
    const m = closedMeta(ridesDir, rideId, profileId);
    if (!m) continue;
    try { out.push({ rideId, sha256: rideHash(readRideFiles(path.join(ridesDir, rideId))), ...m }); } catch { /* unreadable: not listed */ }
  }
  return out;
};

/** One closed ride of this profile in the upload format, or null. */
export const loadRide = (ridesDir: string, rideId: string, profileId: string): RideUpload | null => {
  if (!RIDE_ID.test(rideId) || !closedMeta(ridesDir, rideId, profileId)) return null;
  try { return readRideUpload(ridesDir, rideId); } catch { return null; }
};
