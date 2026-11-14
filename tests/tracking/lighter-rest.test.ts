import { followingSameWeight, setWeights } from '../../src/tracking/lighter-rest';
import type { TrackedSet, TrackedWorkout } from '../../src/tracking/session';

const set = (rid: string, kg: number | null, over: Partial<TrackedSet> = {}): TrackedSet => ({ rid, type: 'normal', weightKg: kg, reps: 8, durationS: null, doneMs: null, ...over });
const workout = (sets: TrackedSet[]): TrackedWorkout => ({ id: 'w', title: 'T', startMs: 0, endMs: null, source: 'pandafit', rest: null, exercises: [{ rid: 'e1', exerciseId: 'x', title: 'X', supersetId: null, notes: '', sets }] });

describe('restliche Sätze mit dem alten Gewicht', () => {
  it('senkt von 50 auf 45 und bietet Satz 2 und 3 an, wenn beide 50 haben', () => {
    const w = workout([set('a', 45), set('b', 50), set('c', 50)]);
    expect(followingSameWeight(w, 'e1', 'a', 50)).toEqual([{ rid: 'b' }, { rid: 'c' }]);
  });
  it('bietet einen folgenden Satz mit 55 nicht an', () => {
    const w = workout([set('a', 45), set('b', 50), set('c', 55)]);
    expect(followingSameWeight(w, 'e1', 'a', 50)).toEqual([{ rid: 'b' }]);
  });
  it('bietet erledigte Sätze und Aufwärmsätze nicht an', () => {
    const w = workout([set('a', 45), set('b', 50, { doneMs: 1 }), set('c', 50, { type: 'warmup' }), set('d', 50)]);
    expect(followingSameWeight(w, 'e1', 'a', 50)).toEqual([{ rid: 'd' }]);
  });
  it('bietet frühere Sätze nicht an', () => {
    const w = workout([set('a', 50), set('b', 45), set('c', 50)]);
    expect(followingSameWeight(w, 'e1', 'b', 50)).toEqual([{ rid: 'c' }]);
  });
  it('geht ohne geplantes oder vorbelegtes Gewicht, auch nach oben', () => {
    const w = workout([set('a', 55), set('b', 50), set('c', 50)]);
    expect(followingSameWeight(w, 'e1', 'a', 50)).toEqual([{ rid: 'b' }, { rid: 'c' }]);
  });
  it('liefert nichts, wenn nichts folgt', () => {
    expect(followingSameWeight(workout([set('a', 45)]), 'e1', 'a', 50)).toEqual([]);
    expect(followingSameWeight(workout([set('a', 45), set('b', null)]), 'e1', 'a', 50)).toEqual([]);
  });
  it('setWeights lässt erledigte Sätze unangetastet', () => {
    const w = workout([set('a', 50, { doneMs: 1 }), set('b', 60)]);
    const r = setWeights(w, 'e1', [{ rid: 'a', kg: 30 }, { rid: 'b', kg: 45 }]);
    expect(r.exercises[0]!.sets.map((s) => s.weightKg)).toEqual([50, 45]);
  });
});
