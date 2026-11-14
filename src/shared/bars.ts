import { z } from 'zod';
import type { TrackedRecord } from './records';
import { titleHash } from './exercise-links';
import { ruleNumber, ruleNumbers } from './training-policy';
import { resolveStudio, type Renames } from './studio';
import { SZ_BAR_EXERCISES } from './exercises';

/** Bar types: the weight per studio and the type per exercise are the person's (record kind `bar`); the defaults are rules (`load.bar-kg`, `load.sz-bar-kg`) and the catalog. Pure, shared by app and coach. */
export type FixedBarType = 'langhantel' | 'sz';
/** A bar type id: a fixed one, or a custom one (`eigen-...`) the person added. */
export type BarType = string;
/** `weights`: by `type|studio`. `uses`: by exercise id. `custom`: the person's own bar types by id (`kg` is the weight given at creation). */
export type Bars = { weights: Map<string, number>; uses: Map<string, BarType>; custom: Map<string, { name: string; kg: number }> };

/** No `bar` records: the defaults of the rules and the catalog. */
export const NO_BARS: Bars = { weights: new Map(), uses: new Map(), custom: new Map() };

export const BAR_TYPES: readonly FixedBarType[] = ['langhantel', 'sz'];
export const BAR_LABEL: Record<FixedBarType, string> = { langhantel: 'Langhantel', sz: 'SZ-Stange' };
export const BAR_NAME_MAX = 30;

const CUSTOM_ID = /^eigen-[a-z0-9]{1,40}$/;
export const isCustomBarId = (id: string): boolean => CUSTOM_ID.test(id);
/** A new id for a custom bar type. */
export const newCustomBarId = (): string => `eigen-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;

const typeSchema = z.string().refine((t) => t === 'langhantel' || t === 'sz' || CUSTOM_ID.test(t));
const bodySchema = z.discriminatedUnion('what', [
  z.object({ what: z.literal('weight'), type: typeSchema, studio: z.string().max(40), kg: z.number().finite() }),
  z.object({ what: z.literal('use'), exerciseId: z.string().min(1).max(200), type: typeSchema }),
  z.object({ what: z.literal('type'), id: z.string().regex(CUSTOM_ID), name: z.string().trim().min(1).max(BAR_NAME_MAX), kg: z.number().finite() }),
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

export const barTypeId = (id: string): string => `bartype-${titleHash(id)}`;

/** The record that adds a custom bar type (or renames it: same id, newer stamp). `kg` is the weight for every studio without its own. The name is trimmed. */
export const barTypeRecord = (id: string, name: string, kg: number, nowMs: number): TrackedRecord =>
  ({ kind: 'bar', id: barTypeId(id), updatedMs: nowMs, deleted: false, body: { what: 'type', id, name: name.trim(), kg } });

/** Live, readable `bar` records. Deleted and malformed ones count for nothing; the newer record wins. */
export function readBars(records: readonly TrackedRecord[], renames: Renames = new Map()): Bars {
  const out: Bars = { weights: new Map(), uses: new Map(), custom: new Map() };
  for (const r of [...records].sort((a, b) => a.updatedMs - b.updatedMs)) {
    if (r.kind !== 'bar' || r.deleted) continue;
    const b = readBar(r.body);
    if (!b) continue;
    if (b.what === 'type') out.custom.set(b.id, { name: b.name, kg: b.kg });
    else if (b.what === 'use') out.uses.set(b.exerciseId, b.type);
    else out.weights.set(weightKey(b.type, b.studio === '' ? '' : resolveStudio(b.studio, renames)), b.kg);
  }
  // Uses and weights of a custom type that is unknown or deleted count for nothing.
  const known = (t: string) => !isCustomBarId(t) || out.custom.has(t);
  for (const [k, t] of out.uses) if (!known(t)) out.uses.delete(k);
  for (const k of out.weights.keys()) if (!known(k.split('|')[0])) out.weights.delete(k);
  return out;
}

/** The name of a bar type: the fixed label, or the custom name ("Stange" for an unknown id). */
export const barLabel = (id: BarType, bars: Bars): string =>
  (BAR_LABEL as Record<string, string>)[id] ?? bars.custom.get(id)?.name ?? 'Stange';

/** All bar types to choose from: the fixed ones first, then the custom ones by name. */
export const barChoices = (bars: Bars): { id: BarType; label: string; custom: boolean }[] => [
  ...BAR_TYPES.map((id) => ({ id: id as BarType, label: BAR_LABEL[id], custom: false })),
  ...[...bars.custom].map(([id, c]) => ({ id, label: c.name, custom: true })).sort((a, b) => a.label.localeCompare(b.label, 'de')),
];

/** The bar type of an exercise: the person's choice, else the catalog's, else the straight bar. */
export const barTypeOf = (exerciseId: string, bars: Bars): BarType =>
  bars.uses.get(exerciseId) ?? (SZ_BAR_EXERCISES.has(exerciseId) ? 'sz' : 'langhantel');

/** The weight of the bar in a studio: the person's setting; a custom type else the weight given at creation; a fixed one else the rule's default. */
export const barWeightOf = (type: BarType, studio: string, bars: Bars): number =>
  bars.weights.get(weightKey(type, studio)) ?? bars.custom.get(type)?.kg ?? ruleNumber(type === 'sz' ? 'load.sz-bar-kg' : 'load.bar-kg');

/** What the bar weighs for this exercise here; 0 when the exercise does not use a barbell. */
export const barKgFor = (exerciseId: string, equipment: string, studio: string, bars: Bars): number =>
  equipment === 'barbell' ? barWeightOf(barTypeOf(exerciseId, bars), studio, bars) : 0;
