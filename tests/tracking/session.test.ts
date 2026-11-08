import {
  addExercise, addSet, confirmSet, editSet, finish, hereKey, lastValues, parseDecimal, formatDecimal, removeExercise, removeSet,
  durationLabel, linkWith, currentSet, supersetPartners, unlinkSuperset, setEffort, startEmpty, startFromPlan, startFromRoutine, swapExercise, setRest, restRemainingS, ensureIds, editNotes, setStudio,
} from '../../src/tracking/session';
import type { LoggedWorkout } from '../../src/shared/records';
import { studioRecord, studioStateOf } from '../../src/shared/studio';
import { stepHere } from '../../src/tracking/steps';
import { mergeCatalog } from '../../src/shared/catalog';
import { EXERCISES } from '../../src/shared/exercises';
import type { GymWorkout } from '../../src/coach/gym/types';

const done = (weightKg: number | null, reps: number | null, doneMs: number | null = 1000, type: 'normal' | 'warmup' = 'normal') => ({ type, weightKg, reps, durationS: null, doneMs });
const past = (id: string, endMs: number, exerciseId: string, sets: ReturnType<typeof done>[], extra: Partial<LoggedWorkout> = {}): LoggedWorkout => ({
  id, title: 'Alt', startMs: endMs - 1000, endMs, source: 'pandafit',
  exercises: [{ exerciseId, title: 'X', supersetId: null, notes: '', sets }], ...extra,
});
const plan: GymWorkout = { name: 'Oberkörper', exercises: [
  { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: 120, supersetId: null, notes: '', sets: [
    { type: 'normal', weightKg: 50, reps: null, repRange: { start: 8, end: 12 } },
    { type: 'normal', weightKg: null, reps: null, repRange: { start: 8, end: 12 } },
  ] },
] };
const ex0 = (w: ReturnType<typeof startEmpty>) => w.exercises[0].rid;
const set0 = (w: ReturnType<typeof startEmpty>, i = 0) => w.exercises[0].sets[i].rid;

test('prefills last values, with weight empty when there are none', () => {
  const hist = [past('h1', 5000, 'pf-bench-press', [done(40, 10), done(42.5, 9)]), past('h0', 1000, 'pf-bench-press', [done(10, 5)])];
  const w = startFromRoutine({ name: 'R', exercises: [{ templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [
    { type: 'normal', weightKg: null, reps: null }, { type: 'normal', weightKg: null, reps: null }] }] }, hist, 10, 'w1');
  expect(w.exercises[0].sets.map((s) => [s.weightKg, s.reps, s.doneMs])).toEqual([[40, 10, null], [42.5, 9, null]]);
  const fresh = startFromRoutine({ name: 'R', exercises: [plan.exercises[0]] }, [], 10, 'w2');
  expect(fresh.exercises[0].sets[1].weightKg).toBeNull();
  expect(w.endMs).toBeNull();
});

test('plan values win for a planned exercise', () => {
  const hist = [past('h1', 5000, 'pf-bench-press', [done(40, 10), done(42.5, 9)])];
  const sets = startFromPlan(plan, hist, 10, 'w1').exercises[0].sets;
  expect(sets[0].weightKg).toBe(50);
  expect(sets[0].reps).toBe(8);
  expect(sets[0].repRange).toEqual({ start: 8, end: 12 });
  expect(sets[1].weightKg).toBe(42.5);
});

test('warmups never prefill a working set', () => {
  const hist = [past('h1', 5000, 'pf-bench-press', [done(20, 10, 1000, 'warmup'), done(60, 8)])];
  const r: GymWorkout = { name: 'R', exercises: [{ templateId: 'pf-bench-press', title: 'B', restS: null, supersetId: null, notes: '', sets: [
    { type: 'normal', weightKg: null, reps: null }] }] };
  expect(startFromRoutine(r, hist, 1, 'w').exercises[0].sets[0].weightKg).toBe(60);
});

test('lastValues counts one performed session once, own winning over an overlapping Hevy one', () => {
  const own = past('own', 100_000, 'pf-squat', [done(100, 5)], { startMs: 40_000 });
  const hevy = past('hv', 110_000, 'pf-squat', [done(999, 1)], { startMs: 50_000, source: 'hevy' });
  expect(lastValues('pf-squat', [hevy, own]).map((s) => s.weightKg)).toEqual([100]);
  const later = past('hv2', 900_000_000, 'pf-squat', [done(70, 5)], { source: 'hevy' });
  expect(lastValues('pf-squat', [own, later]).map((s) => s.weightKg)).toEqual([70]);
});

test('lastValues only counts confirmed sets of the newest finished workout', () => {
  const open: LoggedWorkout = { ...past('o', 9000, 'a', [done(1, 1)]), endMs: null };
  const hist = [open, past('h', 5000, 'a', [done(30, 8), done(99, 1, null)])];
  expect(lastValues('a', hist).map((s) => s.weightKg)).toEqual([30]);
  expect(lastValues('none', hist)).toEqual([]);
});

test('confirming marks the set done and starts the rest timer', () => {
  const w = startFromPlan(plan, [], 10, 'w1');
  const c = confirmSet(w, ex0(w), set0(w), 5000);
  expect(c.exercises[0].sets[0].doneMs).toBe(5000);
  expect(c.rest).toEqual({ startMs: 5000, durationS: 120 });
  expect(restRemainingS(c, 5000 + 30_000)).toBe(90);
  expect(restRemainingS(c, 5000 + 200_000)).toBe(0);
  expect(w.exercises[0].sets[0].doneMs).toBeNull();
});

test('sets can be edited, added and removed by stable id', () => {
  let w = startEmpty(1, 'w', 'Frei');
  w = addExercise(w, { id: 'e', title: 'E', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'none' }, []);
  const e = ex0(w);
  w = editSet(w, e, set0(w), { weightKg: 12.5, reps: 8 });
  w = addSet(w, e);
  expect(w.exercises[0].sets[1]).toMatchObject({ weightKg: 12.5, reps: 8, doneMs: null });
  expect(w.exercises[0].sets[1].rid).not.toBe(set0(w));
  w = removeSet(w, e, set0(w));
  expect(w.exercises[0].sets).toHaveLength(1);
  w = removeExercise(w, e);
  expect(w.exercises).toHaveLength(0);
});

test('a stale id does nothing, so a double tap never removes the next row', () => {
  let w = startFromPlan(plan, [], 10, 'w1');
  const e = ex0(w), s = set0(w);
  w = removeSet(w, e, s);
  expect(w.exercises[0].sets).toHaveLength(1);
  expect(removeSet(w, e, s)).toBe(w);
  w = removeExercise(w, e);
  expect(removeExercise(w, e)).toBe(w);
  expect(confirmSet(w, 'nope', 'nope', 1)).toBe(w);
});

test('ensureIds gives old records stable row ids once', () => {
  const old = past('x', 5000, 'a', [done(1, 1)]) as unknown as Parameters<typeof ensureIds>[0];
  const a = ensureIds(old);
  expect(a.exercises[0].rid).toBeTruthy();
  expect(a.exercises[0].sets[0].rid).toBeTruthy();
  expect(ensureIds(a)).toBe(a);
});

test('an exercise can be swapped and what happened counts', () => {
  let w = startFromPlan(plan, [], 10, 'w1');
  w = editNotes(w, ex0(w), 'Schulter zwickt');
  w = confirmSet(w, ex0(w), set0(w), 100);
  const alt = { id: 'pf-chest-press-machine', title: 'Brustpresse', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'machine' };
  const s = swapExercise(w, ex0(w), alt, []);
  expect(s.exercises.map((e) => e.exerciseId)).toEqual(['pf-bench-press', 'pf-chest-press-machine']);
  expect(s.exercises[0].sets).toHaveLength(1);
  expect(s.exercises[1].notes).toBe(''); // notes belong to the old exercise
  expect(s.exercises[1].restS).toBeUndefined(); // the new exercise resolves its own rest
  const none = swapExercise(startFromPlan(plan, [], 10, 'w2'), startFromPlan(plan, [], 10, 'w2').exercises[0].rid, alt, []);
  expect(none).toBeDefined();
});

test('finish without confirmed sets asks first and never deletes silently', () => {
  const w = startFromPlan(plan, [], 10, 'w1');
  expect(finish(w, 99)).toEqual({ status: 'ask', question: 'nothing-confirmed' });
  expect(finish(w, 99, 'discard')).toEqual({ status: 'discard' });
  const one = confirmSet(w, ex0(w), set0(w), 50);
  expect(finish(one, 99)).toEqual({ status: 'ask', question: 'open-sets', open: 1 });
  expect(finish(one, 99, 'discard').status).not.toBe('discard'); // a confirmed set blocks discarding
  const omit = finish(one, 99, 'omit');
  expect(omit.status === 'finished' && omit.workout.exercises[0].sets.map((s) => s.doneMs)).toEqual([50, null]);
  const comp = finish(one, 99, 'complete');
  expect(comp.status === 'finished' && comp.workout.exercises[0].sets.map((s) => s.doneMs)).toEqual([50, 99]);
  const none = finish(w, 99, 'complete');
  expect(none.status === 'finished' && none.workout.exercises[0].sets.every((s) => s.doneMs === 99)).toBe(true);
  expect(finish(confirmSet(one, ex0(one), set0(one, 1), 60), 99).status).toBe('finished');
});

test('finishing a workout left open for hours ends it at its last confirmed set, not now', () => {
  const H = 3_600_000;
  const base = startFromPlan(plan, [], 10, 'w1');
  const one = confirmSet(base, ex0(base), set0(base), 1_000_000);
  const now = 1_000_000 + 7 * H;
  const r = finish(one, now, 'complete');
  expect(r.status === 'finished' && r.workout.endMs).toBe(1_000_000);
  expect(r.status === 'finished' && r.workout.exercises[0].sets.map((s) => s.doneMs)).toEqual([1_000_000, 1_000_000]);
  const fresh = finish(one, 1_000_000 + 2 * H, 'complete');
  expect(fresh.status === 'finished' && fresh.workout.endMs).toBe(1_000_000 + 2 * H);
});

test('decimal comma and dot both parse; display uses a comma', () => {
  expect(parseDecimal('62,5')).toBe(62.5);
  expect(parseDecimal('62.5')).toBe(62.5);
  expect(parseDecimal('')).toBeNull();
  expect(parseDecimal('abc')).toBeUndefined();
  expect(formatDecimal(62.5)).toBe('62,5');
  expect(formatDecimal(null)).toBe('');
});

describe('durationLabel', () => {
  it('shows minutes and seconds, and hours once past an hour', () => {
    expect(durationLabel(0)).toBe('0:00');
    expect(durationLabel(99_000)).toBe('1:39');
    expect(durationLabel(3_725_000)).toBe('1:02:05');
    expect(durationLabel(-5_000)).toBe('0:00');
  });
});

describe('supersets', () => {
  const three: GymWorkout = { name: 'S', exercises: ['pf-bench-press', 'pf-squat', 'pf-lat-pulldown'].map((id) => ({
    templateId: id, title: id, restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: 20, reps: 10 }, { type: 'normal' as const, weightKg: 20, reps: 10 }],
  })) };
  const start = () => startFromPlan(three, [], 1000, 'w1');
  const groups = (w: ReturnType<typeof start>) => w.exercises.map((e) => e.supersetId);

  const link = (w: ReturnType<typeof start>, i: number, j: number) => linkWith(w, w.exercises[i].rid, w.exercises[j].rid);

  it('links neighbours, and a third joins the same group', () => {
    const w = start();
    const a = link(w, 0, 1);
    expect(groups(a)[0]).not.toBeNull();
    expect(groups(a)[0]).toBe(groups(a)[1]);
    expect(groups(a)[2]).toBeNull();
    const b = link(a, 1, 2);
    expect(new Set(groups(b)).size).toBe(1);
    expect(linkWith(b, b.exercises[0].rid, b.exercises[2].rid)).toBe(b); // already together
  });

  it('linking non-neighbours moves the partner right behind', () => {
    const w = start();
    const a = link(w, 0, 2);
    expect(a.exercises.map((e) => e.title)).toEqual(['pf-bench-press', 'pf-lat-pulldown', 'pf-squat']);
    expect(groups(a)).toEqual([0, 0, null]);
    expect(a.exercises[1]).toEqual({ ...w.exercises[2], supersetId: 0 }); // intact: only the group id differs
  });

  it('linking into an existing group, and joining a partner that has its own group', () => {
    const w = start();
    const ab = link(w, 0, 1);
    const abc = linkWith(ab, ab.exercises[0].rid, ab.exercises[2].rid);
    expect(new Set(groups(abc)).size).toBe(1);
    const four = { ...w, exercises: [...w.exercises, { ...w.exercises[0], rid: 'x4', title: 'four' }] };
    const cd = link(four, 2, 3);
    const joined = linkWith(cd, cd.exercises[0].rid, cd.exercises[2].rid);
    expect(groups(joined).map((g) => g !== null)).toEqual([true, true, true, false]);
    expect(new Set(groups(joined).slice(0, 3)).size).toBe(1);
    expect(joined.exercises.map((e) => e.title)).toEqual(['pf-bench-press', 'pf-lat-pulldown', 'four', 'pf-squat']);
  });

  it('a partner with a confirmed set is refused', () => {
    const w = start();
    const d = confirmSet(w, w.exercises[2].rid, w.exercises[2].sets[0].rid, 5);
    expect(link(d, 0, 2)).toBe(d);
  });

  it('removing or swapping dissolves a group left with one member', () => {
    const ab = link(start(), 0, 1);
    expect(groups(removeExercise(ab, ab.exercises[1].rid))).toEqual([null, null]);
    const sw = swapExercise(confirmSet(ab, ab.exercises[0].rid, ab.exercises[0].sets[0].rid, 3), ab.exercises[0].rid, EXERCISES.find((e) => e.id === 'pf-squat')!, []);
    const g = sw.exercises.map((e) => e.supersetId);
    expect(g[0]).toBeNull(); // done-set copy leaves the group
    expect(g.filter((x) => x !== null)).toHaveLength(2);
  });

  it('round order A1 B1 A2 B2, done members are passed over', () => {
    const ab = link(start(), 0, 1);
    const [a, b] = ab.exercises;
    const order: string[] = [];
    let w = ab;
    for (let k = 0; k < 4; k++) {
      const c = currentSet(w)!;
      order.push(`${w.exercises.find((e) => e.rid === c.ex)!.title === a.title ? 'A' : 'B'}${c.round}`);
      w = confirmSet(w, c.ex, c.set, 10 + k);
    }
    expect(order).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(currentSet(w)!.ex).toBe(w.exercises[2].rid);
    // A is finished, B open: only B
    let x = ab;
    for (const s of a.sets) x = confirmSet(x, a.rid, s.rid, 1);
    expect(currentSet(x)).toMatchObject({ ex: b.rid, round: 1 });
    // A skipped: B
    expect(currentSet(setEffort(ab, a.rid, 'skip'))!.ex).toBe(b.rid);
  });

  it('warm-ups come before the first round and rounds count work sets', () => {
    const mkEx = (id: string, warm: number, work: number) => ({ templateId: id, title: id, restS: 90, supersetId: null, notes: '', sets: [
      ...Array.from({ length: warm }, () => ({ type: 'warmup' as const, weightKg: 10, reps: 5 })),
      ...Array.from({ length: work }, () => ({ type: 'normal' as const, weightKg: 20, reps: 10 })),
    ] });
    let w = startFromPlan({ name: 'S', exercises: [mkEx('pf-bench-press', 2, 3), mkEx('pf-squat', 0, 3)] }, [], 1000, 'w1');
    w = link(w, 0, 1);
    const label = (rid: string, set: string) => { const e = w.exercises.find((x) => x.rid === rid)!; const s = e.sets.find((x) => x.rid === set)!; return `${e.title === 'pf-bench-press' ? 'A' : 'B'}${s.type === 'warmup' ? 'W' : ''}${e.sets.filter((x) => x.type !== 'warmup').indexOf(s) + 1}`; };
    const order: string[] = [];
    for (let k = 0; k < 8; k++) { const c = currentSet(w)!; order.push(label(c.ex, c.set)); w = confirmSet(w, c.ex, c.set, 10 + k); }
    expect(order).toEqual(['AW0', 'AW0', 'A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(currentSet(w)).toBeNull();
  });

  it('a partner whose group has a done set can not be linked or offered', () => {
    const ab = link(start(), 0, 1);
    const [a, b] = ab.exercises;
    const x = confirmSet(ab, b.rid, b.sets[0].rid, 5000);
    const c = x.exercises[2];
    expect(linkWith(x, c.rid, a.rid)).toBe(x);
    expect(supersetPartners(x, c.rid).map((p) => p.rid)).toEqual([]);
    expect(supersetPartners(ab, c.rid).map((p) => p.rid).sort()).toEqual([a.rid, b.rid].sort());
  });

  it('rest only after the round, whatever order it was trained in', () => {
    const ab = link(start(), 0, 1);
    const [a, b] = ab.exercises;
    const x = confirmSet(ab, b.rid, b.sets[0].rid, 5000); // B1 first
    expect(x.rest).toBeNull();
    expect(confirmSet(x, a.rid, a.sets[0].rid, 6000).rest).toEqual({ startMs: 6000, durationS: 90 });
  });

  it('unlinking takes one exercise out, and a group of one is dissolved', () => {
    const w = start();
    const a = link(link(w, 0, 1), 1, 2);
    const b = unlinkSuperset(a, a.exercises[2].rid);
    expect(groups(b)[2]).toBeNull();
    expect(groups(b)[0]).toBe(groups(b)[1]);
    const c = unlinkSuperset(b, b.exercises[0].rid);
    expect(groups(c)).toEqual([null, null, null]);
  });

  it('no rest between the exercises of a superset, rest after the last one', () => {
    const st = start();
    const s = link(st, 0, 1);
    const a = confirmSet(s, s.exercises[0].rid, s.exercises[0].sets[0].rid, 5000);
    expect(a.rest).toBeNull();
    const b = confirmSet(a, a.exercises[1].rid, a.exercises[1].sets[0].rid, 6000);
    expect(b.rest).toEqual({ startMs: 6000, durationS: 90 });
  });

  it('rests normally once the later exercise of the superset is finished', () => {
    const st = start();
    const s0 = link(st, 0, 1);
    let s = s0;
    for (const set of s0.exercises[1].sets) s = confirmSet(s, s0.exercises[1].rid, set.rid, 4000);
    expect(confirmSet(s, s.exercises[0].rid, s.exercises[0].sets[0].rid, 5000).rest).toEqual({ startMs: 5000, durationS: 90 });
  });
});

describe('last values across Hevy and own ids', () => {
  const hevyPreacher = (title: string, endMs: number) => past(`h-${title}`, endMs, 'HEVY-TPL-1', [done(30, 10), done(30, 9)]);
  it('a swapped-in own exercise takes the last sets logged under its Hevy title', () => {
    const hist = [{ ...hevyPreacher('a', 5000), exercises: [{ exerciseId: 'HEVY-TPL-1', title: 'Preacher Curl (Barbell)', supersetId: null, notes: '', sets: [done(30, 10), done(30, 9)] }] }];
    const w = startFromPlan(plan, [], 10, 'w1');
    const preacher = { id: 'pf-preacher-curl', title: 'Scott-Curl', type: 'weight_reps', primaryMuscle: 'biceps', equipment: 'barbell', hevyTitle: 'Preacher Curl (Barbell)' };
    const s = swapExercise(w, ex0(w), preacher, hist);
    expect(s.exercises[0].sets.map((x) => [x.weightKg, x.reps])).toEqual([[30, 10], [30, 9]]);
  });

  it('also under the German Hevy title', () => {
    const hist = [{ ...hevyPreacher('b', 5000), exercises: [{ exerciseId: 'HEVY-TPL-2', title: 'Preacher Curl (Langhantel)', supersetId: null, notes: '', sets: [done(25, 12)] }] }];
    expect(lastValues('pf-preacher-curl', hist).map((x) => x.weightKg)).toEqual([25]);
  });
});

test('a title that is now an overlay alias of a built-in finds its past values', () => {
  const alias = { kind: 'exercise' as const, id: 'pf-bench-press', updatedMs: 1, deleted: false, body: { id: 'pf-bench-press', aliases: ['Flat Press Custom'] } };
  const catalog = mergeCatalog(EXERCISES, [], [alias]);
  const hist = [past('h1', 5000, 'hevy-odd-1', [done(40, 10)])];
  hist[0].exercises[0].title = 'Flat Press Custom';
  expect(lastValues('pf-bench-press', hist)).toEqual([]);
  expect(lastValues('pf-bench-press', hist, catalog).map((s) => [s.weightKg, s.reps])).toEqual([[40, 10]]);
  const w = startFromPlan(plan, hist, 10, 'w1', catalog);
  expect(w.exercises[0].sets.map((s) => [s.weightKg, s.reps])).toEqual([[50, 8], [40, 8]]);
});

describe('last values come from the current studio', () => {
  const hist = [
    past('a', 9000, 'pf-bench-press', [done(30, 10)], { studio: 'Alt' }),
    past('b', 8000, 'pf-bench-press', [done(50, 10)], { studio: 'Neu' }),
    past('c', 1000, 'pf-bench-press', [done(40, 10)], { studio: 'Alt' }),
  ];
  const step = { name: 'R', exercises: [{ templateId: 'pf-bench-press', title: 'B', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: null, reps: null }] }] };
  test('prefill and hint values are from the studio, not the newest session overall', () => {
    expect(lastValues('pf-bench-press', hist, undefined, 'Neu').map((s) => s.weightKg)).toEqual([50]);
    expect(lastValues('pf-bench-press', hist, undefined, 'Alt').map((s) => s.weightKg)).toEqual([30]);
    expect(lastValues('pf-bench-press', hist).map((s) => s.weightKg)).toEqual([30]); // default: the studio of the newest own workout
    expect(startFromPlan(step, hist, 10, 'w', undefined, 'Neu').exercises[0].sets[0].weightKg).toBe(50);
    expect(addExercise({ ...startEmpty(1, 'e'), studio: 'Neu' }, EXERCISES.find((e) => e.id === 'pf-bench-press')!, hist).exercises[0].sets[0].weightKg).toBe(50);
  });
  test('no history in this studio falls back to all studios', () => {
    expect(lastValues('pf-bench-press', hist, undefined, 'Dritte').map((s) => s.weightKg)).toEqual([30]);
  });
});

describe('renamed studios in the app', () => {
  const set = { type: 'normal' as const, weightKg: 50, reps: 8, durationS: null, doneMs: 5 };
  const past = (id: string, startMs: number, studio: string, kg: number): LoggedWorkout => ({ id, title: 'T', startMs, endMs: startMs + 1, source: 'pandafit', studio, exercises: [{ exerciseId: 'pf-squat', title: 'K', supersetId: null, notes: '', sets: [{ ...set, weightKg: kg }] }] });
  test('lastValues and hereKey follow a rename', () => {
    const history = [past('a', 10, 'Alpha', 60), past('b', 20, 'Beta', 40)];
    const studios = studioStateOf([studioRecord('Alpha', 99, 99, 'Neu'), studioRecord('Neu', 99, 99)]);
    expect(hereKey({ studio: 'Alpha' }, history, studios)).toBe('Neu');
    expect(lastValues('pf-squat', history, undefined, 'Neu', studios)[0].weightKg).toBe(60);
    expect(lastValues('pf-squat', history, undefined, 'Neu')[0].weightKg).toBe(40);
    const ladder = (renames: typeof studios.renames) => stepHere('pf-squat', 'machine', [past('a', 10, 'Alpha', 60), past('c', 15, 'Alpha', 62.5), past('b', 20, 'Beta', 40)], 'Neu', new Map(), renames);
    expect(ladder(studios.renames).stepKg).toBe(2.5);
    expect(ladder(new Map()).stepKg).not.toBe(2.5);
  });
});

describe('weights fit the studio you chose', () => {
  const bench = EXERCISES.find((e) => e.id === 'pf-bench-press')!;
  const mk = (kg: number | null, repRange = { start: 8, end: 12 }) => ({ name: 'P', studio: 'Alt', exercises: [{ templateId: 'pf-bench-press', title: 'B', restS: null, supersetId: null, notes: '', sets: [
    { type: 'normal' as const, weightKg: kg, reps: null, repRange }, { type: 'normal' as const, weightKg: kg, reps: null, repRange }] }] });
  const hist = [
    past('a', 9000, 'pf-bench-press', [done(60, 10), done(60, 10)], { studio: 'Alt' }),
    past('b', 8000, 'pf-bench-press', [done(30, 10), done(35, 10)], { studio: 'Neu' }),
  ];
  const kgs = (w: ReturnType<typeof startFromPlan>) => w.exercises[0].sets.map((s) => s.weightKg);

  test('another studio takes its own last weight, the reps stay from the plan', () => {
    const w = startFromPlan(mk(60), hist, 10, 'w', undefined, 'Neu');
    expect(kgs(w)).toEqual([30, 35]);
    expect(w.exercises[0].sets.map((s) => s.reps)).toEqual([8, 8]);
  });
  test('without own history the plan weight is snapped down to the studio\'s ladder', () => {
    const only = [past('a', 9000, 'pf-bench-press', [done(60, 10)], { studio: 'Alt' })];
    const kg = (overrides?: Map<string, number>) => startFromPlan(mk(63), only, 10, 'w', undefined, 'Neu', undefined, { changes: [], workouts: [], ...(overrides ? { overrides } : {}) }).exercises[0].sets[0].weightKg;
    expect(kg()).toBe(62.5); // the barbell's default step from the bar
    expect(kg(new Map([['pf-bench-press|Neu', 5]]))).toBe(60); // the person's step in that studio
    expect(kg(new Map([['pf-bench-press|Alt', 5]]))).toBe(62.5); // another studio's step does not count
  });
  test('the same studio changes nothing', () => {
    expect(kgs(startFromPlan(mk(50), hist, 10, 'w', undefined, 'Alt'))).toEqual([50, 50]);
    expect(kgs(startFromPlan({ ...mk(50), studio: undefined }, hist, 10, 'w', undefined, 'Neu'))).toEqual([50, 50]);
  });
  test('a studio change mid-workout refits untouched exercises only', () => {
    let w: ReturnType<typeof startFromPlan> = { ...startFromPlan(mk(60), hist, 10, 'w', undefined, 'Alt'), studio: 'Alt' };
    expect(kgs(w)).toEqual([60, 60]);
    // the rider typed 62.5 into the first set
    w = editSet(w, ex0(w), set0(w, 0), { weightKg: 62.5 });
    const fit = { history: hist };
    const moved = setStudio(w, 'Neu', fit);
    expect(moved.studio).toBe('Neu');
    expect(kgs(moved as never)).toEqual([62.5, 35]); // the edited set stays, the untouched one follows
    // back again: the untouched set returns to the plan weight
    expect(kgs(setStudio(moved, 'Alt', fit) as never)).toEqual([62.5, 60]);
    // a confirmed set freezes the exercise
    const done1 = confirmSet(w, ex0(w), set0(w, 1), 20);
    expect(kgs(setStudio(done1, 'Neu', fit) as never)).toEqual([62.5, 60]);
    // without the fit nothing but the name changes
    expect(kgs(setStudio(w, 'Neu') as never)).toEqual([62.5, 60]);
  });
  test('a workout not started from a plan is not refitted', () => {
    const w = addExercise({ ...startEmpty(1, 'e'), studio: 'Alt' }, bench, hist);
    expect(setStudio(w, 'Neu', { history: hist })).toEqual({ ...w, studio: 'Neu' });
  });
});

describe('rest on swap', () => {
  const alt = { id: 'pf-chest-press-machine', title: 'Brustpresse', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'machine' };
  test('a rest the person set survives a swap, a planned one does not', () => {
    const w = startFromPlan(plan, [], 10, 'w1');
    expect(swapExercise(w, ex0(w), alt, []).exercises[0].restS).toBeUndefined();
    const own = setRest(w, ex0(w), 90);
    const s = swapExercise(own, ex0(own), alt, []);
    expect(s.exercises[0]).toMatchObject({ exerciseId: 'pf-chest-press-machine', restS: 90, restByUser: true });
  });
});

describe('start without legs (noLegs)', () => {
  const sets = [{ type: 'normal' as const, weightKg: null, reps: null }];
  const squat = { templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets };
  const bench = { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets };
  const run = (exercises: GymWorkout['exercises'], noLegs?: boolean) => {
    let lines: string[] = [];
    const w = startFromPlan({ name: 'T', exercises }, [], 0, 'w1', EXERCISES, undefined, undefined, { changes: [], workouts: [], ...(noLegs !== undefined ? { noLegs } : {}), onSkipped: (l) => { lines = l; } });
    return { w, lines };
  };
  test('drops leg exercises and says so', () => {
    const { w, lines } = run([squat, bench], true);
    expect(w.exercises.map((e) => e.exerciseId)).toEqual(['pf-bench-press']);
    expect(lines).toContain('Ohne Beine, wie abgesprochen.');
  });
  test('keeps both when unset', () => {
    const { w, lines } = run([squat, bench]);
    expect(w.exercises).toHaveLength(2);
    expect(lines).toEqual([]);
  });
  test('never drops everything', () => {
    const { w, lines } = run([squat], true);
    expect(w.exercises).toHaveLength(1);
    expect(lines).toContain('Heute war ohne Beine abgesprochen.');
  });
});
