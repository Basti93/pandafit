import type { RideSummary } from './metrics';
import type { Session } from '../shared/session';
import type { StrengthWorkout } from './hevy';
import type { GymWorkout } from '../shared/gym/types';
import type { TrainingWeek } from './all-training';
import { LEG_MUSCLES } from './gym/history';
import { RAMP_ID } from './session-limits';
import { stepFtpFraction } from '../shared/session';
import { gymMinutes } from '../shared/duration';

import { HARD_FRACTION, MODERATE_FRACTION, dateKey, rateIntensity, ratingsFromEntries, type DayHardness, type DayRating, type RatingEntry } from '../shared/day-rating';

export { dateKey };
export type { DayHardness, DayRating };
type MuscleOf = (templateId: string, title: string) => string | null;

/** Only the fallback for a day without a planned workout; a planned one is estimated (see shared/duration). */
const GYM_MINUTES_WITHOUT_PLAN = 45;
const MAX_CUT = 0.2;
const BEFORE_WEEKS = 4;

/** Only reads the plan: hard for the ramp test or an erg step from 0.8, moderate for a main step from 0.7. */
export const rateSession = (s: Session): DayHardness => {
  if (s.id === RAMP_ID || s.steps.some((st) => st.kind === 'erg' && st.ftpFraction >= HARD_FRACTION)) return 'hard';
  const main = s.steps.length >= 3 ? s.steps.slice(1, -1) : s.steps;
  return main.some((st) => stepFtpFraction(st) >= MODERATE_FRACTION) ? 'moderate' : 'easy';
};

export const rateRide = (r: RideSummary): DayHardness => rateIntensity(r.intensityFactor);

/** A test run is hard, a long run or any run of 75 minutes or more is moderate. */
export const rateRun = (r: { durationS: number; planned: 'easy' | 'long' | 'test' | null }): DayHardness =>
  r.planned === 'test' ? 'hard' : r.planned === 'long' || r.durationS >= 75 * 60 ? 'moderate' : 'easy';

export const trainsLegs = (exercises: { templateId: string; title: string }[], muscleOf: MuscleOf): boolean =>
  exercises.some((e) => LEG_MUSCLES.includes(muscleOf(e.templateId, e.title) ?? ''));

export type DayInput = {
  rides: RideSummary[]; bikeNext: Session | null; gym: StrengthWorkout[]; gymNext: GymWorkout | null;
  muscleOf: MuscleOf; bikeDays: number[]; gymDays: number[];
  /** Local date of today: a planned session never goes on an earlier date. */
  today: string;
  runs?: { startMs: number; durationS: number; hardness: DayHardness }[];
};

/** Monday is 0. */
const weekday = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(y!, m! - 1, d!).getDay() + 6) % 7;
};

/** How hard each of the given local dates is, from rides, gym workouts and the two next planned sessions. */
export const dayRatings = (input: DayInput, dates: string[]): Record<string, DayRating> => {
  const entries: RatingEntry[] = [];
  const add = (date: string, hardness: DayHardness, legs: boolean, minutes: number, sport: RatingEntry['sport'], planned = false): void => {
    entries.push({ date, hardness, legs, minutes, ...(sport ? { sport } : {}), ...(planned ? { planned: true as const } : {}) });
  };
  for (const r of input.rides) add(dateKey(r.startedAtMs), rateRide(r), false, r.durationS / 60, 'bike');
  for (const w of input.gym) {
    const legs = trainsLegs(w.exercises, input.muscleOf);
    add(dateKey(w.startMs), legs ? 'hard' : 'moderate', legs, w.durationS / 60, 'gym');
  }
  for (const r of input.runs ?? []) add(dateKey(r.startMs), r.hardness, false, r.durationS / 60, 'run');
  // A planned session goes on the next usual day without a finished one of its own source. Without usual days, any date does.
  const nextFree = (days: number[], done: Set<string>): string | undefined =>
    dates.find((d) => d >= input.today && (days.length === 0 || days.includes(weekday(d))) && !done.has(d));
  const bikeDate = input.bikeNext ? nextFree(input.bikeDays, new Set(input.rides.map((r) => dateKey(r.startedAtMs)))) : undefined;
  if (input.bikeNext && bikeDate) add(bikeDate, rateSession(input.bikeNext), false, input.bikeNext.steps.reduce((a, s) => a + s.durationS, 0) / 60, 'bike', true);
  const gymDate = input.gymNext ? nextFree(input.gymDays, new Set(input.gym.map((w) => dateKey(w.startMs)))) : undefined;
  if (input.gymNext && gymDate) {
    const legs = trainsLegs(input.gymNext.exercises, input.muscleOf);
    add(gymDate, legs ? 'hard' : 'moderate', legs, input.gymNext.exercises.length > 0 ? gymMinutes(input.gymNext) : GYM_MINUTES_WITHOUT_PLAN, 'gym', true);
  }
  return ratingsFromEntries(entries, dates);
};

/**
 * Minutes to cut from the run week: how far the last complete week of bike and gym lies above the mean of the four before,
 * but at most 20 % of the run minutes. `weeks` is oldest first with the current week last. Without four earlier weeks of
 * bike or gym time there is nothing to compare, and nothing is cut.
 */
export const crossSportCut = (weeks: TrainingWeek[], runMinutes: number): number => {
  const load = (w: TrainingWeek): number => w.rad.minutes + w.kraft.minutes;
  const lastIdx = weeks.length - 2;
  if (lastIdx < BEFORE_WEEKS) return 0;
  const mean = weeks.slice(lastIdx - BEFORE_WEEKS, lastIdx).reduce((a, w) => a + load(w), 0) / BEFORE_WEEKS;
  if (mean <= 0) return 0;
  const excess = load(weeks[lastIdx]!) - mean;
  return excess > 0 ? Math.round(Math.min(excess, runMinutes * MAX_CUT)) : 0;
};
