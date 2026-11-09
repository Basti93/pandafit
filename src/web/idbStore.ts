import { applyRecord, RECORD_KINDS, RECORD_KINDS_SIGNATURE, type RecordKind, type TrackedRecord } from '../shared/records';
import type { PutResult } from '../tracking/ports';
import { lineAfterAck, planWrite, type WriteOrigin } from '../tracking/kept-copy';
import type { SyncCursors } from '../tracking/sync';
import { readable } from './validate';

export type Refusal = { id: string; reason: string };
type Row = { key: string; seq: number; rec: TrackedRecord; /** Came from the server: not pending. */ remote?: boolean; /** See tracking/kept-copy. */ serverMs?: number; line?: number[] };
const KINDS: readonly RecordKind[] = RECORD_KINDS;
const KINDS_SIGNATURE = RECORD_KINDS_SIGNATURE;

export type IdbStore = {
  /** Records the screens can draw. Unreadable ones stay stored (and are still synced) but are not listed. */
  list(kind: RecordKind): Promise<TrackedRecord[]>;
  /** Resolves only after the transaction completed, so the data is durable. `applyRecord` decides; nothing is overwritten blindly. Reports what was kept. */
  put(r: TrackedRecord, opts?: { seenMs?: number }): Promise<PutResult>;
  /** One transaction for a whole page. */
  applyMany(rs: TrackedRecord[]): Promise<void>;
  /** The server took these versions. Not a change: no new sequence number. */
  acknowledged(rs: TrackedRecord[]): Promise<void>;
  changedSince(cursor: number): Promise<{ records: TrackedRecord[]; cursor: number }>;
  cursors: { get(): Promise<SyncCursors>; set(c: SyncCursors): Promise<void> };
  /** Refused records stay in their own store, with the record as it was. */
  addRefused(list: Refusal[]): Promise<void>;
  /** These were accepted by the server after all (a later edit): they leave the refused list. */
  clearRefused(ids: string[]): Promise<void>;
  /** Last known counts, readable at once. */
  counts(): { pending: number; refused: number };
  subscribe(fn: () => void): () => void;
  /** Only for writes that changed records of this kind. */
  subscribeKind(kind: RecordKind, fn: () => void): () => void;
  close(): void;
};

const done = (tx: IDBTransaction): Promise<void> => {
  const p = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
  p.catch(() => {}); // a failing request may reach the caller first
  return p;
};
const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** No room on the device: asking again at once changes nothing. The store above shows "not saved" and tries at its own pace. */
const isQuota = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { name?: string }).name === 'QuotaExceededError';

/** One IndexedDB database per account, so two people on one phone never see each other's data. */
export async function openIdb(account: string, factory: IDBFactory = indexedDB, opts: { timeoutMs?: number } = {}): Promise<IdbStore> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const connect = () => new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('timeout opening the database')); }, timeoutMs);
    const open = factory.open(`pandafit-${account}`, 1);
    open.onupgradeneeded = () => {
      const d = open.result;
      d.createObjectStore('records', { keyPath: 'key' }).createIndex('seq', 'seq');
      d.createObjectStore('meta');
      d.createObjectStore('refused', { keyPath: 'id' });
    };
    // A late answer after the timeout is closed again, so no handle leaks.
    open.onsuccess = () => { clearTimeout(timer); if (settled) open.result.close(); else resolve(open.result); };
    open.onerror = () => { clearTimeout(timer); reject(open.error); };
    open.onblocked = () => { clearTimeout(timer); settled = true; reject(new Error('blocked')); };
  });
  let db: IDBDatabase | null = await connect();
  let closed = false;
  const watch = (d: IDBDatabase): IDBDatabase => {
    // WebKit drops connections after backgrounding; another tab's upgrade asks us to let go. Reopened on the next use.
    d.onclose = () => { if (db === d) db = null; };
    d.onversionchange = () => { d.close(); if (db === d) db = null; };
    return d;
  };
  watch(db);
  const subs = new Set<() => void>();
  const kindSubs = new Map<RecordKind, Set<() => void>>();
  const notifyKinds = (kinds: Set<RecordKind>) => kinds.forEach((k) => kindSubs.get(k)?.forEach((f) => { try { f(); } catch { /* one listener must not stop the rest */ } }));
  const notify = () => subs.forEach((f) => { try { f(); } catch { /* one listener must not stop the rest */ } });
  let counts = { pending: 0, refused: 0 };

  /**
   * Runs an operation on a live connection. On any failure to start or complete a transaction the handle is dropped and
   * the operation tried once more: WebKit reports a lost connection as UnknownError or AbortError, maybe without a close
   * event. Repeating is safe for every operation here: an aborted transaction wrote nothing, a write that did commit
   * meets its own identical record in `applyRecord` and changes nothing, and the rest are reads or plain keyed puts.
   */
  async function run<T>(op: (d: IDBDatabase) => Promise<T>): Promise<T> {
    if (closed) throw new Error('store closed');
    for (let attempt = 0; ; attempt++) {
      try {
        if (!db) db = watch(await connect());
        return await op(db);
      } catch (e) {
        if (isQuota(e)) throw e;
        try { db?.close(); } catch { /* already gone */ }
        db = null;
        if (attempt === 0 && !closed) continue;
        throw e;
      }
    }
  }

  async function refreshCounts(): Promise<boolean> {
    if (closed) return false;
    const next = await run(async (d) => {
      const tx = d.transaction(['records', 'meta', 'refused'], 'readonly');
      const cur = ((await req(tx.objectStore('meta').get('cursors'))) as { sent: number } | undefined)?.sent ?? 0;
      const rows = (await req(tx.objectStore('records').index('seq').getAll(IDBKeyRange.lowerBound(cur, true)))) as Row[];
      const refused = await req(tx.objectStore('refused').count());
      return { pending: rows.filter((r) => !r.remote).length, refused };
    });
    const changed = next.pending !== counts.pending || next.refused !== counts.refused;
    counts = next;
    return changed;
  }

  async function apply(rs: TrackedRecord[], origin: WriteOrigin): Promise<PutResult[]> {
    if (rs.length === 0) return [];
    const touched = new Set<RecordKind>();
    let wrote = false; // also a first attempt whose commit we did not hear about
    const { results } = await run(async (d) => {
      // Local writes ask for a durable commit where the browser supports the option.
      const tx = d.transaction(['records', 'meta'], 'readwrite', { durability: origin.from === 'remote' ? 'default' : 'strict' });
      const finished = done(tx);
      const records = tx.objectStore('records'), meta = tx.objectStore('meta');
      let seq = ((await req(meta.get('seq'))) as number | undefined) ?? 0;
      let any = false;
      const results: PutResult[] = [];
      for (const r of rs) {
        const key = `${r.kind}:${r.id}`;
        const have = (await req(records.get(key))) as Row | undefined;
        const plan = planWrite(have, r, origin);
        results.push(plan.result);
        if (plan.copy) {
          const copyKey = `${plan.copy.kind}:${plan.copy.id}`;
          const other = (await req(records.get(copyKey))) as Row | undefined;
          const { keep } = applyRecord(other?.rec, plan.copy);
          if (!other || keep !== other.rec) { seq += 1; any = true; touched.add(plan.copy.kind); records.put({ key: copyKey, seq, rec: keep, remote: false } satisfies Row); }
        }
        if (!plan.replaces) {
          // The same version came back: now the device knows the server has it.
          if (have && plan.serverMs !== have.serverMs) records.put({ ...have, serverMs: plan.serverMs, line: plan.line } satisfies Row);
          continue;
        }
        seq += 1; any = true; touched.add(r.kind);
        records.put({ key, seq, rec: plan.keep, remote: origin.from === 'remote', serverMs: plan.serverMs, line: plan.line } satisfies Row);
      }
      if (any) { meta.put(seq, 'seq'); wrote = true; }
      await finished;
      return { any, results };
    });
    await refreshCounts();
    if (wrote) { notifyKinds(touched); notify(); }
    return results;
  }

  await refreshCounts();
  return {
    list: (kind) => run(async (d) => {
      const tx = d.transaction('records', 'readonly');
      const rows = (await req(tx.objectStore('records').getAll(IDBKeyRange.bound(`${kind}:`, `${kind}:￿`)))) as Row[];
      return rows.map((r) => r.rec).filter(readable);
    }),
    put: async (r, opts) => (await apply([r], { from: 'local', seenMs: opts?.seenMs }))[0]!,
    applyMany: async (rs) => { await apply(rs, { from: 'remote' }); },
    async acknowledged(rs) {
      if (rs.length === 0) return;
      await run(async (d) => {
        const tx = d.transaction('records', 'readwrite');
        const finished = done(tx);
        for (const r of rs) {
          const key = `${r.kind}:${r.id}`;
          const row = (await req(tx.objectStore('records').get(key))) as Row | undefined;
          if (row) tx.objectStore('records').put({ ...row, serverMs: r.updatedMs, line: lineAfterAck(row.line, r.updatedMs) } satisfies Row);
        }
        await finished;
      });
    },
    changedSince: (cursor) => run(async (d) => {
      const tx = d.transaction('records', 'readonly');
      const rows = (await req(tx.objectStore('records').index('seq').getAll(IDBKeyRange.lowerBound(cursor, true)))) as Row[];
      return { records: rows.map((r) => r.rec), cursor: rows.reduce((m, r) => Math.max(m, r.seq), cursor) };
    }),
    cursors: {
      get: () => run(async (d) => {
        const tx = d.transaction('meta', 'readonly');
        const stored = (await req(tx.objectStore('meta').get('cursors'))) as (SyncCursors & { kinds?: string }) | undefined;
        const { kinds, ...c } = stored ?? { sent: 0, received: 0 };
        // A version that did not know a kind skipped its records while the
        // cursor moved past them: when the known kinds change, fetch everything again.
        const received = kinds === KINDS_SIGNATURE ? c.received ?? 0 : 0;
        return { ...c, sent: c.sent ?? 0, received };
      }),
      async set(c) {
        await run(async (d) => {
          const tx = d.transaction('meta', 'readwrite');
          const finished = done(tx);
          tx.objectStore('meta').put({ ...c, kinds: KINDS_SIGNATURE }, 'cursors');
          await finished;
        });
        if (await refreshCounts()) notify();
      },
    },
    async addRefused(list) {
      if (list.length === 0) return;
      await run(async (d) => {
        const tx = d.transaction(['records', 'refused'], 'readwrite');
        const finished = done(tx);
        for (const x of list) {
          let record: TrackedRecord | null = null;
          for (const k of KINDS) {
            const row = (await req(tx.objectStore('records').get(`${k}:${x.id}`))) as Row | undefined;
            if (row) { record = row.rec; break; }
          }
          tx.objectStore('refused').put({ id: x.id, reason: x.reason, record });
        }
        await finished;
      });
      if (await refreshCounts()) notify();
    },
    async clearRefused(ids) {
      if (ids.length === 0) return;
      await run(async (d) => {
        const tx = d.transaction('refused', 'readwrite');
        const finished = done(tx);
        for (const id of ids) tx.objectStore('refused').delete(id);
        await finished;
      });
      if (await refreshCounts()) notify();
    },
    counts: () => counts,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    subscribeKind(kind, fn) {
      const set = kindSubs.get(kind) ?? new Set<() => void>();
      kindSubs.set(kind, set);
      set.add(fn);
      return () => { set.delete(fn); };
    },
    close() { closed = true; try { db?.close(); } catch { /* ignore */ } db = null; },
  };
}
