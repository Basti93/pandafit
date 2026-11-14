import { describe, expect, it } from 'vitest';
import { barKgFor, barWeightRecord, readBars, NO_BARS, type Bars } from '../../src/shared/bars';
import { ruleWorkout } from '../../src/coach/gym/rules';
import { ladderHere } from '../../src/tracking/steps';
import { addWarmup, startFromPlan } from '../../src/tracking/session';
import type { StrengthWorkout } from '../../src/coach/hevy';
import type { ExerciseTemplate } from '../../src/shared/gym/types';
import type { LoggedWorkout } from '../../src/shared/records';

const ID = 'pf-preacher-curl';
const STUDIO = 'Gym A';
const NOW = Date.UTC(2026, 10, 2, 12);
const DAY = 86_400_000;
const template: ExerciseTemplate = { id: ID, title: ID, type: 'weight_reps', primaryMuscle: 'biceps', equipment: 'barbell' };

const coachHistory: StrengthWorkout[] = [14, 7].map((d) => ({
  id: `w${d}`, title: 'Day', startMs: NOW - d * DAY, durationS: 3600, studio: STUDIO,
  exercises: [{ title: ID, templateId: ID, sets: 2, reps: 0, volumeKg: 0, workSets: [{ type: 'normal', weightKg: 22.5, reps: 8 }, { type: 'normal', weightKg: 22.5, reps: 8 }] }],
}));
const appHistory: LoggedWorkout[] = [14, 7].map((d) => ({
  id: `l${d}`, title: 'Day', startMs: NOW - d * DAY, endMs: NOW - d * DAY + 3_600_000, source: 'pandafit', studio: STUDIO,
  exercises: [{ exerciseId: ID, title: ID, supersetId: null, notes: '', sets: [1, 2].map((i) => ({ type: 'normal' as const, weightKg: 22.5, reps: 8, durationS: null, doneMs: NOW - d * DAY + i })) }],
}));

const coachFirstWarmup = (bars?: Bars): number[] => {
  const { workout } = ruleWorkout({ workouts: coachHistory, templates: [template], nowMs: NOW, studio: STUDIO, ...(bars ? { bars } : {}) });
  return workout.exercises.find((e) => e.templateId === ID)!.sets.filter((s) => s.type === 'warmup').map((s) => s.weightKg!);
};

const appWarmups = (bars: Bars): number[] => {
  const plan = { name: 'T', exercises: [{ templateId: ID, title: ID, restS: null, supersetId: null, notes: '', sets: [22.5, 22.5].map((kg) => ({ type: 'normal' as const, weightKg: kg, reps: 8 })) }] };
  const w = startFromPlan(plan, appHistory, NOW, 'w1', undefined, STUDIO);
  const { ladder } = ladderHere(ID, 'barbell', appHistory, STUDIO, new Map(), undefined, bars);
  const out = addWarmup(w, w.exercises[0].rid, ladder, barKgFor(ID, 'barbell', STUDIO, bars));
  return out.exercises[0].sets.filter((s) => s.type === 'warmup').map((s) => s.weightKg!);
};

describe('the bar weight reaches the coach plan and the app warm-up', () => {
  const bars = readBars([barWeightRecord('sz', STUDIO, 8.5, 1)]);
  it('coach: first warm-up set is 8.5 kg, none below', () => {
    const w = coachFirstWarmup(bars);
    expect(w[0]).toBe(8.5);
    expect(w.every((kg) => kg >= 8.5)).toBe(true);
  });
  it('app: first warm-up set is 8.5 kg, none below', () => {
    const w = appWarmups(bars);
    expect(w[0]).toBe(8.5);
    expect(w.every((kg) => kg >= 8.5)).toBe(true);
  });
  it('without bar records both start at the SZ default of 10 kg', () => {
    expect(coachFirstWarmup()[0]).toBe(10);
    expect(coachFirstWarmup(NO_BARS)[0]).toBe(10);
    expect(appWarmups(NO_BARS)[0]).toBe(10);
  });
});
