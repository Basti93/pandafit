import { describe, expect, test } from 'vitest';
import { confirmSet, finish, presetOf, type TrackedSet, type TrackedWorkout } from '../../src/tracking/session';

const set = (rid: string, weightKg: number | null, reps: number | null, type: TrackedSet['type'] = 'normal', doneMs: number | null = null): TrackedSet => ({ rid, type, weightKg, reps, durationS: null, doneMs });
const workout = (sets: TrackedSet[]): TrackedWorkout => ({
  id: 'w', title: 'T', startMs: 1000, endMs: null, source: 'pandafit',
  exercises: [{ rid: 'e', exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets }],
} as unknown as TrackedWorkout);
const setsOf = (w: TrackedWorkout) => w.exercises[0]!.sets;

describe('presets come from one set', () => {
  test('a bodyweight set before the empty one is not mixed with an older weight', () => {
    const sets = [set('a', 10, 8), set('b', null, 12), set('c', null, null)];
    expect(presetOf(sets, 2)).toEqual({ weightKg: null, reps: 12, durationS: null });
    const w = confirmSet(workout(sets), 'e', 'c', 5000);
    expect(setsOf(w)[2]).toMatchObject({ weightKg: null, reps: 12, doneMs: 5000 });
  });

  test('a drop set does not feed the next working set', () => {
    const sets = [set('a', 60, 8), set('b', 40, 10, 'dropset'), set('c', null, null)];
    expect(presetOf(sets, 2)).toEqual({ weightKg: 60, reps: 8, durationS: null });
  });

  test('finishing with "complete" enters empty open sets as shown, one after the other', () => {
    const w = workout([set('a', 60, 8, 'normal', 2000), set('b', null, null), set('c', null, null)]);
    const r = finish(w, 9000, 'complete');
    expect(r.status).toBe('finished');
    const sets = setsOf((r as { workout: TrackedWorkout }).workout);
    expect(sets[1]).toMatchObject({ weightKg: 60, reps: 8, doneMs: 9000 });
    expect(sets[2]).toMatchObject({ weightKg: 60, reps: 8, doneMs: 9000 });
  });
});
