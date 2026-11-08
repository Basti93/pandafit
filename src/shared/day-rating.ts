import type { SportKey } from './personal';

/** How hard a day was. The same three steps as the week plan. */
export type DayHardness = 'easy' | 'moderate' | 'hard';
/** `sports`: which sports were really done that day (for "done least recently"). `plannedSports`: planned only, not done. Hardness, legs and minutes count both. */
export type DayRating = { date: string; hardness: DayHardness | null; legs: boolean; minutes: number; sports?: SportKey[]; plannedSports?: SportKey[] };
/** One finished or planned session, already rated. The apps and the coach both turn their own records into these. */
export type RatingEntry = { date: string; hardness: DayHardness; legs: boolean; minutes: number; sport?: SportKey; planned?: true };

// Our own choices: where a day turns moderate or hard.
export const HARD_FRACTION = 0.8;
export const MODERATE_FRACTION = 0.7;
const ORDER: DayHardness[] = ['easy', 'moderate', 'hard'];
export const harder = (a: DayHardness | null, b: DayHardness): DayHardness => (a === null || ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a);

/** Hard from an intensity factor (or FTP fraction) of 0.8, moderate from 0.7. No factor: easy. */
export const rateIntensity = (f: number | null): DayHardness => (f !== null && f >= HARD_FRACTION ? 'hard' : f !== null && f >= MODERATE_FRACTION ? 'moderate' : 'easy');

export const dateKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** How hard each of the given local dates is: the hardest entry, legs if any, minutes summed. */
export const ratingsFromEntries = (entries: readonly RatingEntry[], dates: readonly string[]): Record<string, DayRating> => {
  const out: Record<string, DayRating> = Object.fromEntries(dates.map((date) => [date, { date, hardness: null, legs: false, minutes: 0 }]));
  for (const e of entries) {
    const day = out[e.date];
    if (!day) continue;
    day.hardness = harder(day.hardness, e.hardness);
    day.legs = day.legs || e.legs;
    day.minutes += Math.round(e.minutes);
    if (e.sport && e.planned) {
      if (!(day.plannedSports ?? []).includes(e.sport)) day.plannedSports = [...(day.plannedSports ?? []), e.sport];
    } else if (e.sport && !(day.sports ?? []).includes(e.sport)) day.sports = [...(day.sports ?? []), e.sport];
  }
  return out;
};
