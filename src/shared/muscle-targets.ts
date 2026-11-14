import { policyRule, ruleNumber } from './training-policy';
import { lightVolumeView, type Experience } from './experience';

/**
 * Weekly working sets and rep ranges per muscle group.
 *
 * Sets: population averages after the volume landmarks of Renaissance Periodization (Israetel): the "adaptive" range
 * for a muscle-building goal, the minimum effective range otherwise. Direct sets only; arms get fewer because rows and
 * presses already train them. More sets tend to bring more growth with diminishing returns (Schoenfeld 2017;
 * Pelland et al. 2024, preprint).
 *
 * Reps: growth is about the same from roughly 5 to 30 reps when sets end close to failure (Schoenfeld 2017, Lopez 2021).
 * The ranges below are practice, not proof: big compound lifts sit lower (heavy and safe to load), small muscles and
 * isolation work higher (less joint stress, easier to reach failure cleanly), as RP recommends for calves, side delts
 * and forearms. A rep range is a starting point, never a rule.
 */
export type MuscleGroup =
  | 'chest' | 'back' | 'front_delts' | 'side_delts' | 'rear_delts' | 'biceps' | 'triceps'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'abs' | 'traps' | 'forearms' | 'other';

export type MuscleTarget = { label: string; muscle: { min: number; max: number }; other: { min: number; max: number }; reps: { min: number; max: number } };

const LABELS: Record<MuscleGroup, string> = {
  chest: 'Brust', back: 'Rücken', front_delts: 'Schulter vorn', side_delts: 'Schulter seitlich', rear_delts: 'Schulter hinten',
  biceps: 'Bizeps', triceps: 'Trizeps', quads: 'Oberschenkel vorn', hamstrings: 'Oberschenkel hinten', glutes: 'Gesäß',
  calves: 'Waden', abs: 'Bauch', traps: 'Nacken und Trapez', forearms: 'Unterarme', other: 'Sonstiges',
};

/** The targets are product rules in the register (`muscle.target.<group>`); only "other" has none. */
const targetFromRegister = (g: Exclude<MuscleGroup, 'other'>): MuscleTarget => {
  const rule = policyRule(`muscle.target.${g}`);
  const { other, reps } = rule.ranges ?? {};
  if (!rule.value || typeof rule.value === 'number' || !other || !reps) throw new Error(`policy rule ${rule.id} lacks its ranges`);
  return { label: LABELS[g], muscle: rule.value, other, reps };
};

export const MUSCLE_TARGETS: Record<MuscleGroup, MuscleTarget> = {
  chest: targetFromRegister('chest'), back: targetFromRegister('back'),
  front_delts: targetFromRegister('front_delts'), side_delts: targetFromRegister('side_delts'), rear_delts: targetFromRegister('rear_delts'),
  biceps: targetFromRegister('biceps'), triceps: targetFromRegister('triceps'),
  quads: targetFromRegister('quads'), hamstrings: targetFromRegister('hamstrings'), glutes: targetFromRegister('glutes'),
  calves: targetFromRegister('calves'), abs: targetFromRegister('abs'), traps: targetFromRegister('traps'), forearms: targetFromRegister('forearms'),
  other: { label: LABELS.other, muscle: { min: 0, max: 0 }, other: { min: 0, max: 0 }, reps: { min: 8, max: 15 } },
};

/** Muscle to group. Legacy `shoulders` counts as the front shoulder; abductors work like glutes, adductors count as other. */
const BY_MUSCLE: Record<string, MuscleGroup> = {
  chest: 'chest', lats: 'back', upper_back: 'back', lower_back: 'back',
  shoulders: 'front_delts', front_delts: 'front_delts', side_delts: 'side_delts', rear_delts: 'rear_delts',
  biceps: 'biceps', triceps: 'triceps', quadriceps: 'quads', adductors: 'other', hamstrings: 'hamstrings', glutes: 'glutes', abductors: 'glutes',
  calves: 'calves', abdominals: 'abs', traps: 'traps', forearms: 'forearms',
};

/** The group an exercise counts for: by its primary muscle only. */
export function muscleGroupOf(e: { primaryMuscle: string | null | undefined }): MuscleGroup {
  return (e.primaryMuscle && Object.hasOwn(BY_MUSCLE, e.primaryMuscle) && BY_MUSCLE[e.primaryMuscle]) || 'other';
}

/** The rep range of an exercise: its group's range. An exercise that resolves to no group uses the "other" range. */
export const repRangeOf = (e: { primaryMuscle: string | null | undefined }): { min: number; max: number } => MUSCLE_TARGETS[muscleGroupOf(e)].reps;

/**
 * The weekly set range for a group: the building range for a muscle goal, the minimum effective range otherwise. A person who
 * starts gets the lower range whatever the goal (`experience.volume-view`).
 */
export function weeklySetRange(g: MuscleGroup, goal: string | null | undefined, focus: readonly MuscleGroup[] = [], experience?: Experience): { min: number; max: number } {
  const r = goal === 'muscle' && !lightVolumeView(experience) ? MUSCLE_TARGETS[g].muscle : MUSCLE_TARGETS[g].other;
  if (!focus.includes(g)) return r;
  const f = ruleNumber('muscle.focus-factor');
  return { min: Math.round(r.min * f), max: Math.round(r.max * f) };
}

export type MusclePair = { a: MuscleGroup[]; b: MuscleGroup[]; label: string };
const sideLabel = (side: MuscleGroup[]) => side.map((g) => LABELS[g]).join(' und ');
const pair = (a: MuscleGroup[], b: MuscleGroup[]): MusclePair => ({ a, b, label: `${sideLabel(a)} : ${sideLabel(b)}` });
export const PAIRS: MusclePair[] = [
  pair(['chest'], ['back']),
  pair(['quads'], ['hamstrings', 'glutes']),
  pair(['front_delts'], ['side_delts', 'rear_delts']),
];

export type PairVerdict = { label: string; aLabel: string; bLabel: string; a: number; b: number; short: 'a' | 'b' | null; shortLabel: string | null };

/**
 * Effective set counts of both sides of each pair (a side is the sum of its groups). `short` is the smaller side when
 * it is below two thirds of the larger and the larger has at least 6.
 */
export function pairVerdicts(effective: Partial<Record<MuscleGroup, number>>): PairVerdict[] {
  const side = (gs: MuscleGroup[]) => gs.reduce((n, g) => n + (effective[g] ?? 0), 0);
  return PAIRS.map((p) => {
    const a = side(p.a), b = side(p.b);
    const large = Math.max(a, b), small = Math.min(a, b);
    const short = large >= 6 && small < (2 / 3) * large ? (a < b ? 'a' : 'b') : null;
    return { label: p.label, aLabel: sideLabel(p.a), bLabel: sideLabel(p.b), a, b, short, shortLabel: short === 'a' ? sideLabel(p.a) : short === 'b' ? sideLabel(p.b) : null };
  });
}
