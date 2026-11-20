import { MUSCLE_TARGETS, weeklySetRange, type MuscleGroup } from './muscle-targets';
import { effectiveOf, tally, type BalanceItem } from './muscle-balance';
import { lightVolumeView, type Experience } from './experience';
import { policyRule, ruleValues } from './training-policy';

/**
 * The chart card of a chat message: the training distribution per muscle group over a period ("Spinnennetz"). The numbers
 * are counted by code from the recorded workouts (same weights as the muscle balance), never by the model. The card carries
 * the counted values, so a device without the workout history still draws it. `min`/`max` are the weekly target range scaled
 * to the period; for a beginner `min` is 0, so a low group is never called a gap.
 */
export type MuscleChartAxis = { group: MuscleGroup; sets: number; min: number; max: number };
export type MuscleChart = { kind: 'muskeln'; fromMs: number; toMs: number; axes: MuscleChartAxis[] };

/** The periods Bo may ask for; the lengths are in the rule register (`chart.muscle-periods`). */
export const CHART_PERIODS = ['month', 'weeks4', 'months3'] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const AXES = (policyRule('chart.muscle-axes').lists?.axes ?? []) as MuscleGroup[];
const round1 = (n: number) => Math.round(n * 10) / 10;

export const isChartPeriod = (x: unknown): x is ChartPeriod => typeof x === 'string' && (CHART_PERIODS as readonly string[]).includes(x);

/** The running calendar month up to now, or the last 4 weeks, or the last 3 months. */
export function chartPeriodRange(period: ChartPeriod, nowMs: number): { fromMs: number; toMs: number } {
  if (period === 'month') { const d = new Date(nowMs); return { fromMs: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), toMs: nowMs }; }
  return { fromMs: nowMs - ruleValues('chart.muscle-periods')[period]! * DAY_MS, toMs: nowMs };
}

/** The chart of the sets in `items` (already limited to the period), or null when there are none. */
export function buildMuscleChart(items: BalanceItem[], o: { fromMs: number; toMs: number; goal: string | null | undefined; focus: readonly MuscleGroup[]; experience?: Experience }): MuscleChart | null {
  const t = tally(items);
  const weeks = Math.max(1, (o.toMs - o.fromMs) / WEEK_MS);
  const axes = AXES.map((group): MuscleChartAxis => {
    const r = weeklySetRange(group, o.goal, o.focus, o.experience);
    return { group, sets: round1(effectiveOf(t, group)), min: lightVolumeView(o.experience) ? 0 : round1(r.min * weeks), max: round1(r.max * weeks) };
  });
  return axes.some((a) => a.sets > 0) ? { kind: 'muskeln', fromMs: o.fromMs, toMs: o.toMs, axes } : null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const MIN_AXES = 3;

/** Reads a stored chart; an unknown kind or unusable data gives null (the message then reads without it), never an error. */
export function readMuscleChart(x: unknown): MuscleChart | null {
  if (!isObj(x) || x.kind !== 'muskeln' || !num(x.fromMs) || !num(x.toMs) || x.toMs < x.fromMs || !Array.isArray(x.axes) || x.axes.length < MIN_AXES) return null;
  const axes: MuscleChartAxis[] = [];
  for (const a of x.axes) {
    if (!isObj(a) || typeof a.group !== 'string' || a.group === 'other' || !Object.hasOwn(MUSCLE_TARGETS, a.group) || !num(a.sets) || !num(a.min) || !num(a.max)) return null;
    axes.push({ group: a.group as MuscleGroup, sets: a.sets, min: a.min, max: a.max });
  }
  return { kind: 'muskeln', fromMs: x.fromMs, toMs: x.toMs, axes };
}

const label = (a: MuscleChartAxis) => MUSCLE_TARGETS[a.group].label;
/** The group as the subject of a sentence: article and noun, and whether it is plural. */
const SUBJECT: Record<MuscleGroup, { np: string; plural?: true }> = {
  chest: { np: 'die Brust' }, back: { np: 'der Rücken' }, front_delts: { np: 'die vordere Schulter' }, side_delts: { np: 'die seitliche Schulter' }, rear_delts: { np: 'die hintere Schulter' },
  biceps: { np: 'der Bizeps' }, triceps: { np: 'der Trizeps' }, quads: { np: 'der vordere Oberschenkel' }, hamstrings: { np: 'der hintere Oberschenkel' },
  glutes: { np: 'das Gesäß' }, calves: { np: 'die Waden', plural: true }, abs: { np: 'der Bauch' }, traps: { np: 'der Nacken' }, forearms: { np: 'die Unterarme', plural: true }, other: { np: 'das Übrige' },
};
const subject = (a: MuscleChartAxis) => { const s = SUBJECT[a.group]; return { np: s.np.charAt(0).toUpperCase() + s.np.slice(1), plural: !!s.plural }; };
/** How far a group sits below its range (share of the lower bound missing) or above it (share over the upper bound), else 0. */
const gapOf = (a: MuscleChartAxis) => (a.min > 0 && a.sets < a.min ? 1 - a.sets / a.min : 0);
const excessOf = (a: MuscleChartAxis) => (a.max > 0 && a.sets > a.max ? a.sets / a.max - 1 : 0);
const biggest = (axes: MuscleChartAxis[], f: (a: MuscleChartAxis) => number) => axes.reduce<{ a: MuscleChartAxis; v: number } | null>((best, a) => (f(a) > (best?.v ?? 0) ? { a, v: f(a) } : best), null);

/** One calm sentence in words: the clearest gap or excess, or that all is in range. No numbers. */
export function chartSentence(c: MuscleChart): string {
  const gap = biggest(c.axes, gapOf), excess = biggest(c.axes, excessOf);
  if (gap && (!excess || gap.v >= excess.v)) { const s = subject(gap.a); return `${s.np} ${s.plural ? 'kamen' : 'kam'} bei dir zuletzt am wenigsten dran, da ist noch Platz.`; }
  if (excess) { const s = subject(excess.a); return `${s.np} ${s.plural ? 'standen' : 'stand'} bei dir zuletzt im Vordergrund, du darfst gern etwas ausgleichen.`; }
  return 'Dein Training ist gut verteilt, alle Muskelgruppen liegen im Zielbereich.';
}

/** The text for screen readers: which groups are in range, below and above, in words. */
export function chartSummary(c: MuscleChart): string {
  const names = (f: (a: MuscleChartAxis) => boolean) => c.axes.filter(f).map(label).join(', ');
  const parts = [`Spinnennetz der Trainingsverteilung nach Muskelgruppe.`];
  const low = names((a) => gapOf(a) > 0), high = names((a) => excessOf(a) > 0), good = names((a) => gapOf(a) === 0 && excessOf(a) === 0);
  if (good) parts.push(`Im Zielbereich: ${good}.`);
  if (low) parts.push(`Darunter: ${low}.`);
  if (high) parts.push(`Darüber: ${high}.`);
  return parts.join(' ');
}
