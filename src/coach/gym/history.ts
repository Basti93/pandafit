import type { StrengthWorkout } from '../../shared/gym/types';
import type { ExerciseTemplate } from '../../shared/gym/types';
import type { Ladder } from '../../shared/loads';
import { LEG_MUSCLES } from '../../shared/legs';
import { RECENT_DAYS } from './limits';

export * from '../../shared/gym/progression';

const DAY_MS = 86_400_000;
export { LEG_MUSCLES };
const LEG_WINDOW_MS = 48 * 3_600_000;

/** Hevy's rep-based exercise types. Timed and distance exercises cannot become sets of reps. */
const REP_TYPES = ['weight_reps', 'reps_only', 'bodyweight_reps', 'bodyweight_weighted', 'bodyweight_assisted', 'bodyweight_assisted_reps'];
export const isRepBased = (t: ExerciseTemplate): boolean => REP_TYPES.includes(t.type);

export type Availability = { templateId: string; title: string; lastMs: number; recent: boolean };
/** Exercises ever done, newest first. Exercises without a template id are skipped. */
export function availableExercises(workouts: StrengthWorkout[], nowMs: number): Availability[] {
  const found = new Map<string, Availability>();
  for (const w of workouts) {
    if (w.startMs > nowMs) continue;
    for (const e of w.exercises) {
      if (!e.templateId) continue;
      const known = found.get(e.templateId);
      if (!known || w.startMs >= known.lastMs) {
        found.set(e.templateId, { templateId: e.templateId, title: e.title, lastMs: w.startMs, recent: nowMs - w.startMs <= RECENT_DAYS * DAY_MS });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.lastMs - a.lastMs);
}

/** "in 5-kg-Stufen", for the prompt. */
export const stepWords = (l: Ladder): string => `in ${String(l.stepKg).replace('.', ',')}-kg-Stufen`;

/** True when quadriceps, hamstrings, glutes or calves were trained in the last 48 hours. */
export function recentLegWork(workouts: StrengthWorkout[], templates: ExerciseTemplate[], nowMs: number): boolean {
  const legIds = new Set(templates.filter((t) => LEG_MUSCLES.includes(t.primaryMuscle)).map((t) => t.id));
  return workouts.some((w) => w.startMs <= nowMs && nowMs - w.startMs <= LEG_WINDOW_MS && w.exercises.some((e) => e.templateId && legIds.has(e.templateId)));
}
