import { z } from 'zod';
import type { TrackedRecord } from './records';
import { titleHash } from './exercise-links';
import { ruleNumber, ruleNumbers } from './training-policy';
import { resolveStudio, type Renames } from './studio';
import { SZ_BAR_EXERCISES } from './exercises';

/** Bar types: the weight per studio and the type per exercise are the person's (record kind `bar`); the defaults are rules (`load.bar-kg`, `load.sz-bar-kg`) and the catalog. Pure, shared by app and coach. */
export type BarType = 'langhantel' | 'sz';
/** `weights`: by `type|studio`. `uses`: by exercise id. */
export type Bars = { weights: Map<string, number>; uses: Map<string, BarType> };

/** No `bar` records: the defaults of the rules and the catalog. */
export const NO_BARS: Bars = { weights: new Map(), uses: new Map() };

export const BAR_TYPES: readonly BarType[] = ['langhantel', 'sz'];
export const BAR_LABEL: Record<BarType, string> = { langhantel: 'Langhantel', sz: 'SZ-Stange' };

const typeSchema = z.enum(['langhantel', 'sz']);
const bodySchema = z.discriminatedUnion('what', [
  z.object({ what: z.literal('weight'), type: typeSchema, studio: z.string().max(40), kg: z.number().finite() }),
  z.object({ what: z.literal('use'), exerciseId: z.string().min(1).max(200), type: typeSchema }),
]);
export type BarBody = z.infer<typeof bodySchema>;

const inRange = (kg: number): boolean => { const [lo, hi] = ruleNumbers('load.bar-range-kg'); return kg >= lo && kg <= hi; };
const weightKey = (type: BarType, studio: string): string => `${type}|${studio}`;

export const barWeightId = (type: BarType, studio: string): string => `bar-${titleHash(weightKey(type, studio))}`;
export const barUseId = (exerciseId: string): string => `baruse-${titleHash(exerciseId)}`;

/** The body of a `bar` record, or null for anything else (an unknown type, a weight out of range, a missing exercise). */
export function readBar(body: unknown): BarBody | null {
  const p = bodySchema.safeParse(body);
  return p.success && (p.data.what === 'use' || inRange(p.data.kg)) ? p.data : null;
}

/** The record that sets the weight of a bar type in a studio. A tombstone is the same record with `deleted: true` and a newer stamp. */
export const barWeightRecord = (type: BarType, studio: string, kg: number, nowMs: number): TrackedRecord =>
  ({ kind: 'bar', id: barWeightId(type, studio), updatedMs: nowMs, deleted: false, body: { what: 'weight', type, studio, kg } });

/** The record that sets the bar type of an exercise. */
export const barUseRecord = (exerciseId: string, type: BarType, nowMs: number): TrackedRecord =>
  ({ kind: 'bar', id: barUseId(exerciseId), updatedMs: nowMs, deleted: false, body: { what: 'use', exerciseId, type } });

/** Live, readable `bar` records. Deleted and malformed ones count for nothing; the newer record wins. */
export function readBars(records: readonly TrackedRecord[], renames: Renames = new Map()): Bars {
  const out: Bars = { weights: new Map(), uses: new Map() };
  for (const r of [...records].sort((a, b) => a.updatedMs - b.updatedMs)) {
    if (r.kind !== 'bar' || r.deleted) continue;
    const b = readBar(r.body);
    if (!b) continue;
    if (b.what === 'use') out.uses.set(b.exerciseId, b.type);
    else out.weights.set(weightKey(b.type, b.studio === '' ? '' : resolveStudio(b.studio, renames)), b.kg);
  }
  return out;
}

/** The bar type of an exercise: the person's choice, else the catalog's, else the straight bar. */
export const barTypeOf = (exerciseId: string, bars: Bars): BarType =>
  bars.uses.get(exerciseId) ?? (SZ_BAR_EXERCISES.has(exerciseId) ? 'sz' : 'langhantel');

/** The weight of the bar in a studio: the person's setting, else the rule's default. */
export const barWeightOf = (type: BarType, studio: string, bars: Bars): number =>
  bars.weights.get(weightKey(type, studio)) ?? ruleNumber(type === 'sz' ? 'load.sz-bar-kg' : 'load.bar-kg');

/** What the bar weighs for this exercise here; 0 when the exercise does not use a barbell. */
export const barKgFor = (exerciseId: string, equipment: string, studio: string, bars: Bars): number =>
  equipment === 'barbell' ? barWeightOf(barTypeOf(exerciseId, bars), studio, bars) : 0;
