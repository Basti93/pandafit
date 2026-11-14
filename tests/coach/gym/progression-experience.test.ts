import { describe, expect, it } from 'vitest';
import type { StrengthWorkout } from '../../../src/coach/hevy';
import { REASONS, stagnates, suggestNext } from '../../../src/coach/gym/history';
import { isLargeStep, repsAt } from '../../../src/shared/gym/progression';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 12);
/** A session `daysAgo` with sets [kg, reps, plannedReps?]. */
const wk = (daysAgo: number, sets: [number, number, number?][], effort?: 'plenty'): StrengthWorkout => ({
  id: `w${daysAgo}`, title: 'Day', startMs: NOW - daysAgo * DAY, durationS: 3600,
  exercises: [{ title: 'Press', templateId: 'cp', sets: sets.length, reps: 0, volumeKg: 0, ...(effort ? { effort } : {}),
    workSets: sets.map(([weightKg, reps, plannedReps]) => ({ type: 'normal' as const, weightKg, reps, ...(plannedReps !== undefined ? { plannedReps } : {}) })) }],
});
// Chest: range 6-12, for a person who starts 8-12.
const PLATES = { type: 'weight_reps', equipment: 'barbell', primaryMuscle: 'chest' };
const MACHINE = { type: 'weight_reps', equipment: 'machine', primaryMuscle: 'chest' };
const next = (ws: StrengthWorkout[], experience?: 'neu' | 'einige' | 'erfahren', ex = PLATES) => {
  const { reason: _r, ...rest } = suggestNext('cp', ws, NOW, ex, experience ? { experience } : undefined);
  return rest;
};

describe('progression by experience', () => {
  it('erfahren and a missing level give the same suggestion', () => {
    const ws = [wk(14, [[60, 8], [60, 8]]), wk(7, [[60, 9], [60, 9]])];
    expect(next(ws, 'erfahren')).toEqual(next(ws));
    expect(next(ws, 'einige')).toEqual(next(ws));
  });

  it('a person who starts trains at least 8 reps', () => {
    expect(next([wk(7, [[60, 6], [60, 6]])])).toEqual({ weightKg: 60, reps: 6, why: 'keep' });
    expect(next([wk(7, [[60, 6], [60, 6]])], 'neu')).toEqual({ weightKg: 60, reps: 8, why: 'keep' });
  });

  it('with "plenty left" a person who starts jumps 2 reps', () => {
    expect(next([wk(7, [[60, 8], [60, 8]], 'plenty')])).toEqual({ weightKg: 60, reps: 9, why: 'progress' });
    expect(next([wk(7, [[60, 8], [60, 8]], 'plenty')], 'neu')).toEqual({ weightKg: 60, reps: 10, why: 'progress' });
    // never above the range
    expect(next([wk(7, [[60, 11], [60, 11]], 'plenty')], 'neu')).toEqual({ weightKg: 60, reps: 12, why: 'progress' });
  });

  it('clearly more reps than planned: a person who starts goes on at once, others wait for a second session', () => {
    const one = [wk(7, [[60, 10, 8], [60, 10, 8]])];
    expect(next(one)).toEqual({ weightKg: 60, reps: 10, why: 'keep' });
    expect(next(one, 'neu')).toEqual({ weightKg: 60, reps: 12, why: 'progress' });
    expect(suggestNext('cp', one, NOW, PLATES, { experience: 'neu' }).reason).toBe('weil du deutlich mehr geschafft hast als geplant');
    // one more than planned is no clear surplus
    expect(next([wk(7, [[60, 9, 8], [60, 9, 8]])], 'neu')).toEqual({ weightKg: 60, reps: 9, why: 'keep' });
  });
});

describe('large weight steps (every level)', () => {
  it('estimates the reps after a step with Epley', () => {
    expect(repsAt(20, 12, 25)).toBe(3);
    expect(repsAt(60, 12, 62.5)).toBe(10);
    expect(isLargeStep(20, 25)).toBe(true);
    expect(isLargeStep(60, 62.5)).toBe(false);
  });

  it('a small step starts at the bottom of the range, a large one where the weight allows, at most 3 below', () => {
    expect(next([wk(14, [[60, 12], [60, 12]]), wk(7, [[60, 12], [60, 12]])])).toEqual({ weightKg: 62.5, reps: 6, why: 'progress' });
    expect(next([wk(14, [[20, 12], [20, 12]]), wk(7, [[20, 12], [20, 12]])], undefined, MACHINE)).toEqual({ weightKg: 25, reps: 3, why: 'progress' });
  });

  it('after a large step the reps may stay below the range while the weight stays', () => {
    const ws = [wk(21, [[20, 12], [20, 12]]), wk(14, [[20, 12], [20, 12]]), wk(7, [[25, 4], [25, 4]])];
    expect(next(ws, undefined, MACHINE)).toEqual({ weightKg: 25, reps: 4, why: 'keep' });
    const on = [...ws.slice(0, 2), wk(10, [[25, 4], [25, 4]]), wk(7, [[25, 5], [25, 5]])];
    expect(next(on, undefined, MACHINE)).toEqual({ weightKg: 25, reps: 6, why: 'progress' });
  });
});

describe('stagnation by experience', () => {
  it('a core exercise of a person who starts stalls only after 3 sessions', () => {
    const ws = [wk(21, [[60, 8]]), wk(14, [[60, 8]]), wk(7, [[60, 8]])];
    expect(stagnates('cp', ws, NOW, PLATES)).toBe(true);
    expect(stagnates('cp', ws, NOW, PLATES, { experience: 'neu' })).toBe(false);
    expect(stagnates('cp', [wk(28, [[60, 8]]), ...ws], NOW, PLATES, { experience: 'neu' })).toBe(true);
  });
});

describe('after a large step (review fixes)', () => {
  const DB = { type: 'weight_reps', equipment: 'dumbbell', primaryMuscle: 'chest' };
  const sw = (daysAgo: number, kg: number, reps: number): StrengthWorkout => wk(daysAgo, [[kg, reps], [kg, reps]]);
  it('a step back after two drops goes to the plain range at the lighter weight', () => {
    const ws = [sw(28, 10, 12), sw(21, 12.5, 7), sw(14, 12.5, 6), sw(7, 12.5, 5)];
    expect(next(ws, undefined, DB)).toEqual({ weightKg: 10, reps: 6, why: 'step-back' });
  });
  it('a long break after a large step goes to the plain range too', () => {
    const ws = [sw(50, 10, 12), sw(40, 12.5, 5)];
    expect(next(ws, undefined, DB)).toEqual({ weightKg: 10, reps: 6, why: 'step-back' });
  });
  it('a later place in the workout with a lower weight keeps the plain range', () => {
    const ws = [sw(14, 10, 12), sw(7, 12.5, 5)];
    const r = suggestNext('cp', ws, NOW, DB, undefined, 4);
    expect(r.why).toBe('keep');
    expect(r.weightKg).toBe(10);
    expect(r.reps).toBe(6);
  });
  it('a person who starts never goes below 8: the weight stays and the reps climb until the step fits', () => {
    const ws = [sw(14, 10, 12), sw(7, 10, 12)];
    expect(next(ws, 'neu', DB)).toEqual({ weightKg: 10, reps: 13, why: 'progress' });
    const later = [sw(14, 10, 15), sw(7, 10, 16)];
    expect(next(later, 'neu', DB)).toEqual({ weightKg: 12, reps: 8, why: 'progress' });
  });
  it('without a plan the reason compares with the last session', () => {
    const ws = [wk(14, [[60, 8], [60, 8]]), wk(7, [[60, 10], [60, 10]])];
    expect(suggestNext('cp', ws, NOW, PLATES, { experience: 'neu' }).reason).toBe(REASONS['more-than-last']);
    expect(REASONS['more-than-last']).toBe('weil du deutlich mehr geschafft hast als beim letzten Mal');
  });
});
