import { resolveExercise } from './exercise-identity';
import { LEG_MUSCLES } from '../shared/legs';
import { isExcluded } from '../shared/excluded';
import { EXERCISES, exerciseTitles, type Exercise } from '../shared/exercises';
import { defaultStudio, mainStudio, studioName, studioKey, resolveStudio, NO_STUDIOS, type StudioState } from '../shared/studio';
import { dedupeSessions, onePerSession } from '../shared/history';
import type { Effort, LoggedExercise, LoggedSet, LoggedWorkout } from '../shared/records';
import { extendDown, ladderFrom, snapDown, type Ladder, type LoadStepOverrides } from '../shared/loads';
import { tidyGroups, contiguousGroups } from '../shared/superset';
import { warmupRamp, workingWeightOf } from '../shared/warmup';
import { restAfterSet, restChoices, restExtendS } from '../shared/rest';
import { applyNextChanges, LIGHTER_PCT, listedIds, type NextChange } from '../shared/changes';
import type { GymExercise, GymWorkout } from '../coach/gym/types';

/** Pure workout logic. No browser, Node or Electron APIs, so the Mac app and the web app share it. */
/**
 * `plannedReps`: the reps the plan asked for, kept when the rider edits `reps`. `plannedKg`: the plan's weight (null: none);
 * `prefillKg`: the weight put in at the start or at the last studio change. A set whose weight still equals `prefillKg` was not edited.
 */
export type TrackedSet = LoggedSet & { rid: string; repRange?: { start: number; end: number }; plannedReps?: number; plannedKg?: number | null; prefillKg?: number | null };
export type TrackedExercise = Omit<LoggedExercise, 'sets'> & { rid: string; sets: TrackedSet[]; restS?: number | null; restByUser?: true; timed?: boolean; swappedIn?: true };
/** Stored as the record body. `rest` keeps the timer start, so a reload continues it. Rows have stable ids (`rid`). */
/** `planStudio`: the studio the plan's weights were made for (a bucket key), kept so a studio change can refit them. */
export type TrackedWorkout = Omit<LoggedWorkout, 'exercises'> & { exercises: TrackedExercise[]; rest?: { startMs: number; durationS: number } | null; planStudio?: string };

export const STALE_OPEN_MS = 6 * 3_600_000;
export type FinishChoice = 'complete' | 'omit' | 'discard';
export type FinishResult =
  | { status: 'ask'; question: 'nothing-confirmed' }
  | { status: 'ask'; question: 'open-sets'; open: number }
  | { status: 'finished'; workout: TrackedWorkout }
  | { status: 'discard' };

export const isTimed = (type: string): boolean => type.includes('duration');
const isDone = (s: LoggedSet): boolean => s.doneMs !== null;

let counter = 0;
const newRid = (): string => `r${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Records from before row ids existed get them once; a workout that has them is returned as it is. */
export function ensureIds(w: Omit<TrackedWorkout, 'exercises'> & { exercises: (Omit<TrackedExercise, 'rid' | 'sets'> & { rid?: string; sets: (Omit<TrackedSet, 'rid'> & { rid?: string })[] })[] }): TrackedWorkout {
  if (w.exercises.every((e) => e.rid && e.sets.every((s) => s.rid))) return w as TrackedWorkout;
  return { ...w, exercises: w.exercises.map((e) => ({ ...e, rid: e.rid ?? newRid(), sets: e.sets.map((s) => ({ ...s, rid: s.rid ?? newRid() })) })) };
}

/** Comma or dot. '' is empty (null), unreadable text is undefined so the caller keeps the old value. */
export function parseDecimal(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
export const formatDecimal = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

/** The studio bucket a workout counts for: its own, else the default studio, else the main one, else the shared bucket (''). */
export function hereKey(w: { studio?: string }, history: readonly LoggedWorkout[], studios: StudioState = NO_STUDIOS): string {
  return (w.studio ? resolveStudio(w.studio, studios.renames) : undefined) ?? defaultStudio(history, studios.renames, studios.picks) ?? mainStudio(history, studios.renames) ?? '';
}

/**
 * The last done sets of an exercise; an own exercise also finds sets logged in Hevy under its titles. A session known twice
 * (own and Hevy, record and kept copy) counts once. Sessions of the studio `studio` (a bucket key; default: the default
 * studio) come first, so weights never come from another studio's machines; only without any history there, all studios count
 * (unless `only`: then nothing from other studios).
 */
export function lastValues(exerciseId: string, history: LoggedWorkout[], catalog?: Exercise[], studio?: string, studios: StudioState = NO_STUDIOS, only = false): LoggedSet[] {
  const own = (catalog ?? EXERCISES).find((e) => e.id === exerciseId);
  const titles = own ? exerciseTitles(own) : [];
  const key = studio ?? hereKey({}, history, studios);
  const main = mainStudio(history, studios.renames);
  const sessions = onePerSession(dedupeSessions(history));
  const setsOf = (w: LoggedWorkout): LoggedSet[] => w.exercises.filter((e) => e.exerciseId === exerciseId || titles.includes(e.title)).flatMap((e) => e.sets.filter(isDone));
  const here = sessions.filter((w) => studioKey(w, main, studios.renames) === key);
  for (const pool of only ? [here] : [here, sessions]) {
    for (const w of pool) {
      const sets = setsOf(w);
      if (sets.length) return sets;
    }
  }
  return [];
}

const blank = (): TrackedSet => ({ rid: newRid(), type: 'normal', weightKg: null, reps: null, durationS: null, doneMs: null });
const typeOf = (id: string, catalog: Exercise[]): string => catalog.find((e) => e.id === id)?.type ?? 'weight_reps';

/** What decides the weights of a plan exercise: the studio chosen, the studio the plan is for, the person's step overrides. */
type Fit = { planStudio?: string; overrides?: LoadStepOverrides };

/** True when the plan was made for another studio than the one chosen (both bucket keys, renames applied). */
function otherStudio(planStudio: string | undefined, chosen: string, studios: StudioState): boolean {
  return !!planStudio && resolveStudio(planStudio, studios.renames).toLowerCase() !== chosen.toLowerCase();
}

/**
 * The prefill weight per set of an exercise whose sets carry their `plannedKg`, for the studio bucket `chosen`.
 * Same studio as the plan: the plan's weight, else the last one there (all studios as fallback). Another studio: that studio's own
 * last weight (no other studio's), else the plan's weight snapped down to that studio's ladder. Reps are not touched.
 */
function prefillWeights(e: Pick<TrackedExercise, 'exerciseId' | 'sets'>, chosen: string, history: LoggedWorkout[], catalog: Exercise[], studios: StudioState, fit: Fit): (number | null)[] {
  const other = otherStudio(fit.planStudio, chosen, studios);
  const last = lastValues(e.exerciseId, history, catalog, chosen, studios, other);
  let ladder: Ladder | null = null;
  const snap = (kg: number): number => {
    if (!ladder) {
      const equipment = catalog.find((c) => c.id === e.exerciseId)?.equipment ?? '';
      const sessions = onePerSession(dedupeSessions([...history])).map((h) => ({ studio: h.studio, startMs: h.startMs, sets: h.exercises.filter((x) => x.exerciseId === e.exerciseId).flatMap((x) => x.sets.filter(isDone)) }));
      ladder = extendDown(ladderFrom(sessions, { exerciseId: e.exerciseId, studio: chosen, main: mainStudio(history, studios.renames), renames: studios.renames }, equipment, fit.overrides ?? new Map()).ladder, equipment);
    }
    return snapDown(kg, ladder);
  };
  const seen = { warm: 0, work: 0 };
  return e.sets.map((s) => {
    // A warmup only ever prefills a warmup, a working set only a working set.
    const warm = s.type === 'warmup';
    const pool = last.filter((l) => (l.type === 'warmup') === warm);
    const i = warm ? seen.warm++ : seen.work++;
    const l = pool[i] ?? pool[pool.length - 1];
    const planned = s.plannedKg ?? null;
    if (!other) return planned ?? l?.weightKg ?? null;
    return l?.weightKg ?? (planned !== null ? snap(planned) : null);
  });
}

function plannedExercise(g: GymExercise, history: LoggedWorkout[], catalog: Exercise[], studio?: string, studios: StudioState = NO_STUDIOS, fit: Fit = {}): TrackedExercise {
  const last = lastValues(g.templateId, history, catalog, studio, studios);
  const timed = isTimed(typeOf(g.templateId, catalog));
  const seen = { warm: 0, work: 0 };
  const sets = g.sets.map((p): TrackedSet => {
    // A warmup only ever prefills a warmup, a working set only a working set.
    const warm = p.type === 'warmup';
    const pool = last.filter((l) => (l.type === 'warmup') === warm);
    const i = warm ? seen.warm++ : seen.work++;
    const l = pool[i] ?? pool[pool.length - 1];
    return {
      rid: newRid(), type: p.type,
      weightKg: p.weightKg ?? l?.weightKg ?? null,
      reps: p.reps ?? (p.repRange ? p.repRange.start : null) ?? l?.reps ?? null,
      durationS: l?.durationS ?? null, doneMs: null,
      plannedKg: p.weightKg,
      ...(p.repRange ? { repRange: p.repRange } : {}),
      ...(p.reps !== null && p.reps !== undefined ? { plannedReps: p.reps } : {}),
    };
  });
  // An open set without reps takes them from the set before it of the same kind, so no open set shows "–" while its neighbours show a number.
  const carry = { warmup: null as number | null, work: null as number | null };
  if (!timed) for (const s of sets) {
    const k = s.type === 'warmup' ? 'warmup' : 'work';
    if (s.reps === null) s.reps = carry[k]; else carry[k] = s.reps;
  }
  const ex: TrackedExercise = { rid: newRid(), exerciseId: g.templateId, title: g.title, supersetId: g.supersetId, notes: g.notes, sets, restS: g.restS, ...(timed ? { timed } : {}) };
  // Another studio than the plan's: the weights come from there. The same studio keeps the weights as they are.
  const kg = otherStudio(fit.planStudio, hereKey({ studio }, history, studios), studios) ? prefillWeights(ex, hereKey({ studio }, history, studios), history, catalog, studios, fit) : null;
  return { ...ex, sets: ex.sets.map((s, i) => ({ ...s, weightKg: kg ? kg[i]! : s.weightKg, prefillKg: kg ? kg[i]! : s.weightKg })) };
}

/**
 * `next`: the changes for this workout that are `taken` (see shared/changes). Applied oldest first, except those a workout
 * already lists (`workouts`, any, open or finished): a second start never applies one twice. The new workout lists each change of
 * which at least one op applied (empty rows, so no undo after the start); the others stay taken. `onSkipped` gets the short lines for ops
 * that no longer fit; they are for the rider's screen only, not workout data.
 */
/** True when a plan exercise is ruled out: by its own id, its Hevy template id or title resolved to the own catalog id. */
export function isExcludedExercise(e: { templateId: string; title: string }, catalog: Exercise[], excluded: ReadonlySet<string>): boolean {
  return isExcluded(e, excluded, catalog);
}

export function startFromPlan(w: GymWorkout, history: LoggedWorkout[], nowMs: number, id: string, catalog: Exercise[] = EXERCISES, studio?: string, studios: StudioState = NO_STUDIOS, next: { changes: NextChange[]; workouts: LoggedWorkout[]; overrides?: LoadStepOverrides; /** Exercise ids the person's rules rule out: dropped from the plan, with a line in `onSkipped`. */ excluded?: ReadonlySet<string>; /** The plan day says no legs: leg exercises are dropped (never all of them). */ noLegs?: boolean; onSkipped?: (lines: string[]) => void } = { changes: [], workouts: [] }): TrackedWorkout {
  const out = (e: GymExercise): boolean => !!next.excluded && isExcludedExercise(e, catalog, next.excluded);
  const dropped = w.exercises.filter(out);
  if (dropped.length) w = { ...w, exercises: w.exercises.filter((e) => !out(e)) };
  const legNotes: string[] = [];
  if (next.noLegs) {
    const leg = (e: GymExercise): boolean => LEG_MUSCLES.includes(resolveExercise({ exerciseId: e.templateId, title: e.title }, catalog).exercise?.primaryMuscle ?? '');
    const rest = w.exercises.filter((e) => !leg(e));
    if (rest.length === w.exercises.length) { /* no leg exercise: nothing to say */ }
    else if (rest.length === 0) legNotes.push('Heute war ohne Beine abgesprochen.');
    else { w = { ...w, exercises: rest }; legNotes.push('Ohne Beine, wie abgesprochen.'); }
  }
  const listed = listedIds(next.workouts);
  const todo = next.changes.filter((c) => c.state === 'taken' && !listed.has(c.id));
  // A lowered weight lands on a weight the machine here can really show: the exercise's ladder in this workout's studio.
  const key = hereKey({ studio }, history, studios);
  const main = mainStudio(history, studios.renames);
  const sessions = onePerSession(dedupeSessions([...history]));
  const lower = (exerciseId: string, kg: number): number => {
    const equipment = catalog.find((e) => e.id === exerciseId)?.equipment ?? '';
    const own = sessions.map((h) => ({ studio: h.studio, startMs: h.startMs, sets: h.exercises.filter((x) => x.exerciseId === exerciseId).flatMap((x) => x.sets.filter(isDone)) }));
    return snapDown(kg, ladderFrom(own, { exerciseId, studio: key, main, renames: studios.renames }, equipment, next.overrides ?? new Map()).ladder);
  };
  const { plan, notes: changeNotes, applied } = applyNextChanges(w, todo, catalog, lower, next.excluded);
  const notes = [...dropped.map((e) => `Ohne ${e.title} – deine Regel.`), ...legNotes, ...changeNotes];
  const done = todo.filter((c) => applied.includes(c.id));
  const planStudio = w.studio ? studioName(w.studio) : undefined;
  const exercises = plan.exercises.map((g) => plannedExercise(g, history, catalog, studio, studios, { planStudio, overrides: next.overrides }));
  // Lighter also works on weights the last session gave (the plan had none); planned weights were lightened above.
  for (const c of done) for (const o of c.ops) {
    const g = o.op === 'lighter' ? plan.exercises.findIndex((x) => x.templateId === o.exerciseId) : -1;
    if (g >= 0) exercises[g] = { ...exercises[g]!, sets: exercises[g]!.sets.map((x, k) => (plan.exercises[g]!.sets[k]?.weightKg === null && x.weightKg !== null ? { ...x, weightKg: lower(o.exerciseId, x.weightKg * (1 - LIGHTER_PCT / 100)) } : x)) };
  }
  if (notes.length) next.onSkipped?.(notes);
  const changes = done.map((c) => ({ id: c.id, atMs: nowMs, prior: [], pos: [], after: [] }));
  return { id, title: plan.name, startMs: nowMs, endMs: null, source: 'pandafit', exercises, rest: null, ...(planStudio ? { planStudio } : {}), ...(changes.length ? { changes } : {}) };
}
/**
 * Sets (or, with an empty name, clears) the studio. With `fit` (a workout that started from a plan) the weights follow: exercises
 * with no confirmed set get the weights for the new studio (see `prefillWeights`), but only in sets still holding their prefill; a
 * weight the rider typed stays. Confirmed sets are never touched.
 */
export function setStudio(w: TrackedWorkout, raw: string, fit?: { history: LoggedWorkout[]; catalog?: Exercise[]; studios?: StudioState; overrides?: LoadStepOverrides }): TrackedWorkout {
  const { studio: _old, ...rest } = w;
  const studio = studioName(raw);
  const next: TrackedWorkout = studio ? { ...rest, studio } : rest;
  if (!fit || !w.planStudio) return next;
  const studios = fit.studios ?? NO_STUDIOS;
  const catalog = fit.catalog ?? EXERCISES;
  const chosen = hereKey(next, fit.history, studios);
  return { ...next, exercises: next.exercises.map((e) => {
    if (e.sets.some(isDone) || !e.sets.some((s) => s.prefillKg !== undefined)) return e;
    const kg = prefillWeights(e, chosen, fit.history, catalog, studios, { planStudio: w.planStudio, overrides: fit.overrides });
    return { ...e, sets: e.sets.map((s, i) => (s.prefillKg === undefined || s.weightKg !== s.prefillKg ? s : { ...s, weightKg: kg[i]!, prefillKg: kg[i]! })) };
  }) };
}
export const startFromRoutine = startFromPlan;
export const startEmpty = (nowMs: number, id: string, title = 'Training'): TrackedWorkout =>
  ({ id, title, startMs: nowMs, endMs: null, source: 'pandafit', exercises: [], rest: null });

function fromCatalog(e: Exercise, history: LoggedWorkout[], studio: string, keep?: Pick<TrackedExercise, 'supersetId'>, studios: StudioState = NO_STUDIOS): TrackedExercise {
  const last = lastValues(e.id, history, [e], studio, studios);
  const sets: TrackedSet[] = last.length
    ? last.map((l) => ({ rid: newRid(), type: l.type, weightKg: l.weightKg, reps: l.reps, durationS: l.durationS, doneMs: null }))
    : [blank()];
  return { rid: newRid(), exerciseId: e.id, title: e.title, supersetId: keep?.supersetId ?? null, notes: '', sets, ...(isTimed(e.type) ? { timed: true } : {}) };
}

/** Applies f to the exercise with that row id. An unknown id (a stale tap) changes nothing and returns the same object. */
function mapEx(w: TrackedWorkout, rid: string, f: (e: TrackedExercise) => TrackedExercise): TrackedWorkout {
  if (!w.exercises.some((e) => e.rid === rid)) return w;
  return { ...w, exercises: w.exercises.map((e) => (e.rid === rid ? f(e) : e)) };
}
function mapSet(w: TrackedWorkout, ex: string, set: string, f: (s: TrackedSet) => TrackedSet): TrackedWorkout {
  if (!w.exercises.find((e) => e.rid === ex)?.sets.some((s) => s.rid === set)) return w;
  return mapEx(w, ex, (x) => ({ ...x, sets: x.sets.map((s) => (s.rid === set ? f(s) : s)) }));
}

const kindOf = (t: TrackedSet['type']): string => (t === 'warmup' ? 'w' : t === 'dropset' ? 'd' : 'n');
/** The preset of an empty set: all values of the nearest set before it of the same kind (warm-up, drop set or working) that has any value. Never mixed from several sets. */
export function presetOf(sets: readonly TrackedSet[], index: number): Pick<TrackedSet, 'weightKg' | 'reps' | 'durationS'> {
  const me = sets[index];
  const none = { weightKg: null, reps: null, durationS: null };
  if (!me) return none;
  for (let i = index - 1; i >= 0; i--) {
    const o = sets[i]!;
    if (kindOf(o.type) !== kindOf(me.type)) continue;
    if (o.weightKg !== null || o.reps !== null || o.durationS !== null) return { weightKg: o.weightKg, reps: o.reps, durationS: o.durationS };
  }
  return none;
}
type Values = Pick<TrackedSet, 'weightKg' | 'reps' | 'durationS'>;
/** What an empty set takes from its preset: all three when it is entirely empty, else only the missing reps or seconds of a set that has a weight. A cleared weight next to reps is meant (bodyweight) and stays. */
export function filled(s: Values, preset: Values): Partial<Values> {
  if (s.weightKg === null && s.reps === null && s.durationS === null) return { weightKg: preset.weightKg, reps: preset.reps, durationS: preset.durationS };
  if (s.weightKg !== null && s.reps === null && s.durationS === null) return { reps: preset.reps, durationS: preset.durationS };
  return {};
}
/** Confirming a set without any value takes the preset (the set before it), so one tap logs "the same again". */
export function confirmSet(w: TrackedWorkout, ex: string, set: string, nowMs: number, catalog: readonly Exercise[] = EXERCISES): TrackedWorkout {
  const sets = w.exercises.find((x) => x.rid === ex)?.sets ?? [];
  const preset = presetOf(sets, sets.findIndex((s) => s.rid === set));
  const next = mapSet(w, ex, set, (s) => ({ ...s, ...filled(s, preset), doneMs: nowMs }));
  if (next === w) return w;
  const setIndex = next.exercises.find((x) => x.rid === ex)?.sets.findIndex((s) => s.rid === set) ?? 0;
  const durationS = restAfterSet(next, ex, setIndex, catalog);
  return { ...next, rest: durationS === null ? null : { startMs: nowMs, durationS } };
}
/** Adds the extension (30 s) to the running rest. No rest running changes nothing. */
export const extendRest = (w: TrackedWorkout, s: number = restExtendS()): TrackedWorkout => (w.rest ? { ...w, rest: { ...w.rest, durationS: w.rest.durationS + s } } : w);
/** Sets the rest of one exercise (one of the offered choices); the next confirmed set uses it. */
export const setRest = (w: TrackedWorkout, ex: string, s: number): TrackedWorkout => (restChoices().includes(s) ? mapEx(w, ex, (x) => ({ ...x, restS: s, restByUser: true as const })) : w);
export function unconfirmSet(w: TrackedWorkout, ex: string, set: string): TrackedWorkout {
  const next = mapSet(w, ex, set, (s) => ({ ...s, doneMs: null }));
  return next === w ? w : { ...next, rest: null };
}
export const editSet = (w: TrackedWorkout, ex: string, set: string, patch: Partial<Pick<TrackedSet, 'weightKg' | 'reps' | 'durationS' | 'type'>>): TrackedWorkout =>
  mapSet(w, ex, set, (s) => ({ ...s, ...patch }));
export const setEffort = (w: TrackedWorkout, ex: string, effort: Effort | 'skip'): TrackedWorkout => mapEx(w, ex, (x) => ({ ...x, effort }));
export const editNotes = (w: TrackedWorkout, ex: string, notes: string): TrackedWorkout => mapEx(w, ex, (x) => ({ ...x, notes }));
export const addSet = (w: TrackedWorkout, ex: string): TrackedWorkout =>
  mapEx(w, ex, (x) => {
    const l = x.sets[x.sets.length - 1];
    return { ...x, sets: [...x.sets, l ? { ...l, rid: newRid(), doneMs: null } : blank()] };
  });
/**
 * Inserts the warm-up ramp before the exercise's first work set (the working weight is that set's weight) as normal, editable
 * sets of type warmup. Nothing is added without a working weight, or when the exercise already has a warm-up or a done set.
 */
export function addWarmup(w: TrackedWorkout, ex: string, ladder: Ladder, catalog: readonly Exercise[] = EXERCISES): TrackedWorkout {
  const e = w.exercises.find((x) => x.rid === ex);
  if (!e || e.sets.some((s) => s.type === 'warmup' || s.doneMs !== null)) return w;
  const own = resolveExercise(e, [...catalog]).exercise;
  const ramp = warmupRamp({ workingKg: workingWeightOf(e), equipment: own?.equipment ?? 'other', ladder, type: own?.type });
  if (ramp.length === 0) return w;
  const first = Math.max(0, e.sets.findIndex((s) => s.type !== 'warmup'));
  const sets = ramp.map((r): TrackedSet => ({ rid: newRid(), type: 'warmup', weightKg: r.weightKg, reps: r.reps, durationS: null, doneMs: null }));
  return mapEx(w, ex, (x) => ({ ...x, sets: [...x.sets.slice(0, first), ...sets, ...x.sets.slice(first)] }));
}
export const removeSet = (w: TrackedWorkout, ex: string, set: string): TrackedWorkout =>
  mapSet(w, ex, set, (s) => s) === w ? w : mapEx(w, ex, (x) => ({ ...x, sets: x.sets.filter((s) => s.rid !== set) }));
export const addExercise = (w: TrackedWorkout, e: Exercise, history: LoggedWorkout[], studios: StudioState = NO_STUDIOS): TrackedWorkout =>
  ({ ...w, exercises: [...w.exercises, fromCatalog(e, history, hereKey(w, history, studios), undefined, studios)] });
export const removeExercise = (w: TrackedWorkout, ex: string): TrackedWorkout =>
  w.exercises.some((e) => e.rid === ex) ? { ...w, exercises: tidyGroups(w.exercises.filter((e) => e.rid !== ex)) } : w;

/** What really happened counts: confirmed sets stay with the old exercise, the rest moves to the new one. */
export function swapExercise(w: TrackedWorkout, ex: string, e: Exercise, history: LoggedWorkout[], studios: StudioState = NO_STUDIOS): TrackedWorkout {
  const i = w.exercises.findIndex((x) => x.rid === ex);
  if (i < 0) return w;
  const old = w.exercises[i];
  const doneSets = old.sets.filter(isDone);
  const fresh: TrackedExercise = { ...fromCatalog(e, history, hereKey(w, history, studios), old, studios), swappedIn: true, ...(old.restByUser && old.restS != null ? { restS: old.restS, restByUser: true as const } : {}) };
  const exercises = [...w.exercises];
  if (!doneSets.length) exercises.splice(i, 1, fresh);
  else {
    // The done-set copy leaves the group (it goes right before it), so the group stays contiguous around the new exercise.
    const copy = { ...old, supersetId: null, sets: doneSets };
    const at = old.supersetId === null ? i : exercises.findIndex((x) => x.supersetId === old.supersetId);
    exercises.splice(i, 1, fresh);
    exercises.splice(at, 0, copy);
  }
  return { ...w, exercises: tidyGroups(exercises) };
}

export const restRemainingS = (w: TrackedWorkout, nowMs: number): number =>
  w.rest ? Math.max(0, Math.ceil((w.rest.startMs + w.rest.durationS * 1000 - nowMs) / 1000)) : 0;

/** A first confirmed set later than this after the start moves the start to that set. */
const LATE_FIRST_SET_MS = 3 * 3600_000;

/**
 * Asks before anything is dropped. 'discard' only works when no set is confirmed; otherwise it is ignored and the
 * normal question comes. A workout whose last confirmed set is over 6 hours old ends at that set, not now.
 */
export function finish(w: TrackedWorkout, nowMs: number, choice?: FinishChoice): FinishResult {
  const sets = w.exercises.flatMap((e) => e.sets);
  const doneTimes = sets.filter(isDone).map((s) => s.doneMs as number);
  const confirmed = doneTimes.length;
  const open = sets.length - confirmed;
  if (choice === 'discard' && confirmed > 0) choice = undefined;
  if (confirmed === 0 && choice !== 'complete') {
    return choice === 'discard' ? { status: 'discard' } : { status: 'ask', question: 'nothing-confirmed' };
  }
  if (open > 0 && !choice) return { status: 'ask', question: 'open-sets', open };
  const last = confirmed ? Math.max(...doneTimes) : null;
  const endMs = last !== null && nowMs - last > STALE_OPEN_MS ? last : nowMs;
  const exercises = choice === 'complete'
    ? w.exercises.map((e) => {
      // Open sets are entered as shown: an empty one takes its preset, like a tap on the check.
      const sets: TrackedSet[] = [];
      e.sets.forEach((s, i) => { sets.push(isDone(s) ? s : { ...s, ...filled(s, presetOf([...sets, ...e.sets.slice(i)], i)), doneMs: endMs }); });
      return { ...e, sets };
    })
    : w.exercises;
  // The undo data of a coach change is of no use once the workout is over; the ids stay (a second start must not apply them again).
  const changes = w.changes?.map((c) => ({ id: c.id, atMs: c.atMs, prior: [], pos: [], after: [] })); // anchor left out too
  // Started long before the first confirmed set (left open overnight): the workout dates from that set. Only startMs changes, never the sets.
  const first = confirmed ? Math.min(...doneTimes) : null;
  const startMs = first !== null && first - w.startMs > LATE_FIRST_SET_MS ? first : w.startMs;
  return { status: 'finished', workout: { ...w, startMs, exercises, endMs, rest: null, ...(changes ? { changes } : {}) } };
}

/** A running time: "1:39", past an hour "1:02:05". */
export function durationLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Joins an exercise with any partner in a superset: the partner (with its own group) moves directly behind the group of `ex`,
 * all share one group id. The partner must be unstarted (no confirmed set); anything else changes nothing. Rows stay intact.
 */
export function linkWith(w: TrackedWorkout, ex: string, partner: string): TrackedWorkout {
  const a = w.exercises.find((x) => x.rid === ex), p = w.exercises.find((x) => x.rid === partner);
  if (!a || !p || a === p || (a.supersetId !== null && a.supersetId === p.supersetId)) return w;
  const groupOf = (x: TrackedExercise) => (x.supersetId === null ? [x] : w.exercises.filter((y) => y.supersetId === x.supersetId));
  if (groupOf(p).some((x) => x.sets.some(isDone))) return w;
  const id = a.supersetId ?? p.supersetId ?? Math.max(-1, ...w.exercises.map((x) => x.supersetId ?? -1)) + 1;
  const moving = (x: TrackedExercise) => x === p || (p.supersetId !== null && x.supersetId === p.supersetId);
  const base = contiguousGroups(w.exercises.filter((x) => !moving(x)));
  const into = (x: TrackedExercise) => x.rid === ex || (a.supersetId !== null && x.supersetId === a.supersetId);
  const last = base.reduce((n, x, k) => (into(x) ? k : n), -1);
  const joined = w.exercises.filter(moving).map((x) => ({ ...x, supersetId: id }));
  base.splice(last + 1, 0, ...joined);
  return { ...w, exercises: base.map((x) => (into(x) ? { ...x, supersetId: id } : x)) };
}

/** The exercises other than `ex` that can be its partner: unstarted and not already in its group. */
export const supersetPartners = (w: TrackedWorkout, ex: string): TrackedExercise[] => {
  const a = w.exercises.find((x) => x.rid === ex);
  return a ? w.exercises.filter((x) => x !== a && (a.supersetId === null || x.supersetId !== a.supersetId)
    && !(x.supersetId === null ? x.sets.some(isDone) : w.exercises.some((y) => y.supersetId === x.supersetId && y.sets.some(isDone)))) : [];
};

/**
 * The next set to train, in round order: a single exercise by its sets, a superset group round by round (A1 B1 A2 B2).
 * Members without an open set, or skipped, are passed over. null when nothing is open.
 */
export function currentSet(w: TrackedWorkout): { ex: string; set: string; round: number } | null {
  const skipped = (e: TrackedExercise) => e.supersetId !== null && e.effort === 'skip';
  const work = (e: TrackedExercise) => e.sets.filter((s) => s.type !== 'warmup');
  /** The index among work sets of the first open work set; -1 when none. */
  const open = (e: TrackedExercise) => (skipped(e) ? -1 : work(e).findIndex((s) => !isDone(s)));
  // A warm-up is open only until the exercise has a done work set; later it never blocks the work.
  const warm = (e: TrackedExercise) => (skipped(e) || work(e).some(isDone) ? undefined : e.sets.find((s) => s.type === 'warmup' && !isDone(s)));
  for (const e of w.exercises) {
    const members = e.supersetId === null ? [e] : w.exercises.filter((x) => x.supersetId === e.supersetId);
    // Warm-ups come before the first round and pair with nothing.
    for (const x of members) { const s = warm(x); if (s) return { ex: x.rid, set: s.rid, round: 0 }; }
    const live = members.filter((x) => open(x) >= 0);
    if (live.length === 0) continue;
    const best = live.reduce((m, x) => (open(x) < open(m) ? x : m), live[0]!);
    const k = open(best);
    return { ex: best.rid, set: work(best)[k]!.rid, round: k + 1 };
  }
  return null;
}

/** Takes one exercise out of its superset; a group left with one exercise is dissolved. */
export function unlinkSuperset(w: TrackedWorkout, ex: string): TrackedWorkout {
  const e = w.exercises.find((x) => x.rid === ex);
  if (!e || e.supersetId === null) return w;
  const group = e.supersetId;
  const rest = w.exercises.filter((x) => x.rid !== ex && x.supersetId === group);
  return { ...w, exercises: w.exercises.map((x) => (x.rid === ex || (rest.length === 1 && x.supersetId === group) ? { ...x, supersetId: null } : x)) };
}

/** The workout's exercises as blocks: a superset group is one block, every other exercise its own. */
export function exerciseBlocks(w: TrackedWorkout): TrackedExercise[][] {
  const blocks: TrackedExercise[][] = [];
  for (const e of w.exercises) {
    const last = blocks[blocks.length - 1];
    if (last && e.supersetId !== null && last[0]!.supersetId === e.supersetId) last.push(e);
    else blocks.push([e]);
  }
  return blocks;
}

/** Moves an exercise one place up (-1) or down (1). A superset group moves as one block past the neighbouring block (a single exercise or a whole group). Rows stay intact. */
export function moveExercise(w: TrackedWorkout, ex: string, dir: -1 | 1): TrackedWorkout {
  const blocks = exerciseBlocks(w);
  const i = blocks.findIndex((b) => b.some((e) => e.rid === ex));
  return moveExerciseTo(w, ex, i + dir);
}

/** Moves the block of an exercise (a single exercise or its whole superset group) so it ends up at block index `targetIndex`. Same index, unknown row or out of range: the workout as it is. Rows stay intact. */
export function moveExerciseTo(w: TrackedWorkout, ex: string, targetIndex: number): TrackedWorkout {
  const blocks = exerciseBlocks(w);
  const i = blocks.findIndex((b) => b.some((e) => e.rid === ex));
  if (i < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= blocks.length || targetIndex === i) return w;
  const [block] = blocks.splice(i, 1);
  blocks.splice(targetIndex, 0, block!);
  return { ...w, exercises: blocks.flat() };
}
