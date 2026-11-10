import type { Exercise } from '../../shared/exercises';
import type { ExerciseTemplate } from '../../shared/gym/types';
import type { MuscleGroup } from '../../shared/muscle-targets';
import type { Strength } from '../../shared/personal';
import { ruleNumber } from '../../shared/training-policy';
import { addDays, mondayOf } from '../../shared/week-plan';
import { dateKey } from '../day-load';
import type { StrengthWorkout } from '../hevy';
import { muscleVolume } from './muscle-volume';

const DAY_MS = 86_400_000;
const MAX_EXERCISES_SHOWN = 5;
const LOW_CHECK_DAYS = [0, 28, 56];

export type StrengthFacts = {
  wochen: { montag: string; kraft: number }[];
  uebungen: { titel: string; trend: 'steigt' | 'gleich' | 'faellt'; einheiten: number }[];
  untenDauerhaft: string[];
};

const firstWorkKg = (w: StrengthWorkout, templateId: string): number | null =>
  w.exercises.find((e) => e.templateId === templateId)?.workSets.find((s) => s.type !== 'warmup' && s.weightKg !== null)?.weightKg ?? null;

/**
 * The strength facts for the monthly review, from the stored workouts only: workouts per week, how the most frequent exercises
 * moved (first work weight of the first against the last session in the window), and the muscle groups that were below their
 * target now, 4 weeks ago and 8 weeks ago.
 */
export function strengthFacts(workouts: StrengthWorkout[], templates: ExerciseTemplate[], catalog: Exercise[], goal: { strength: Strength; focus: MuscleGroup[] }, nowMs: number): StrengthFacts {
  const weeks = ruleNumber('review.weeks');
  const thisMonday = mondayOf(dateKey(nowMs));
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - 1 - i)));
  const real = workouts.filter((w) => w.startMs <= nowMs && dateKey(w.startMs) >= mondays[0]!);
  const wochen = mondays.map((montag) => ({ montag, kraft: real.filter((w) => mondayOf(dateKey(w.startMs)) === montag).length }));

  const sessions = new Map<string, StrengthWorkout[]>();
  for (const w of [...real].sort((a, b) => a.startMs - b.startMs)) {
    for (const id of new Set(w.exercises.map((e) => e.templateId).filter(Boolean))) sessions.set(id, [...(sessions.get(id) ?? []), w]);
  }
  const uebungen = [...sessions.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_EXERCISES_SHOWN)
    .map(([id, list]) => {
      const first = firstWorkKg(list[0]!, id), last = firstWorkKg(list[list.length - 1]!, id);
      const trend = first === null || last === null || last === first ? 'gleich' : last > first ? 'steigt' : 'faellt';
      const titel = list[list.length - 1]!.exercises.find((e) => e.templateId === id)!.title;
      return { titel, trend: trend as 'steigt' | 'gleich' | 'faellt', einheiten: list.length };
    });

  const under = LOW_CHECK_DAYS.map((d) => new Set(muscleVolume(workouts, templates, catalog, nowMs - d * DAY_MS, goal.strength, goal.focus)
    .filter((g) => g.state === 'low' || g.state === 'none').map((g) => g.label)));
  const untenDauerhaft = [...under[0]!].filter((label) => under.every((s) => s.has(label)));
  return { wochen, uebungen, untenDauerhaft };
}
