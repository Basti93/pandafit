import { asksEffort, MAX_EFFORT_QUESTIONS } from '../../src/tracking/effort';
import { confirmSet, editSet, setEffort, startFromPlan, swapExercise, type TrackedWorkout } from '../../src/tracking/session';
import { EXERCISES } from '../../src/shared/exercises';
import type { LoggedWorkout } from '../../src/shared/records';
import type { GymWorkout } from '../../src/shared/gym/types';

const plan = (reps: number | null, repRange?: { start: number; end: number }, n = 1): GymWorkout => ({ name: 'P', exercises: Array.from({ length: n }, (_, i) => ({
  templateId: `pf-x${i}`, title: `X${i}`, restS: null, supersetId: null, notes: '',
  sets: [{ type: 'warmup' as const, weightKg: 20, reps: 10 }, { type: 'normal' as const, weightKg: 50, reps, ...(repRange ? { repRange } : {}) }],
})) });
const past = (weightKg: number): LoggedWorkout => ({ id: 'h', title: 'A', startMs: 1, endMs: 2, source: 'pandafit',
  exercises: [{ exerciseId: 'pf-x0', title: 'X0', supersetId: null, notes: '', sets: [{ type: 'normal', weightKg, reps: 8, durationS: null, doneMs: 2 }] }] });
/** Does every set of exercise i with the given reps on the working set. */
const doAll = (w: TrackedWorkout, reps: number, i = 0, weightKg?: number): TrackedWorkout => {
  const ex = w.exercises[i];
  let x = editSet(w, ex.rid, ex.sets[1].rid, { reps, ...(weightKg !== undefined ? { weightKg } : {}) });
  for (const s of ex.sets) x = confirmSet(x, ex.rid, s.rid, 100);
  return x;
};

test('asks after the last set when the planned reps were hit exactly', () => {
  const w = doAll(startFromPlan(plan(8), [], 0, 'w'), 8);
  expect(asksEffort(w, w.exercises[0].rid, [])).toBe(true);
});
test('asks within the planned rep range, not 2 or more outside it', () => {
  const w = startFromPlan(plan(null, { start: 8, end: 12 }), [], 0, 'w');
  expect(asksEffort(doAll(w, 10), w.exercises[0].rid, [])).toBe(true);
  expect(asksEffort(doAll(w, 6), w.exercises[0].rid, [])).toBe(false);
  expect(asksEffort(doAll(w, 14), w.exercises[0].rid, [])).toBe(false);
});
test('never while a set is open, and never when reps are clearly off the plan', () => {
  const w = startFromPlan(plan(8), [], 0, 'w');
  const ex = w.exercises[0];
  expect(asksEffort(confirmSet(w, ex.rid, ex.sets[0].rid, 1), ex.rid, [])).toBe(false);
  expect(asksEffort(doAll(w, 6), ex.rid, [])).toBe(false);
  expect(asksEffort(doAll(w, 10), ex.rid, [])).toBe(false);
  // One off: neither exact nor clearly off, and nothing else new: no question.
  expect(asksEffort(doAll(w, 9), ex.rid, [])).toBe(false);
});
test('asks for a heavier weight than last time and for a swapped-in exercise, unless reps are clearly off', () => {
  const w = startFromPlan(plan(8), [past(45)], 0, 'w');
  expect(asksEffort(doAll(w, 9, 0, 50), w.exercises[0].rid, [past(45)])).toBe(true);
  expect(asksEffort(doAll(w, 9, 0, 45), w.exercises[0].rid, [past(45)])).toBe(false);
  expect(asksEffort(doAll(w, 5, 0, 50), w.exercises[0].rid, [past(45)])).toBe(false);
  const fresh = startFromPlan(plan(8), [], 0, 'w');
  const swapped = swapExercise(fresh, fresh.exercises[0].rid, EXERCISES[0], []);
  const ex = swapped.exercises[0];
  let x = editSet(swapped, ex.rid, ex.sets[0].rid, { reps: 8, weightKg: 20 });
  x = confirmSet(x, ex.rid, ex.sets[0].rid, 1);
  expect(asksEffort(x, ex.rid, [])).toBe(true);
});
test('once answered or skipped it is not asked again, and at most four per workout', () => {
  let w = startFromPlan(plan(8, undefined, MAX_EFFORT_QUESTIONS + 1), [], 0, 'w');
  for (let i = 0; i <= MAX_EFFORT_QUESTIONS; i++) w = doAll(w, 8, i);
  const rids = w.exercises.map((e) => e.rid);
  expect(asksEffort(setEffort(w, rids[0], 'skip'), rids[0], [])).toBe(false);
  for (let i = 0; i < MAX_EFFORT_QUESTIONS; i++) w = setEffort(w, rids[i], i % 2 ? 'skip' : 'some');
  expect(asksEffort(w, rids[MAX_EFFORT_QUESTIONS], [])).toBe(false);
});
test('timed exercises are never asked', () => {
  const w = startFromPlan(plan(8), [], 0, 'w');
  const timed = { ...w, exercises: [{ ...w.exercises[0], timed: true }] };
  expect(asksEffort(doAll(timed, 8), w.exercises[0].rid, [])).toBe(false);
});
test('fragt nach einem Versagenssatz nicht', () => {
  const w = startFromPlan(plan(8), [], 0, 'w');
  const ex = w.exercises[0];
  expect(asksEffort(doAll(w, 8), ex.rid, [])).toBe(true);
  const failed = doAll(editSet(w, ex.rid, ex.sets[1].rid, { type: 'failure' }), 8);
  expect(asksEffort(failed, ex.rid, [])).toBe(false);
});
