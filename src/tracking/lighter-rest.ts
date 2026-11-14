import type { TrackedSet, TrackedWorkout } from './session';

const isWork = (s: TrackedSet): boolean => s.type !== 'warmup';

/**
 * The open work sets after the edited set of an exercise that still have the weight the edited set had before: the sets
 * that "Die restlichen Sätze auch mit X kg?" would change. Done sets, warm-ups, earlier sets and other weights stay out.
 */
export function followingSameWeight(w: TrackedWorkout, exRid: string, setRid: string, oldKg: number): { rid: string }[] {
  const e = w.exercises.find((x) => x.rid === exRid);
  const at = e ? e.sets.findIndex((x) => x.rid === setRid) : -1;
  if (!e || at < 0) return [];
  return e.sets.slice(at + 1).filter((s) => isWork(s) && s.doneMs === null && s.weightKg === oldKg).map((s) => ({ rid: s.rid }));
}

/** Sets the weight of the listed sets of an exercise, but only of sets that are still open. Used for "Übernehmen" and, with the old weights, for "Rückgängig". */
export function setWeights(w: TrackedWorkout, exRid: string, sets: readonly { rid: string; kg: number }[]): TrackedWorkout {
  const to = new Map(sets.map((s) => [s.rid, s.kg]));
  if (!w.exercises.some((e) => e.rid === exRid)) return w;
  return { ...w, exercises: w.exercises.map((e) => (e.rid !== exRid ? e : { ...e, sets: e.sets.map((s) => (s.doneMs === null && to.has(s.rid) ? { ...s, weightKg: to.get(s.rid)! } : s)) })) };
}
