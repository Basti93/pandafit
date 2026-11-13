import { bodyOf } from '../../shared/record-bodies';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Exercise } from '../../shared/exercises';
import { mergeCatalog } from '../../shared/catalog';
import { fedbIfLoaded, loadFedb } from '../fedb-lazy';
import { EXERCISES } from '../../shared/exercises';
import type { LoggedWorkout, RecordKind, TrackedRecord } from '../../shared/records';
import { dateKey } from '../../shared/day-rating';
import { excludedIds, goalOf } from '../../shared/personal';
import type { TrackingPort } from '../ports';
import { deepFreeze, freezing, useRecordsCache } from './data/RecordsProvider';
import type { createWorkoutStore, StoreView } from '../store';

export type WorkoutStore = ReturnType<typeof createWorkoutStore>;

export type PortRecords = { records: TrackedRecord[] | null; /** Including tombstones, so a writer can stay above them. */ all: TrackedRecord[] | null; failed: boolean; retry: () => void; /** Reads again; what is shown stays until the answer. */ reload: () => void };

/** Live records of one kind, null until the first answer. Tombstones are already filtered out. A failed first read is `failed`, with a retry. Inside a `RecordsProvider` the read is shared with every other reader of the kind. */
export function usePortRecords(port: TrackingPort, kind: RecordKind): PortRecords {
  const cache = useRecordsCache(port);
  const own = useOwnRecords(port, kind, cache === null);
  const subscribe = useCallback((cb: () => void) => (cache ? cache.subscribe(kind, cb) : () => {}), [cache, kind]);
  const snap = useSyncExternalStore(subscribe, () => (cache ? cache.snapshot(kind) : NO_SNAPSHOT));
  const shared = cache !== null;
  const all = shared ? snap.all : own.all;
  const records = useMemo(() => (all === null ? null : all.filter((x) => !x.deleted)), [all]);
  const failed = shared ? snap.failed : own.failed;
  const retry = shared ? () => cache.retry(kind) : own.retry;
  const reload = shared ? () => cache.reload(kind) : own.retry;
  return { records, all, failed: failed && all === null, retry, reload };
}

const NO_SNAPSHOT = { all: null, failed: false };

/** The reader without a provider: its own read and its own subscription. */
function useOwnRecords(port: TrackingPort, kind: RecordKind, active: boolean) {
  const [all, setAll] = useState<TrackedRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () => {
      port.list(kind).then(
        (r) => { if (alive) { setAll(freezing() ? deepFreeze(r) : r); setFailed(false); } },
        () => { if (alive) setFailed(true); },
      );
    };
    load();
    const off = port.subscribe(load);
    return () => { alive = false; off(); };
  }, [port, kind, attempt, active]);
  return { all, failed, retry: () => setAttempt((n) => n + 1) };
}

/** What `port.syncState()` says, re-read when the port says it may have changed. Replaces re-render tricks. */
export function useSyncState(port: TrackingPort): ReturnType<TrackingPort['syncState']> {
  const last = useRef<ReturnType<TrackingPort['syncState']> | null>(null);
  const snapshot = () => {
    const s = port.syncState();
    const p = last.current;
    if (p && p.pending === s.pending && p.lastOkMs === s.lastOkMs && p.refused === s.refused) return p;
    return (last.current = s);
  };
  // A port without sync notices (a fake) changes with its records, so the global notice serves.
  return useSyncExternalStore((cb) => (port.subscribeSync ? port.subscribeSync(cb) : port.subscribe(cb)), snapshot);
}

export const finishedWorkouts = (records: TrackedRecord[] | null): LoggedWorkout[] =>
  (records ?? []).map((r) => bodyOf('workout', r)).filter((w) => typeof w === 'object' && w !== null && w.endMs !== null).sort((a, b) => (b.endMs ?? 0) - (a.endMs ?? 0));

/** The one catalog: built-ins plus the person's exercise records (an own record with a built-in's id is an overlay). */
export function useCatalog(port: TrackingPort): Exercise[] {
  const own = usePortRecords(port, 'exercise').records;
  const fedb = useFedb();
  return useMemo(() => mergeCatalog(EXERCISES, fedb ?? [], own ?? []), [own, fedb]);
}

/** The base catalog, loaded on first use; null while it loads (the catalog then holds the built-ins and own exercises only). */
export function useFedb(): Exercise[] | null {
  const [list, setList] = useState<Exercise[] | null>(fedbIfLoaded);
  useEffect(() => {
    let live = true;
    // On a failed load the catalog stays as it is; the next screen tries again.
    loadFedb().then((l) => { if (live) setList(l); }, () => undefined);
    return () => { live = false; };
  }, []);
  return list;
}

/** The exercise ids the person's active exclude rules rule out. */
export function useExcluded(port: TrackingPort): ReadonlySet<string> {
  const rules = usePortRecords(port, 'rule').records;
  const catalog = useCatalog(port);
  return useMemo(() => excludedIds(rules ?? [], catalog), [rules, catalog]);
}

/** The person's goal (today's default without a record). */
export function useGoal(port: TrackingPort, nowMs: number) {
  const goal = usePortRecords(port, 'goal').records;
  const today = dateKey(nowMs);
  return useMemo(() => goalOf(goal ?? [], today), [goal, today]);
}

export function useStoreView(store: WorkoutStore): StoreView {
  return useSyncExternalStore(store.subscribe, store.view);
}

/** Keeps the screen on while active, where the browser allows it. Errors are ignored. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let sentinel: { release(): Promise<void> } | null = null;
    let cancelled = false;
    const release = (s: { release(): Promise<void> } | null) => { try { void s?.release().catch(() => {}); } catch { /* ignore */ } };
    const request = async () => {
      try {
        const got = (await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
        if (cancelled) release(got); // resolved after the screen was left
        else { release(sentinel); sentinel = got; }
      } catch { /* not allowed, fine */ }
    };
    // Hidden: let the lock go on purpose (the browser mostly does). Back: take it again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
      else { release(sentinel); sentinel = null; }
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      release(sentinel);
    };
  }, [active]);
}

/**
 * The current time, re-read every `periodMs` while `active` and the page is visible. The state lives only in the component that calls it,
 * so only that component re-renders. When the page hides the beat stops; on return the time is read again at once.
 */
export function useNow(periodMs: number, active: boolean, read: () => number = Date.now): number {
  const [t, setT] = useState(read);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const start = () => { stop(); setT(readRef.current()); timer = setInterval(() => setT(readRef.current()), periodMs); };
    const onChange = () => { if (document.visibilityState === 'visible') start(); else stop(); };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onChange);
    return () => { stop(); document.removeEventListener('visibilitychange', onChange); };
  }, [periodMs, active]);
  return t;
}

/** Text kept locally while typing, so a slow save never eats characters. Not overwritten from outside while focused. */
export function useDraft(value: string, commit: (text: string) => void, debounceMs = 0) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, commit });
  latest.current = { draft, commit };
  const dirty = useRef(false);
  useEffect(() => { if (!focused.current && !dirty.current) setDraft(value); }, [value]);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (dirty.current) { dirty.current = false; latest.current.commit(latest.current.draft); }
  };
  useEffect(() => () => flush(), []);
  return {
    draft,
    onChange(text: string) {
      setDraft(text);
      latest.current = { draft: text, commit };
      dirty.current = true;
      if (debounceMs <= 0) flush();
      else { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, debounceMs); }
    },
    /** Typed but not yet applied. */
    pending: () => dirty.current,
    flush,
    onFocus() { focused.current = true; },
    onBlur() { focused.current = false; flush(); },
    setDraft,
  };
}
