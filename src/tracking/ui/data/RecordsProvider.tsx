import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { RecordKind, TrackedRecord } from '../../../shared/records';
import type { TrackingPort } from '../../ports';

/** What one kind looks like to a reader. A new object only when something changed, so it is a stable snapshot. */
export type KindSnapshot = { all: TrackedRecord[] | null; failed: boolean };
const EMPTY: KindSnapshot = { all: null, failed: false };

export type RecordsCache = {
  port: TrackingPort;
  /** The first subscriber of a kind starts the one read; changes of that kind reload it. */
  subscribe(kind: RecordKind, cb: () => void): () => void;
  snapshot(kind: RecordKind): KindSnapshot;
  retry(kind: RecordKind): void;
  /** Reads again without dropping what is shown. */
  reload(kind: RecordKind): void;
};

/** Cached records are shared by many components: outside production a mutation throws instead of corrupting the others. */
export const freezing = (): boolean => (typeof process !== 'undefined' ? process.env.NODE_ENV !== 'production' : !import.meta.env?.PROD);
export function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

type Entry = { snap: KindSnapshot; subs: Set<() => void>; loading: boolean; again: boolean; off: () => void };

export function createRecordsCache(port: TrackingPort): RecordsCache {
  const entries = new Map<RecordKind, Entry>();
  const freeze = freezing();
  const emit = (e: Entry) => e.subs.forEach((f) => f());

  function load(kind: RecordKind, e: Entry): void {
    if (e.loading) { e.again = true; return; }
    e.loading = true;
    port.list(kind).then(
      // A change that came while this read ran makes its answer stale: it is dropped and read again.
      (r) => { if (entries.get(kind) === e && !e.again) { e.snap = { all: freeze ? deepFreeze(r) : r, failed: false }; emit(e); } },
      () => { if (entries.get(kind) === e && e.snap.all === null && !e.snap.failed) { e.snap = { all: null, failed: true }; emit(e); } },
    ).finally(() => {
      e.loading = false;
      if (e.again && entries.get(kind) === e) { e.again = false; load(kind, e); }
    });
  }

  // A port without per-kind notices reloads every kind that has readers.
  let offGlobal: (() => void) | null = null;
  const globalOn = () => { if (!offGlobal) offGlobal = port.subscribe(() => entries.forEach((e, k) => load(k, e))); };
  const globalOff = () => { if (entries.size === 0) { offGlobal?.(); offGlobal = null; } };

  return {
    port,
    subscribe(kind, cb) {
      let e = entries.get(kind);
      if (!e) {
        e = { snap: EMPTY, subs: new Set(), loading: false, again: false, off: () => {} };
        entries.set(kind, e);
        const entry = e;
        if (port.subscribeKind) entry.off = port.subscribeKind(kind, () => load(kind, entry)); else globalOn();
        load(kind, entry);
      }
      e.subs.add(cb);
      const entry = e;
      return () => {
        entry.subs.delete(cb);
        if (entry.subs.size === 0 && entries.get(kind) === entry) { entries.delete(kind); entry.off(); globalOff(); }
      };
    },
    snapshot: (kind) => entries.get(kind)?.snap ?? EMPTY,
    reload(kind) { const e = entries.get(kind); if (e) load(kind, e); },
    retry(kind) {
      const e = entries.get(kind);
      if (e) { e.snap = EMPTY; emit(e); load(kind, e); }
    },
  };
}

const Ctx = createContext<RecordsCache | null>(null);

/** One cache for the port below it. Without it, `usePortRecords` reads for itself. */
export function RecordsProvider({ port, children }: { port: TrackingPort; children: ReactNode }) {
  const cache = useMemo(() => createRecordsCache(port), [port]);
  return <Ctx.Provider value={cache}>{children}</Ctx.Provider>;
}

/** The cache, only if it belongs to `port`. */
export const useRecordsCache = (port: TrackingPort): RecordsCache | null => {
  const c = useContext(Ctx);
  return c && c.port === port ? c : null;
};
