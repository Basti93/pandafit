import { describe, expect, it } from 'vitest';
import { hardSetsOf, muscleOfFrom, preFatigue } from '../../../src/coach/gym/pre-fatigue';

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
});
