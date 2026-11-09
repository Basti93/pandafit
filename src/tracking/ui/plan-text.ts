import { HARDNESS_LABEL, SPORT_LABEL, dayLabel, dayParts, minutesText, type PlanDay } from '../../shared/week-plan';
import type { PlannedRun } from '../../shared/run';
import { gymMinutes, type TimedWorkout } from '../../shared/duration';
import type { Exercise } from '../../shared/exercises';
import { isExcludedExercise } from '../session';

const RUN_KIND: Record<string, string> = { easy: 'locker', long: 'lang', test: 'Test' };

/** One planned session in words, parts joined with " · ": "Laufen · 35 Min · locker · Puls bis 150". */
export const runText = (r: PlannedRun & { done?: unknown }): string =>
  ['Laufen', `${r.minutes} Min`, RUN_KIND[r.kind] ?? '', ...(r.hrCap !== null ? [`Puls bis ${r.hrCap}`] : []), ...(r.done != null ? ['gelaufen'] : [])].filter(Boolean).join(' · ');

/** A plan day as one line: "Kraft · mittel", "Kraft · mittel · mit Beinen", "Rad · locker + Kraft · mittel", "Ruhetag". */
export function planDayText(d: PlanDay, opts: { legs?: boolean } = {}): string {
  return dayParts(d).map((p, i) => {
    if (p.sport === 'rest') return 'Ruhetag';
    const extra = [i === 0 && d.long ? 'lang' : '', opts.legs && p.sport === 'gym' && d.legs ? 'mit Beinen' : '', minutesText(p)].filter(Boolean);
    return [SPORT_LABEL[p.sport], HARDNESS_LABEL[p.hardness], ...extra].join(' · ');
  }).join(' + ');
}

/** One session: "Kraft, mittel". Two sessions of the same hardness: "Kraft + Rad locker", else each with its own. */
export const planDayLabel = (d: PlanDay) => {
  if (!d.also || d.sport === 'rest') return dayLabel(d, (_, first) => (first && d.long ? ', lang' : ''));
  const min = d.also.minutes ? ` ${minutesText(d.also)}` : '';
  if (d.also.hardness === d.hardness) return `${SPORT_LABEL[d.sport]} + ${SPORT_LABEL[d.also.sport]}${min} ${HARDNESS_LABEL[d.hardness]}`;
  return `${SPORT_LABEL[d.sport]} ${HARDNESS_LABEL[d.hardness]} + ${SPORT_LABEL[d.also.sport]}${min} ${HARDNESS_LABEL[d.also.hardness]}`;
};

/** `gymLine` of a plan as it would start: exercises the rules rule out are not counted. Heute and Kraft both call this, so the count is the same. */
export function planGymLine(w: { exercises: readonly { templateId?: string; exerciseId?: string; title?: string; restS?: number | null; supersetId?: number | null; sets: readonly { type?: string; reps?: number | null; repRange?: { start: number; end: number } }[] }[] }, catalog: Exercise[], excluded: ReadonlySet<string>): string | null {
  return gymLine({ exercises: w.exercises.filter((e) => !isExcludedExercise({ templateId: e.templateId ?? e.exerciseId ?? '', title: e.title ?? '' }, catalog, excluded)).map((e) => ({ ...e, restS: e.restS ?? null })) }, catalog);
}

/** The strength plan in one line: "Krafttraining, etwa 45 Minuten, 6 Übungen". Without exercises: null. Heute and Kraft both use it. */
export function gymLine(w: TimedWorkout, catalog?: readonly Exercise[]): string | null {
  const n = w.exercises.length;
  return n > 0 ? `Krafttraining, etwa ${gymMinutes(w, catalog)} Minuten, ${n} ${n === 1 ? 'Übung' : 'Übungen'}` : null;
}
