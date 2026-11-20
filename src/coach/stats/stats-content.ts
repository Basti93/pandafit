import type { GarminActivity } from '../../shared/garmin';
import type { TrackedRecord } from '../../shared/records';
import { RUN_TYPES } from '../../shared/run';
import { SPORTS, type Sport, type StatsBody, type StatsDay } from '../../shared/stats';
import { CYCLING, overlapsByHalf, STRENGTH } from '../all-training';
import { dateKey, type DayRating } from '../day-load';
import { muscleOf } from '../mobility/mobility';
import { lastDates, statsDays } from './stats-days';

/** Minutes of a mobility session without its own minutes. */
export const MOBILITY_MINUTES = 10;

export type StatsContentInput = {
  nowMs: number;
  rides: { startedAtMs: number; durationS: number }[];
  /** Strength workouts recorded here or in Hevy, doubles already removed. */
  history: { startMs: number; durationS: number; exercises: { templateId: string; title: string }[] }[];
  runs: { startMs: number; durationS: number }[];
  /** The mobility records of the profile, as stored. */
  mobility: TrackedRecord[];
  activities: Pick<GarminActivity, 'startMs' | 'durationS' | 'sport' | 'fromBikeCoach'>[];
  /** How hard each date was, from what was done. */
  ratings: (dates: string[]) => Record<string, DayRating>;
  goal: string | null;
  /** The primary muscle of a Hevy or own template as the gym coach knows it (also custom ones); null when unknown. */
  templateMuscle?: (templateId: string) => string | null;
  /** The bike coach's FTP history; the last half year goes into the record. */
  ftp?: { atMs: number; ftpW: number }[];
  weightKg?: number | null;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Minutes per sport per date, the same overlap rules as allTraining: a ride of this app or a strength workout recorded here
 * counts once. Runs come from the run coach. Cycling recorded only on the watch is still cycling.
 */
function daysFor(i: StatsContentInput, dates: string[], ratings: Record<string, DayRating>): StatsDay[] {
  const mobility = i.mobility.flatMap((r) => {
    if (r.deleted || !isObj(r.body)) return [];
    const { doneMs, minutes } = r.body;
    if (typeof doneMs !== 'number' || !Number.isFinite(doneMs)) return [];
    const ok = typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0;
    return [{ doneMs, minutes: ok ? minutes : MOBILITY_MINUTES }];
  });
  const garmin = i.activities.filter((a) => !a.fromBikeCoach && !(RUN_TYPES as readonly string[]).includes(a.sport));
  const ownRide = (a: (typeof garmin)[number]) => i.rides.some((r) => overlapsByHalf({ startMs: r.startedAtMs, durationS: r.durationS }, a));
  const cycling = garmin.filter((a) => CYCLING.test(a.sport));
  const watchRides = cycling.filter((a) => !ownRide(a)).map((a) => ({ startedAtMs: a.startMs, durationS: a.durationS }));
  const other = garmin.filter((a) => !CYCLING.test(a.sport) && !(STRENGTH.test(a.sport) && i.history.some((w) => overlapsByHalf(w, a))))
    .map((a) => ({ startMs: a.startMs, durationS: a.durationS, sport: a.sport }));
  return statsDays({
    rides: [...i.rides.map((r) => ({ startedAtMs: r.startedAtMs, durationS: r.durationS })), ...watchRides],
    strength: i.history.map((w) => ({ startMs: w.startMs, durationS: w.durationS })),
    runs: i.runs.map((r) => ({ startMs: r.startMs, durationS: r.durationS })), mobility, other, ratings,
  }, dates);
}

/** What the stats record of a profile says; null when there is nothing in the nine weeks. */
export function statsContent(i: StatsContentInput): Omit<StatsBody, 'atMs'> | null {
  const dates = lastDates(i.nowMs);
  const inDates = new Set(dates);
  const days = daysFor(i, dates, i.ratings(dates));
  const found = new Map<string, string>();
  for (const w of i.history) {
    if (!inDates.has(dateKey(w.startMs))) continue;
    for (const e of w.exercises) {
      const m = i.templateMuscle?.(e.templateId) ?? muscleOf(e.templateId, e.title);
      if (m) found.set(e.templateId, m);
    }
  }
  const muscles = Object.fromEntries([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const empty = days.every((d) => d.hardness === null && !d.legs && SPORTS.every((s) => d.minutes[s] === 0));
  if (empty && found.size === 0) return null;
  const ftp = (i.ftp ?? []).filter((h) => i.nowMs - h.atMs <= 183 * 86_400_000).slice(-30).map((h) => ({ atMs: h.atMs, ftpW: h.ftpW }));
  return { type: 'stats', goal: i.goal, days, muscles, ...(ftp.length ? { ftp } : {}), ...(i.weightKg ? { weightKg: i.weightKg } : {}) };
}

/** Real cardio besides running and cycling; walking, hiking, yoga and unknown activities are not training time for the sport chart. */
const CARDIO = /swim|rowing|elliptical|cardio/i;

/** The input for the sport chart: a strength session only the watch knows counts as strength, and activities that are no training for it are dropped. */
function countable(i: StatsContentInput): StatsContentInput {
  const watchStrength = i.activities.filter((a) => !a.fromBikeCoach && STRENGTH.test(a.sport) && !i.history.some((w) => overlapsByHalf(w, a)));
  return {
    ...i,
    history: [...i.history, ...watchStrength.map((a) => ({ startMs: a.startMs, durationS: a.durationS, exercises: [] }))],
    activities: i.activities.filter((a) => CYCLING.test(a.sport) || CARDIO.test(a.sport)),
  };
}

/** Minutes per sport over the local days from `fromMs` to `toMs`, doubles removed like in the stats record (for the sport chart). */
export function sportMinutes(i: StatsContentInput, fromMs: number, toMs: number): Record<Sport, number> {
  const dates: string[] = [];
  for (let d = new Date(new Date(fromMs).getFullYear(), new Date(fromMs).getMonth(), new Date(fromMs).getDate()); d.getTime() <= toMs; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dates.push(dateKey(d.getTime()));
  const total = Object.fromEntries(SPORTS.map((s) => [s, 0])) as Record<Sport, number>;
  for (const day of daysFor(countable(i), dates, {})) for (const s of SPORTS) total[s] += day.minutes[s];
  return total;
}
