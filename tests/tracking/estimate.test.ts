import { answered, asksEstimate, estimateStep, NOT_ASKED, setEstimate, showsEstimateHint, stepKg, stillEstimated } from '../../src/tracking/estimate';
import type { EstimateAsk, TrackedExercise, TrackedSet, TrackedWorkout } from '../../src/tracking/session';
import { asksEffort } from '../../src/tracking/effort';
import type { Ladder } from '../../src/shared/loads';
import { ruleNumber } from '../../src/shared/training-policy';

const ladder: Ladder = { stepKg: 5, anchorKg: 0, learned: false };
let n = 0;
const s = (kg: number | null, done: boolean, extra: Partial<TrackedSet> = {}): TrackedSet =>
  ({ rid: `s${n++}`, type: 'normal', weightKg: kg, reps: 10, durationS: null, doneMs: done ? 1 : null, estimatedKg: true, prefillKg: kg, ...extra });
const warm = (kg: number, done: boolean) => s(kg, done, { type: 'warmup', estimatedKg: undefined });
const ex = (sets: TrackedSet[], estimateAsk?: EstimateAsk): TrackedExercise => ({ rid: 'e', exerciseId: 'pf-x', title: 'X', supersetId: null, notes: '', sets, ...(estimateAsk ? { estimateAsk } : {}) });
const wo = (e: TrackedExercise): TrackedWorkout => ({ id: 'w', title: 'T', startMs: 0, endMs: null, source: 'pandafit', exercises: [e], rest: null });

describe('the estimated start weight', () => {
  it('steps 15 % of the weight, at least one ladder step, on the ladder', () => {
    expect(ruleNumber('gym.estimate-step-pct')).toBe(15);
    expect(stepKg(30, 'up', ladder)).toBe(35); // 34,5 -> 35
    expect(stepKg(40, 'up', ladder)).toBe(45); // 46: 45 is nearer than 50
    expect(stepKg(60, 'up', ladder)).toBe(70); // 69 -> 70
    expect(stepKg(60, 'down', ladder)).toBe(50); // 51 -> 50
    expect(stepKg(20, 'down', ladder)).toBe(15); // 17 -> 15
    expect(stepKg(100, 'up', { stepKg: 2.5, anchorKg: 20, learned: false })).toBe(115);
    expect(stepKg(5, 'down', ladder)).toBeNull(); // nothing lighter
  });

  it('shows the hint until the first question comes', () => {
    expect(showsEstimateHint(ex([s(30, false), s(30, false)]))).toBe(true);
    expect(showsEstimateHint(ex([s(30, true), s(30, false)]))).toBe(false);
    expect(showsEstimateHint(ex([warm(15, true), warm(20, false), s(30, false)]))).toBe(true);
    expect(showsEstimateHint(ex([warm(15, true), s(30, false)]))).toBe(false);
    expect(showsEstimateHint(ex([s(30, false, { estimatedKg: undefined })]))).toBe(false);
  });

  it('asks first after the first work set, while open sets still hold the estimate', () => {
    expect(asksEstimate(ex([s(30, false), s(30, false)]))).toBe(false);
    expect(asksEstimate(ex([s(30, true), s(30, false)]))).toBe(true);
    expect(asksEstimate(ex([s(30, true), s(30, true), s(30, false)]))).toBe(false);
    // the rider already changed the rest: nothing left to ask about
    expect(asksEstimate(ex([s(30, true), s(35, false, { prefillKg: 30 })]))).toBe(false);
    expect(asksEstimate(ex([s(30, true, { estimatedKg: undefined }), s(30, false, { estimatedKg: undefined })]))).toBe(false);
  });

  it('never asks when the set just lifted was not at the estimate: the person chose their own weight', () => {
    expect(asksEstimate(ex([s(30, true, { weightKg: 35 }), s(30, false), s(30, false)]))).toBe(false);
    // after a step the next lifted set holds the new estimate
    expect(asksEstimate(ex([s(30, true), s(35, true), s(35, false)], { n: 1, atDone: 1, ended: false }))).toBe(true);
    expect(asksEstimate(ex([s(30, true), s(35, true, { weightKg: 40 }), s(35, false)], { n: 1, atDone: 1, ended: false }))).toBe(false);
  });

  it('keeps the answers on the exercise: an end stays ended, a step counts', () => {
    const e = ex([s(30, true), s(30, false)]);
    expect(answered(e, 'end')).toEqual({ n: 0, atDone: 0, ended: true });
    expect(answered(e, 'step')).toEqual({ n: 1, atDone: 1, ended: false });
    expect(asksEstimate({ ...e, estimateAsk: answered(e, 'end') })).toBe(false);
    expect(showsEstimateHint(ex([s(30, false)], { ...NOT_ASKED, ended: true }))).toBe(false);
  });

  it('an exercise with an estimate never gets the effort question', () => {
    const e = ex([s(30, true, { reps: 10, repRange: { start: 8, end: 12 } })]);
    expect(asksEffort(wo({ ...e, swappedIn: true }), 'e', [])).toBe(false);
    expect(asksEffort(wo({ ...e, swappedIn: true, sets: e.sets.map((x) => ({ ...x, estimatedKg: undefined })) }), 'e', [])).toBe(true);
  });

  it('a skipped warm-up still lets the first work set ask', () => {
    expect(asksEstimate(ex([warm(15, false), s(30, true), s(30, false)]))).toBe(true);
  });

  it('with warm-ups it asks after the last warm-up set instead', () => {
    expect(asksEstimate(ex([warm(15, true), warm(20, false), s(30, false), s(30, false)]))).toBe(false);
    expect(asksEstimate(ex([warm(15, true), warm(20, true), s(30, false), s(30, false)]))).toBe(true);
    expect(asksEstimate(ex([warm(15, true), warm(20, true), s(30, true), s(30, false)]))).toBe(false);
  });

  it('after a step it asks once more after the next work set; "Passt" or "Überspringen" end it', () => {
    const after = { n: 1, atDone: 1, ended: false };
    expect(asksEstimate(ex([s(30, true), s(35, false), s(35, false)], after))).toBe(false);
    expect(asksEstimate(ex([s(30, true), s(35, true), s(35, false)], after))).toBe(true);
    expect(asksEstimate(ex([s(30, true), s(35, true), s(35, true), s(35, false)], after))).toBe(false);
    expect(asksEstimate(ex([s(30, true), s(35, true), s(40, true), s(40, false)], { n: 2, atDone: 2, ended: false }))).toBe(false);
    expect(asksEstimate(ex([s(30, true), s(30, false)], { ...NOT_ASKED, ended: true }))).toBe(false);
  });

  it('moves only the following open work sets still at the estimate', () => {
    const e = ex([s(30, true), s(30, false), s(35, false, { prefillKg: 30 }), warm(15, false), s(30, false)]);
    expect(stillEstimated(e).map((x) => x.rid)).toEqual([e.sets[1]!.rid, e.sets[4]!.rid]);
    const down = estimateStep(e, 'down', ladder);
    expect(down.to).toEqual([{ rid: e.sets[1]!.rid, kg: 25 }, { rid: e.sets[4]!.rid, kg: 25 }]);
    expect(down.prior).toEqual([{ rid: e.sets[1]!.rid, kg: 30 }, { rid: e.sets[4]!.rid, kg: 30 }]);
  });

  it('the step becomes the new estimate, and undo puts the old weights back', () => {
    const e = ex([s(30, true), s(30, false), s(30, false)]);
    const { to, prior } = estimateStep(e, 'up', ladder);
    const up = setEstimate(wo(e), 'e', to);
    expect(up.exercises[0]!.sets.map((x) => x.weightKg)).toEqual([30, 35, 35]);
    expect(stillEstimated(up.exercises[0]!)).toHaveLength(2);
    const back = setEstimate(up, 'e', prior).exercises[0]!.sets;
    expect(back.map((x) => [x.weightKg, x.prefillKg])).toEqual([[30, 30], [30, 30], [30, 30]]);
  });
});
