import { dateKey } from '../../shared/day-rating';
import { HEALTH_DAYS, HEALTH_WEEKS, type HealthDay, type HealthWeek } from '../../shared/health';
import type { GarminDay } from '../../shared/garmin';
import { addDays, mondayOf } from '../../shared/week-plan';
import { ruleValues } from '../../shared/training-policy';

export const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const known = (xs: (number | null | undefined)[]): number[] => xs.filter((x): x is number => typeof x === 'number');
const round1 = (x: number): number => Math.round(x * 10) / 10;
const set = <K extends string>(key: K, v: number | null): { [P in K]?: number } => (v === null ? {} : { [key]: v } as { [P in K]?: number });

/** Steps and active minutes of a week count only when enough days were measured, so a half-empty week does not look like a lazy one. */
const MIN_DAYS = ruleValues('health.steps-band').minDays!;

/** The last 52 ISO weeks (Monday keys, oldest first) that have anything to say; `workouts` give the strength days. */
export function weeksOf(days: GarminDay[], workouts: { startMs: number }[], nowMs: number): HealthWeek[] {
  const first = addDays(mondayOf(dateKey(nowMs)), -7 * (HEALTH_WEEKS - 1));
  const byWeek = new Map<string, GarminDay[]>();
  for (const d of days) {
    const w = mondayOf(d.date);
    if (w < first) continue;
    byWeek.set(w, [...(byWeek.get(w) ?? []), d]);
  }
  const strength = new Map<string, Set<string>>();
  for (const wo of workouts) {
    const date = dateKey(wo.startMs);
    const w = mondayOf(date);
    if (w < first) continue;
    strength.set(w, (strength.get(w) ?? new Set()).add(date));
  }
  const out: HealthWeek[] = [];
  for (const week of new Set([...byWeek.keys(), ...strength.keys()])) {
    const ds = byWeek.get(week) ?? [];
    const med = (f: (d: GarminDay) => number | null | undefined): number | null => { const k = known(ds.map(f)); return k.length ? median(k) : null; };
    const steps = known(ds.map((d) => d.steps)), active = known(ds.map((d) => d.intensityMin));
    const rhr = med((d) => d.restingHrBpm), vo2 = med((d) => d.vo2max), hrv = med((d) => d.hrvMs), sleep = med((d) => (d.sleepS === null ? null : d.sleepS / 3600));
    const row: HealthWeek = {
      week,
      ...set('rhr', rhr === null ? null : Math.round(rhr)), ...set('vo2', vo2 === null ? null : round1(vo2)),
      ...set('steps', steps.length >= MIN_DAYS ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null),
      ...set('activeMin', active.length >= MIN_DAYS ? Math.round(active.reduce((a, b) => a + b, 0)) : null),
      ...set('sleepH', sleep === null ? null : round1(sleep)), ...set('hrv', hrv === null ? null : Math.round(hrv)),
    };
    const sd = strength.get(week)?.size ?? 0;
    if (Object.keys(row).length > 1 || sd > 0) out.push({ ...row, strengthDays: sd });
  }
  return out.sort((a, b) => (a.week < b.week ? -1 : 1));
}

/** The last 28 calendar days with resting pulse, steps or sleep. */
export function daysOf(days: GarminDay[], nowMs: number): HealthDay[] {
  const from = addDays(dateKey(nowMs), -(HEALTH_DAYS - 1));
  return days.filter((d) => d.date >= from && d.date <= dateKey(nowMs)).flatMap((d): HealthDay[] => {
    const row: HealthDay = { date: d.date, ...set('rhr', d.restingHrBpm), ...set('steps', d.steps), ...set('sleepH', d.sleepS === null ? null : round1(d.sleepS / 3600)) };
    return Object.keys(row).length > 1 ? [row] : [];
  }).sort((a, b) => (a.date < b.date ? -1 : 1));
}
