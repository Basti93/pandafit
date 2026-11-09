import { RECORD_KINDS, type RecordKind, type TrackedRecord } from '../shared/records';
import type { TrackingPort } from '../tracking/ports';
import { apiFetch } from '../tracking/ui/data/api';
import { syncRecords } from '../tracking/sync';
import type { IdbStore } from './idbStore';
import type { PushEnv } from './push';

export type SyncResult = 'ok' | 'login' | 'offline';
export type WebPort = TrackingPort & {
  /** One sync run. Never throws. 'login' means the cookie is gone: all data and open workouts stay. */
  sync(): Promise<SyncResult>;
  status(): 'ok' | 'login' | 'offline';
  /** Fires when the login state changes. */
  onStatus(fn: () => void): () => void;
  /** Stops syncing and waits for a run in progress, so a request never goes out under another login. */
  pause(): Promise<void>;
  /** Resolves when no local write is in flight. */
  idle(): Promise<void>;
  resume(): void;
  /** The server's login belongs to another account than this database. */
  mismatch(): boolean;
  /** Shows the login without a request (the session is known to be gone). */
  markLogin(): void;
  dispose(): void;
};

class Unauthorized extends Error {}
class Mismatch extends Error {}
class Stopped extends Error {}
const TIMEOUT_MS = 15_000;
const PAGE = 200;
const EVERY_MS = 60_000;
const SOON_MS = 1500;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const KINDS: readonly string[] = RECORD_KINDS;
const valid = (x: unknown): x is TrackedRecord => isObj(x) && KINDS.includes(x.kind as string) && typeof x.id === 'string' && typeof x.updatedMs === 'number' && typeof x.deleted === 'boolean' && x.body !== undefined;

export function createWebPort(o: {
  store: IdbStore; /** The account this database belongs to; the server's login must match it before anything is sent. */ account: string; fetchFn?: typeof fetch; now?: () => number;
  /** Where `online` and visibility events come from. Default: window. */
  events?: EventTarget;
  intervalMs?: number;
  meTimeoutMs?: number;
  /** With it, the port can ask the server for a push at the end of a rest. */
  push?: PushEnv;
}): WebPort {
  const { store } = o;
  const now = o.now ?? Date.now;
  const fetchFn = o.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const events = o.events ?? (typeof window !== 'undefined' ? window : undefined);
  let status: 'ok' | 'login' | 'offline' = 'ok';
  let lastOkMs: number | null = null;
  let running: Promise<SyncResult> | null = null;
  let again = false;
  let disposed = false;
  let paused = false;
  let writes = 0;
  let mismatched = false;
  let soon: ReturnType<typeof setTimeout> | null = null;
  const statusSubs = new Set<() => void>();
  const syncSubs = new Set<() => void>();
  const syncChanged = () => syncSubs.forEach((f) => { try { f(); } catch { /* one listener must not stop the rest */ } });
  const offStore = store.subscribe(syncChanged); // counts change with writes and acknowledgements
  const setStatus = (s: typeof status) => { if (s !== status) { status = s; statusSubs.forEach((f) => f()); syncChanged(); } };

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<unknown> => {
    const res = await apiFetch(fetchFn, path, { method, timeoutMs, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    if (res.status === 401) throw new Unauthorized();
    if (!res.ok) throw new Error(`server answered ${res.status}`);
    return res.json();
  };

  /** The server's login must be this database's account. Checked right before every request that moves records. */
  const verify = async (): Promise<void> => {
    const me = await call('GET', '/me', undefined, o.meTimeoutMs ?? 5000);
    if (paused || disposed) throw new Stopped(); // paused while we waited: nothing moves under whatever login is coming
    mismatched = !(isObj(me) && typeof me.name === 'string' && me.name.toLowerCase() === o.account);
    if (mismatched) throw new Mismatch();
  };

  async function run(): Promise<SyncResult> {
    try {
      if (paused) return 'login';
      await syncRecords({
        cursors: store.cursors,
        local: { changedSince: (c) => store.changedSince(c), apply: (r) => store.applyMany([r]), applyMany: (rs) => store.applyMany(rs), acknowledged: (rs) => store.acknowledged(rs) },
        send: async (records) => {
          await verify();
          const out = await call('POST', '/records', { records });
          const refused = isObj(out) && Array.isArray(out.refused)
            ? out.refused.flatMap((x) => (isObj(x) && typeof x.id === 'string' ? [{ id: x.id, reason: typeof x.reason === 'string' ? x.reason : '' }] : []))
            : [];
          // Accepted records leave the refused list, refused ones join it.
          const no = new Set(refused.map((x) => x.id));
          await store.clearRefused(records.filter((r) => !no.has(r.id)).map((r) => r.id));
          await store.addRefused(refused);
          return { refused };
        },
        fetchSince: async (cursor) => {
          await verify();
          const out = await call('GET', `/records?since=${cursor}&limit=${PAGE}`);
          if (!isObj(out) || !Array.isArray(out.records) || typeof out.cursor !== 'number') throw new Error('unexpected answer');
          return { records: out.records.filter(valid), cursor: out.cursor, more: out.more === true, reset: out.reset === true, generation: typeof out.generation === 'string' ? out.generation : undefined };
        },
        mayContinue: () => !disposed && !paused,
      });
      lastOkMs = now();
      setStatus('ok');
      syncChanged();
      return 'ok';
    } catch (e) {
      if (e instanceof Stopped) return 'login';
      const r: SyncResult = e instanceof Unauthorized || e instanceof Mismatch ? 'login' : 'offline';
      setStatus(r);
      return r;
    }
  }

  const sync = (): Promise<SyncResult> => {
    if (running) { again = true; return running; }
    const p = run().finally(() => {
      running = null;
      if (again && !disposed) { again = false; void sync(); }
    });
    running = p;
    return p;
  };

  const schedule = () => {
    if (disposed || soon || status === 'login') return;
    soon = setTimeout(() => { soon = null; void sync(); }, SOON_MS);
  };
  const onOnline = () => { void sync(); };
  const onVisible = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') void sync(); };
  events?.addEventListener('online', onOnline);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => { void sync(); }, o.intervalMs ?? EVERY_MS);

  const push = o.push;
  /** Fire and forget: only with permission and a subscription, and every failure is swallowed. */
  const restAlarm = push ? (atMs: number | null): void => {
    void (async () => {
      if (disposed || push.permission() !== 'granted') return;
      const endpoint = (await push.current())?.endpoint;
      if (!endpoint) return;
      await call('POST', '/push/rest', { endpoint, atMs });
    })().catch(() => {});
  } : undefined;

  return {
    ...(restAlarm ? { restAlarm } : {}),
    list: (kind: RecordKind) => store.list(kind),
    async put(r, opts) {
      writes++;
      let res;
      try { res = await store.put(r, opts); } finally { writes--; }
      schedule();
      return res;
    },
    async idle() { while (writes > 0) await new Promise((res) => setTimeout(res, 5)); },
    subscribe: (fn) => store.subscribe(fn),
    subscribeKind: (kind, fn) => store.subscribeKind(kind, fn),
    subscribeSync(fn) { syncSubs.add(fn); return () => { syncSubs.delete(fn); }; },
    syncState: () => { const c = store.counts(); return { pending: c.pending, lastOkMs, refused: c.refused }; },
    sync,
    status: () => status,
    onStatus(fn) { statusSubs.add(fn); return () => { statusSubs.delete(fn); }; },
    async pause() { paused = true; if (running) await running.catch(() => {}); },
    resume() { paused = false; },
    mismatch: () => mismatched,
    markLogin() { setStatus('login'); },
    dispose() {
      disposed = true;
      offStore();
      store.close();
      if (soon) clearTimeout(soon);
      clearInterval(timer);
      events?.removeEventListener('online', onOnline);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
