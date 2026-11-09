import { readWorkoutChange } from '../../src/shared/chat';
import { EXERCISES } from '../../src/shared/exercises';
import { applyWorkoutChange, validOps } from '../../src/tracking/workout-change';
import { confirmSet, startFromPlan, type TrackedWorkout } from '../../src/tracking/session';
import type { GymWorkout } from '../../src/shared/gym/types';

const plan: GymWorkout = { name: 'P', exercises: [
  { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 60, reps: 8 })) },
  { templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 80, reps: 5 })) },
] };
const start = (): TrackedWorkout => {
  const w = startFromPlan(plan, [], 0, 'w1');
  return confirmSet(w, w.exercises[0]!.rid, w.exercises[0]!.sets[0]!.rid, 1);
};
const ch = (ops: object[]) => readWorkoutChange({ workoutId: 'w1', ops })!;

test('reads only valid shapes', () => {
  expect(readWorkoutChange({ workoutId: 'w1', ops: [{ op: 'lighter', ex: 'a', pct: 50 }] })).toBeNull();
  expect(readWorkoutChange({ workoutId: 'w1', ops: [{ op: 'jump', ex: 'a' }] })).toBeNull();
  expect(readWorkoutChange({ workoutId: 'w1', ops: [{ op: 'sets', ex: 'a', open: 1 }] })).toEqual({ workoutId: 'w1', ops: [{ op: 'sets', ex: 'a', open: 1 }] });
});

test('dropping keeps done sets, an untouched exercise goes entirely', () => {
  const w = start();
  const [bench, squat] = w.exercises.map((e) => e.rid);
  const x = applyWorkoutChange(w, ch([{ op: 'drop', ex: bench }, { op: 'drop', ex: squat }]), [], EXERCISES);
  expect(x.exercises).toHaveLength(1);
  expect(x.exercises[0]!.sets).toHaveLength(1);
  expect(x.exercises[0]!.sets[0]!.doneMs).toBe(1);
});

test('fewer sets, lighter and swap touch only open sets', () => {
  const w = start();
  const [bench, squat] = w.exercises.map((e) => e.rid);
  const x = applyWorkoutChange(w, ch([{ op: 'sets', ex: bench, open: 1 }, { op: 'lighter', ex: bench, pct: 10 }, { op: 'swap', ex: squat, to: 'pf-leg-press' }]), [], EXERCISES);
  expect(x.exercises[0]!.sets.map((s) => [s.weightKg, s.doneMs])).toEqual([[60, 1], [54, null]]);
  expect(x.exercises[1]!.exerciseId).toBe('pf-leg-press');
});

test('unknown rows, finished exercises, other workouts and unknown swap targets do nothing', () => {
  const w = start();
  const bench = w.exercises[0]!.rid;
  expect(validOps(ch([{ op: 'drop', ex: 'nope' }, { op: 'swap', ex: bench, to: 'not-in-catalog' }]), w, EXERCISES)).toEqual([]);
  expect(validOps({ workoutId: 'other', ops: [{ op: 'drop', ex: bench }] }, w, EXERCISES)).toEqual([]);
  expect(validOps(ch([{ op: 'drop', ex: bench }]), { ...w, endMs: 5 }, EXERCISES)).toEqual([]);
});

test('take lists the change once; undo of a drop and a swap restores rows and positions, done sets stay', async () => {
  const { takeChange, undoChange } = await import('../../src/tracking/workout-change');
  const w = start();
  const [bench, squat] = w.exercises.map((e) => e.rid);
  const c = ch([{ op: 'drop', ex: bench }, { op: 'swap', ex: squat, to: 'pf-leg-press' }]);
  const t = takeChange(w, 'm1:0', c, [], EXERCISES, { renames: [], picks: [] } as never, 5);
  expect(t.workout.changes).toHaveLength(1);
  expect(t.workout.exercises[0]!.sets).toHaveLength(1);
  expect(takeChange(t.workout, 'm1:0', c, [], EXERCISES, { renames: [], picks: [] } as never, 6).workout).toBe(t.workout);
  const u = undoChange(t.workout, 'm1:0');
  expect(u.refusal).toBeNull();
  expect(u.workout).toEqual(w);
});

test('a missing row says the exercise is gone, not that the set is done', async () => {
  const { checkOps } = await import('../../src/tracking/workout-change');
  expect(checkOps(ch([{ op: 'drop', ex: 'nope' }]), start(), EXERCISES).reasons).toEqual(['die Übung nicht mehr da ist']);
  const w = start();
  const allDone = { ...w, exercises: w.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, doneMs: 1 })) })) };
  expect(checkOps(ch([{ op: 'drop', ex: w.exercises[0]!.rid }]), allDone, EXERCISES).reasons).toEqual(['der Satz schon erledigt ist']);
});

test('undo ignores planned values the rider did not edit, and refuses a set confirmed at the very moment of the change', async () => {
  const { takeChange, undoChange } = await import('../../src/tracking/workout-change');
  const none = { renames: [], picks: [] } as never;
  const w = start();
  const { workout } = takeChange(w, 'c:0', ch([{ op: 'lighter', ex: w.exercises[0]!.rid, pct: 10 }]), [], EXERCISES, none, 100);
  const replanned = { ...workout, exercises: workout.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, plannedReps: 99 })) })) };
  expect(undoChange(replanned, 'c:0').refusal).toBeNull();
  const same = { ...workout, exercises: workout.exercises.map((e) => ({ ...e, sets: e.sets.map((s, i) => (i === 1 ? { ...s, doneMs: 100 } : s)) })) };
  expect(undoChange(same, 'c:0').refusal).toMatch(/weitertrainiert/);
});

test('finishing keeps the ids of the changes but not their undo data', async () => {
  const { takeChange } = await import('../../src/tracking/workout-change');
  const { finish } = await import('../../src/tracking/session');
  const w = start();
  const { workout } = takeChange(w, 'c:0', ch([{ op: 'lighter', ex: w.exercises[0]!.rid, pct: 10 }]), [], EXERCISES, { renames: [], picks: [] } as never, 100);
  expect(workout.changes![0]!.after.length).toBeGreaterThan(0);
  const r = finish(workout, 200, 'omit');
  expect(r.status).toBe('finished');
  if (r.status === 'finished') expect(r.workout.changes).toEqual([{ id: 'c:0', atMs: 100, prior: [], pos: [], after: [] }]);
});
