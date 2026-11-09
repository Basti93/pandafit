import type { Exercise } from '../shared/exercises';
import { dedupeSessions, onePerSession } from '../shared/history';
import { effectiveByGroup, muscleBalance, tally, type BalanceItem, type GroupBalance, type Tally } from '../shared/muscle-balance';
import { MUSCLE_TARGETS, pairVerdicts, weeklySetRange, type MuscleGroup } from '../shared/muscle-targets';
import type { LoggedWorkout } from '../shared/records';
import { SPORTS, type Sport, type StatsBody } from '../shared/stats';
import { addDays } from '../shared/week-plan';
import { resolveExercise } from './exercise-identity';

export type DayCounts = { easy: number; moderate: number; hard: number; rest: number };
export type WeekStats = {
  weekStart: string; minutes: Record<Sport, number>; hardDays: number;
  /** Days by hardness from the stats record; rest: days with no minutes, up to today. */
  days: DayCounts;
  /** Direct working sets per group. */
  sets: Partial<Record<MuscleGroup, number>>;
  /** Effective sets per group: direct plus half of the synergist sets (the unit of the targets). */
  effective: Partial<Record<MuscleGroup, number>>;
};
export type StatsView = {
  asOfMs: number | null;
  /** Oldest first, the current week last, 9 entries. */
  weeks: WeekStats[];
  thisWeek: WeekStats;
  targets: Record<MuscleGroup, { min: number; max: number }>;
  pairs: ReturnType<typeof pairVerdicts>;
  /** The one balance (last 7 days, 4-week average, state per group), as the coach sees it. */
  balance: GroupBalance[];
  verdicts: string[];
  /** Titles counted under Sonstiges, unique. */
  unknown: string[];
  /** Sports with any minutes in the 9 weeks. */
  sports: Sport[];
};

const WEEKS = 9;
const GROUPS = Object.keys(MUSCLE_TARGETS) as MuscleGroup[];
const GONE: Record<Sport, string | null> = { bike: 'warst du nicht auf dem Rad', strength: 'hattest du kein Krafttraining', run: 'warst du nicht laufen', mobility: 'hattest du keine Mobility', other: null };

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const total = (w: WeekStats) => sum(SPORTS.map((s) => w.minutes[s]));

/** Monday of the local week of a time, as a local date at midnight. */
function mondayOf(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Workouts as far as they can be counted: the Mac does not check the bodies, so a broken one is skipped, not thrown on. */
export function wellFormed(all: unknown[]): LoggedWorkout[] {
  const out: LoggedWorkout[] = [];
  for (const w of all) {
    if (!isObj(w) || typeof w.startMs !== 'number' || !Number.isFinite(w.startMs) || !Array.isArray(w.exercises)) continue;
    const exercises = w.exercises.filter((e): e is LoggedWorkout['exercises'][number] =>
      isObj(e) && Array.isArray(e.sets) && typeof e.exerciseId === 'string' && typeof e.title === 'string')
      .map((e) => ({ ...e, sets: e.sets.filter((s) => isObj(s)) }));
    out.push({ ...(w as unknown as LoggedWorkout), exercises });
  }
  return out;
}

/** The numbers of the statistics page: minutes and hard days from the stats record, sets from the workouts. */
export function statsView(stats: StatsBody | null, workouts: LoggedWorkout[], nowMs: number, catalog: Exercise[], strength: string | null | undefined = stats?.goal, focus: readonly MuscleGroup[] = []): StatsView {
  const monday = mondayOf(nowMs);
  const starts = Array.from({ length: WEEKS }, (_, i) => isoDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (WEEKS - 1 - i))));
  const weeks: WeekStats[] = starts.map((weekStart) => ({
    weekStart, minutes: { bike: 0, strength: 0, run: 0, mobility: 0, other: 0 }, hardDays: 0, days: { easy: 0, moderate: 0, hard: 0, rest: 0 }, sets: {}, effective: {},
  }));
  const today = isoDate(new Date(nowMs));
  // A week that starts after the record was made has no data yet: no verdict is drawn from it.
  const asOf = stats ? isoDate(new Date(stats.atMs)) : null;
  const covered = (w: WeekStats) => asOf !== null && w.weekStart <= asOf;
  const weekOf = (iso: string) => { for (let i = WEEKS - 1; i >= 0; i--) if (iso >= starts[i]) return weeks[i]; return null; };

  for (const d of stats?.days ?? []) {
    const w = weekOf(d.date);
    if (!w) continue;
    for (const s of SPORTS) w.minutes[s] += d.minutes[s];
    if (d.hardness === 'hard') w.hardDays++;
    if (d.hardness) w.days[d.hardness]++;
    if (d.date <= today && SPORTS.every((s) => d.minutes[s] === 0)) w.days.rest++;
  }

  const unknown = new Set<string>();
  const balanceItems: BalanceItem[] = [];
  const weekItems = new Map<WeekStats, BalanceItem[]>(weeks.map((w) => [w, []]));
  for (const wo of onePerSession(dedupeSessions(wellFormed(workouts)))) {
    const w = weekOf(isoDate(new Date(wo.startMs)));
    if (!w) continue;
    for (const ex of wo.exercises) {
      const n = ex.sets.filter((s) => s.doneMs !== null && s.type !== 'warmup').length;
      if (n === 0) continue;
      const r = resolveExercise(ex, catalog, stats?.muscles);
      if (r.group === null || r.group === 'other') unknown.add(ex.title);
      const item: BalanceItem = { exercise: r.exercise, group: r.group, sets: n, ageMs: nowMs - wo.startMs };
      balanceItems.push(item);
      weekItems.get(w)!.push(item);
    }
  }
  for (const w of weeks) {
    const t: Tally = tally(weekItems.get(w)!);
    for (const [g, v] of Object.entries(t)) w.sets[g as MuscleGroup] = v.direct;
    w.effective = effectiveByGroup(t);
  }

  const complete = weeks.slice(0, WEEKS - 1);
  const last4 = complete.slice(-4);
  const sets4: Partial<Record<MuscleGroup, number>> = {};
  for (const g of GROUPS) sets4[g] = sum(last4.map((w) => w.effective[g] ?? 0));
  const pairs = pairVerdicts(sets4);

  const verdicts: string[] = [];
  for (const p of pairs) {
    if (!p.short) continue;
    const [shortLabel, shortN, otherLabel, otherN] = p.short === 'a' ? [p.aLabel, p.a, p.bLabel, p.b] : [p.bLabel, p.b, p.aLabel, p.a];
    verdicts.push(`${shortLabel} ${shortN} Sätze, ${otherLabel} ${otherN}: ${shortLabel} kommt zu kurz.`);
  }
  for (const w of [complete[complete.length - 1], weeks[WEEKS - 1]]) {
    if (covered(w) && w.hardDays > 2) verdicts.push(`In der Woche vom ${short(w.weekStart)} hattest du ${w.hardDays} harte Tage. Mehr als zwei sind viel.`);
  }
  for (const s of SPORTS) {
    const name = GONE[s];
    if (!name) continue;
    const setUp = weeks.slice(0, WEEKS - 4).some((w) => w.minutes[s] > 0);
    const last3 = complete.slice(-3);
    if (setUp && last3.every((w) => covered(w) && w.minutes[s] === 0) && weeks[WEEKS - 1].minutes[s] === 0) verdicts.push(`Seit drei Wochen ${name}.`);
  }
  for (let i = complete.length - 1; i >= 4; i--) {
    const mean = sum(complete.slice(i - 4, i).map(total)) / 4;
    if (covered(complete[i]) && mean > 0 && total(complete[i]) > 1.5 * mean) {
      verdicts.push(`Die Woche vom ${short(complete[i].weekStart)} hatte deutlich mehr Minuten als die vier davor.`);
      break;
    }
  }

  const targets = {} as Record<MuscleGroup, { min: number; max: number }>;
  for (const g of GROUPS) targets[g] = weeklySetRange(g, strength, focus);

  return {
    asOfMs: stats?.atMs ?? null, weeks, thisWeek: weeks[WEEKS - 1], targets, pairs, balance: muscleBalance(balanceItems, strength, focus), verdicts, unknown: [...unknown],
    sports: SPORTS.filter((s) => weeks.some((w) => w.minutes[s] > 0)),
  };
}

/** All minutes of a week. */
export const weekMinutes = (w: WeekStats): number => SPORTS.reduce((a, s) => a + w.minutes[s], 0);
/** "Einheiten" of a week: its days with any minutes. */
export const weekSessions = (stats: StatsBody | null, w: WeekStats): number =>
  (stats?.days ?? []).filter((d) => d.date >= w.weekStart && d.date <= addDays(w.weekStart, 6) && SPORTS.some((x) => d.minutes[x] > 0)).length;
