import { ACTIVITIES_ID, readActivities, type ActivityItem, type ActivityKind } from '../../shared/activities';
import { localDayKey } from '../../shared/dates';
import { dedupeSessions } from '../../shared/history';
import { overlapsByHalf } from '../../shared/overlap';
import type { LoggedWorkout, TrackedRecord } from '../../shared/records';
import { dayParts, type PlanDay, type Sport } from '../../shared/week-plan';

type Merged = { items: ActivityItem[]; known: boolean };

/** Server list plus locally finished workouts, every activity once, newest first. known is false without an activities record. */
export function mergedActivities(activities: TrackedRecord[] | null, workouts: TrackedRecord[] | null): Merged {
  const record = (activities ?? []).find((r) => r.id === ACTIVITIES_ID && !r.deleted);
  const server = record ? readActivities(record.body) : null;
  const deleted = new Set((workouts ?? []).filter((r) => r.deleted).map((r) => r.id));
  const alive = (workouts ?? []).filter((r) => !r.deleted).map((r) => ({ ...(r.body as LoggedWorkout), id: r.id }));
  const local = dedupeSessions(alive).map((w): ActivityItem => ({
    key: `kraft-${w.id}`, kind: 'kraft', title: w.title || null, sport: 'strength', startMs: w.startMs,
    minutes: Math.max(0, ((w.endMs ?? w.startMs) - w.startMs) / 60000), distanceM: null, avgHr: null, ref: w.id,
  }));
  const spans = local.map((l) => ({ startMs: l.startMs, durationS: l.minutes * 60 }));
  const keys = new Set(local.map((l) => l.key));
  const rest = (server?.items ?? []).filter((s) => {
    if (keys.has(s.key)) return false;
    if (s.kind === 'kraft' && s.ref !== null && deleted.has(s.ref)) return false;
    return !(s.kind === 'kraft' && spans.some((p) => overlapsByHalf(p, { startMs: s.startMs, durationS: s.minutes * 60 })));
  });
  return { items: [...local, ...rest].sort((a, b) => b.startMs - a.startMs), known: server !== null };
}

const SPORT_NAME: [RegExp, string][] = [
  [/running|run\b/i, 'Lauf'], [/cycling|biking|bike/i, 'Rad'], [/strength/i, 'Kraft'], [/yoga/i, 'Yoga'],
  [/walking/i, 'Gehen'], [/hiking/i, 'Wandern'], [/swimming/i, 'Schwimmen'],
];
const KIND_NAME: Record<ActivityKind, string> = { kraft: 'Kraft', rad: 'Rad', lauf: 'Lauf', andere: 'Aktivität' };

const km = (m: number): string => {
  const k = m / 1000;
  return (k < 10 ? String(Math.round(k * 10) / 10) : String(Math.round(k))).replace('.', ',');
};

/** Short day text: "Lauf 6 km", "Kraft Oberkörper", "Rad 45 Min", "Yoga 30 Min". */
export function activityText(a: ActivityItem): string {
  if (a.kind === 'kraft') return a.title ? `Kraft ${a.title}` : 'Kraft';
  const name = (a.sport && SPORT_NAME.find(([re]) => re.test(a.sport!))?.[1]) ?? (a.sport ? 'Aktivität' : KIND_NAME[a.kind]);
  if (name === 'Lauf' && a.distanceM !== null && a.distanceM > 0) return `Lauf ${km(a.distanceM)} km`;
  return `${name} ${Math.max(1, Math.round(a.minutes))} Min`;
}

export type DayRow = { date: string; done: string[]; plan: PlanDay | null; rest: boolean };

const SPORT_KIND: Record<Sport, ActivityKind | null> = { bike: 'rad', gym: 'kraft', run: 'lauf', mobility: 'andere', rest: null };

/** Past days show only what was done (or Ruhetag), today the done part plus the rest of the plan, later days the plan. */
export function doneDays(dates: string[], today: string, plan: PlanDay[] | null, merged: Merged): DayRow[] {
  return dates.map((date): DayRow => {
    const planDay = plan?.find((p) => p.date === date) ?? null;
    if (date > today) return { date, done: [], plan: planDay, rest: false };
    const items = merged.items.filter((a) => localDayKey(a.startMs) === date).sort((a, b) => a.startMs - b.startMs);
    const done = items.map(activityText);
    if (date < today) return { date, done, plan: null, rest: done.length === 0 && merged.known };
    const planned = planDay ? dayParts(planDay).map((p) => SPORT_KIND[p.sport]).filter((k): k is ActivityKind => k !== null) : [];
    const finished = planned.length > 0 && planned.every((k) => items.some((a) => a.kind === k));
    return { date, done, plan: finished ? null : planDay, rest: false };
  });
}

/** Rows that only show the plan, for weeks that have not started. */
export const planRows = (days: PlanDay[]): DayRow[] => days.map((d) => ({ date: d.date, done: [], plan: d, rest: false }));
