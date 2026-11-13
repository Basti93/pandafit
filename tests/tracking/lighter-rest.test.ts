import { lighterRest, setWeights } from '../../src/tracking/lighter-rest';
import type { TrackedSet, TrackedWorkout } from '../../src/tracking/session';

const snap = (kg: number): number => Math.floor(kg / 2.5 + 1e-9) * 2.5;
const set = (rid: string, planned: number, over: Partial<TrackedSet> = {}): TrackedSet => ({ rid, type: 'normal', weightKg: planned, reps: 8, durationS: null, doneMs: null, plannedKg: planned, prefillKg: planned, ...over });
const workout = (sets: TrackedSet[]): TrackedWorkout => ({ id: 'w', title: 'T', startMs: 0, endMs: null, source: 'pandafit', rest: null, exercises: [{ rid: 'e1', exerciseId: 'x', title: 'X', supersetId: null, notes: '', sets }] });

describe('weniger Gewicht für die restlichen Sätze', () => {
  it('nimmt das bestätigte Gewicht für alle offenen Sätze', () => {
    const w = workout([set('a', 60, { weightKg: 50, doneMs: 1 }), set('b', 60), set('c', 60)]);
    expect(lighterRest(w, 'e1', snap)).toEqual({ kg: 50, sets: [{ rid: 'b', kg: 50 }, { rid: 'c', kg: 50 }] });
  });
  it('lässt eine Pyramide eine Pyramide bleiben', () => {
    const w = workout([set('a', 60, { weightKg: 54, doneMs: 1 }), set('b', 65), set('c', 70)]);
    expect(lighterRest(w, 'e1', snap)).toEqual({ kg: null, sets: [{ rid: 'b', kg: 57.5 }, { rid: 'c', kg: 62.5 }] });
  });
  it('meldet nichts, wenn die restlichen Sätze das Gewicht schon haben', () => {
    const w = workout([set('a', 60, { weightKg: 50, doneMs: 1 }), set('b', 60, { weightKg: 50 })]);
    expect(lighterRest(w, 'e1', snap)).toBeNull();
  });
  it('hebt keinen Satz an, den die Person schon tiefer eingetippt hat', () => {
    const w = workout([set('a', 60, { weightKg: 50, doneMs: 1 }), set('b', 60, { weightKg: 40 }), set('c', 60)]);
    expect(lighterRest(w, 'e1', snap)?.sets).toEqual([{ rid: 'c', kg: 50 }]);
  });
  it('senkt keinen Satz, den die Person höher eingetippt hat', () => {
    const w = workout([set('a', 60, { weightKg: 50, doneMs: 1 }), set('b', 60, { weightKg: 65 }), set('c', 60)]);
    expect(lighterRest(w, 'e1', snap)?.sets).toEqual([{ rid: 'c', kg: 50 }]);
  });
  it('setWeights lässt erledigte Sätze unangetastet', () => {
    const w = workout([set('a', 60, { weightKg: 50, doneMs: 1 }), set('b', 60)]);
    const r = setWeights(w, 'e1', [{ rid: 'a', kg: 30 }, { rid: 'b', kg: 45 }]);
    expect(r.exercises[0]!.sets.map((s) => s.weightKg)).toEqual([50, 45]);
  });
});
