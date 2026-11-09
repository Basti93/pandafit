import type { TrackedRecord } from '../shared/records';
import type { TrackingPort } from './ports';
import type { TrackedWorkout } from './session';
import { createWorkoutStore } from './store';

type Store = ReturnType<typeof createWorkoutStore>;
const byPort = new WeakMap<TrackingPort, Map<string, Store>>();
const stores = (port: TrackingPort): Map<string, Store> => {
  let m = byPort.get(port);
  if (!m) { m = new Map(); byPort.set(port, m); }
  return m;
};
const listeners = new WeakMap<TrackingPort, Set<() => void>>();
/** Tells readers of `openStoreCount` that the count changed. Deferred, because stores are acquired while a screen renders. */
const changed = (port: TrackingPort): void => { queueMicrotask(() => listeners.get(port)?.forEach((f) => f())); };
export function subscribeStores(port: TrackingPort, fn: () => void): () => void {
  let set = listeners.get(port);
  if (!set) { set = new Set(); listeners.set(port, set); }
  set.add(fn);
  return () => { set.delete(fn); };
}
const idOf = (s: TrackedWorkout | TrackedRecord): string => s.id;

/**
 * One store per workout id and port. Reopening a workout (also from the history) returns the live store, so no stale
 * copy can overwrite a later edit. A newer stored record is taken only by a clean store.
 */
export function acquireStore(port: TrackingPort, source: TrackedWorkout | TrackedRecord, now: () => number = Date.now): Store {
  const map = stores(port);
  const have = map.get(idOf(source));
  if (have) {
    if ('kind' in source) have.reload(source);
    return have;
  }
  const s = createWorkoutStore(port, source, now);
  map.set(idOf(source), s);
  changed(port);
  return s;
}

function forget(port: TrackingPort, store: Store): void {
  const map = stores(port);
  for (const [k, v] of map) if (v === store) map.delete(k);
  store.dispose();
  changed(port);
}

/**
 * The screen is gone. A clean store is let go. A dirty one stays alive, so its retry continues, until it is clean.
 */
export function releaseStore(port: TrackingPort, store: Store): void {
  store.flushDrafts();
  if (!store.dirty()) { forget(port, store); return; }
  const off = store.subscribe(() => { if (!store.dirty()) { off(); forget(port, store); } });
}

/** The workout is no longer ours: close it for good, flushing nothing. */
export function closeStore(port: TrackingPort, store: Store): void {
  store.close();
  forget(port, store);
}

export const openStoreCount = (port: TrackingPort): number => stores(port).size;
