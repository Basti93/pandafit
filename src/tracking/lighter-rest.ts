import type { TrackedSet, TrackedWorkout } from './session';

const isWork = (s: TrackedSet): boolean => s.type !== 'warmup';

/**
 * The lighter weights for the open work sets of an exercise, after the rider confirmed a set below the planned weight.
 * The factor is the confirmed weight over the planned one; every open set gets its own planned weight times that factor, snapped
 * with `snap`, so a pyramid stays a pyramid. Only sets that get lighter are listed; a set the rider already typed lower stays.
 * `kg` is the one new weight when all sets share it, else null. Null when nothing would change (or for a timed exercise).
 */
export function lighterRest(w: TrackedWorkout, exRid: string, snap: (kg: number) => number): { kg: number | null; sets: { rid: string; kg: number }[] } | null {
  const e = w.exercises.find((x) => x.rid === exRid);
  if (!e || e.timed) return null;
  let ref: TrackedSet | undefined;
  for (const s of e.sets) if (isWork(s) && s.doneMs !== null && s.weightKg !== null && (!ref || s.doneMs >= ref.doneMs!)) ref = s;
  if (!ref) return null;
  const planned = ref.plannedKg ?? ref.prefillKg ?? null;
  if (planned === null || planned <= 0 || ref.weightKg! >= planned) return null;
  const factor = ref.weightKg! / planned;
  const sets: { rid: string; kg: number }[] = [];
  for (const s of e.sets) {
    if (!isWork(s) || s.doneMs !== null || s.weightKg === null) continue;
    const kg = snap((s.plannedKg ?? s.weightKg) * factor);
    if (kg < s.weightKg) sets.push({ rid: s.rid, kg });
  }
  if (sets.length === 0) return null;
  return { kg: sets.every((s) => s.kg === sets[0]!.kg) ? sets[0]!.kg : null, sets };
}

/** Sets the weight of the listed sets of an exercise, but only of sets that are still open. Used for "Übernehmen" and, with the old weights, for "Rückgängig". */
export function setWeights(w: TrackedWorkout, exRid: string, sets: readonly { rid: string; kg: number }[]): TrackedWorkout {
  const to = new Map(sets.map((s) => [s.rid, s.kg]));
  if (!w.exercises.some((e) => e.rid === exRid)) return w;
  return { ...w, exercises: w.exercises.map((e) => (e.rid !== exRid ? e : { ...e, sets: e.sets.map((s) => (s.doneMs === null && to.has(s.rid) ? { ...s, weightKg: to.get(s.rid)! } : s)) })) };
}
