import type { Exercise } from './exercises';
import { MUSCLE_TARGETS, muscleGroupOf, weeklySetRange, type MuscleGroup } from './muscle-targets';
import { policyRule, ruleNumber } from './training-policy';

const DAY_MS = 86_400_000;
const GROUPS = Object.keys(MUSCLE_TARGETS) as MuscleGroup[];

const DIRECT_WEIGHT = ruleNumber('muscle.direct-weight');
const INDIRECT_WEIGHT = ruleNumber('muscle.indirect-weight');
const SYNERGISTS: Record<string, string[]> = policyRule('muscle.synergists').lists ?? {};

export type BalanceState = 'none' | 'low' | 'good' | 'high';
export const STATE_LABELS: Record<BalanceState, string> = { none: 'Noch nichts', low: 'Wenig', good: 'Im Ziel', high: 'Viel' };

/** What the balance needs of an exercise. `group` names the group directly for an exercise known only by its muscle (Hevy template). */
export type BalanceExercise = Pick<Exercise, 'primaryMuscle' | 'secondaryMuscles'>;
export type BalanceItem = { exercise: BalanceExercise | null; group?: MuscleGroup | null; sets: number; ageMs: number };
export type Tally = Partial<Record<MuscleGroup, { direct: number; indirect: number }>>;
export type GroupBalance = {
  group: MuscleGroup; label: string; direct7: number; indirect7: number; effective7: number; perWeek4: number; effective28: number;
  state: BalanceState | null; target: { min: number; max: number };
};

/**
 * The groups an exercise works and how: its primary group directly; a secondary muscle indirectly only when its group is
 * a synergist of the primary group (stabilizers do not count). A group counts once; the primary wins. `synergists` is the
 * balance's own list unless a caller (the fatigue of earlier exercises) brings another.
 */
export function contributions(e: BalanceExercise | null, group?: MuscleGroup | null, synergists: Record<string, string[]> = SYNERGISTS): { group: MuscleGroup; direct: boolean }[] {
  const primary = e ? muscleGroupOf(e) : group ?? 'other';
  const out = [{ group: primary, direct: true }];
  const allowed = synergists[primary] ?? [];
  for (const m of e?.secondaryMuscles ?? []) {
    const g = muscleGroupOf({ primaryMuscle: m });
    if (g === 'other' || !allowed.includes(g) || out.some((o) => o.group === g)) continue;
    out.push({ group: g, direct: false });
  }
  return out;
}

/** Direct and indirect sets per group. */
export function tally(items: { exercise: BalanceExercise | null; group?: MuscleGroup | null; sets: number }[]): Tally {
  const t: Tally = {};
  for (const it of items) {
    if (it.sets <= 0) continue;
    for (const c of contributions(it.exercise, it.group)) {
      const e = (t[c.group] ??= { direct: 0, indirect: 0 });
      e[c.direct ? 'direct' : 'indirect'] += it.sets;
    }
  }
  return t;
}

export const effectiveOf = (t: Tally, g: MuscleGroup): number => (t[g]?.direct ?? 0) * DIRECT_WEIGHT + (t[g]?.indirect ?? 0) * INDIRECT_WEIGHT;
export const effectiveByGroup = (t: Tally): Partial<Record<MuscleGroup, number>> =>
  Object.fromEntries(GROUPS.map((g) => [g, effectiveOf(t, g)]).filter(([, n]) => (n as number) > 0));

const round1 = (n: number) => Math.round(n * 10) / 10;

export function stateOf(effective: number, range: { min: number; max: number }): BalanceState | null {
  if (range.max <= 0) return null;
  if (effective <= 0) return 'none';
  return effective < range.min ? 'low' : effective > range.max ? 'high' : 'good';
}

/**
 * The one balance for app, statistics and coach: effective sets per group over the last 7 days against the weekly range, and
 * the weekly average of the last 4 weeks. Unresolved exercises count as `other`, direct only. `other` is listed only when trained.
 */
export function muscleBalance(items: BalanceItem[], goal: string | null | undefined, focus: readonly MuscleGroup[] = []): GroupBalance[] {
  const inDays = (d: number) => items.filter((i) => i.ageMs >= 0 && i.ageMs <= d * DAY_MS);
  const week = tally(inDays(7)), month = tally(inDays(28));
  return GROUPS.filter((g) => g !== 'other' || effectiveOf(month, g) > 0).map((g) => {
    const target = weeklySetRange(g, goal, focus);
    const effective7 = effectiveOf(week, g);
    return {
      group: g, label: MUSCLE_TARGETS[g].label,
      direct7: week[g]?.direct ?? 0, indirect7: week[g]?.indirect ?? 0, effective7: round1(effective7),
      perWeek4: round1(effectiveOf(month, g) / 4), effective28: round1(effectiveOf(month, g)),
      state: stateOf(effective7, target), target,
    };
  });
}
