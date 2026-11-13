import { EXERCISES } from '../../src/shared/exercises';
import { readWorkoutChange } from '../../src/shared/chat';
import { confirmSet, linkWith, moveExercise, moveExerciseTo, startFromPlan, type TrackedWorkout } from '../../src/tracking/session';
import { takeChange, undoChange } from '../../src/tracking/workout-change';
import type { GymExercise, GymWorkout } from '../../src/shared/gym/types';
import { refitPlaces } from '../../src/tracking/placement';

const ex = (id: string, title: string) => ({ templateId: id, title, restS: null, supersetId: null, notes: '', sets: [1, 2].map(() => ({ type: 'normal' as const, weightKg: 50, reps: 8 })) });
const plan: GymWorkout = { name: 'P', exercises: [ex('pf-bench-press', 'A'), ex('pf-squat', 'B'), ex('pf-leg-press', 'C'), ex('pf-bench-press', 'D')] };
const start = (): TrackedWorkout => startFromPlan(plan, [], 0, 'w1');
const titles = (w: TrackedWorkout) => w.exercises.map((e) => e.title).join('');
const rid = (w: TrackedWorkout, i: number) => w.exercises[i]!.rid;

test('moves up and down, ends and unknown rows change nothing', () => {
  const w = start();
  expect(titles(moveExercise(w, rid(w, 1), -1))).toBe('BACD');
  expect(titles(moveExercise(w, rid(w, 1), 1))).toBe('ACBD');
  expect(moveExercise(w, rid(w, 0), -1)).toBe(w);
  expect(moveExercise(w, rid(w, 3), 1)).toBe(w);
  expect(moveExercise(w, 'nope', 1)).toBe(w);
});

test('a group moves as one block past a single exercise or a group', () => {
  let w = start();
  w = linkWith(w, rid(w, 1), rid(w, 2)); // B+C
  const down = moveExercise(w, rid(w, 1), 1);
  expect(titles(down)).toBe('ADBC');
  expect(titles(moveExercise(w, rid(w, 2), -1))).toBe('BCAD');
  const x = start();
  const both = linkWith(linkWith(x, rid(x, 2), rid(x, 3)), rid(x, 0), rid(x, 1)); // A+B, C+D
  expect(titles(moveExercise(both, rid(both, 0), 1))).toBe('CDAB');
});

test('rows stay intact and done sets stay with their exercise', () => {
  const w0 = start();
  const w = confirmSet(w0, rid(w0, 1), w0.exercises[1]!.sets[0]!.rid, 5);
  const m = moveExercise(w, rid(w, 1), -1);
  expect(m.exercises[0]).toBe(w.exercises[1]);
  expect(m.exercises[0]!.sets[0]!.doneMs).toBe(5);
});

const taken = (w: TrackedWorkout, ops: object[]) =>
  takeChange(w, 'c1', readWorkoutChange({ workoutId: 'w1', ops })!, [], EXERCISES, { renames: [], picks: [] } as never, 9);

test('undo after a move restores rows next to their anchor', () => {
  const w = start();
  const t = taken(w, [{ op: 'drop', ex: rid(w, 2) }]).workout; // A B D
  const b = t.exercises.find((e) => e.title === 'B')!;
  expect(t.changes![0]!.anchor).toBe(b.rid);
  const moved = moveExercise(moveExercise(t, rid(t, 0), 1), rid(t, 0), 1); // B D A
  expect(titles(moved)).toBe('BDA');
  const u = undoChange(moved, 'c1');
  expect(u.refusal).toBeNull();
  expect(titles(u.workout)).toBe('BCDA');
});

test('undo leaves no group of one member behind', () => {
  const w = start();
  const t = taken(w, [{ op: 'drop', ex: rid(w, 1) }]).workout; // A C D
  const grouped = linkWith(t, rid(t, 0), rid(t, 1)); // A+C
  const lone = { ...grouped, exercises: grouped.exercises.filter((e) => e.title !== 'C') }; // A alone, still in a group id
  expect(lone.exercises[0]!.supersetId).not.toBeNull();
  const u = undoChange(lone, 'c1').workout; // B comes back between A and D
  expect(u.exercises.map((e) => e.supersetId).every((g) => g === null)).toBe(true);
});

test('an anchor of null means the start; an entry without anchor uses pos', () => {
  const w = start();
  const t0 = taken(w, [{ op: 'drop', ex: rid(w, 0) }]).workout; // B C D
  expect(t0.changes![0]!.anchor).toBeNull();
  expect(titles(undoChange(moveExercise(t0, rid(t0, 2), -1), 'c1').workout)).toBe('ABDC');
  const t = taken(w, [{ op: 'drop', ex: rid(w, 1) }]).workout; // A C D
  const old = { ...t, changes: t.changes!.map(({ anchor: _a, ...c }) => c) };
  expect(titles(undoChange(moveExercise(old, rid(old, 0), 1), 'c1').workout)).toBe('CBAD');
});

test('moveExerciseTo: single, block, to start and end, no-op', () => {
  const w = start();
  expect(titles(moveExerciseTo(w, rid(w, 0), 3))).toBe('BCDA');
  expect(titles(moveExerciseTo(w, rid(w, 3), 0))).toBe('DABC');
  expect(titles(moveExerciseTo(w, rid(w, 1), 2))).toBe('ACBD');
  expect(moveExerciseTo(w, rid(w, 1), 1)).toBe(w);
  expect(moveExerciseTo(w, rid(w, 1), 9)).toBe(w);
  expect(moveExerciseTo(w, rid(w, 1), -1)).toBe(w);
  expect(moveExerciseTo(w, 'nope', 0)).toBe(w);
  const g = linkWith(w, rid(w, 1), rid(w, 2)); // B+C is one block: A, [BC], D
  expect(titles(moveExerciseTo(g, rid(g, 2), 2))).toBe('ADBC');
  expect(titles(moveExerciseTo(g, rid(g, 3), 0))).toBe('DABC');
  expect(titles(moveExerciseTo(g, rid(g, 0), 1))).toBe('BCAD');
  expect(moveExerciseTo(g, rid(g, 1), 2).exercises.map((e) => e.supersetId !== null)).toEqual([false, false, true, true]);
});

test('moveExerciseTo keeps rows and done sets intact', () => {
  const w0 = start();
  const w = confirmSet(w0, rid(w0, 2), w0.exercises[2]!.sets[0]!.rid, 5);
  const m = moveExerciseTo(w, rid(w, 2), 0);
  expect(m.exercises[0]).toBe(w.exercises[2]);
  expect(m.exercises[1]).toBe(w.exercises[0]);
});

test('undo after a drag-reorder puts the rows back next to their anchor', () => {
  const w0 = start(); // A B C D
  const change = readWorkoutChange({ workoutId: 'w1', ops: [{ op: 'lighter', ex: rid(w0, 2), pct: 10 }] })!;
  const { workout: taken } = takeChange(w0, 'c1', change, [], EXERCISES, { renames: [], picks: [] } as never, 1000);
  const taken2 = taken;
  const dragged = moveExerciseTo(taken2, rid(taken2, 2), 0); // C A B D: the changed row left its anchor B
  expect(titles(dragged)).toBe('CABD');
  const undone = undoChange(dragged, 'c1');
  expect(undone.refusal).toBeNull();
  expect(titles(undone.workout)).toBe('ABCD');
  expect(undone.workout.exercises[2]!.sets[0]!.weightKg).toBe(50);
  const anchorMoved = moveExerciseTo(taken2, rid(taken2, 1), 3); // A C D B: the anchor itself moved to the end
  expect(titles(undoChange(anchorMoved, 'c1').workout)).toBe('ADBC');
});


const chestEx = (templateId: string, title: string, n: number, kg: number): GymExercise => ({ templateId, title, restS: 90, supersetId: null, notes: '', sets: Array.from({ length: n }, () => ({ type: 'normal' as const, weightKg: kg, reps: 8 })) });
const chestPlan: GymWorkout = { name: 'Brust', exercises: [chestEx('pf-incline-bench-press', 'Schrägbankdrücken', 3, 40), chestEx('pf-chest-press-machine', 'Brustpresse', 4, 50), chestEx('pf-cable-crossover', 'Kabelzug Crossover', 3, 20)] };
const ladder = (_id: string, kg: number): number => Math.floor(kg / 2.5 + 1e-9) * 2.5;
const chestStart = (): TrackedWorkout => startFromPlan(chestPlan, [], 1, 'w1', EXERCISES);
const refitMove = (w: TrackedWorkout, from: number, to: number) => refitPlaces(moveExerciseTo(w, w.exercises[from]!.rid, to), EXERCISES, ladder);
const kgsOf = (w: TrackedWorkout, i: number) => w.exercises[i]!.sets.map((s) => s.weightKg);

describe('Verschieben rechnet die Gewichte neu', () => {
  it('senkt das Gewicht einer Brustübung, die hinter zwei Brustübungen rutscht', () => {
    const r = refitMove(chestStart(), 0, 2);
    const e = r.workout.exercises[2]!;
    expect(e.title).toBe('Schrägbankdrücken');
    for (const s of e.sets) { expect(s.weightKg!).toBeLessThan(40); expect(s.weightKg! % 2.5).toBe(0); }
    expect(r.changed).toEqual(['Schrägbankdrücken']);
  });
  it('bringt das Gewicht zurück, wenn die Übung wieder nach vorn kommt', () => {
    const back = refitMove(refitMove(chestStart(), 0, 2).workout, 2, 0);
    expect(kgsOf(back.workout, 0)).toEqual([40, 40, 40]);
    expect(back.changed).toEqual(['Schrägbankdrücken']);
  });
  it('lässt erledigte und selbst eingetippte Sätze stehen', () => {
    const w = chestStart();
    const done = { ...w, exercises: w.exercises.map((e, i) => (i === 0 ? { ...e, sets: e.sets.map((s, k) => (k === 0 ? { ...s, doneMs: 5 } : s)) } : e)) };
    expect(refitMove(done, 0, 2).workout.exercises[2]!.sets.map((s) => s.weightKg)).toEqual([40, 40, 40]);
    const typed = { ...w, exercises: w.exercises.map((e, i) => (i === 0 ? { ...e, sets: e.sets.map((s, k) => (k === 1 ? { ...s, weightKg: 42.5 } : s)) } : e)) };
    const r = refitMove(typed, 0, 2);
    expect(kgsOf(r.workout, 2)).toEqual([40, 42.5, 40]);
    expect(r.changed).toEqual([]);
  });
  it('ändert ohne placedPre nichts', () => {
    const w = chestStart();
    const old = { ...w, exercises: w.exercises.map(({ placedPre: _p, ...e }) => e) };
    const r = refitMove(old, 0, 2);
    expect(kgsOf(r.workout, 2)).toEqual([40, 40, 40]);
    expect(r.changed).toEqual([]);
  });
});
