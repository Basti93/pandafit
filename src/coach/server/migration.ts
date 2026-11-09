import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { parseProfile, type Profile } from '../../shared/profiles';
import { RIDE_ID, readRideFiles, rideHash } from '../ride-upload-format';
import { sealedCodec } from '../secrets/secret-box';
import { writeFileAtomic } from '../../shared/node/atomic-write';

export type MigrationItem = 'coach-state' | 'gym-state' | 'garmin-db' | 'garmin-sync-meta' | 'hevy-workouts' | 'hevy-templates' | 'hevy-key' | 'garmin-tokens';
export type Manifest = { profile: Profile; rides: { rideId: string; sha256: string }[]; items: { name: MigrationItem; sha256: string; bytes: number }[] };

export type BeginResult = { state: 'open'; haveItems: MigrationItem[]; haveRides: string[] } | { state: 'done'; profileId: string } | { state: 'refused'; reason: 'other-profile' };
export type FinishResult = { state: 'done'; counts: { rides: number; items: number } } | { state: 'missing'; items: MigrationItem[]; rides: string[] };

/** Refusals that are not part of the desk's answers: a broken manifest, a finish before begin, an item past its size. Carries no content. */
export class MigrationError extends Error {
  constructor(readonly reason: 'invalid' | 'not-begun' | 'too-large') { super(`Umzug: ${reason}`); }
}

export type MigrationDeskOptions = {
  /** The household root: holds `accounts/<id>/`. */
  root: string;
  secretKey: Buffer;
  /** After the moved marker is written. */
  onMoved: (accountId: number) => void;
  nowMs?: () => number;
  /** Takes a person's uploaded meal file into the household. Goes through the household, so it never writes behind the meal plan's back. */
  meals: (profileId: string, upload: Record<string, unknown>) => void;
};

/** The most bytes of one item; the route has the same limit. */
export const MAX_ITEM_BYTES = 128 * 1024 * 1024;
/** A secret is read whole to be sealed, so it stays small. */
const MAX_SECRET_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ACCOUNT_DIR = /^[1-9][0-9]{0,15}$/;

/** Where each item goes in the account's folder, for profile `p`. Only these names ever become paths. */
const INSTALL: Record<MigrationItem, (p: string) => string[]> = {
  'coach-state': (p) => ['coach', `${p}.json`],
  'gym-state': (p) => ['coach', 'gym', `${p}.json`],
  'garmin-db': (p) => ['garmin', 'data', p, 'garmin.db'],
  'garmin-sync-meta': (p) => ['garmin', 'data', p, 'sync-meta.json'],
  'hevy-workouts': (p) => ['hevy', p, 'workouts.json'],
  'hevy-templates': (p) => ['hevy', p, 'templates.json'],
  'hevy-key': (p) => ['hevy', p, 'api-key'],
  'garmin-tokens': (p) => ['garmin', 'tokens', p, 'garmin_tokens.json.sealed'],
};
/** Secrets are sealed as they arrive, with the label the account's coach opens them with. */
const SECRET_LABEL: Partial<Record<MigrationItem, string>> = { 'hevy-key': 'hevy', 'garmin-tokens': 'garmin' };
const ITEMS = Object.keys(INSTALL) as MigrationItem[];
const isItem = (name: unknown): name is MigrationItem => typeof name === 'string' && Object.prototype.hasOwnProperty.call(INSTALL, name);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A manifest as the Mac sends it, checked. Null for anything else. */
export const parseManifest = (x: unknown): Manifest | null => {
  if (!isObj(x) || !Array.isArray(x.rides) || !Array.isArray(x.items)) return null;
  let profile: Profile;
  try { profile = parseProfile(x.profile); } catch { return null; }
  if (!SAFE_ID.test(profile.id)) return null;
  const rides: Manifest['rides'] = [];
  const rideIds = new Set<string>();
  for (const r of x.rides) {
    if (!isObj(r) || typeof r.rideId !== 'string' || !RIDE_ID.test(r.rideId) || typeof r.sha256 !== 'string' || !SHA256.test(r.sha256) || rideIds.has(r.rideId)) return null;
    rideIds.add(r.rideId);
    rides.push({ rideId: r.rideId, sha256: r.sha256 });
  }
  const items: Manifest['items'] = [];
  const names = new Set<string>();
  for (const i of x.items) {
    if (!isObj(i) || !isItem(i.name) || names.has(i.name) || typeof i.sha256 !== 'string' || !SHA256.test(i.sha256)) return null;
    if (typeof i.bytes !== 'number' || !Number.isSafeInteger(i.bytes) || i.bytes < 0 || i.bytes > MAX_ITEM_BYTES) return null;
    names.add(i.name);
    items.push({ name: i.name, sha256: i.sha256, bytes: i.bytes });
  }
  return { profile, rides, items };
};

const readJson = (file: string): unknown => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readProfileId = (file: string): string | null => {
  try {
    const p = parseProfile(readJson(file));
    return SAFE_ID.test(p.id) ? p.id : null;
  } catch { return null; }
};

const fsyncFile = (file: string): void => {
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
/** Makes the renames inside a folder durable. */
const fsyncDir = (dir: string): void => {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
const writeSynced = (file: string, data: string | Buffer): void => writeFileAtomic(file, data, { mode: 0o600 });
/** A copy under a temp name, renamed in one step: the target is either the old file or the whole new one. */
const copySynced = (from: string, to: string): void => {
  fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
  const tmp = `${to}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.copyFileSync(from, tmp);
    fs.chmodSync(tmp, 0o600);
    fsyncFile(tmp);
    fs.renameSync(tmp, to);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
};

/** `PRAGMA integrity_check` on a read-only open. Any error counts as broken. The journal files SQLite leaves are removed. */
const databaseOk = (file: string): boolean => {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check?: unknown }[];
    return rows.length === 1 && rows[0]!.integrity_check === 'ok';
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch { /* closed */ }
    for (const s of ['-wal', '-shm']) fs.rmSync(`${file}${s}`, { force: true });
  }
};

type Held = { sha256: string; bytes: number };

/**
 * The server side of a profile's move from the Mac. `begin` binds the profile id to the account (one profile per account, one account
 * per profile), items wait in `accounts/<id>/migrate/incoming/` with their hash, rides arrive through `PUT /rides/:rideId`, and `finish`
 * installs only when everything the manifest names is there with the same hash. The moved marker is written last, so a crash leaves
 * either the account as it was or the whole move. Secrets are sealed as they arrive and never logged or answered.
 */
export class MigrationDesk {
  private readonly nowMs: () => number;

  constructor(private readonly opts: MigrationDeskOptions) {
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.sweepParts();
  }

  /** Parts an earlier process left behind when it stopped mid-upload: never trusted, never kept. */
  private sweepParts(): void {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(this.opts.root, 'accounts')); } catch { return; }
    for (const n of names) {
      if (!ACCOUNT_DIR.test(n)) continue;
      const dir = path.join(this.opts.root, 'accounts', n, 'migrate', 'incoming');
      let files: string[] = [];
      try { files = fs.readdirSync(dir); } catch { continue; }
      for (const f of files) if (f.startsWith('.') && f.endsWith('.part')) fs.rmSync(path.join(dir, f), { force: true });
    }
  }

  /**
   * What follows the moved marker: the waiting items go, the coach starts and the meal plan may move. Safe to repeat, so a crash
   * after the marker is made good by the next begin or finish.
   */
  private complete(accountId: number): void {
    fs.rmSync(path.join(this.accountDir(accountId), 'migrate'), { recursive: true, force: true });
    this.opts.onMoved(accountId);
  }

  private accountDir(accountId: number): string {
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new MigrationError('invalid');
    return path.join(this.opts.root, 'accounts', String(accountId));
  }
  private incoming(accountId: number): string { return path.join(this.accountDir(accountId), 'migrate', 'incoming'); }
  private moved(accountId: number): boolean { return fs.existsSync(path.join(this.accountDir(accountId), 'moved.json')); }

  /** The profile id bound to the account by begin (or by the move), else null. */
  boundProfileId(accountId: number): string | null {
    return readProfileId(path.join(this.accountDir(accountId), 'profile.json'));
  }

  /** Every other account's bound profile id. */
  private heldElsewhere(accountId: number, profileId: string): boolean {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(this.opts.root, 'accounts')); } catch { /* no account yet */ }
    return names.some((n) => ACCOUNT_DIR.test(n) && Number(n) !== accountId && this.boundProfileId(Number(n)) === profileId);
  }

  private held(accountId: number, name: MigrationItem): Held | null {
    const dir = this.incoming(accountId);
    if (!fs.existsSync(path.join(dir, name))) return null;
    const meta = readJson(path.join(dir, `${name}.meta.json`));
    if (!isObj(meta) || typeof meta.sha256 !== 'string' || typeof meta.bytes !== 'number') return null;
    return { sha256: meta.sha256, bytes: meta.bytes };
  }
  private holds(accountId: number, item: Manifest['items'][number]): boolean {
    const h = this.held(accountId, item.name);
    return h !== null && h.sha256 === item.sha256 && h.bytes === item.bytes;
  }
  private storedRide(accountId: number, ride: Manifest['rides'][number]): boolean {
    try { return rideHash(readRideFiles(path.join(this.accountDir(accountId), 'rides', ride.rideId))) === ride.sha256; } catch { return false; }
  }

  begin(accountId: number, manifest: Manifest): BeginResult {
    const m = parseManifest(manifest);
    if (!m) throw new MigrationError('invalid');
    const dir = this.accountDir(accountId);
    const bound = this.boundProfileId(accountId);
    if (this.moved(accountId) && bound) {
      this.complete(accountId);
      return { state: 'done', profileId: bound };
    }
    if ((bound !== null && bound !== m.profile.id) || this.heldElsewhere(accountId, m.profile.id)) return { state: 'refused', reason: 'other-profile' };
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeSynced(path.join(dir, 'profile.json'), JSON.stringify(m.profile));
    return {
      state: 'open',
      haveItems: m.items.filter((i) => this.holds(accountId, i)).map((i) => i.name),
      haveRides: m.rides.filter((r) => this.storedRide(accountId, r)).map((r) => r.rideId),
    };
  }

  /**
   * Streams the item to disk while hashing it and never holds it whole. A secret (at most 64 KiB) is the exception: it is kept in memory
   * only and sealed from there, so its clear text never touches the disk.
   */
  async putItem(accountId: number, name: string, body: NodeJS.ReadableStream, sha256: string): Promise<'ok' | 'hash' | 'unknown' | 'closed'> {
    if (!isItem(name)) return 'unknown';
    if (this.moved(accountId) || this.boundProfileId(accountId) === null) return 'closed';
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return 'hash';
    const label = SECRET_LABEL[name];
    const max = label ? MAX_SECRET_BYTES : MAX_ITEM_BYTES;
    const dir = this.incoming(accountId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const hash = createHash('sha256');
    let bytes = 0;
    const target = path.join(dir, name);
    const metaFile = path.join(dir, `${name}.meta.json`);
    /** Reads the body chunk by chunk, counting and hashing, into `take`. Past the limit it stops at once. */
    const drain = async (take: (chunk: Buffer) => Promise<void> | void, onTooLarge?: (chunk: Buffer) => void): Promise<void> => {
      for await (const raw of body as AsyncIterable<Buffer | string>) {
        const chunk = typeof raw === 'string' ? Buffer.from(raw) : raw;
        bytes += chunk.length;
        if (bytes > max) { onTooLarge?.(chunk); throw new MigrationError('too-large'); }
        hash.update(chunk);
        await take(chunk);
      }
    };
    if (label) {
      const chunks: Buffer[] = [];
      // Too large: what has arrived of the secret is wiped before the refusal.
      await drain((chunk) => { chunks.push(chunk); }, (last) => { for (const c of [...chunks, last]) c.fill(0); });
      const clear = Buffer.concat(chunks);
      try {
        if (hash.digest('hex') !== sha256) return 'hash';
        const sealed = sealedCodec(this.opts.secretKey, `${accountId}:${label}`).seal(clear.toString('utf8'));
        // The old meta goes first: a crash before the new one leaves an item that counts as not there, never one with a stale hash.
        fs.rmSync(metaFile, { force: true });
        writeSynced(target, sealed);
      } finally {
        // Our own copy only; the chunks belong to the stream.
        clear.fill(0);
      }
    } else {
      const part = path.join(dir, `.${name}.${randomBytes(6).toString('hex')}.part`);
      const out = fs.createWriteStream(part, { mode: 0o600 });
      // Listened to for the stream's whole life: a write error (a full disk) while the body waits for its next chunk is kept here
      // and thrown at the next step, never an unhandled 'error' that ends the process.
      let failure: Error | null = null;
      const broken = new Promise<never>((_, reject) => {
        out.on('error', (e) => { failure ??= e; reject(e); });
        out.on('close', () => { if (!out.writableFinished) reject(failure ?? new Error('Schreiben abgebrochen')); });
      });
      broken.catch(() => {});
      try {
        await drain(async (chunk) => {
          if (failure) throw failure;
          if (!out.write(chunk)) await Promise.race([once(out, 'drain'), broken]);
        });
        if (failure) throw failure;
        out.end();
        await finished(out);
        if (hash.digest('hex') !== sha256) return 'hash';
        fsyncFile(part);
        fs.rmSync(metaFile, { force: true });
        fs.renameSync(part, target);
      } finally {
        // Closed before the part goes, so a stream still opening cannot create it again afterwards.
        if (!out.closed) { const closed = once(out, 'close'); out.destroy(); await closed; }
        // A refused or failed upload leaves nothing of its own.
        fs.rmSync(part, { force: true });
      }
    }
    writeSynced(metaFile, JSON.stringify({ sha256, bytes }));
    return 'ok';
  }

  finish(accountId: number, manifest: Manifest): FinishResult {
    const m = parseManifest(manifest);
    if (!m) throw new MigrationError('invalid');
    const dir = this.accountDir(accountId);
    const bound = this.boundProfileId(accountId);
    if (bound === null || bound !== m.profile.id) throw new MigrationError('not-begun');
    const movedFile = path.join(dir, 'moved.json');
    if (this.moved(accountId)) {
      this.complete(accountId);
      const was = readJson(movedFile);
      const counts = isObj(was) && isObj(was.counts) ? was.counts as { rides: number; items: number } : { rides: m.rides.length, items: m.items.length };
      return { state: 'done', counts };
    }
    const incoming = this.incoming(accountId);
    const missingItems = m.items.filter((i) => !this.holds(accountId, i)).map((i) => i.name);
    const db = m.items.find((i) => i.name === 'garmin-db');
    if (db && !missingItems.includes('garmin-db') && !databaseOk(path.join(incoming, 'garmin-db'))) {
      // Dropped, so the next begin asks for it again.
      fs.rmSync(path.join(incoming, 'garmin-db.meta.json'), { force: true });
      fs.rmSync(path.join(incoming, 'garmin-db'), { force: true });
      missingItems.push('garmin-db');
    }
    const missingRides = m.rides.filter((r) => !this.storedRide(accountId, r)).map((r) => r.rideId);
    if (missingItems.length || missingRides.length) {
      return { state: 'missing', items: ITEMS.filter((n) => missingItems.includes(n)), rides: missingRides };
    }

    const p = m.profile.id;
    writeSynced(path.join(dir, 'profile.json'), JSON.stringify(m.profile));
    // Copies, not moves: until the marker is written, a retry finds every item still waiting.
    const folders = new Set([dir]);
    for (const i of m.items) {
      const target = path.join(dir, ...INSTALL[i.name](p));
      copySynced(path.join(incoming, i.name), target);
      // The target's folder and every parent up to the account folder, as mkdir may have made them fresh (garmin/, garmin/data/).
      for (let f = path.dirname(target); f.startsWith(dir + path.sep); f = path.dirname(f)) folders.add(f);
    }
    // Every rename above is durable before the marker says the move is done.
    for (const f of folders) fsyncDir(f);
    const counts = { rides: m.rides.length, items: m.items.length };
    writeSynced(movedFile, JSON.stringify({ atMs: this.nowMs(), profileId: p, counts }));
    fsyncDir(dir);
    this.complete(accountId);
    return { state: 'done', counts };
  }

  /** The person's meal file from the Mac. Only once the account moved. */
  meals(accountId: number, body: Buffer): 'ok' | 'not-moved' {
    const profileId = this.boundProfileId(accountId);
    if (!this.moved(accountId) || profileId === null) return 'not-moved';
    let upload: unknown;
    try { upload = JSON.parse(body.toString('utf8')); } catch { throw new MigrationError('invalid'); }
    if (!isObj(upload)) throw new MigrationError('invalid');
    this.opts.meals(profileId, upload);
    return 'ok';
  }
}
