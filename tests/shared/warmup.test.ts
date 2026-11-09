import { warmupRamp, needsWarmup } from '../../src/shared/warmup';
import { policyRule } from '../../src/shared/training-policy';
import { addWarmup, confirmSet, startFromPlan } from '../../src/tracking/session';
import type { Ladder } from '../../src/shared/loads';
import type { StrengthWorkout } from '../../src/coach/hevy';
import type { ExerciseTemplate } from '../../src/shared/gym/types';
import { ruleWorkout } from '../../src/coach/gym/rules';

const L = (stepKg: number, anchorKg = stepKg): Ladder => ({ stepKg, anchorKg, learned: true });

describe('warmupRamp', () => {
  it('barbell 100 kg on a 2.5 ladder: bar x10, 40x5, 60x3, 80x2', () => {
    expect(warmupRamp({ workingKg: 100, equipment: 'barbell', ladder: L(2.5, 20) })).toEqual([
      { weightKg: 20, reps: 10 }, { weightKg: 40, reps: 5 }, { weightKg: 60, reps: 3 }, { weightKg: 80, reps: 2 }]);
  });
  it('a 5 kg machine ladder snaps down', () => {
    expect(warmupRamp({ workingKg: 52, equipment: 'machine', ladder: L(5) })).toEqual([{ weightKg: 20, reps: 5 }, { weightKg: 30, reps: 3 }, { weightKg: 40, reps: 2 }]);
  });
  it('drops duplicates and steps at or above the working weight', () => {
    expect(warmupRamp({ workingKg: 12, equipment: 'machine', ladder: L(5) })).toEqual([{ weightKg: 5, reps: 5 }]);
    expect(warmupRamp({ workingKg: 20, equipment: 'barbell', ladder: L(2.5, 20) })).toEqual([]);
    expect(warmupRamp({ workingKg: 30, equipment: 'barbell', ladder: L(2.5, 20) })).toEqual([{ weightKg: 20, reps: 10 }, { weightKg: 22.5, reps: 2 }]);
  });
  it('no working weight, no ramp', () => {
    expect(warmupRamp({ workingKg: null, equipment: 'barbell', ladder: L(2.5, 20) })).toEqual([]);
    expect(warmupRamp({ workingKg: 0, equipment: 'machine', ladder: L(5) })).toEqual([]);
  });
  it('is in the register as active', () => {
    expect(policyRule('prep.ramp').ramp).toHaveLength(3);
    expect(policyRule('prep.per-movement-block').status).toEqual({ state: 'active' });
  });
});

const set = (weightKg: number | null) => ({ type: 'normal' as const, weightKg, reps: 8 });
const ex = (id: string, kg: number | null) => ({ templateId: id, title: id, restS: null, supersetId: null, notes: '', sets: [set(kg), set(kg)] });

describe('needsWarmup', () => {
  const plan = { name: 'T', exercises: [ex('pf-bench-press', 80), ex('pf-incline-bench-press', 60), ex('pf-squat', 100)] };
  it('is true for the first of a group, false after a same-group exercise was trained', () => {
    const w = startFromPlan(plan, [], 10, 'w1');
    const [a, b, c] = w.exercises;
    expect([a, b, c].map((e) => needsWarmup(w, e.rid))).toEqual([true, true, true]);
    const done = confirmSet(w, a.rid, a.sets[0].rid, 1000);
    expect(needsWarmup(done, b.rid)).toBe(false);
    expect(needsWarmup(done, c.rid)).toBe(true); // a new movement block, also late in the workout
    expect(needsWarmup(done, a.rid)).toBe(false);
  });
});

describe('addWarmup', () => {
  it('inserts the ramp before the work sets as editable warmup sets, then the offer is gone', () => {
    const w = startFromPlan({ name: 'T', exercises: [ex('pf-squat', 100)] }, [], 10, 'w1');
    const e = w.exercises[0];
    const out = addWarmup(w, e.rid, L(2.5, 20));
    const sets = out.exercises[0].sets;
    expect(sets.map((s) => [s.type, s.weightKg])).toEqual([['warmup', 20], ['warmup', 40], ['warmup', 60], ['warmup', 80], ['normal', 100], ['normal', 100]]);
    expect(sets.slice(4).map((s) => s.rid)).toEqual(e.sets.map((s) => s.rid));
    expect(needsWarmup(out, e.rid)).toBe(false);
    expect(addWarmup(out, e.rid, L(2.5, 20))).toBe(out);
  });
  it('adds nothing without a working weight or after a done set', () => {
    const w = startFromPlan({ name: 'T', exercises: [ex('pf-squat', null), ex('pf-bench-press', 80)] }, [], 10, 'w1');
    expect(addWarmup(w, w.exercises[0].rid, L(2.5, 20))).toBe(w);
    const done = confirmSet(w, w.exercises[1].rid, w.exercises[1].sets[0].rid, 5);
    expect(addWarmup(done, done.exercises[1].rid, L(2.5, 20))).toBe(done);
  });
});

describe('the rule plan', () => {
  const T = (id: string, equipment: string, primaryMuscle: string): ExerciseTemplate => ({ id, title: id, type: 'weight_reps', primaryMuscle, equipment });
  const NOW = Date.UTC(2026, 10, 2, 12);
  const wk = (d: number, id: string, kg: number): StrengthWorkout => ({ id: `w${d}${id}`, title: 'Day', startMs: NOW - d * 86_400_000, durationS: 3600,
    exercises: [{ title: id, templateId: id, sets: 2, reps: 0, volumeKg: 0, workSets: [{ type: 'normal', weightKg: kg, reps: 8 }, { type: 'normal', weightKg: kg, reps: 8 }] }] });
  it('adds the ramp only to the first exercise per group', () => {
    const templates = [T('bp', 'barbell', 'chest'), T('cp', 'machine', 'chest'), T('lr', 'machine', 'lats')];
    const workouts = [14, 7].flatMap((d) => [wk(d, 'bp', 80), wk(d, 'cp', 40), wk(d, 'lr', 50)]);
    const { workout } = ruleWorkout({ workouts, templates, nowMs: NOW });
    const warm = (id: string) => workout.exercises.find((e) => e.templateId === id)!.sets.filter((s) => s.type === 'warmup');
    const chest = workout.exercises.filter((e) => ['bp', 'cp'].includes(e.templateId));
    expect(chest.filter((e) => e.sets.some((s) => s.type === 'warmup'))).toHaveLength(1);
    expect(chest[0].sets.some((s) => s.type === 'warmup')).toBe(true);
    expect(warm('lr').length).toBeGreaterThan(0);
    for (const e of workout.exercises) { const first = e.sets.findIndex((s) => s.type !== 'warmup'); expect(e.sets.slice(0, first).every((s) => s.type === 'warmup')).toBe(true); }
  });
});

describe('the lattice below the learned anchor', () => {
  it('a barbell ladder learned at 92.5-100 still gives a full ramp', async () => {
    const { extendDown } = await import('../../src/shared/loads');
    const l = extendDown({ stepKg: 2.5, anchorKg: 92.5, learned: true }, 'barbell');
    expect(l.anchorKg).toBe(20);
    expect(warmupRamp({ workingKg: 100, equipment: 'barbell', ladder: l }).map((s) => s.weightKg)).toEqual([20, 40, 60, 80]);
  });
});
