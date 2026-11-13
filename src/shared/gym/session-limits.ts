import type { Exercise } from '../exercises';
import { isCompound } from '../compound';
import { resolveCatalogEntry } from '../excluded';
import { effectiveByGroup, tally, type BalanceExercise } from '../muscle-balance';
import { muscleGroupOf, type MuscleGroup } from '../muscle-targets';
import type { StrengthWorkout } from './types';

/** Effective sets per muscle group of one workout: direct sets 1, sets of synergists 0.5, counted like the muscle balance. */
export const sessionSetsByGroup = (items: { exercise: BalanceExercise | null; sets: number }[]): Partial<Record<MuscleGroup, number>> => {
  const out = effectiveByGroup(tally(items));
  delete out.other;
  return out;
};

/** The group an exercise trains in isolation; null for a compound exercise, an unknown exercise or an unresolved group. */
export function isolationGroupOf(e: Pick<Exercise, 'primaryMuscle' | 'secondaryMuscles'> | null): MuscleGroup | null {
  if (!e || isCompound(e)) return null;
  const g = muscleGroupOf(e);
  return g === 'other' ? null : g;
}

/** Monday 00:00 (local time) of the calendar week `ms` falls in, and the Monday after it. */
export function weekBoundsOf(ms: number): { startMs: number; endMs: number } {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const start = d.getTime();
  d.setDate(d.getDate() + 7);
  return { startMs: start, endMs: d.getTime() };
}

/** In how many done workouts of the week of `nowMs` (up to `nowMs`) each group got isolation work. Exercises without a catalog entry are unknown and do not count. */
export function isolationSessionsThisWeek(workouts: readonly StrengthWorkout[], nowMs: number, catalog: readonly Exercise[], links?: Readonly<Record<string, string>>): Partial<Record<MuscleGroup, number>> {
  const { startMs, endMs } = weekBoundsOf(nowMs);
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const w of workouts) {
    if (w.startMs < startMs || w.startMs >= endMs || w.startMs > nowMs) continue;
    const groups = new Set(w.exercises.map((e) => isolationGroupOf(resolveCatalogEntry(e, catalog, links))).filter((g): g is MuscleGroup => g !== null));
    for (const g of groups) out[g] = (out[g] ?? 0) + 1;
  }
  return out;
}
