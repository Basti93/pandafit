import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Coach } from '../../../src/coach/coach';
import { GymCoach } from '../../../src/coach/gym/gym-coach';
import type { StrengthWorkout } from '../../../src/coach/hevy';
import { handleRecords } from '../../../src/coach/tracking/records-api';
import { RecordStore } from '../../../src/coach/tracking/store';
import { mergedHealth, mergedStrength } from '../../../src/coach/tracking/strength-source';
import { strengthPromptData } from '../../../src/coach/strength';
import type { TrackedRecord } from '../../../src/shared/records';

const NOW = Date.UTC(2026, 10, 2, 12);
const ID = 'p1';
const START = NOW - 2 * 86_400_000;

const own = (endMs: number | null = START + 3_600_000): TrackedRecord => ({
  kind: 'workout', id: 'w1', updatedMs: START + 3_600_000, deleted: false,
  body: { id: 'w1', title: 'Beine', startMs: START, endMs, source: 'pandafit', exercises: [{ exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [1, 2].map(() => ({ type: 'normal', weightKg: 100, reps: 5, durationS: null, doneMs: START + 60_000 })) }] },
});
const hevySame: StrengthWorkout = {
  id: 'w1', title: 'Beine', startMs: START, durationS: 3600,
  exercises: [{ title: 'Kniebeuge', templateId: 'pf-squat', sets: 2, reps: 10, volumeKg: 1000, workSets: [1, 2].map(() => ({ type: 'normal' as const, weightKg: 100, reps: 5 })) }],
};

function world(o: { hevy?: StrengthWorkout[]; connected?: boolean } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-src-'));
  const store = new RecordStore({ dir: path.join(tmp, 'tracking') });
  const dirty: string[] = [];
  const connected = o.connected ?? false;
  const gym = new GymCoach({
    dir: path.join(tmp, 'gym'), nowMs: () => NOW, store, hevy: () => connected,
    ask: async () => { throw new Error('no ai'); }, workouts: () => o.hevy ?? [],
    templates: async () => [], refreshTemplates: async () => [], ready: () => true,
    bike: () => ({ summaries: [], complaints: [] }), complaint: () => {}, writer: () => null,
    onWorkoutFinished: (id) => { dirty.push(id); },
  });
  return { tmp, store, gym, dirty, strength: mergedStrength((id) => gym.history(id), () => o.hevy ?? []), health: mergedHealth({ history: (id) => gym.history(id), connected: () => connected, nowMs: () => NOW }) };
}
const put = (w: ReturnType<typeof world>, record: TrackedRecord) =>
  handleRecords({ store: w.store, gym: w.gym, profiles: () => [ID] }, { type: 'records-put', requestId: 'q', profileId: ID, record });

describe('bike coach and health page read the merged history', () => {
  it('own workouts without Hevy give the same strength data block as Hevy would', () => {
    const w = world();
    put(w, own());
    expect(strengthPromptData(w.strength(ID), NOW)).toEqual(strengthPromptData([hevySame], NOW));
    expect(w.health(ID)).not.toBeNull();
  });

  it('with neither account nor Hevy nor a workout: no block, no health card and no store file', () => {
    const w = world();
    expect(strengthPromptData(w.strength(ID), NOW)).toBeNull();
    expect(w.health(ID)).toBeNull();
    expect(fs.existsSync(path.join(w.tmp, 'tracking'))).toBe(false);
  });

  it('Hevy alone gives what it gave before, in the same order, and connected without workouts still has a health view', () => {
    const later = { ...hevySame, id: 'h2', startMs: START + 86_400_000 };
    const w = world({ hevy: [hevySame, later], connected: true });
    expect(w.strength(ID)).toEqual([hevySame, later]);
    expect(world({ connected: true }).health(ID)).not.toBeNull();
  });

  it('a failing store still leaves the Hevy list to the coach', () => {
    const s = mergedStrength(() => { throw new Error('disk'); }, () => [hevySame]);
    expect(s(ID)).toEqual([hevySame]);
  });

  it('a finished own workout marks the bike coach dirty once; an open one or an edit does not', () => {
    const w = world();
    put(w, own(null));
    expect(w.dirty).toEqual([]);
    put(w, { ...own(), updatedMs: START + 3_700_000 });
    expect(w.dirty).toEqual([ID]);
    put(w, { ...own(), updatedMs: START + 3_800_000, body: { ...(own().body as object), title: 'Anders' } });
    expect(w.dirty).toEqual([ID]);
  });

  it('marking dirty interrupts nothing: no planning call follows from it, ride or not', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-coach-'));
    const ask = vi.fn(async () => ({}));
    const coach = new Coach({ ridesDir: path.join(tmp, 'r'), coachDir: tmp, nowMs: () => NOW, ask });
    coach.scanRides([{ id: ID, name: 'A', ftpW: 200 }]);
    coach.strengthChanged(ID);
    expect(coach.state(ID).dirty).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('the coach runtime wires them, and leaves the ride process alone', () => {
    const main = fs.readFileSync(path.join(__dirname, '../../../src/coach/runtime/index.ts'), 'utf8');
    expect(main).toMatch(/strength: mergedStrength\(/);
    expect(main).toMatch(/mergedHealth\(/);
    expect(main).toMatch(/onWorkoutFinished: .*strengthChanged/);
  });
});
