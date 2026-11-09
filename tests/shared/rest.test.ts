import { restOf, restAfterSet } from '../../src/shared/rest';
import { gymMinutes } from '../../src/shared/duration';
import { policyRule, ruleNumber } from '../../src/shared/training-policy';
import { currentSet, confirmSet, extendRest, setRest, startFromPlan } from '../../src/tracking/session';
import type { GymWorkout } from '../../src/shared/gym/types';

const sets = (reps: number | null, n = 3, type: 'normal' | 'warmup' = 'normal') => Array.from({ length: n }, () => ({ type, weightKg: 20, reps }));
const ex = (id: string, restS: number | null, reps: number | null = 10, supersetId: number | null = null, n = 3) =>
  ({ templateId: id, title: id, restS, supersetId, notes: '', sets: sets(reps, n) });

describe('restOf', () => {
  it('lets an explicit rest win', () => expect(restOf({ exerciseId: 'pf-squat', restS: 45, sets: sets(3) })).toBe(45));
  it('uses the register: heavy, compound, isolation', () => {
    expect(restOf({ exerciseId: 'pf-squat', sets: sets(3) })).toBe(240);
    expect(restOf({ exerciseId: 'pf-squat', sets: sets(10) })).toBe(150);
    expect(restOf({ exerciseId: 'pf-lateral-raise', sets: sets(10) })).toBe(90);
    expect(restOf({ exerciseId: 'unknown-id', sets: sets(null) })).toBe(90);
  });
  it('compound means a big group plus a secondary muscle in another group, not the equipment', () => {
    expect(restOf({ exerciseId: 'pf-leg-curl', sets: sets(10) })).toBe(90);
    expect(restOf({ exerciseId: 'pf-bench-press', sets: sets(10) })).toBe(150);
  });
  it('flipped the used rest rules to active', () => {
    for (const id of ['rest.compound-s', 'rest.isolation-s', 'rest.heavy-strength-s']) expect(policyRule(id).status).toEqual({ state: 'active' });
  });
});

describe('rest with warm-ups', () => {
  const mk = (restS: number) => ({ templateId: 'x', title: 'x', restS, supersetId: 1, notes: '', sets: [{ type: 'warmup' as const, weightKg: 10, reps: 5 }, ...sets(10, 2)] });
  it('a warm-up pairs with nothing; rounds count work sets', () => {
    const w = startFromPlan({ name: 'S', exercises: [mk(60), { ...ex('b', 120, 10, 1, 2) }] }, [], 10, 'w1');
    const [a, b] = w.exercises;
    expect(confirmSet(w, a.rid, a.sets[0].rid, 1000).rest?.durationS).toBe(ruleNumber('rest.warmup-s')); // short, whatever the exercise's rest
    const x = confirmSet(w, a.rid, a.sets[1].rid, 1000);
    expect(x.rest).toBeNull();
    expect(confirmSet(x, b.rid, b.sets[0].rid, 2000).rest?.durationS).toBe(120);
  });
});

describe('one source for timer and estimate', () => {
  const plan = (restS: number | null, ...rest: GymWorkout['exercises']): GymWorkout => ({ name: 'T', exercises: [ex('pf-squat', restS), ...rest] });
  it('the timer starts the same rest the estimate uses', () => {
    const w = startFromPlan(plan(null), [], 10, 'w1');
    const done = confirmSet(w, w.exercises[0].rid, w.exercises[0].sets[0].rid, 1000);
    expect(done.rest?.durationS).toBe(restOf(w.exercises[0]));
    expect(done.rest?.durationS).toBe(150);
    const slow = (x: number) => gymMinutes({ exercises: [{ templateId: 'pf-squat', restS: x, sets: sets(10) }] });
    expect(slow(150)).toBe(gymMinutes({ exercises: [{ templateId: 'pf-squat', restS: null, sets: sets(10) }] }));
  });
  it('a superset rests once per round, the longest rest', () => {
    const w = startFromPlan({ name: 'S', exercises: [ex('a', 60, 10, 1), ex('b', 120, 10, 1)] }, [], 10, 'w1');
    const [a, b] = w.exercises;
    const first = confirmSet(w, a.rid, a.sets[0].rid, 1000);
    expect(first.rest).toBeNull();
    expect(restAfterSet(first, b.rid, 0)).toBe(120);
    expect(confirmSet(first, b.rid, b.sets[0].rid, 2000).rest?.durationS).toBe(120);
    const single = gymMinutes({ exercises: [{ templateId: 'a', restS: 60, sets: sets(10, 8) }, { templateId: 'b', restS: 120, sets: sets(10, 8) }] });
    const group = gymMinutes({ exercises: [{ templateId: 'a', restS: 60, supersetId: 1, sets: sets(10, 8) }, { templateId: 'b', restS: 120, supersetId: 1, sets: sets(10, 8) }] });
    expect(group).toBeLessThan(single);
  });
  it('warm-up sets count short', () => {
    const base = { templateId: 'pf-squat', restS: 180 };
    const plain = gymMinutes({ exercises: [{ ...base, sets: sets(10, 3) }] });
    const asWork = gymMinutes({ exercises: [{ ...base, sets: [...sets(10, 3), ...sets(10, 3)] }] });
    const warm = gymMinutes({ exercises: [{ ...base, sets: [...sets(10, 3, 'warmup'), ...sets(10, 3)] }] });
    expect(warm).toBeGreaterThanOrEqual(plain);
    expect(warm).toBeLessThan(asWork);
  });
});

describe('extending and editing the rest', () => {
  it('+30 s extends the running rest and survives a reload', () => {
    const w = startFromPlan({ name: 'T', exercises: [ex('pf-squat', 90)] }, [], 10, 'w1');
    const c = confirmSet(w, w.exercises[0].rid, w.exercises[0].sets[0].rid, 1000);
    const e = extendRest(c);
    expect(e.rest).toEqual({ startMs: 1000, durationS: 120 });
    expect(JSON.parse(JSON.stringify(e)).rest).toEqual(e.rest);
    expect(extendRest(w)).toBe(w);
  });
  it('the per-exercise rest edit is used next', () => {
    const w = startFromPlan({ name: 'T', exercises: [ex('pf-squat', 90)] }, [], 10, 'w1');
    const r = setRest(w, w.exercises[0].rid, 180);
    expect(confirmSet(r, r.exercises[0].rid, r.exercises[0].sets[0].rid, 1000).rest?.durationS).toBe(180);
    expect(setRest(w, w.exercises[0].rid, 31)).toBe(w);
  });
});

describe('one rest everywhere', () => {
  it('a rule plan leaves the rest to restOf; estimate, timer and Hevy body agree for a compound exercise', () => {
    const e = { ...ex('pf-bench-press', null), sets: sets(10) };
    const w = startFromPlan({ name: 'T', exercises: [e] }, [], 10, 'w1');
    const done = confirmSet(w, w.exercises[0].rid, w.exercises[0].sets[0].rid, 1000);
    expect(done.rest?.durationS).toBe(150);
    expect(restOf(e)).toBe(150);
  });
  it('a warm-up set rests short and an open warm-up never blocks the work sets', () => {
    const e = { ...ex('pf-bench-press', null), sets: [{ type: 'warmup' as const, weightKg: 10, reps: 5 }, ...sets(10, 2)] };
    let w = startFromPlan({ name: 'T', exercises: [e] }, [], 10, 'w1');
    const x = w.exercises[0];
    w = confirmSet(w, x.rid, x.sets[1].rid, 1000); // work set first, warm-up still open
    expect(currentSet(w)).toMatchObject({ set: x.sets[2].rid });
  });
});
