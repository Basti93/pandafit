import { z } from 'zod';
import type { TrackedRecord } from './records';
import { titleHash } from './exercise-links';
import { ruleNumber, ruleNumbers, ruleValues } from './training-policy';
import { resolveStudio, studioKey, type Renames } from './studio';

/** Weight steps learned per exercise and studio, reachable weights and barbell plates. Pure, shared by app and coach. Product values: see the `load.*` rules. */
export type Ladder = { stepKg: number; anchorKg: number; learned: boolean };

const GRID = 4; // weights are worked on a 0.25 kg grid
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The step and the anchor from the weights (> 0) of one exercise in one studio. `equipment` is the catalog's equipment. */
export function learnLadder(weights: readonly number[], equipment: string, barKg: number): Ladder {
  const defaults = ruleValues('load.default-step');
  const def = defaults[equipment] ?? defaults.other;
  const units = [...new Set(weights.filter((w) => w > 0).map((w) => Math.round(w * GRID)))].sort((a, b) => a - b);
  const anchorKg = units.length > 0 ? units[0] / GRID : equipment === 'barbell' ? barKg : 0;
  if (units.length < 2) return { stepKg: Math.max(0.5, def), anchorKg, learned: false };
  let g = 0;
  for (let i = 1; i < units.length; i++) g = gcd(g, units[i] - units[i - 1]);
  const d = g / GRID;
  // Few data points overestimate the step: a multiple of the default is read as the default.
  const step = d <= def ? d : Number.isInteger(round2(d / def)) ? def : d;
  return { stepKg: Math.max(0.5, step), anchorKg, learned: true };
}

const EPS = 1e-6;

/** The smallest reachable weight above `w`. */
export function nextUp(w: number, l: Ladder): number {
  if (w < l.anchorKg - EPS) return l.anchorKg;
  return round2(l.anchorKg + (Math.floor((w - l.anchorKg) / l.stepKg + EPS) + 1) * l.stepKg);
}

/**
 * The ladder with its lattice continued below the learned anchor (the lightest weight seen): down to the bar for a barbell, else
 * down to one step. The anchor stays on the lattice; only warm-ups and step-backs can go lighter than anything seen.
 */
export function extendDown(l: Ladder, equipment: string, barKg: number): Ladder {
  const floor = equipment === 'barbell' && l.anchorKg >= barKg ? barKg : 0;
  const below = floor > 0 ? Math.floor((l.anchorKg - floor) / l.stepKg + EPS) : Math.max(0, Math.ceil(l.anchorKg / l.stepKg - EPS) - 1);
  return { ...l, anchorKg: round2(l.anchorKg - below * l.stepKg) };
}

/** The largest reachable weight at or below `w`, never below the anchor. */
export function snapDown(w: number, l: Ladder): number {
  if (w <= l.anchorKg + EPS) return l.anchorKg;
  return round2(l.anchorKg + Math.floor((w - l.anchorKg) / l.stepKg + EPS) * l.stepKg);
}

// --- the person's override: record kind `loadstep` ---

export type LoadStep = { exerciseId: string; studio: string; stepKg: number };
export type LoadStepOverrides = Map<string, number>;

const bodySchema = z.object({
  exerciseId: z.string().min(1).max(200), studio: z.string().max(40),
  stepKg: z.number().refine((n) => ruleNumbers('load.step-choices').includes(n)),
});

export const loadStepId = (exerciseId: string, studio: string): string => `step-${titleHash(`${exerciseId}|${studio}`)}`;
const keyOf = (exerciseId: string, studio: string): string => `${exerciseId}|${studio}`;

/** The body of a `loadstep` record, or null for anything else (a step that is not on offer, a missing exercise). */
export function readLoadStep(body: unknown): LoadStep | null {
  const p = bodySchema.safeParse(body);
  return p.success ? { exerciseId: p.data.exerciseId, studio: p.data.studio, stepKg: p.data.stepKg } : null;
}

/** The record that sets the step. A tombstone is the same record with `deleted: true` and a newer stamp. */
export const loadStepRecord = (exerciseId: string, studio: string, stepKg: number, updatedMs: number): TrackedRecord =>
  ({ kind: 'loadstep', id: loadStepId(exerciseId, studio), updatedMs, deleted: false, body: { exerciseId, studio, stepKg } });

/** Live, readable `loadstep` records by exercise and studio. Deleted and malformed ones count for nothing. */
export function loadStepOverrides(records: readonly TrackedRecord[], renames: Renames = new Map()): LoadStepOverrides {
  const out: LoadStepOverrides = new Map();
  // A rename keeps the step: the studio is read through the renames; when both names have one, the newer record wins.
  for (const r of [...records].sort((a, b) => a.updatedMs - b.updatedMs)) {
    if (r.kind !== 'loadstep' || r.deleted) continue;
    const s = readLoadStep(r.body);
    if (s) out.set(keyOf(s.exerciseId, s.studio === '' ? '' : resolveStudio(s.studio, renames)), s.stepKg);
  }
  return out;
}

/** The learned ladder with the person's step, if any. The anchor stays. */
export function withOverride(l: Ladder, overrides: LoadStepOverrides, key: { exerciseId: string; studio: string }): Ladder {
  const s = overrides.get(keyOf(key.exerciseId, key.studio));
  return s === undefined ? l : { ...l, stepKg: s };
}

/** One session of an exercise, in the neutral shape app and coach both map their history to. */
export type LadderSession = { studio?: string; startMs: number; sets: readonly { type: string; weightKg: number | null }[] };

const LADDER_SESSIONS = 10;

/**
 * The ONE place the weight steps are learned, for the app and the coach. From the exercise's newest 10 sessions in the
 * studio bucket `key` (a session's bucket is `studioKey(session, main)`): only normal and failure sets with a weight count,
 * then the person's override. `learned` is the ladder before the override.
 * The learner works on a 0.25 kg grid, but the anchor is the exact lightest weight seen, so an off-grid weight (22.68 from
 * a lb conversion) stays the anchor with its exact value and the steps go on from there.
 */
export function ladderFrom(sessions: readonly LadderSession[], key: { exerciseId: string; studio: string; main: string | undefined; renames?: Renames }, equipment: string, overrides: LoadStepOverrides, barKg: number): { ladder: Ladder; learned: Ladder } {
  const weights = sessions
    .filter((s) => studioKey(s, key.main, key.renames) === key.studio)
    .sort((a, b) => b.startMs - a.startMs).slice(0, LADDER_SESSIONS)
    .flatMap((s) => s.sets.filter((x) => x.type === 'normal' || x.type === 'failure').map((x) => x.weightKg ?? 0))
    .filter((x) => x > 0);
  const base = learnLadder(weights, equipment, barKg);
  const learned = weights.length > 0 ? { ...base, anchorKg: Math.min(...weights) } : base;
  return { learned, ladder: withOverride(learned, overrides, { exerciseId: key.exerciseId, studio: key.studio }) };
}

// --- plates (barbell) ---

export type Plates = { status: 'exact' | 'between' | 'below-bar'; perSide: number[]; lower?: number; upper?: number };

/** Plates per side for a total, greedy with the register's plates in unlimited pairs. 'between': the two nearest exact totals. */
export function platesPerSide(totalKg: number, barKg: number): Plates {
  const bar = barKg;
  if (!Number.isFinite(totalKg) || totalKg < bar - EPS) return { status: 'below-bar', perSide: [] };
  const plates = [...ruleNumbers('load.plates')].sort((a, b) => b - a);
  let rest = Math.round(((totalKg - bar) / 2) * 100); // hundredths of a kg per side
  const perSide: number[] = [];
  for (const p of plates) {
    const u = Math.round(p * 100);
    while (rest >= u) { perSide.push(p); rest -= u; }
  }
  if (rest === 0) return { status: 'exact', perSide };
  const lower = round2(bar + 2 * perSide.reduce((a, b) => a + b, 0));
  return { status: 'between', perSide, lower, upper: round2(lower + 2 * plates[plates.length - 1]) };
}
