import { tidyGroups } from '../shared/superset';
import type { WorkoutChange, WorkoutOp } from '../shared/chat';
import type { Exercise } from '../shared/exercises';
import type { LoggedWorkout } from '../shared/records';
import { NO_STUDIOS, type StudioState } from '../shared/studio';
import type { WorkoutChangeEntry } from '../shared/records';
import { gehtNicht } from '../shared/wording';
import { half } from '../shared/changes';
import { removeExercise, swapExercise, type TrackedWorkout } from './session';

const open = (w: TrackedWorkout, ex: string) => w.exercises.find((e) => e.rid === ex)?.sets.filter((s) => s.doneMs === null) ?? [];

/**
 * The ops that can apply to this workout (their row exists and still has open sets, a swap target is in the catalog)
 * and, for the others, one reason each in words.
 */
export function checkOps(change: WorkoutChange, w: TrackedWorkout, catalog: Exercise[], excluded?: ReadonlySet<string>): { ops: WorkoutOp[]; reasons: string[] } {
  if (change.workoutId !== w.id || w.endMs !== null) return { ops: [], reasons: change.ops.length ? ['das Training schon beendet ist'] : [] };
  const ops: WorkoutOp[] = [];
  const reasons: string[] = [];
  for (const o of change.ops) {
    if (!w.exercises.some((e) => e.rid === o.ex)) reasons.push('die Übung nicht mehr da ist');
    else if (open(w, o.ex).length === 0) reasons.push('der Satz schon erledigt ist');
    else if (o.op === 'swap' && !catalog.some((e) => e.id === o.to)) reasons.push('die Übung nicht im Katalog ist');
    else if (o.op === 'swap' && excluded?.has(o.to)) reasons.push(`du ${catalog.find((e) => e.id === o.to)?.title ?? 'die Übung'} ausgeschlossen hast`);
    else ops.push(o);
  }
  return { ops, reasons };
}

export const validOps = (change: WorkoutChange, w: TrackedWorkout, catalog: Exercise[], excluded?: ReadonlySet<string>): WorkoutOp[] => checkOps(change, w, catalog, excluded).ops;

/** Applies the valid ops in order. Done sets are never touched. */
export function applyWorkoutChange(w: TrackedWorkout, change: WorkoutChange, history: LoggedWorkout[], catalog: Exercise[], studios: StudioState = NO_STUDIOS, excluded?: ReadonlySet<string>): TrackedWorkout {
  let x = w;
  for (const o of validOps(change, w, catalog, excluded)) {
    const e = x.exercises.find((y) => y.rid === o.ex);
    if (!e) continue;
    if (o.op === 'drop') {
      x = e.sets.some((s) => s.doneMs !== null)
        ? { ...x, exercises: x.exercises.map((y) => (y.rid === o.ex ? { ...y, sets: y.sets.filter((s) => s.doneMs !== null) } : y)) }
        : removeExercise(x, o.ex);
    } else if (o.op === 'swap') {
      const to = catalog.find((c) => c.id === o.to);
      if (to) x = swapExercise(x, o.ex, to, history, studios);
    } else if (o.op === 'sets') {
      let seen = 0;
      x = { ...x, exercises: x.exercises.map((y) => (y.rid === o.ex ? { ...y, sets: y.sets.filter((s) => s.doneMs !== null || seen++ < o.open) } : y)) };
    } else {
      x = { ...x, exercises: x.exercises.map((y) => (y.rid === o.ex ? { ...y, sets: y.sets.map((s) => (s.doneMs === null && s.weightKg !== null ? { ...s, weightKg: half(s.weightKg * (1 - o.pct / 100)) } : s)) } : y)) };
    }
  }
  return x;
}

/** What the rider edits by hand: per row the type, weight and reps of each set (and so the set count). Planned values and the like do not count. */
const edited = (rows: readonly { rid?: string; sets: { type: string; weightKg: number | null; reps: number | null }[] }[]): string =>
  JSON.stringify(rows.map((e) => [e.rid, e.sets.map((s) => [s.type, s.weightKg, s.reps])]));
export const changeTaken = (w: TrackedWorkout, id: string): boolean => !!w.changes?.some((c) => c.id === id);

/**
 * Applies the change and records it in the workout, so one write of the workout holds both. Taking an id that is
 * already listed changes nothing. `line`: why some ops did not apply, in words.
 */
export function takeChange(w: TrackedWorkout, id: string, change: WorkoutChange, history: LoggedWorkout[], catalog: Exercise[], studios: StudioState, nowMs: number, excluded?: ReadonlySet<string>): { workout: TrackedWorkout; line: string | null } {
  if (changeTaken(w, id)) return { workout: w, line: null };
  const { ops, reasons } = checkOps(change, w, catalog, excluded);
  const line = gehtNicht(reasons);
  if (ops.length === 0) return { workout: w, line };
  const next = applyWorkoutChange(w, { workoutId: change.workoutId, ops }, history, catalog, studios, excluded);
  const touched = new Set(ops.map((o) => o.ex));
  const before = new Set(w.exercises.map((e) => e.rid));
  const isTouched = (e: TrackedWorkout['exercises'][number]) => touched.has(e.rid) || !before.has(e.rid);
  const entry: WorkoutChangeEntry = {
    id, atMs: nowMs,
    prior: w.exercises.filter((e) => touched.has(e.rid)),
    pos: w.exercises.flatMap((e, i) => (touched.has(e.rid) ? [i] : [])),
    after: next.exercises.filter(isTouched),
    anchor: w.exercises[Math.min(...w.exercises.flatMap((e, i) => (touched.has(e.rid) ? [i] : [])), w.exercises.length) - 1]?.rid ?? null,
  };
  return { workout: { ...next, changes: [...(w.changes ?? []), entry] }, line };
}

const rids = (rows: { rid?: string }[]) => new Set(rows.map((r) => r.rid));

/** null when undo is possible, else the reason in words. */
export function undoRefusal(w: TrackedWorkout, id: string): string | null {
  const c = w.changes?.find((x) => x.id === id);
  if (!c) return 'Das gibt es nicht mehr.';
  const mine = rids(c.after as { rid?: string }[]);
  const rows = w.exercises.filter((e) => mine.has(e.rid));
  if (rows.some((e) => e.sets.some((s) => s.doneMs !== null && s.doneMs >= c.atMs))) return 'Das geht nicht, weil du in dieser Übung schon weitertrainiert hast.';
  if (edited(rows) !== edited(c.after as TrackedWorkout['exercises'])) return 'Das geht nicht, weil du sie inzwischen selbst geändert hast.';
  return null;
}

/** Restores the touched rows as they were and removes the entry, in one step. Refused: the workout is returned as it is. */
export function undoChange(w: TrackedWorkout, id: string): { workout: TrackedWorkout; refusal: string | null } {
  const refusal = undoRefusal(w, id);
  const c = w.changes?.find((x) => x.id === id);
  if (refusal || !c) return { workout: w, refusal };
  const mine = rids(c.after as { rid?: string }[]);
  const exercises = w.exercises.filter((e) => !mine.has(e.rid));
  // Where the first row goes: right after the anchor when it is still there (rows may have moved), else the stored index.
  const found = c.anchor === undefined ? -1 : c.anchor === null ? 0 : exercises.findIndex((e) => e.rid === c.anchor) + 1;
  const first = c.pos[0] ?? 0;
  (c.prior as TrackedWorkout['exercises']).forEach((e, k) => {
    const i = found >= 0 && (c.anchor === null || found > 0) ? found + (c.pos[k] ?? first) - first : c.pos[k] ?? exercises.length;
    exercises.splice(Math.max(0, Math.min(i, exercises.length)), 0, e);
  });
  const changes = (w.changes ?? []).filter((x) => x.id !== id);
  const { changes: _old, ...rest } = w;
  return { workout: { ...rest, exercises: tidyGroups(exercises), ...(changes.length ? { changes } : {}) }, refusal: null };
}
