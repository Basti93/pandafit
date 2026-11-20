import type { GarminActivity } from '../../shared/garmin';
import { classifyByAvgHr, classifyByIntensityMinutes, classifyByZoneSeconds, equivalentMinutes, isHardSession, noData, type IntensityClass } from '../../shared/intensity';
import type { TrackedRecord } from '../../shared/records';
import { RUN_TYPES } from '../../shared/run';
import { SPORTS, type StatsBody, type StatsDay } from '../../shared/stats';
import { CYCLING, overlapsByHalf, STRENGTH } from '../all-training';
import { dateKey, type DayRating } from '../day-load';
import { muscleOf } from '../mobility/mobility';
import { lastDates, statsDays } from './stats-days';

/** Minutes of a mobility session without its own minutes. */
export const MOBILITY_MINUTES = 10;

export type StatsContentInput = {
  nowMs: number;
  rides: { startedAtMs: number; durationS: number; avgHrBpm?: number | null; intensity?: IntensityClass }[];
  /** Strength workouts recorded here or in Hevy, doubles already removed. */
  history: { startMs: number; durationS: number; exercises: { templateId: string; title: string }[] }[];
  runs: { startMs: number; durationS: number }[];
  /** The mobility records of the profile, as stored. */
  mobility: TrackedRecord[];
  activities: (Pick<GarminActivity, 'startMs' | 'durationS' | 'sport' | 'fromBikeCoach'> & Partial<Pick<GarminActivity, 'avgHr' | 'hrZoneS' | 'moderateMin' | 'vigorousMin'>>)[];
  /** The person's maximum heart rate (own value or estimate) for activities without time in zone; null when unknown. */
  hrMaxBpm?: number | null;
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

/** Real cardio besides running and cycling; walking, hiking, yoga and unknown activities are no endurance training for the intensity view. */
const CARDIO = /swim|rowing|elliptical|cardio|hiit/i;

export type WeekIntensity = {
  /** Strength sessions (recorded here, in Hevy, or only on the watch), doubles removed. */
  strengthSessions: number;
  /** Moderate-equivalent minutes of all endurance training: moderate plus vigorous counted twice. */
  enduranceMin: number;
  /** Endurance sessions with at least 20 vigorous minutes or 5 peak minutes. */
  hardSessions: number;
};

/**
 * The class of one Garmin activity: the watch's time in heart rate zone (zones 2-3 moderate, 4-5 vigorous) when the record has
 * it, else the watch's own intensity minutes, else the average heart rate against the person's zones, else the whole duration
 * as moderate. Policy: `intensity.*`.
 */
export function garminClass(a: StatsContentInput['activities'][number], hrMaxBpm: number | null): IntensityClass {
  if (a.hrZoneS) return classifyByZoneSeconds(a.hrZoneS);
  if (a.moderateMin !== undefined || a.vigorousMin !== undefined) return classifyByIntensityMinutes(a.moderateMin ?? 0, a.vigorousMin ?? 0);
  return classifyByAvgHr(a.durationS, a.avgHr ?? null, hrMaxBpm);
}

/**
 * What the intensity view counts over the local days from `fromMs` to `toMs`, doubles removed like in the stats record: a ride of
 * this app counts once (not again as its Garmin copy), a strength session recorded here or in Hevy not again from the watch.
 * Runs come from Garmin with their heart rate, manual runs without data count moderate. Walking, hiking, yoga and mobility count
 * for nothing.
 */
export function weekIntensity(i: StatsContentInput, fromMs: number, toMs: number): WeekIntensity {
  const dates = new Set<string>();
  for (let d = new Date(new Date(fromMs).getFullYear(), new Date(fromMs).getMonth(), new Date(fromMs).getDate()); d.getTime() <= toMs; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dates.add(dateKey(d.getTime()));
  const inRange = (ms: number) => dates.has(dateKey(ms));
  const hrMax = i.hrMaxBpm ?? null;
  const watch = i.activities.filter((a) => !a.fromBikeCoach);
  const sessions: IntensityClass[] = [];
  for (const r of i.rides) if (inRange(r.startedAtMs)) sessions.push(r.intensity ?? classifyByAvgHr(r.durationS, r.avgHrBpm ?? null, hrMax));
  const ownRide = (a: { startMs: number; durationS: number }) => i.rides.some((r) => overlapsByHalf({ startMs: r.startedAtMs, durationS: r.durationS }, a));
  const garminRuns = watch.filter((a) => (RUN_TYPES as readonly string[]).includes(a.sport));
  for (const a of watch) {
    if (!inRange(a.startMs)) continue;
    const run = (RUN_TYPES as readonly string[]).includes(a.sport);
    if (run || CARDIO.test(a.sport) || (CYCLING.test(a.sport) && !ownRide(a))) sessions.push(garminClass(a, hrMax));
  }
  for (const r of i.runs) if (inRange(r.startMs) && !garminRuns.some((a) => overlapsByHalf(r, a))) sessions.push(noData(r.durationS));
  const watchStrength = watch.filter((a) => inRange(a.startMs) && STRENGTH.test(a.sport) && !i.history.some((w) => overlapsByHalf(w, a)));
  return {
    strengthSessions: i.history.filter((w) => inRange(w.startMs)).length + watchStrength.length,
    enduranceMin: sessions.reduce((a, c) => a + equivalentMinutes(c), 0),
    hardSessions: sessions.filter(isHardSession).length,
  };
}
