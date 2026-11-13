import type { Exercise } from '../shared/exercises';
import { hardSetsOf, positionShare, preFatigue } from '../shared/gym/pre-fatigue';
import { ruleNumber } from '../shared/training-policy';
import { resolveExercise } from './exercise-identity';
import type { TrackedExercise, TrackedSet, TrackedWorkout } from './session';

const TOLERANCE = ruleNumber('gym.pre-fatigue-tolerance');

/** The fatigue each exercise has from the ones before it, in this order (hard sets of the planned or done sets). */
export function placesOf(exercises: readonly TrackedExercise[], catalog: readonly Exercise[]): number[] {
  return preFatigue(exercises.map((e) => {
    const x = resolveExercise({ exerciseId: e.exerciseId, title: e.title }, [...catalog]).exercise;
    return { primaryMuscle: x?.primaryMuscle ?? null, secondaryMuscles: x?.secondaryMuscles, hardSets: hardSetsOf(e.sets), supersetId: e.supersetId };
  }));
}

const isWork = (s: TrackedSet): boolean => s.type !== 'warmup';
/** True when the plan's weights of this exercise are still untouched by the rider: nothing done, nothing typed over the prefill. */
const untouched = (e: TrackedExercise): boolean =>
  e.placedPre !== undefined && !e.sets.some((s) => s.doneMs !== null) && e.sets.every((s) => !isWork(s) || s.prefillKg === undefined || s.weightKg === s.prefillKg);

/**
 * After a move: the weights of the exercises the coach planned fresh follow their new place. A set at a later place than planned
 * (more than the tolerance) gets the planned weight times the share that is left; at the planned place or earlier it gets the planned weight
 * back. Never above the plan. Done sets, weights the rider typed, warm-ups and workouts without `placedPre` stay as they are.
 * `changed` lists the titles of the exercises whose weights changed.
 */
export function refitPlaces(w: TrackedWorkout, catalog: readonly Exercise[], snap: (exerciseId: string, kg: number) => number): { workout: TrackedWorkout; changed: string[] } {
  const places = placesOf(w.exercises, catalog);
  const changed: string[] = [];
  const exercises = w.exercises.map((e, i) => {
    if (!untouched(e)) return e;
    const delta = places[i]! - e.placedPre!;
    let moved = false;
    const sets = e.sets.map((s) => {
      if (!isWork(s) || s.plannedKg === null || s.plannedKg === undefined || s.prefillKg === undefined) return s;
      const kg = delta > TOLERANCE ? Math.min(s.plannedKg, snap(e.exerciseId, s.plannedKg * positionShare(delta))) : s.plannedKg;
      if (kg === s.weightKg) return s;
      moved = true;
      return { ...s, weightKg: kg, prefillKg: kg };
    });
    if (!moved) return e;
    changed.push(e.title);
    return { ...e, sets };
  });
  return changed.length ? { workout: { ...w, exercises }, changed } : { workout: w, changed };
}
