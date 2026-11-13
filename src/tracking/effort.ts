import type { Exercise } from '../shared/exercises';
import type { LoggedWorkout } from '../shared/records';
import { NO_STUDIOS, type StudioState } from '../shared/studio';
import { hereKey, lastValues, type TrackedSet, type TrackedWorkout } from './session';

/** At most this many effort questions per workout. */
export const MAX_EFFORT_QUESTIONS = 4;

const work = (s: TrackedSet) => s.type !== 'warmup';

/**
 * Whether to ask "how many more could you have done?" after this exercise. Only once all its sets are done, only where the
 * numbers do not already tell: the last working set hit the plan exactly (or landed inside the planned rep range), the exercise
 * was swapped in, or the weight is higher than last time. Never when the last working set is a failure set (the numbers tell), never when the reps were 2 or more off the plan, never for timed
 * exercises, never twice, and at most MAX_EFFORT_QUESTIONS per workout.
 */
export function asksEffort(w: TrackedWorkout, ex: string, history: LoggedWorkout[], catalog?: Exercise[], studios: StudioState = NO_STUDIOS): boolean {
  const e = w.exercises.find((x) => x.rid === ex);
  if (!e || e.timed || e.effort !== undefined) return false;
  if (w.exercises.filter((x) => x.effort !== undefined).length >= MAX_EFFORT_QUESTIONS) return false;
  if (e.sets.length === 0 || e.sets.some((s) => s.doneMs === null)) return false;
  const sets = e.sets.filter(work);
  const last = sets[sets.length - 1];
  if (!last || last.reps === null || last.type === 'failure') return false;
  const reps = last.reps;
  let exact = false;
  if (last.plannedReps !== undefined) {
    if (Math.abs(reps - last.plannedReps) >= 2) return false;
    exact = reps === last.plannedReps;
  } else if (last.repRange) {
    if (reps <= last.repRange.start - 2 || reps >= last.repRange.end + 2) return false;
    exact = reps >= last.repRange.start && reps <= last.repRange.end;
  }
  const before = lastValues(e.exerciseId, history, catalog, hereKey(w, history, studios), studios).filter((s) => s.type !== 'warmup' && s.weightKg !== null).map((s) => s.weightKg as number);
  const top = Math.max(0, ...sets.map((s) => s.weightKg ?? 0));
  const heavier = before.length > 0 && top > Math.max(...before);
  return exact || !!e.swappedIn || heavier;
}
