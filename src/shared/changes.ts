import type { TrackedRecord } from './records';
import type { Exercise } from './exercises';
import type { GymExercise, GymWorkout } from '../coach/gym/types';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** The nearest 0.5 kg. */
export const half = (kg: number): number => Math.round(kg * 2) / 2;

/**
 * A change the rider wants for the NEXT workout (record kind `change`, id `chg-<chat message id>`). Its state only moves
 * forward: proposed -> taken | declined; taken -> undone | used. `used` is final: the workout it went into lists its id.
 */
export type NextOp = { op: 'drop'; exerciseId: string } | { op: 'swap'; exerciseId: string; toId: string } | { op: 'sets'; exerciseId: string; sets: number } | { op: 'lighter'; exerciseId: string };
export type ChangeState = 'proposed' | 'taken' | 'declined' | 'undone' | 'used';
export type NextChange = { id: string; ops: NextOp[]; reason: string; state: ChangeState; atMs: number; usedBy?: string };

const STATES: ChangeState[] = ['proposed', 'taken', 'declined', 'undone', 'used'];
const MAX_OPS = 8;
/** Lighter takes this share off the planned weights. */
export const LIGHTER_PCT = 10;

export const changeId = (messageId: string): string => `chg-${messageId}`;

/** The shape of the ops only; whether the exercises exist is checked when they apply. Null for anything odd. */
export function readNextOps(x: unknown, catalog?: readonly Exercise[]): NextOp[] | null {
  if (!Array.isArray(x) || x.length === 0 || x.length > MAX_OPS) return null;
  const ops: NextOp[] = [];
  for (const o of x) {
    if (!isObj(o) || typeof o.exerciseId !== 'string' || !o.exerciseId) return null;
    if (o.op === 'drop' || o.op === 'lighter') ops.push({ op: o.op, exerciseId: o.exerciseId });
    else if (o.op === 'swap') {
      if (typeof o.toId !== 'string' || !o.toId || (catalog && !catalog.some((e) => e.id === o.toId))) return null;
      ops.push({ op: 'swap', exerciseId: o.exerciseId, toId: o.toId });
    } else if (o.op === 'sets') {
      if (!Number.isInteger(o.sets) || (o.sets as number) < 0 || (o.sets as number) > 10) return null;
      ops.push({ op: 'sets', exerciseId: o.exerciseId, sets: o.sets as number });
    } else return null;
  }
  return ops;
}

/** The body of a `change` record, or null for anything else. */
export function readChange(id: string, body: unknown): NextChange | null {
  if (!isObj(body) || body.target !== 'next' || !STATES.includes(body.state as ChangeState) || typeof body.atMs !== 'number' || !Number.isFinite(body.atMs)) return null;
  const ops = readNextOps(body.ops);
  if (!ops) return null;
  return { id, ops, reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : '', state: body.state as ChangeState, atMs: body.atMs, ...(typeof body.usedBy === 'string' ? { usedBy: body.usedBy } : {}) };
}

export const changeRecord = (messageId: string, ops: NextOp[], reason: string, nowMs: number): TrackedRecord =>
  ({ kind: 'change', id: changeId(messageId), updatedMs: nowMs, deleted: false, body: { target: 'next', ops, reason, state: 'proposed', atMs: nowMs } });

const ALLOWED: Record<ChangeState, ChangeState[]> = { proposed: ['taken', 'declined'], taken: ['undone', 'used'], declined: [], undone: [], used: [] };

/** The record in its next state, stamped above what it has, or null when that move is not allowed (a state never goes back). */
export function moveChange(r: TrackedRecord, to: ChangeState, nowMs: number, usedBy?: string): TrackedRecord | null {
  const c = r.kind === 'change' && !r.deleted ? readChange(r.id, r.body) : null;
  if (!c || !ALLOWED[c.state].includes(to) || !isObj(r.body)) return null;
  const { usedBy: _old, ...rest } = r.body;
  return { ...r, updatedMs: Math.max(nowMs, r.updatedMs + 1), body: { ...rest, state: to, ...(to === 'used' && usedBy ? { usedBy } : {}) } };
}

/** Live, readable change records, oldest first. */
export const changesOf = (records: readonly TrackedRecord[]): NextChange[] =>
  records.flatMap((r) => { const c = r.kind === 'change' && !r.deleted ? readChange(r.id, r.body) : null; return c ? [c] : []; }).sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : 1));

export const takenChanges = (records: readonly TrackedRecord[]): NextChange[] => changesOf(records).filter((c) => c.state === 'taken');

/** The ids of the changes workouts list as applied (`changes` of any workout). */
export function listedIds(workouts: readonly { changes?: { id: string }[] }[]): Set<string> {
  return new Set(workouts.flatMap((w) => (Array.isArray(w.changes) ? w.changes.map((c) => c.id) : [])));
}

/**
 * The plan with the taken changes applied, oldest first. An op whose exercise is not in the plan (any more) is skipped with a
 * short line. `lower`: where a lowered weight lands (default: the nearest 0.5 kg; the app passes the exercise's weight ladder). `applied`: the ids of the changes of which at least one op did something; the others are not used up.
 */
export function applyNextChanges(plan: GymWorkout, changes: readonly NextChange[], catalog: readonly Exercise[], lower: (exerciseId: string, kg: number) => number = (_id, kg) => half(kg), excluded?: ReadonlySet<string>): { plan: GymWorkout; notes: string[]; applied: string[] } {
  let exercises: GymExercise[] = plan.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) }));
  const notes: string[] = [];
  const applied: string[] = [];
  for (const c of changes) for (const o of c.ops) {
    let i = exercises.findIndex((e) => e.templateId === o.exerciseId);
    if (i < 0 && o.op === 'swap') {
      // The original is not planned: the swap still counts when its target is, or it takes the place of a planned exercise for the same muscle.
      const to = catalog.find((x) => x.id === o.toId);
      const muscle = catalog.find((x) => x.id === o.exerciseId)?.primaryMuscle;
      if (exercises.some((e) => e.templateId === o.toId)) { applied.push(c.id); continue; }
      if (to && !excluded?.has(to.id) && muscle) i = exercises.findIndex((e) => catalog.find((x) => x.id === e.templateId)?.primaryMuscle === muscle && !excluded?.has(e.templateId));
      if (i < 0) { notes.push('Ein Tausch passte nicht zu diesem Training und bleibt fürs nächste.'); continue; }
    }
    if (i < 0) { notes.push('Eine Änderung fürs Training passte nicht mehr zum Plan.'); continue; }
    const e = exercises[i]!;
    if (o.op === 'drop') { exercises = exercises.filter((_, k) => k !== i); applied.push(c.id); }
    else if (o.op === 'swap') {
      const to = catalog.find((x) => x.id === o.toId);
      if (!to || excluded?.has(to.id)) { notes.push('Eine Änderung fürs Training passte nicht mehr zum Plan.'); continue; }
      exercises[i] = { ...e, templateId: to.id, title: to.title, sets: e.sets.map((s) => ({ ...s, weightKg: null })) };
      applied.push(c.id);
    } else if (o.op === 'sets') {
      const warm = e.sets.filter((s) => s.type === 'warmup');
      const work = e.sets.filter((s) => s.type !== 'warmup');
      if (work.length === 0) { notes.push('Eine Änderung fürs Training passte nicht mehr zum Plan.'); continue; }
      const fitted = o.sets <= work.length ? work.slice(0, o.sets) : [...work, ...Array.from({ length: o.sets - work.length }, () => ({ ...work[work.length - 1]! }))].filter(Boolean);
      exercises[i] = { ...e, sets: [...warm, ...fitted] };
      applied.push(c.id);
    } else { exercises[i] = { ...e, sets: e.sets.map((s) => (s.weightKg !== null ? { ...s, weightKg: lower(e.templateId, s.weightKg * (1 - LIGHTER_PCT / 100)) } : s)) }; applied.push(c.id); }
  }
  return { plan: { ...plan, exercises }, notes: [...new Set(notes)], applied: [...new Set(applied)] };
}

/** The reason line for the coach's preview: what is taken for the next workout. Empty without any. */
export const considered = (changes: readonly NextChange[]): string => {
  const reasons = changes.map((c) => c.reason.trim().replace(/[.!]+$/, '')).filter(Boolean);
  return reasons.length ? `Berücksichtigt: ${reasons.join('; ')}.` : '';
};

/** Marks every taken change `used` that a workout lists, with that workout's id. Nothing for the rest. */
export function usedMarks(records: readonly TrackedRecord[], workouts: readonly { id: string; changes?: { id: string }[] }[], nowMs: number): TrackedRecord[] {
  return records.flatMap((r) => {
    const w = workouts.find((x) => Array.isArray(x.changes) && x.changes.some((c) => c.id === r.id));
    const next = w ? moveChange(r, 'used', nowMs, w.id) : null;
    return next ? [next] : [];
  });
}
