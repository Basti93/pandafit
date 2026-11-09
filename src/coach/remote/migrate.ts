import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseProfile, type Profile } from '../../shared/profiles';
import { readRideFiles, rideHash } from '../ride-upload-format';
import type { Manifest, MigrationItem } from '../server/migration';
import { CoachHttpError, type CoachHttp } from './coach-http';
import { markMealsMoved, markMoved, mealFile, mealsDue, recordDrift, remoteDir } from './home';
import type { RideUploads } from './ride-upload';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

/**
 * paused: ride (a ride opened), records (records not on the server yet), finish (the finish was cut off; asked again with the same
 * snapshot). failed: offline (not reached), changing (the live data kept changing), unreadable (an item here cannot be read),
 * missing (the server misses items after finish), too-large / refused (the server refused a ride or an item).
 */
export type MigrateResult =
  | { state: 'done'; drift?: string[] }
  | { state: 'refused'; reason: 'other-profile' }
  | { state: 'paused'; reason: 'ride' | 'records' | 'finish' }
  | { state: 'failed'; reason: 'offline' | 'changing' | 'unreadable' | 'missing' | 'too-large' | 'refused'; items?: string[] };

export type MigrateOptions = {
  /** Holds `rides/`, `coach/`, `garmin/` and `hevy/`, as the Mac keeps them. Only read, never changed. */
  root: string;
  profileId: string;
  http: CoachHttp;
  uploads: RideUploads;
  /** True once every record of the profile is on the server: until then the switch waits. */
  recordsSettled: () => boolean;
  /** False while a ride is open. Checked before every request. */
  noOpenRide: () => boolean;
  progress: (done: number, total: number) => void;
  nowMs?: () => number;
};

/** How often one run takes a fresh snapshot when the live data keeps changing under it. */
const MAX_ROUNDS = 3;

type Source = { name: MigrationItem; file: string; kind: 'copy' | 'database' | 'secret' };
/** What the Mac holds for a profile, by item. Secrets are never copied: they are hashed and streamed from where they live. */
const sources = (root: string, p: string): Source[] => {
  const coach = path.join(root, 'coach');
  return [
    { name: 'coach-state', file: path.join(coach, `${encodeURIComponent(p)}.json`), kind: 'copy' },
    { name: 'gym-state', file: path.join(coach, 'gym', `${encodeURIComponent(p)}.json`), kind: 'copy' },
    { name: 'garmin-db', file: path.join(root, 'garmin', 'data', p, 'garmin.db'), kind: 'database' },
    { name: 'garmin-sync-meta', file: path.join(root, 'garmin', 'data', p, 'sync-meta.json'), kind: 'copy' },
    { name: 'hevy-workouts', file: path.join(root, 'hevy', p, 'workouts.json'), kind: 'copy' },
    { name: 'hevy-templates', file: path.join(root, 'hevy', p, 'templates.json'), kind: 'copy' },
    { name: 'hevy-key', file: path.join(root, 'hevy', p, 'api-key'), kind: 'secret' },
    { name: 'garmin-tokens', file: path.join(root, 'garmin', 'tokens', p, 'garmin_tokens.json'), kind: 'secret' },
  ];
};
const SECRET = new Set<string>(sources('', 'x').filter((s) => s.kind === 'secret').map((s) => s.name));

/** What a run compares to see whether the live data changed since its snapshot. */
type Snapshot = {
  /** A secret's hash is never stored: it is '' on disk and computed from its file when the snapshot is used. */
  manifest: Manifest;
  /**
   * Per item, how the live file looked when the snapshot was taken: absent, a content hash, or for the database and the secrets
   * the files' size, time and inode. Also the profile and the closed rides.
   */
  live: Record<string, string>;
  /** The item's bytes to send: the staged copy, or for a secret its own file. */
  files: Partial<Record<MigrationItem, string>>;
};

/** An item that is there but cannot be read or copied: never left out, the move fails. */
class Unreadable extends Error {
  constructor(readonly items: string[]) { super('Umzug: Datei nicht lesbar'); }
}

const hashFile = async (file: string): Promise<{ sha256: string; bytes: number }> => {
  const h = createHash('sha256');
  let bytes = 0;
  for await (const c of fs.createReadStream(file) as AsyncIterable<Buffer>) { h.update(c); bytes += c.length; }
  return { sha256: h.digest('hex'), bytes };
};

const statOf = (file: string): string => { try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}:${s.ino}`; } catch { return '-'; } };

/**
 * How a live file looks now. The database by its files, as hashing it whole on every check costs too much; a secret by its file
 * too, so no hash of it is ever kept. A file that is there but cannot be read counts as unreadable, never as absent.
 */
const fingerprint = async (s: Source): Promise<string> => {
  if (!fs.existsSync(s.file)) return 'absent';
  if (s.kind === 'database') return `db ${statOf(s.file)} ${statOf(`${s.file}-wal`)}`;
  if (s.kind === 'secret') return `stat ${statOf(s.file)}`;
  try { return (await hashFile(s.file)).sha256; } catch { return 'unreadable'; }
};

const readProfile = (root: string, profileId: string): Profile | null => {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(root, 'rides', 'profiles.json'), 'utf8')) as unknown;
    if (!Array.isArray(all)) return null;
    const p = all.find((x) => typeof x === 'object' && x !== null && (x as { id?: unknown }).id === profileId);
    return p ? parseProfile(p) : null;
  } catch { return null; }
};

/** A copy of the database with what still sits in its write-ahead log, read through SQLite. */
const vacuumInto = (from: string, to: string): void => {
  fs.rmSync(to, { force: true });
  const db = new DatabaseSync(from, { readOnly: true });
  try { db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`); } finally { db.close(); }
};

const writeJson = (file: string, data: unknown): void => {
  writeJsonAtomic(file, data);
};

/** The reason a refused upload gives the move. */
const refusal = (e: CoachHttpError): 'too-large' | 'refused' => (e.status === 413 || e.reason === 'too-large' ? 'too-large' : 'refused');

/**
 * Moves a linked profile to the server coach, once. Everything the Mac holds for it goes up checked by hash: a snapshot of the
 * coach files in `<coachDir>/remote/<profileId>/staging/`, the rides through the ride uploads, the secrets straight from their
 * files. Before the switch the live files are checked again; a change starts a fresh snapshot. The profile counts as moved only
 * when the server says done for this profile. A cut-off run resumes with the same snapshot and skips what the server already holds.
 * The local files are never changed, and nothing of their content is logged.
 */
export const migrate = async (opts: MigrateOptions): Promise<MigrateResult> => {
  const { root, profileId: p, http } = opts;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const coachDir = path.join(root, 'coach');
  const staging = path.join(remoteDir(coachDir, p), 'staging');
  const saved = path.join(staging, 'snapshot.json');
  /**
   * The live data of the snapshot last sent to finish. Outside staging, so a fresh snapshot never replaces it: should the server
   * have switched on a finish whose answer was lost, a change here since is measured from it. Gone only with the move.
   */
  const sentFile = path.join(remoteDir(coachDir, p), 'finish-sent.json');
  const loadSent = (): Record<string, string> | null => {
    try {
      const d = JSON.parse(fs.readFileSync(sentFile, 'utf8')) as { live?: unknown };
      return d && typeof d.live === 'object' && d.live !== null ? d.live as Record<string, string> : null;
    } catch { return null; }
  };
  const may = (): boolean => { try { return opts.noOpenRide(); } catch { return false; } };
  const settled = (): boolean => { try { return opts.recordsSettled(); } catch { return false; } };
  const progress = (done: number, total: number): void => { try { opts.progress(done, total); } catch { /* only a display */ } };
  const all = sources(root, p);

  const liveNow = async (): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const s of all) out[s.name] = await fingerprint(s);
    const profile = readProfile(root, p);
    out.profile = profile ? JSON.stringify(profile) : 'absent';
    out.rides = opts.uploads.closed(p).join(',');
    return out;
  };
  const differing = (a: Record<string, string>, b: Record<string, string>): string[] =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);

  /** The snapshot an earlier run left, as it was written. */
  const load = (): Snapshot | null => {
    let s: Snapshot;
    try { s = JSON.parse(fs.readFileSync(saved, 'utf8')) as Snapshot; } catch { return null; }
    if (!s || typeof s !== 'object' || !s.manifest || !s.live || !s.files) return null;
    return s;
  };
  /** A loaded snapshot ready to send: its files there and the secrets' hashes computed from their files. Null if it cannot be used. */
  const ready = async (s: Snapshot): Promise<Snapshot | null> => {
    if (!Object.values(s.files).every((f) => typeof f === 'string' && fs.existsSync(f))) return null;
    const items: Manifest['items'] = [];
    for (const i of s.manifest.items) {
      if (!SECRET.has(i.name)) { items.push(i); continue; }
      try { items.push({ name: i.name, ...(await hashFile(s.files[i.name]!)) }); } catch { return null; }
    }
    return { ...s, manifest: { ...s.manifest, items } };
  };

  const take = async (): Promise<Snapshot | null> => {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    // Looked at first, so a change while copying shows up at the check before the switch.
    const live = await liveNow();
    const profile = readProfile(root, p);
    if (!profile) return null;
    const unreadable = all.filter((s) => live[s.name] === 'unreadable').map((s) => s.name);
    const items: Manifest['items'] = [];
    const files: Snapshot['files'] = {};
    for (const s of all) {
      // Only an item that is not there is left out.
      if (live[s.name] === 'absent' || live[s.name] === 'unreadable') continue;
      let file = s.file;
      try {
        if (s.kind === 'database') { file = path.join(staging, s.name); vacuumInto(s.file, file); }
        else if (s.kind === 'copy') { file = path.join(staging, s.name); fs.copyFileSync(s.file, file); }
        items.push({ name: s.name, ...(await hashFile(file)) });
        files[s.name] = file;
      } catch {
        unreadable.push(s.name);
      }
    }
    if (unreadable.length > 0) throw new Unreadable(unreadable);
    const rides: Manifest['rides'] = [];
    for (const rideId of opts.uploads.closed(p)) {
      try { rides.push({ rideId, sha256: rideHash(readRideFiles(path.join(root, 'rides', rideId))) }); } catch { /* unreadable: not part of the move */ }
    }
    const snap: Snapshot = { manifest: { profile, rides, items }, live, files };
    // No hash of a secret on disk.
    writeJson(saved, { ...snap, manifest: { ...snap.manifest, items: items.map((i) => (SECRET.has(i.name) ? { ...i, sha256: '' } : i)) } });
    return snap;
  };

  /**
   * The server switched. When it did on an earlier, cut-off finish and the data here changed since that snapshot, the changes stay
   * here, are listed for the coach view and logged once by item name. Records travel through the account sync anyway; rides closed
   * later through the ride uploads.
   */
  const done = (counts: { rides: number; items: number }, switched: Record<string, string> | null, live: Record<string, string>): MigrateResult => {
    const drift = switched ? differing(switched, live).filter((k) => k !== 'rides') : [];
    markMoved(coachDir, p, { atMs: nowMs(), counts });
    if (drift.length > 0) {
      recordDrift(coachDir, p, drift, nowMs());
      console.warn(`Coach-Umzug: nach dem Wechsel hier geändert und nicht übertragen: ${drift.join(', ')}`);
    }
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(sentFile, { force: true });
    return drift.length > 0 ? { state: 'done', drift } : { state: 'done' };
  };

  /** One pass with one snapshot: 'changed' when the live data moved on under it. */
  const pass = async (snap: Snapshot): Promise<MigrateResult | 'changed'> => {
    const m = snap.manifest;
    if (!may()) return { state: 'paused', reason: 'ride' };
    const b = await http.begin(m);
    if (b.state === 'refused') return { state: 'refused', reason: 'other-profile' };
    if (b.state === 'done') {
      // Done for another profile is not ours: the account holds someone else.
      if (b.profileId !== p) return { state: 'refused', reason: 'other-profile' };
      // The server took the snapshot an earlier finish sent: the drift is measured from that one.
      return done({ rides: m.rides.length, items: m.items.length }, loadSent(), await liveNow());
    }
    const total = m.rides.length + m.items.length;
    let count = 0;
    const haveRides = new Set(b.haveRides);
    const haveItems = new Set(b.haveItems);
    for (const r of m.rides) if (haveRides.has(r.rideId)) { opts.uploads.remember(p, r.rideId, r.sha256); count++; }
    for (const i of m.items) if (haveItems.has(i.name)) count++;
    progress(count, total);
    for (const r of m.rides) {
      if (haveRides.has(r.rideId)) continue;
      if (!may()) return { state: 'paused', reason: 'ride' };
      await opts.uploads.upload(p, r.rideId, http);
      progress(++count, total);
    }
    for (const i of m.items) {
      if (haveItems.has(i.name)) continue;
      if (!may()) return { state: 'paused', reason: 'ride' };
      await http.putItem(i.name, snap.files[i.name]!, i.sha256);
      progress(++count, total);
    }
    if (differing(snap.live, await liveNow()).length > 0) return 'changed';
    // Records made here before the switch must be on the server first.
    if (!settled()) return { state: 'paused', reason: 'records' };
    if (!may()) return { state: 'paused', reason: 'ride' };
    // Written before the request: the server may switch even when its answer never arrives.
    writeJson(sentFile, { atMs: nowMs(), live: snap.live });
    let f;
    try { f = await http.finish(m); } catch (e) {
      // A cut connection or a timeout: the finish is asked again next time with the same snapshot, never counted as failed.
      if (e instanceof CoachHttpError && (e.kind === 'offline' || e.kind === 'stopped')) return { state: 'paused', reason: 'finish' };
      throw e;
    }
    if (f.state === 'missing') return { state: 'failed', reason: 'missing', items: [...f.items, ...f.rides] };
    return done(f.counts, null, snap.live);
  };

  try {
    if (!may()) return { state: 'paused', reason: 'ride' };
    // The snapshot an earlier run left: used again while the live data is unchanged.
    const earlier = load();
    let first: Snapshot | null = null;
    if (earlier && differing(earlier.live, await liveNow()).length === 0) first = await ready(earlier);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (!may()) return { state: 'paused', reason: 'ride' };
      const snap = (round === 0 ? first : null) ?? await take();
      if (!snap) return { state: 'failed', reason: 'unreadable', items: ['profile'] };
      const out = await pass(snap);
      if (out !== 'changed') return out;
    }
    return { state: 'failed', reason: 'changing' };
  } catch (e) {
    if (e instanceof Unreadable) return { state: 'failed', reason: 'unreadable', items: e.items };
    if (e instanceof CoachHttpError) {
      if (e.kind === 'stopped') return { state: 'paused', reason: 'ride' };
      if (e.kind === 'refused') return { state: 'failed', reason: refusal(e) };
    }
    return { state: 'failed', reason: 'offline' };
  }
};

/**
 * The household's meal file goes up through one moved profile, once everyone it counts has moved. Without a meal file here
 * the server's meal plan starts empty. True when it went up now.
 */
export const moveMeals = async (o: { coachDir: string; profileIds: string[]; onServer: (id: string) => boolean; http: (id: string) => CoachHttp | null; nowMs?: () => number }): Promise<boolean> => {
  if (!mealsDue(o.coachDir, o.profileIds, o.onServer)) return false;
  const via = o.profileIds.find((id) => { try { return o.onServer(id); } catch { return false; } });
  const http = via ? o.http(via) : null;
  if (!http) return false;
  let file = mealFile(o.coachDir);
  if (!fs.existsSync(file)) {
    file = path.join(o.coachDir, 'remote', 'meals-empty.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{}');
  }
  await http.meals(file);
  markMealsMoved(o.coachDir, (o.nowMs ?? Date.now)());
  return true;
};
