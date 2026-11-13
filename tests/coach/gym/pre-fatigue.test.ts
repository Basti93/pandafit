import { describe, expect, it } from 'vitest';
import { hardSetsOf, muscleOfFrom, musclesOfFrom, preFatigue } from '../../../src/coach/gym/pre-fatigue';
import { EXERCISES } from '../../../src/shared/exercises';

const entry = (id: string) => EXERCISES.find((x) => x.id === id)!;
const fromCatalog = (id: string, hardSets: number) => ({ primaryMuscle: entry(id).primaryMuscle, secondaryMuscles: entry(id).secondaryMuscles, hardSets, supersetId: null });

const e = (primaryMuscle: string | null | undefined, hardSets: number, supersetId: number | null = null) => ({ primaryMuscle, hardSets, supersetId });

describe('preFatigue', () => {
  it('counts the hard sets of earlier exercises of the same group only', () => {
    // Chest press 4 sets, shoulder press 3, incline press: shoulders are another group.
    expect(preFatigue([e('chest', 4), e('front_delts', 3), e('chest', 3)])).toEqual([0, 0, 4]);
  });
  it('an exercise without a known muscle is 0 and tires nothing', () => {
    expect(preFatigue([e(undefined, 4), e(null, 4), e('mystery', 4), e('chest', 3)])).toEqual([0, 0, 0, 0]);
  });
  it('in a superset of two chest exercises the second one counts the sets of the first', () => {
    expect(preFatigue([e('chest', 3, 1), e('chest', 3, 1)])).toEqual([0, 3]);
  });
  it('counts normal, failure and drop sets as hard sets, warm-ups not', () => {
    expect(hardSetsOf([{ type: 'warmup' }, { type: 'normal' }, { type: 'failure' }, { type: 'dropset' }])).toBe(3);
  });
  it('resolves a muscle from the catalog first, then the template', () => {
    const of = muscleOfFrom([{ id: 'a', title: 'A', type: 'weight_reps', primaryMuscle: 'lats', equipment: 'machine' }, { id: 'b', title: 'B', type: 'weight_reps', primaryMuscle: 'biceps', equipment: 'machine' }],
      [{ id: 'a', title: 'A', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'machine' }]);
    expect([of('a'), of('b'), of('c')]).toEqual(['chest', 'biceps', undefined]);
  });
  it('Kniebeuge und Rumänisches Kreuzheben ermüden den Hip Thrust', () => {
    const pre = preFatigue([fromCatalog('pf-squat', 4), fromCatalog('pf-romanian-deadlift', 3), fromCatalog('pf-hip-thrust', 3)]);
    // The squat tires the hamstrings (its own fatigue list), so the Romanian deadlift starts tired.
    expect(pre[1]).toBeGreaterThan(0);
    // Hip thrust: half a set for each of the 4 squat sets and each of the 3 deadlift sets on the glutes.
    expect(pre[2]).toBe(4 * 0.5 + 3 * 0.5);
  });
  it('eine Rückenübung ermüdet die Beine nicht über den unteren Rücken', () => {
    // The squat lists the lower back as a secondary muscle, but the lower back is no fatigue synergist of the quads: rowing stays fresh.
    expect(preFatigue([fromCatalog('pf-squat', 4), { primaryMuscle: 'lats', hardSets: 3, supersetId: null }])[1]).toBe(0);
    // And rowing does not tire the quads either.
    expect(preFatigue([{ primaryMuscle: 'lats', hardSets: 3, supersetId: null }, fromCatalog('pf-squat', 3)])[1]).toBe(0);
  });
  it('resolves the secondary muscles from the catalog, not from a Hevy template', () => {
    const of = musclesOfFrom([{ id: 'pf-squat', title: 'S', type: 'weight_reps', primaryMuscle: 'quadriceps', equipment: 'barbell' }, { id: 'h', title: 'H', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'machine' }], EXERCISES);
    expect(of('pf-squat')?.secondaryMuscles).toEqual(entry('pf-squat').secondaryMuscles);
    expect(of('h')).toEqual({ primaryMuscle: 'chest' });
  });
});
