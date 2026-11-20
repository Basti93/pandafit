import type { Exercise } from '../../shared/exercises';
import type { MuscleGroup } from '../../shared/muscle-targets';
import type { Experience } from '../../shared/experience';
import { muscleBalance, type BalanceExercise, type BalanceItem, type GroupBalance } from '../../shared/muscle-balance';
import type { StrengthWorkout } from '../hevy';
import { buildMuscleChart, type MuscleChart } from '../../shared/muscle-chart';
import type { ExerciseTemplate } from '../../shared/gym/types';

/**
 * Thin adapter from Hevy-shaped workouts to the shared balance. An exercise is resolved by its template id through the
 * profile's catalog (secondary muscles included); a template the catalog does not know counts by its primary muscle only;
 * one nobody knows counts as Sonstiges. Warm-ups do not count.
 */
export function muscleVolume(workouts: StrengthWorkout[], templates: ExerciseTemplate[], catalog: Exercise[], nowMs: number, goal: string | null | undefined, focus: readonly MuscleGroup[] = [], experience?: Experience): GroupBalance[] {
  return muscleBalance(balanceItems(workouts, templates, catalog, nowMs), goal, focus, experience);
}

function balanceItems(workouts: StrengthWorkout[], templates: ExerciseTemplate[], catalog: Exercise[], nowMs: number): BalanceItem[] {
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
  return items;
}

/** The chart of the workouts that started in [fromMs, toMs], counted like the balance (the same adapter); null when there are none. */
export function muscleChartOf(workouts: StrengthWorkout[], templates: ExerciseTemplate[], catalog: Exercise[], fromMs: number, toMs: number, goal: string | null | undefined, focus: readonly MuscleGroup[] = [], experience?: Experience): MuscleChart | null {
  const inRange = workouts.filter((w) => w.startMs >= fromMs && w.startMs <= toMs);
  return buildMuscleChart(balanceItems(inRange, templates, catalog, toMs), { fromMs, toMs, goal, focus, experience });
}
