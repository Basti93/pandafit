import { ruleNumber } from './training-policy';

import { EXERCISES, type Exercise } from './exercises';
import { restOf } from './rest';

/** The shape of a gym workout the estimate needs (the coach's GymWorkout fits). */
export type TimedWorkout = { exercises: { templateId?: string; exerciseId?: string; title?: string; restS: number | null; supersetId?: number | null; sets: readonly { type?: string; reps?: number | null; repRange?: { start: number; end: number } }[] }[] };

const roundTo5 = (min: number): number => Math.round(min / 5) * 5;

/**
 * About how long a gym workout takes: warm-up, every set (work time plus the exercise's rest) and the change between
 * exercises, rounded to 5 minutes. The rest is the same value the timer uses (`restOf`). A warm-up set counts short
 * (work and rest together), a superset round rests once (the longest rest of its members). A workout without exercises takes none.
 */
export function gymMinutes(w: TimedWorkout, catalog: readonly Exercise[] = EXERCISES): number {
  if (w.exercises.length === 0) return 0;
  const work = ruleNumber('duration.set-work-s');
  const warm = work + ruleNumber('rest.warmup-s');
  const afterWarm = ruleNumber('rest.after-warmup-s');
  const beforeWarm = ruleNumber('rest.before-warmup-s');
  const isWarm = (s: { type?: string }): boolean => s.type === 'warmup';
  let sets = 0;
  for (let i = 0; i < w.exercises.length; i++) {
    const e = w.exercises[i]!;
    const g = e.supersetId ?? null;
    const warmups = e.sets.filter(isWarm).length;
    if (warmups > 0) sets += (warmups - 1) * warm + work + Math.min(afterWarm, restOf(e, catalog));
    sets += e.sets.filter((s) => !isWarm(s)).length * work;
    if (g !== null && w.exercises[i - 1]?.supersetId === g) continue; // the group's rest is counted at its first member
    const members = [e];
    if (g !== null) for (let j = i + 1; w.exercises[j]?.supersetId === g; j++) members.push(w.exercises[j]!);
    const rounds = Math.max(...members.map((x) => x.sets.filter((s) => !isWarm(s)).length));
    const rest = Math.max(...members.map((x) => restOf(x, catalog)));
    sets += rounds * rest;
    const next = w.exercises[i + members.length];
    if (rounds > 0 && next?.sets.some(isWarm)) sets -= rest - Math.min(beforeWarm, rest); // only a change of machine before a warm-up
  }
  const changes = (w.exercises.length - 1) * ruleNumber('duration.change-s');
  return roundTo5(ruleNumber('duration.gym-warmup-min') + (sets + changes) / 60);
}

/** The longest a gym workout may be for a time budget: the budget plus the slack. */
export const gymLimit = (budgetMinutes: number): number => budgetMinutes * (1 + ruleNumber('duration.slack-pct') / 100);

/** The words for the plan reason and card. */
export const durationNote = (w: TimedWorkout, catalog: readonly Exercise[] = EXERCISES): string => `ca. ${gymMinutes(w, catalog)} Min`;

/** "2 Std 10 Min", "40 Min". */
export const durationText = (n: number): string => { const m = Math.round(n); return m >= 60 ? `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} Min` : ''}` : `${m} Min`; };
