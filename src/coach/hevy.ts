import fs from 'node:fs';
import path from 'node:path';
import type { HevyStatus } from './protocol';
import { PLAIN_CODEC, type SecretCodec } from './secrets/secret-box';

const API = 'https://api.hevyapp.com';
const PAGE_SIZE = 10;
/** During the first import one tick fetches up to this many pages, one after another. */
const MAX_PAGES_PER_TICK = 8;
const PAGE_PAUSE_MS = 1000;
const EVENT_INTERVAL_MS = 30 * 60_000;
const RETRY_MS = 30 * 60_000;
const TIMEOUT_MS = 20_000;
const SAFE_ID = /^[A-Za-z0-9-]+$/;
const KEY_FORMAT = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const KEY_FILE = 'api-key';

import type { SetType, StrengthWorkout } from '../shared/gym/types';
import { writeJsonAtomic } from '../shared/node/atomic-write';
import { createLogger } from '../shared/node/log';

const log = createLogger('hevy');

export type { StrengthWorkout, SetType };
const SET_TYPES: readonly string[] = ['warmup', 'normal', 'failure', 'dropset'];
/** Bump when the stored workouts gain details, so older stores are fetched again. */
const STORE_VERSION = 2;
type RawWorkout = {
  id: string; title: string; start_time: string; end_time: string;
  exercises: { title: string; exercise_template_id?: string; sets: { type: string; weight_kg: number | null; reps: number | null }[] }[];
};
type Store = { version?: number; workouts: Record<string, StrengthWorkout>; nextPage: number | null; syncFromMs: number | null; lastTryMs: number | null; lastOkMs?: number | null };
type Options = { key: string; dir: string; nowMs: () => number; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const toWorkout = (w: RawWorkout): StrengthWorkout => {
  const startMs = Date.parse(w.start_time);
  return {
    id: w.id, title: w.title, startMs, durationS: Math.max(0, Math.round((Date.parse(w.end_time) - startMs) / 1000)),
    exercises: w.exercises.map((e) => {
      const work = e.sets.filter((s) => s.type !== 'warmup');
      return {
        title: e.title, templateId: e.exercise_template_id ?? '',
        workSets: e.sets.map((x) => ({ type: (SET_TYPES.includes(x.type) ? x.type : 'normal') as SetType, weightKg: x.weight_kg ?? null, reps: x.reps ?? null })),
        sets: work.length,
        reps: work.reduce((a, s) => a + (s.reps ?? 0), 0),
        volumeKg: Math.round(work.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)),
      };
    }),
  };
};

class Rejected extends Error {}

/** Reads strength training from Hevy into a local file. Read only, and the key is never stored. */
export class HevySync {
  private store: Store;
  private rejected = false;
  private closed = false;
  private running = false;
  private file: string;

  constructor(private opts: Options) {
    this.file = path.join(opts.dir, 'workouts.json');
    this.store = this.load();
  }

  private load(): Store {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Store;
      if (s && typeof s.workouts === 'object') {
        // Older stores lack the set details: fetch everything again, keeping what is there meanwhile.
        if (s.version !== STORE_VERSION) return { ...s, version: STORE_VERSION, nextPage: 1 };
        return s;
      }
    } catch { /* start over */ }
    return { version: STORE_VERSION, workouts: {}, nextPage: 1, syncFromMs: null, lastTryMs: null };
  }

  private save(): void {
    if (this.closed) return;
    fs.mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    writeJsonAtomic(this.file, this.store, { mode: 0o600 });
  }

  close(): void { this.closed = true; }
  status(): { workouts: number; loading: boolean; lastSyncMs: number | null; rejected: boolean } {
    return { workouts: Object.keys(this.store.workouts).length, loading: this.store.nextPage !== null, lastSyncMs: this.store.lastOkMs ?? null, rejected: this.rejected };
  }

  /** True once every stored workout carries its set details. */
  ready(): boolean { return this.store.nextPage === null; }

  workouts(): StrengthWorkout[] { return Object.values(this.store.workouts).sort((a, b) => a.startMs - b.startMs); }

  private async get<T>(pathAndQuery: string): Promise<T> {
    const res = await (this.opts.fetchFn ?? fetch)(`${API}${pathAndQuery}`, {
      method: 'GET', headers: { 'api-key': this.opts.key, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Rejected();
    if (!res.ok) throw new Error(`Hevy ${res.status}`);
    return await res.json() as T;
  }

  private async firstRunPage(page: number): Promise<boolean> {
    const startedMs = this.opts.nowMs();
    const data = await this.get<{ page_count: number; workouts: RawWorkout[] }>(`/v1/workouts?page=${page}&pageSize=${PAGE_SIZE}`);
    for (const w of data.workouts) this.store.workouts[w.id] = toWorkout(w);
    this.store.syncFromMs ??= startedMs;
    const done = page >= data.page_count;
    this.store.nextPage = done ? null : page + 1;
    // Only the finished history is worth planning anew, not every page of it.
    return done;
  }

  private async changes(): Promise<boolean> {
    const since = new Date(this.store.syncFromMs ?? 0).toISOString();
    const startedMs = this.opts.nowMs();
    let changed = false;
    let page = 1;
    let pageCount = 1;
    while (page <= pageCount) {
      const data = await this.get<{ page_count: number; events: ({ type: 'updated'; workout: RawWorkout } | { type: 'deleted'; id: string })[] }>(
        `/v1/workouts/events?page=${page}&pageSize=${PAGE_SIZE}&since=${encodeURIComponent(since)}`);
      for (const e of data.events) {
        if (e.type === 'updated') { this.store.workouts[e.workout.id] = toWorkout(e.workout); changed = true; }
        if (e.type === 'deleted' && this.store.workouts[e.id]) { delete this.store.workouts[e.id]; changed = true; }
      }
      pageCount = data.page_count;
      page += 1;
    }
    this.store.syncFromMs = startedMs;
    return changed;
  }

  /**
   * One step: either the change check, or up to MAX_PAGES_PER_TICK pages of the first import, one request at a time with a pause between.
   * Stops before the next page when mayContinue says no (a ride opened), and at once on any failure. Every page is saved.
   * True when the coach has something new. Hevy being away changes nothing else.
   */
  async tick(mayContinue?: () => boolean): Promise<boolean> {
    const now = this.opts.nowMs();
    const { nextPage, lastTryMs } = this.store;
    if (this.rejected || this.running) return false;
    if (mayContinue && !mayContinue()) return false;
    if (nextPage === null && lastTryMs !== null && now - lastTryMs < EVENT_INTERVAL_MS) return false;
    if (nextPage !== null && this.failedAtMs !== null && now - this.failedAtMs < RETRY_MS) return false;
    this.running = true;
    try {
      if (nextPage === null) return await this.finishStep(await this.changes(), now);
      const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      let page: number = nextPage;
      for (let n = 0; ; n++) {
        const done = await this.firstRunPage(page);
        this.finishStep(done, this.opts.nowMs());
        if (done) return true;
        if (n + 1 >= MAX_PAGES_PER_TICK) return false;
        await sleep(PAGE_PAUSE_MS);
        if (this.closed || (mayContinue && !mayContinue())) return false;
        page = this.store.nextPage as number;
      }
    } catch (e) {
      if (e instanceof Rejected) this.rejected = true;
      this.failedAtMs = now;
      this.store.lastTryMs = now;
      try { this.save(); } catch (e) { log.error('hevy state not saved', e); /* try again on the next run */ }
      return false;
    } finally {
      this.running = false;
    }
  }

  private finishStep(result: boolean, at: number): boolean {
    this.store.lastTryMs = at;
    this.store.lastOkMs = at;
    this.failedAtMs = null;
    this.save();
    return result;
  }

  private failedAtMs: number | null = null;
}

type LinkOptions = {
  baseDir: string; nowMs: () => number; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; onChange: (profileId: string) => void;
  /** How the key file is stored, one for all profiles or one per profile. Default: plain, as on the Mac. */
  codec?: SecretCodec | ((profileId: string) => SecretCodec);
};

/** Every profile brings its own key, or none: without one nothing here ever runs. The key stays in a private file on this Mac. */
export class HevyLinks {
  private syncs = new Map<string, HevySync>();
  private attempts = new Map<string, HevyStatus>();

  constructor(private opts: LinkOptions) {}

  private dir(profileId: string): string { return path.join(this.opts.baseDir, profileId); }

  private codec(profileId: string): SecretCodec {
    const c = this.opts.codec ?? PLAIN_CODEC;
    return typeof c === 'function' ? c(profileId) : c;
  }

  /** The stored key, or null when there is none or it does not open. Never throws, never logs. */
  private readKey(profileId: string): string | null {
    try { return this.codec(profileId).open(fs.readFileSync(path.join(this.dir(profileId), KEY_FILE), 'utf8').trim()).trim() || null; } catch { return null; }
  }

  private sync(profileId: string): HevySync | null {
    if (!SAFE_ID.test(profileId)) return null;
    const known = this.syncs.get(profileId);
    if (known) return known;
    const key = this.readKey(profileId);
    if (!key) return null;
    const sync = new HevySync({ key, dir: this.dir(profileId), nowMs: this.opts.nowMs, ...(this.opts.fetchFn ? { fetchFn: this.opts.fetchFn } : {}), ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}) });
    this.syncs.set(profileId, sync);
    return sync;
  }

  /** For the coach process only: never part of a status, a log or a prompt. */
  apiKey(profileId: string): string | null {
    if (!SAFE_ID.test(profileId)) return null;
    return this.readKey(profileId);
  }

  status(profileId: string): HevyStatus {
    const attempt = this.attempts.get(profileId);
    if (attempt) return attempt;
    const sync = this.sync(profileId);
    if (!sync) return { state: 'idle' };
    const { workouts, loading, lastSyncMs, rejected } = sync.status();
    return rejected ? { state: 'failed', reason: 'expired' } : { state: 'connected', workouts, loading, lastSyncMs };
  }

  /** True once the history is complete. False without a connection. */
  strengthReady(profileId: string): boolean { return this.sync(profileId)?.ready() ?? false; }

  workouts(profileId: string): StrengthWorkout[] { return this.sync(profileId)?.workouts() ?? []; }

  async connect(profileId: string, rawKey: string): Promise<void> {
    if (!SAFE_ID.test(profileId)) return;
    const key = rawKey.trim();
    if (!KEY_FORMAT.test(key)) { this.attempts.set(profileId, { state: 'failed', reason: 'invalid' }); return; }
    this.attempts.set(profileId, { state: 'connecting' });
    try {
      const res = await (this.opts.fetchFn ?? fetch)(`${API}/v1/user/info`, { method: 'GET', headers: { 'api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 401 || res.status === 403) { this.attempts.set(profileId, { state: 'failed', reason: 'invalid' }); return; }
      if (!res.ok) throw new Error(`Hevy ${res.status}`);
    } catch { this.attempts.set(profileId, { state: 'failed', reason: 'failed' }); return; }
    let stored: string;
    try { stored = this.codec(profileId).seal(key); } catch { this.attempts.set(profileId, { state: 'failed', reason: 'failed' }); return; }
    fs.mkdirSync(this.dir(profileId), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(this.dir(profileId), KEY_FILE), stored, { mode: 0o600 });
    fs.chmodSync(path.join(this.dir(profileId), KEY_FILE), 0o600);
    this.syncs.get(profileId)?.close();
    this.syncs.delete(profileId);
    this.attempts.delete(profileId);
  }

  disconnect(profileId: string): void {
    if (!SAFE_ID.test(profileId)) return;
    this.syncs.get(profileId)?.close();
    this.syncs.delete(profileId);
    this.attempts.delete(profileId);
    fs.rmSync(this.dir(profileId), { recursive: true, force: true });
    this.opts.onChange(profileId);
  }

  /** One step per connected profile, one profile after the other so requests never overlap. Bounded: at most 8 pages per profile and tick. One profile failing changes nothing for the others. */
  async tick(profileIds: string[], mayContinue?: () => boolean): Promise<void> {
    for (const id of profileIds) {
      if (mayContinue && !mayContinue()) return;
      const sync = this.sync(id);
      if (sync && await sync.tick(mayContinue).catch(() => false)) this.opts.onChange(id);
    }
  }
}
