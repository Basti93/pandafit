import type { Exercise } from '../../shared/exercises';
import type { MuscleGroup } from '../../shared/muscle-targets';
import { muscleBalance, type BalanceExercise, type BalanceItem, type GroupBalance } from '../../shared/muscle-balance';
import type { StrengthWorkout } from '../hevy';
import type { ExerciseTemplate } from '../../shared/gym/types';

/**
 * Thin adapter from Hevy-shaped workouts to the shared balance. An exercise is resolved by its template id through the
 * profile's catalog (secondary muscles included); a template the catalog does not know counts by its primary muscle only;
 * one nobody knows counts as Sonstiges. Warm-ups do not count.
 */
export function muscleVolume(workouts: StrengthWorkout[], templates: ExerciseTemplate[], catalog: Exercise[], nowMs: number, goal: string | null | undefined, focus: readonly MuscleGroup[] = []): GroupBalance[] {
  const byCatalog = new Map(catalog.map((e) => [e.id, e]));
  const byTemplate = new Map(templates.map((t) => [t.id, t]));
  const items: BalanceItem[] = [];
  for (const w of workouts) {
    for (const e of w.exercises) {
      const own = byCatalog.get(e.templateId);
      const known: BalanceExercise | undefined = own ?? byTemplate.get(e.templateId);
      items.push({
        exercise: known ? { primaryMuscle: known.primaryMuscle, secondaryMuscles: own?.secondaryMuscles } : null,
        sets: e.workSets.filter((s) => s.type !== 'warmup').length, ageMs: nowMs - w.startMs,
      });
    }
  }
  return muscleBalance(items, goal, focus);
}
