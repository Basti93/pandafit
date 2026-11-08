import { clearDraft, draftDropped, planKeyOf, readDraft, startFromDraft, writeDraft } from '../../src/tracking/plan-draft';
import type { TrackedWorkout } from '../../src/tracking/session';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
};
const throwing = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); }, removeItem: () => { throw new Error('private'); } };
const draft: TrackedWorkout = {
  id: 'd1', title: 'Pull', startMs: 5, endMs: null, source: 'pandafit', rest: { startMs: 5, durationS: 90 }, studio: 'Alpha',
  exercises: [{ rid: 'e1', exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [
    { rid: 's1', type: 'normal', weightKg: 62.5, reps: 6, durationS: null, doneMs: 99 },
    { rid: 's2', type: 'normal', weightKg: 62.5, reps: 6, durationS: null, doneMs: null },
  ] }],
};

describe('plan key', () => {
  test('the plan time and the workout name', () => {
    expect(planKeyOf({ atMs: 7, workout: { name: 'Pull' } })).toBe('7:Pull');
    expect(planKeyOf({ atMs: 7, workout: { name: 'Push' } })).not.toBe(planKeyOf({ atMs: 7, workout: { name: 'Pull' } }));
  });
});

describe('the draft store', () => {
  test('written and read back for the same plan, per account', () => {
    const s = memory();
    expect(writeDraft(s, 'mira', 'k1', draft)).toBe(true);
    expect(readDraft(s, 'mira', 'k1')).toEqual(draft);
    expect(readDraft(s, 'other', 'k1')).toBeNull();
    clearDraft(s, 'mira');
    expect(readDraft(s, 'mira', 'k1')).toBeNull();
  });

  test('another plan key: no draft, and the drop is said once', () => {
    const s = memory();
    writeDraft(s, 'mira', 'old', draft);
    expect(readDraft(s, 'mira', 'new')).toBeNull();
    expect(draftDropped(s, 'mira', 'new')).toBe(true);
    expect(draftDropped(s, 'mira', 'new')).toBe(false);
    expect(readDraft(s, 'mira', 'old')).toBeNull();
  });

  test('the same key is not a drop; no draft is not a drop', () => {
    const s = memory();
    expect(draftDropped(s, 'mira', 'k1')).toBe(false);
    writeDraft(s, 'mira', 'k1', draft);
    expect(draftDropped(s, 'mira', 'k1')).toBe(false);
    expect(readDraft(s, 'mira', 'k1')).toEqual(draft);
  });

  test('an unreadable entry is no draft', () => {
    const s = memory();
    s.setItem('pandafit.plandraft.mira', '{not json');
    expect(readDraft(s, 'mira', 'k1')).toBeNull();
    s.setItem('pandafit.plandraft.mira', JSON.stringify({ planKey: 'k1', workout: { exercises: 'x' } }));
    expect(readDraft(s, 'mira', 'k1')).toBeNull();
  });

  test('a throwing storage never throws: null and false', () => {
    expect(readDraft(throwing, 'mira', 'k1')).toBeNull();
    expect(writeDraft(throwing, 'mira', 'k1', draft)).toBe(false);
    expect(draftDropped(throwing, 'mira', 'k1')).toBe(false);
    expect(() => clearDraft(throwing, 'mira')).not.toThrow();
  });
});

describe('starting from a draft', () => {
  test('new id and start time, no set done, no rest, the edits kept', () => {
    const w = startFromDraft(draft, 1000, 'fresh');
    expect(w.id).toBe('fresh');
    expect(w.startMs).toBe(1000);
    expect(w.endMs).toBeNull();
    expect(w.rest).toBeNull();
    expect(w.exercises[0]!.sets.map((s) => s.doneMs)).toEqual([null, null]);
    expect(w.exercises[0]!.sets.map((s) => [s.weightKg, s.reps])).toEqual([[62.5, 6], [62.5, 6]]);
    expect(w.studio).toBe('Alpha');
    expect(w.title).toBe('Pull');
    expect(draft.exercises[0]!.sets[0]!.doneMs).toBe(99); // the draft itself is untouched
  });
});
