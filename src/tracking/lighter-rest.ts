import type { TrackedSet, TrackedWorkout } from './session';

const isWork = (s: TrackedSet): boolean => s.type !== 'warmup';

/**
 * The new weights for the open work sets of an exercise, after the rider confirmed a set off the planned weight, lighter or heavier.
 * A set planned like the confirmed one gets the confirmed weight (the rider just set it, so it exists here). Any other set gets its
 * own planned weight times confirmed over planned, snapped with `snap`, so a pyramid stays a pyramid. Only sets that move in the
 * same direction are listed; a weight the rider typed over the prefill stays. `kg` is the one new weight when all sets share it,
 * else null. Null when nothing would change (or for a timed exercise).
 */
export function restWeights(w: TrackedWorkout, exRid: string, snap: (kg: number) => number): { kg: number | null; heavier: boolean; sets: { rid: string; kg: number }[] } | null {
  const e = w.exercises.find((x) => x.rid === exRid);
  if (!e || e.timed) return null;
  let ref: TrackedSet | undefined;
  for (const s of e.sets) if (isWork(s) && s.doneMs !== null && s.weightKg !== null && (!ref || s.doneMs >= ref.doneMs!)) ref = s;
  if (!ref) return null;
  const planned = ref.plannedKg ?? ref.prefillKg ?? null;
  if (planned === null || planned <= 0 || ref.weightKg! === planned) return null;
  const heavier = ref.weightKg! > planned;
  const factor = ref.weightKg! / planned;
  const sets: { rid: string; kg: number }[] = [];
  for (const s of e.sets) {
    if (!isWork(s) || s.doneMs !== null || s.weightKg === null) continue;
    // A weight the person typed over the prefill is theirs: never touched.
    if (s.prefillKg !== undefined && s.weightKg !== s.prefillKg) continue;
    const own = s.plannedKg ?? s.weightKg;
    const kg = own === planned ? ref.weightKg! : snap(own * factor);
    if (heavier ? kg > s.weightKg : kg < s.weightKg) sets.push({ rid: s.rid, kg });
  }
  if (sets.length === 0) return null;
  return { kg: sets.every((s) => s.kg === sets[0]!.kg) ? sets[0]!.kg : null, heavier, sets };
}

/** Sets the weight of the listed sets of an exercise, but only of sets that are still open. Used for "Übernehmen" and, with the old weights, for "Rückgängig". */
export function setWeights(w: TrackedWorkout, exRid: string, sets: readonly { rid: string; kg: number }[]): TrackedWorkout {
  const to = new Map(sets.map((s) => [s.rid, s.kg]));
  if (!w.exercises.some((e) => e.rid === exRid)) return w;
  return { ...w, exercises: w.exercises.map((e) => (e.rid !== exRid ? e : { ...e, sets: e.sets.map((s) => (s.doneMs === null && to.has(s.rid) ? { ...s, weightKg: to.get(s.rid)! } : s)) })) };
}
