import { applyRecord, type RecordKind, type TrackedRecord } from '../../src/shared/records';
import type { TrackingPort } from '../../src/tracking/ports';

/** Behaves like the real store: applyRecord decides, so an older write never wins and nothing is overwritten blindly. */
export function fakePort(seed: TrackedRecord[] = []) {
  const map = new Map<string, TrackedRecord>(seed.map((r) => [`${r.kind}:${r.id}`, r]));
  const subs = new Set<() => void>();
  const kindSubs = new Map<RecordKind, Set<() => void>>();
  const state = { failPuts: false, pending: 0, failList: false, gate: null as Promise<void> | null, hang: false, delayMs: 0, lists: [] as RecordKind[], puts: [] as TrackedRecord[], overwritten: [] as TrackedRecord[] };
  const port: TrackingPort = {
    list: async (kind: RecordKind) => { state.lists.push(kind); if (state.failList) throw new Error('read'); return [...map.values()].filter((r) => r.kind === kind); },
    put: async (r) => {
      if (state.hang) await new Promise(() => {});
      if (state.gate) await state.gate;
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.failPuts) throw new Error('disk');
      state.puts.push(r);
      const key = `${r.kind}:${r.id}`;
      const { keep, overwritten } = applyRecord(map.get(key), r);
      if (overwritten) state.overwritten.push(overwritten);
      map.set(key, keep);
      subs.forEach((s) => s());
      kindSubs.get(r.kind)?.forEach((s) => s());
      return { kept: JSON.stringify(keep) === JSON.stringify(r), updatedMs: keep.updatedMs };
    },
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    subscribeKind: (kind, fn) => { const set = kindSubs.get(kind) ?? new Set(); kindSubs.set(kind, set); set.add(fn); return () => { set.delete(fn); }; },
    syncState: () => ({ pending: state.pending, lastOkMs: null }),
  };
  const notify = () => { subs.forEach((s) => s()); kindSubs.forEach((set) => set.forEach((s) => s())); };
  return { port, map, state, notify };
}
