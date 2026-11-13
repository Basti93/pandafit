import { ruleNumber, ruleNumbers, ruleRange } from './training-policy';
import { EXERCISES, catalogEntryOf, type Exercise } from './exercises';
import { isCompound } from './compound';

/** The rest of an exercise comes from here only: the timer, the duration estimate and the coach plan all ask `restOf`. */
type RestSet = { type?: string; reps?: number | null; plannedReps?: number | null; repRange?: { start: number; end: number } };
type RestExercise = { exerciseId?: string; templateId?: string; title?: string; restS?: number | null; sets?: readonly RestSet[] };

export const restMid = (id: string): number => { const r = ruleRange(id); return Math.round((r.min + r.max) / 2); };

/** The planned reps of the first work set (the plan's own number, else the end of its range). */
const plannedRepsOf = (sets: readonly RestSet[] = []): number | null => {
  const s = sets.find((x) => x.type !== 'warmup');
  return s ? (s.plannedReps ?? s.reps ?? s.repRange?.end ?? null) : null;
};

/** Seconds of rest after a set: an explicit rest wins, else the register by kind (heavy, compound, isolation). */
export function restOf(e: RestExercise, catalog: readonly Exercise[] = EXERCISES): number {
  if (typeof e.restS === 'number') return e.restS;
  const reps = plannedRepsOf(e.sets);
  if (reps !== null && reps <= ruleNumber('rest.heavy-max-reps')) return restMid('rest.heavy-strength-s');
  const own = catalogEntryOf(e, catalog);
  const compound = !!own && isCompound(own);
  return restMid(compound ? 'rest.compound-s' : 'rest.isolation-s');
}

type RestWorkout = { exercises: (RestExercise & { rid: string; supersetId: number | null; effort?: string; sets: readonly (RestSet & { doneMs: number | null })[] })[] };

/**
 * The rest to start after the set at `setIndex` of exercise `rid`: in a superset only after the last member of the round
 * (null while another member still has that round's set open, skipped members aside), then the longest rest of the members.
 */
export function restAfterSet(w: RestWorkout, rid: string, setIndex: number, catalog: readonly Exercise[] = EXERCISES): number | null {
  const i = w.exercises.findIndex((x) => x.rid === rid);
  const e = w.exercises[i];
  if (!e) return null;
  const group = e.supersetId;
  const isWarm = (x: { type?: string }): boolean => x.type === 'warmup';
  if (isWarm(e.sets[setIndex] ?? {})) {
    if (e.sets[setIndex + 1] && isWarm(e.sets[setIndex + 1]!)) return ruleNumber('rest.warmup-s'); // a warm-up set pairs with nothing and rests short
    return Math.min(ruleNumber('rest.after-warmup-s'), restOf(e, catalog)); // the last warm-up set: a real rest before the first work set
  }
  /** Only a change of machine when the exercise after `lastIndex` opens with a warm-up set. */
  const beforeWarmup = (lastIndex: number, rest: number): number => {
    const next = (w.exercises[lastIndex + 1]?.sets as readonly { type?: string; doneMs: number | null }[] | undefined)?.find((s) => s.doneMs === null);
    return next && isWarm(next) ? Math.min(ruleNumber('rest.before-warmup-s'), rest) : rest;
  };
  if (group === null) return setIndex === e.sets.length - 1 ? beforeWarmup(i, restOf(e, catalog)) : restOf(e, catalog);
  const round = e.sets.slice(0, setIndex).filter((s) => s.type !== 'warmup').length;
  const roundSet = (x: RestWorkout['exercises'][number]): { doneMs: number | null } | undefined => (x.sets as readonly { type?: string; doneMs: number | null }[]).filter((s) => s.type !== 'warmup')[round];
  if (w.exercises.some((x) => x !== e && x.supersetId === group && x.effort !== 'skip' && roundSet(x)?.doneMs === null)) return null;
  const members = w.exercises.filter((x) => x.supersetId === group);
  const rest = Math.max(...members.map((x) => restOf(x, catalog)));
  const lastRound = Math.max(...members.map((x) => x.sets.filter((s) => !isWarm(s)).length)) - 1;
  const groupEnd = w.exercises.reduce((n, x, j) => (x.supersetId === group ? j : n), i);
  return round >= lastRound ? beforeWarmup(groupEnd, rest) : rest;
}

export const restExtendS = (): number => ruleNumber('rest.extend-s');
export const restChoices = (): number[] => ruleNumbers('rest.choices');
export { plannedRepsOf };
