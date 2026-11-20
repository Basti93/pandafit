import { ladderFor } from '../../src/coach/gym/history';
import { stepHere } from '../../src/tracking/steps';
import { ladderFrom, learnLadder, loadStepId, loadStepOverrides, loadStepRecord, nextUp, platesPerSide, readLoadStep, snapDown, withOverride } from '../../src/shared/loads';
import { RECORD_KINDS, RECORD_KINDS_SIGNATURE, type TrackedRecord } from '../../src/shared/records';
import { validBody } from '../../src/web/validate';
import { loadStepsOf } from '../../src/coach/tracking/load-steps';
import { policyRule, ruleNumber } from '../../src/shared/training-policy';

describe('learnLadder', () => {
  test('40/45/50 on a machine is step 2.5 (a multiple of the default reads as the default)', () => {
    expect(learnLadder([40, 45, 50], 'machine', 20)).toEqual({ stepKg: 2.5, anchorKg: 40, learned: true });
  });
  test('7/14/21 is step 7 and 14 goes up to 21', () => {
    const l = learnLadder([7, 14, 21], 'machine', 20);
    expect(l.stepKg).toBe(7);
    expect(nextUp(14, l)).toBe(21);
  });
  test('dumbbells 12.5/15 are step 2.5', () => {
    expect(learnLadder([12.5, 15], 'dumbbell', 20).stepKg).toBe(2.5);
  });
  test('a single weight gives the equipment default, not learned', () => {
    expect(learnLadder([30], 'dumbbell', 20)).toMatchObject({ stepKg: 2, learned: false });
    expect(learnLadder([30, 30], 'machine', 20)).toMatchObject({ stepKg: 2.5, learned: false });
    expect(learnLadder([30], 'unheard-of', 20).stepKg).toBe(2.5);
  });
  test('a multiple of the default falls back to the default (few data points overestimate)', () => {
    expect(learnLadder([20, 30], 'barbell', 20).stepKg).toBe(2.5);
  });
  test('a finer difference than the default is kept, and the step is at least 0.5', () => {
    expect(learnLadder([10, 11.25], 'machine', 20).stepKg).toBe(1.25);
    expect(learnLadder([10, 10.25], 'machine', 20).stepKg).toBe(0.5);
  });
  test('anchor: smallest weight; barbell without data is the bar; else 0', () => {
    expect(learnLadder([], 'barbell', 20)).toEqual({ stepKg: 2.5, anchorKg: 20, learned: false });
    expect(learnLadder([], 'machine', 20).anchorKg).toBe(0);
  });
});

describe('reachable weights', () => {
  const l = { stepKg: 5, anchorKg: 7, learned: true };
  test('nextUp and snapDown', () => {
    expect(nextUp(7, l)).toBe(12);
    expect(nextUp(8, l)).toBe(12);
    expect(nextUp(2, l)).toBe(7);
    expect(snapDown(14, l)).toBe(12);
    expect(snapDown(12, l)).toBe(12);
    expect(snapDown(3, l)).toBe(7);
  });
});

describe('step override', () => {
  const rec = (ex: string, studio: string, stepKg: number, updatedMs = 1, deleted = false): TrackedRecord => ({ ...loadStepRecord(ex, studio, stepKg, updatedMs), deleted });
  test('is a record kind', () => {
    expect(RECORD_KINDS).toContain('loadstep');
    expect(RECORD_KINDS_SIGNATURE).toContain('loadstep');
  });
  test('parses only the offered steps', () => {
    expect(readLoadStep({ exerciseId: 'e', studio: 'A', stepKg: 7 })).toEqual({ exerciseId: 'e', studio: 'A', stepKg: 7 });
    expect(readLoadStep({ exerciseId: 'e', studio: 'A', stepKg: 3 })).toBeNull();
    expect(readLoadStep({ exerciseId: '', studio: 'A', stepKg: 5 })).toBeNull();
    expect(readLoadStep({ studio: 'A', stepKg: 5 })).toBeNull();
    expect(validBody('loadstep', { exerciseId: 'e', studio: '', stepKg: 5 })).toBe(true);
    expect(validBody('loadstep', { exerciseId: 'e', studio: '', stepKg: 6 })).toBe(false);
  });
  test('the id depends on exercise and studio', () => {
    expect(loadStepId('e', 'A')).toBe(loadStepId('e', 'A'));
    expect(loadStepId('e', 'A')).not.toBe(loadStepId('e', 'B'));
    expect(loadStepId('e', 'A')).toMatch(/^step-/);
  });
  test('an override wins, keeps the anchor, and a tombstone undoes it', () => {
    const base = learnLadder([40, 45, 50], 'machine', 20);
    const key = { exerciseId: 'e', studio: 'A' };
    const on = loadStepOverrides([rec('e', 'A', 10)]);
    expect(withOverride(base, on, key)).toEqual({ stepKg: 10, anchorKg: 40, learned: true });
    expect(withOverride(base, on, { exerciseId: 'e', studio: 'B' })).toEqual(base);
    const off = loadStepOverrides([rec('e', 'A', 10, 2, true)]);
    expect(withOverride(base, off, key)).toEqual(base);
  });
  test('malformed records are skipped', () => {
    const bad: TrackedRecord = { kind: 'loadstep', id: 'step-x', updatedMs: 1, deleted: false, body: { exerciseId: 'e', studio: 'A', stepKg: 3 } };
    expect(loadStepOverrides([bad]).size).toBe(0);
  });
  test('the coach side reads them per profile', () => {
    const store = { all: (p: string, k?: string) => (p === 'p1' && k === 'loadstep' ? [rec('e', 'A', 5)] : []) };
    const key = { exerciseId: 'e', studio: 'A' };
    expect(withOverride(learnLadder([], 'machine', 20), loadStepsOf(store, 'p1'), key).stepKg).toBe(5);
    expect(withOverride(learnLadder([], 'machine', 20), loadStepsOf(store, 'p2'), key).stepKg).toBe(2.5);
  });
});

describe('platesPerSide', () => {
  test('62.5 is exact: 20 + 1.25 per side', () => {
    expect(platesPerSide(62.5, 20)).toEqual({ status: 'exact', perSide: [20, 1.25] });
  });
  test('61 lies between 60 and 62.5', () => {
    expect(platesPerSide(61, 20)).toMatchObject({ status: 'between', lower: 60, upper: 62.5 });
  });
  test('15 is below the bar; the bare bar is exact', () => {
    expect(platesPerSide(15, 20).status).toBe('below-bar');
    expect(platesPerSide(20, 20)).toEqual({ status: 'exact', perSide: [] });
  });
  test('heavy loads use the big plates in pairs', () => {
    expect(platesPerSide(120, 20)).toEqual({ status: 'exact', perSide: [25, 25] });
  });
});

describe('load rules', () => {
  test('are active product rules for loads.ts', () => {
    for (const id of ['load.default-step', 'load.step-choices', 'load.bar-kg', 'load.plates'])
      expect(policyRule(id)).toMatchObject({ class: 'product', status: { state: 'active' }, where: ['src/shared/loads.ts'] });
    expect(ruleNumber('load.bar-kg')).toBe(20);
    expect(policyRule('load.default-step').values).toEqual({ barbell: 2.5, dumbbell: 2, machine: 2.5, kettlebell: 4, none: 2.5, other: 2.5 });
    expect(policyRule('load.step-choices').numbers).toEqual([0.5, 1, 1.25, 2, 2.5, 4, 5, 7, 10]);
    expect(policyRule('load.plates').numbers).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
  });
});

describe('review fixes', () => {
  const grid = { stepKg: 1.25, anchorKg: 1.25, learned: true };
  test('nextUp and snapDown on a 1.25 grid with 61.25', () => {
    expect(snapDown(61.25, grid)).toBe(61.25);
    expect(nextUp(61.25, grid)).toBe(62.5);
    expect(snapDown(61.9, grid)).toBe(61.25);
  });
  test('non-finite totals are below the bar, not an endless loop', () => {
    for (const x of [Infinity, -Infinity, NaN]) expect(platesPerSide(x, 20)).toEqual({ status: 'below-bar', perSide: [] });
  });
  test('a loadstep body is checked', () => {
    expect(validBody('loadstep', { exerciseId: 'e', studio: 'A', stepKg: 5 })).toBe(true);
    expect(validBody('loadstep', { exerciseId: 'e', studio: 'A', stepKg: 3.3 })).toBe(false);
  });
});

describe('one ladder for app and coach', () => {
  const none = new Map<string, number>();
  const kgs: [number, number[], string?][] = [[1, [40, 45]], [2, [50, 60]], [3, [55, 65], 'Anderswo'], [4, [70, 75]]];

  test('the same history gives the same step on both sides', () => {
    const own = kgs.map(([d, w, studio]) => ({
      id: `w${d}`, title: 'T', startMs: d * 1000, endMs: d * 1000 + 500, source: 'pandafit' as const, ...(studio ? { studio } : {}),
      exercises: [{ exerciseId: 'sq', title: 'Squat', supersetId: null, notes: '', sets: w.map((k) => ({ type: 'normal' as const, weightKg: k, reps: 8, durationS: null, doneMs: 1 })) }],
    }));
    const strength = own.map((w) => ({ id: w.id, title: 'T', startMs: w.startMs, durationS: 1, ...(w.studio ? { studio: w.studio } : {}),
      exercises: [{ title: 'Squat', templateId: 'sq', sets: 2, reps: 0, volumeKg: 0, workSets: w.exercises[0].sets.map((s) => ({ type: 'normal' as const, weightKg: s.weightKg, reps: 8 })) }] }));
    for (const studio of ['', 'Anderswo']) {
      const app = stepHere('sq', 'machine', own, studio, none).stepKg;
      const coach = ladderFor('sq', { equipment: 'machine' }, strength, 10_000, { studio: studio || undefined }).stepKg;
      expect(coach).toBe(app);
    }
    expect(stepHere('sq', 'machine', own, '', none).stepKg).toBe(2.5);
  });

  test('an off-grid anchor (22.68 from lb) keeps its exact value and steps from there', () => {
    const sessions = [{ startMs: 1, sets: [{ type: 'normal', weightKg: 22.68 }, { type: 'normal', weightKg: 27.68 }] }];
    const { ladder } = ladderFrom(sessions, { exerciseId: 'x', studio: '', main: undefined }, 'machine', none, 0);
    expect(ladder.anchorKg).toBe(22.68);
    expect(nextUp(22.68, ladder)).toBeCloseTo(22.68 + ladder.stepKg, 2);
  });
});

describe('a rename keeps the own step', () => {
  const ren = new Map([['alt', 'Neu']]);
  test('the override of the old name is found under the new one', () => {
    const o = loadStepOverrides([loadStepRecord('pf-bench-press', 'Alt', 5, 10)], ren);
    expect(o.get('pf-bench-press|Neu')).toBe(5);
    expect(o.has('pf-bench-press|Alt')).toBe(false);
    expect(loadStepOverrides([loadStepRecord('pf-bench-press', 'Alt', 5, 10)]).get('pf-bench-press|Alt')).toBe(5);
  });
  test('when both names have a step, the newer one wins', () => {
    const recs = [loadStepRecord('pf-bench-press', 'Neu', 2.5, 20), loadStepRecord('pf-bench-press', 'Alt', 5, 10)];
    expect(loadStepOverrides(recs, ren).get('pf-bench-press|Neu')).toBe(2.5);
  });
  test('the ladder of the renamed studio uses it', () => {
    const o = loadStepOverrides([loadStepRecord('pf-bench-press', 'Alt', 5, 10)], ren);
    const sessions = [{ studio: 'Alt', startMs: 1, sets: [{ type: 'normal', weightKg: 40 }, { type: 'normal', weightKg: 42.5 }] }];
    expect(ladderFrom(sessions, { exerciseId: 'pf-bench-press', studio: 'Neu', main: undefined, renames: ren }, 'machine', o, 0).ladder.stepKg).toBe(5);
  });
});
