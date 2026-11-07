import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GymCoach } from '../../../src/coach/gym/gym-coach';
import type { HevyRoutines } from '../../../src/coach/gym/hevy-routines';
import { availableExercises, isRepBased } from '../../../src/coach/gym/history';
import { gymPublic } from '../../../src/coach/gym/public';
import { initialGymState } from '../../../src/coach/gym/state';
import type { ExerciseTemplate, GymWorkout } from '../../../src/coach/gym/types';
import type { StrengthWorkout } from '../../../src/coach/hevy';
import { RecordStore } from '../../../src/coach/tracking/store';
import { EXERCISES } from '../../../src/shared/exercises';
import type { LoggedWorkout, TrackedRecord } from '../../../src/shared/records';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 12);
const ID = 'p1';
const BENCH = 'pf-bench-press';
const ROW = 'pf-bent-over-row';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'own-history-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const logged = (id: string, daysAgo: number, exerciseId: string, kg: number, reps: number, source: 'pandafit' | 'hevy' = 'pandafit', finished = true): TrackedRecord => {
  const startMs = NOW - daysAgo * DAY;
  const body: LoggedWorkout = {
    id, title: 'Eigenes Training', startMs, endMs: finished ? startMs + 3_600_000 : null, source,
    exercises: [{ exerciseId, title: exerciseId, supersetId: null, notes: '', sets: [1, 2].map(() => ({ type: 'normal' as const, weightKg: kg, reps, durationS: null, doneMs: startMs + 60_000 })) }],
  };
  return { kind: 'workout', id, updatedMs: startMs, deleted: false, body };
};
const hevyWorkout = (id: string, daysAgo: number, templateId: string, kg: number, reps: number): StrengthWorkout => ({
  id, title: 'Hevy-Tag', startMs: NOW - daysAgo * DAY, durationS: 3600,
  exercises: [{ title: 'x', templateId, sets: 2, reps: 0, volumeKg: 0, workSets: [1, 2].map(() => ({ type: 'normal' as const, weightKg: kg, reps })) }],
});
const HEVY_BENCH: ExerciseTemplate = { id: 'hevy-bench-1', title: 'Bench Press (Barbell)', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'barbell' };
const HEVY_OTHER: ExerciseTemplate = { id: 'hevy-other-1', title: 'Some Odd Machine', type: 'weight_reps', primaryMuscle: 'lats', equipment: 'machine' };

function harness(opts: { hevy?: boolean; workouts?: StrengthWorkout[]; templates?: ExerciseTemplate[]; writer?: HevyRoutines | null; ride?: boolean } = {}) {
  const store = new RecordStore({ dir: path.join(tmp, 'tracking') });
  const h = {
    store, ready: true, hevy: opts.hevy ?? false, workouts: opts.workouts ?? [], templates: opts.templates ?? [], hevyCalls: 0, asked: [] as string[], ride: opts.ride ?? false,
    coach: null as unknown as GymCoach,
  };
  h.coach = new GymCoach({
    dir: path.join(tmp, 'gym'), nowMs: () => NOW, store, hevy: () => h.hevy,
    ask: async (i) => { h.asked.push(i.prompt); throw new Error('no ai'); },
    workouts: () => { h.hevyCalls += 1; return h.workouts; },
    templates: async () => { h.hevyCalls += 1; return h.templates; },
    refreshTemplates: async () => { h.hevyCalls += 1; return h.templates; },
    ready: () => (h.hevy ? h.ready : !h.ride),
    bike: () => ({ summaries: [], complaints: [] }),
    complaint: () => {},
    writer: () => opts.writer ?? null,
  });
  return h;
}

describe('own history', () => {
  it('a profile with neither sees no gym', () => {
    const h = harness();
    expect(h.coach.enabled(ID)).toBe(false);
    expect(gymPublic(h.coach.enabled(ID), h.coach.state(ID), false, true, { hevy: false, complaints: [], hasHistory: false })).toBeNull();
  });

  it('a finished own workout marks the coach dirty so the next tick plans again', () => {
    const h = harness();
    expect(h.coach.state(ID).dirty).toBe(false);
    h.coach.workoutFinished(ID);
    expect(h.coach.state(ID).dirty).toBe(true);
  });

  it('after enabling it plans from own exercises with no Hevy call', async () => {
    const h = harness();
    h.coach.start(ID);
    expect(h.coach.enabled(ID)).toBe(true);
    await h.coach.tick(ID);
    const next = h.coach.state(ID).next;
    expect(next?.workout.exercises.length).toBeGreaterThan(0);
    const own = new Set(EXERCISES.map((e) => e.id));
    expect(next?.workout.exercises.every((e) => own.has(e.templateId))).toBe(true);
    expect(h.hevyCalls).toBe(0);
    expect(h.coach.state(ID).localStart).toBe(true);
  });

  it('an own workout changes the next suggestion', async () => {
    const h = harness();
    h.store.putMany(ID, [logged('a', 14, BENCH, 40, 8), logged('b', 7, BENCH, 40, 8)]);
    expect(h.coach.enabled(ID)).toBe(true);
    await h.coach.tick(ID);
    const e = h.coach.state(ID).next?.workout.exercises.find((x) => x.templateId === BENCH);
    const work = e?.sets.filter((s) => s.type !== 'warmup');
    expect(work?.[0].weightKg).toBe(40);
    expect(work?.[0].reps).toBe(9);
  });

  it('an unconfirmed set of an own workout does not count', async () => {
    const h = harness();
    const r = logged('a', 3, BENCH, 80, 8);
    (r.body as LoggedWorkout).exercises[0].sets.forEach((s) => { s.doneMs = null; });
    h.store.putMany(ID, [r]);
    await h.coach.tick(ID);
    expect(h.coach.state(ID).next?.workout.exercises.find((x) => x.templateId === BENCH)?.sets[0].weightKg ?? null).toBeNull();
  });

  it('with Hevy the merged history is used', async () => {
    const h = harness({ hevy: true, templates: [HEVY_BENCH, HEVY_OTHER], workouts: [hevyWorkout('h1', 14, 'hevy-bench-1', 50, 8), hevyWorkout('h2', 7, 'hevy-bench-1', 50, 8)] });
    h.store.putMany(ID, [logged('own', 2, BENCH, 52.5, 8)]);
    await h.coach.tick(ID);
    // Hevy and own bench press are one exercise under the own id, and the newer own session leads.
    const merged = h.coach.history(ID);
    expect(merged.map((w) => w.id)).toEqual(['h1', 'h2', 'own']);
    expect(merged.every((w) => w.exercises.every((e) => e.templateId === BENCH))).toBe(true);
    expect(availableExercises(merged, NOW)).toHaveLength(1);
    const e = h.coach.state(ID).next?.workout.exercises.find((x) => x.templateId === BENCH);
    const work = e?.sets.filter((s) => s.type !== 'warmup');
    expect(work?.[0].weightKg).toBe(52.5);
    // A linked exercise appears once; an unlinked Hevy one under its Hevy id.
    const list = await h.coach.templateList(ID);
    expect(list.filter((t) => t.id === BENCH || t.id === 'hevy-bench-1')).toHaveLength(1);
    expect(list.find((t) => t.id === 'hevy-other-1')?.title).toBe('Some Odd Machine');
    expect(h.coach.knowsTemplates(ID)).toBe(true);
    expect(h.coach.knowsTemplates('someone-else')).toBe(false);
    // The muscles of the list are remembered, also for a Hevy id that is linked to an own exercise.
    expect(h.coach.templateMuscle(ID, 'hevy-other-1')).toBe(list.find((t) => t.id === 'hevy-other-1')?.primaryMuscle);
    expect(h.coach.templateMuscle(ID, BENCH)).toBe('chest');
    expect(h.coach.templateMuscle(ID, 'unknown-id')).toBeNull();
  });

  it('"Nach Hevy" is not offered without Hevy', async () => {
    const h = harness();
    h.coach.start(ID);
    await h.coach.tick(ID);
    const g = gymPublic(h.coach.enabled(ID), h.coach.state(ID), false, true, { hevy: h.coach.isHevy(ID), complaints: [], hasHistory: h.coach.hasHistory(ID) });
    expect(g?.hevy).toBe(false);
    expect(await h.coach.preview(ID)).toBeNull();
    expect(await h.coach.confirm(ID, 'x')).toBe('failed');
    expect(h.hevyCalls).toBe(0);
  });

  it('removing Hevy keeps own workouts and imported ones', async () => {
    const h = harness({ hevy: true, templates: [HEVY_BENCH], workouts: [hevyWorkout('h1', 14, 'hevy-bench-1', 50, 8), hevyWorkout('h2', 7, 'hevy-bench-1', 50, 8)] });
    h.store.putMany(ID, [logged('own', 2, BENCH, 52.5, 8)]);
    h.coach.importHevy(ID);
    await h.coach.tick(ID); // learns the links
    const imported = h.store.all(ID, 'workout').filter((r) => (r.body as LoggedWorkout).source === 'hevy');
    expect(imported.map((r) => r.id).sort()).toEqual(['h1', 'h2']);
    h.hevy = false;
    h.workouts = [];
    h.templates = [];
    expect(h.coach.enabled(ID)).toBe(true);
    const merged = h.coach.history(ID);
    expect(merged.map((w) => w.id)).toEqual(['h1', 'h2', 'own']);
    expect(merged.every((w) => w.exercises[0].templateId === BENCH)).toBe(true);
  });

  it('importing Hevy workouts again does not raise the cursor', () => {
    const h = harness({ hevy: true, workouts: [hevyWorkout('h1', 14, 'hevy-bench-1', 50, 8)] });
    h.coach.importHevy(ID);
    const cursor = h.store.changedSince(ID, 0).cursor;
    h.coach.importHevy(ID);
    expect(h.store.changedSince(ID, 0).cursor).toBe(cursor);
    const r = h.store.all(ID, 'workout')[0];
    expect(r.updatedMs).toBe(NOW - 14 * DAY + 3_600_000);
  });

  it('a Hevy export leaves out an exercise without a Hevy id and the preview says so', async () => {
    const calls: GymWorkout[] = [];
    const writer = {
      editedSince: async () => false,
      writeRoutine: async (w: GymWorkout) => { calls.push(w); return { routineId: 'r1', updatedAt: 'u' }; },
    } as unknown as HevyRoutines;
    const h = harness({ hevy: true, writer, templates: [HEVY_BENCH], workouts: [hevyWorkout('h1', 14, 'hevy-bench-1', 50, 8)] });
    h.store.putMany(ID, [logged('o1', 3, BENCH, 40, 8), logged('o2', 5, 'pf-ab-wheel', 0, 10)]);
    await h.coach.tick(ID);
    const state = h.coach.state(ID);
    state.next = { source: 'rules', reason: 'r', workout: { name: 'T', exercises: [BENCH, 'pf-ab-wheel'].map((t) => ({ templateId: t, title: t === BENCH ? 'Bankdrücken' : 'Bauchroller', restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: null, reps: 8 }] })) } };
    const p = await h.coach.preview(ID);
    expect(p?.workout.exercises.map((e) => e.templateId)).toEqual(['hevy-bench-1']);
    expect(p?.leftOut).toEqual(['Bauchroller']);
    expect(await h.coach.confirm(ID, 'T')).toBe('written');
    expect(calls[0].exercises.map((e) => e.templateId)).toEqual(['hevy-bench-1']);
  });

  it('writes nothing when every exercise would be left out', async () => {
    const calls: GymWorkout[] = [];
    const writer = { editedSince: async () => false, writeRoutine: async (w: GymWorkout) => { calls.push(w); return { routineId: 'r', updatedAt: 'u' }; } } as unknown as HevyRoutines;
    const h = harness({ hevy: true, writer, templates: [] });
    h.coach.state(ID).next = { source: 'rules', reason: 'r', workout: { name: 'T', exercises: [{ templateId: 'pf-ab-wheel', title: 'Bauchroller', restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: 8 }] }] } };
    const p = await h.coach.preview(ID);
    expect(p?.workout.exercises).toEqual([]);
    expect(p?.leftOut).toEqual(['Bauchroller']);
    expect(await h.coach.confirm(ID, 'T')).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  it('a workout deleted in Hevy is gone from history after Hevy is removed', () => {
    const h = harness({ hevy: true, workouts: [hevyWorkout('h1', 14, 'x', 50, 8), hevyWorkout('h2', 7, 'x', 50, 8)] });
    h.coach.importHevy(ID);
    h.workouts = [hevyWorkout('h2', 7, 'x', 50, 8)];
    h.coach.importHevy(ID);
    const cursor = h.store.changedSince(ID, 0).cursor;
    h.coach.importHevy(ID);
    expect(h.store.changedSince(ID, 0).cursor).toBe(cursor);
    h.hevy = false;
    expect(h.coach.history(ID).map((w) => w.id)).toEqual(['h2']);
  });

  it('a workout back in the Hevy list after a tombstone is live again and stays so', () => {
    const h = harness({ hevy: true, workouts: [hevyWorkout('h1', 14, 'x', 50, 8)] });
    h.coach.importHevy(ID);
    h.workouts = [];
    h.coach.importHevy(ID);
    h.hevy = false;
    expect(h.coach.history(ID)).toEqual([]);
    h.hevy = true;
    h.workouts = [hevyWorkout('h1', 14, 'x', 50, 8)];
    h.coach.importHevy(ID);
    h.hevy = false;
    expect(h.coach.history(ID).map((w) => w.id)).toEqual(['h1']);
    const rec = h.store.all(ID, 'workout').find((r) => r.id === 'h1')!;
    expect(rec.deleted).toBe(false);
    expect(rec.updatedMs).toBe(NOW + 1);
    h.hevy = true;
    const cursor = h.store.changedSince(ID, 0).cursor;
    h.coach.importHevy(ID);
    expect(h.store.changedSince(ID, 0).cursor).toBe(cursor);
    // Only the tombstone and the live copy it replaced; the repeated import adds nothing.
    expect(h.store.overwritten(ID)).toHaveLength(2);
  });

  it('a person\'s delete of an imported workout stays deleted: no re-import revives it and no history counts it', () => {
    const h = harness({ hevy: true, workouts: [hevyWorkout('h1', 14, 'x', 50, 8), hevyWorkout('h2', 7, 'x', 50, 8)] });
    h.coach.importHevy(ID);
    const r = h.store.all(ID, 'workout').find((x) => x.id === 'h1')!;
    h.store.put(ID, { ...r, deleted: true, updatedMs: NOW + 5 });
    const cursor = h.store.changedSince(ID, 0).cursor;
    h.coach.importHevy(ID);
    h.coach.importHevy(ID);
    expect(h.store.all(ID, 'workout').find((x) => x.id === 'h1')!.deleted).toBe(true);
    expect(h.store.changedSince(ID, 0).cursor).toBe(cursor);
    expect(h.coach.history(ID).map((w) => w.id)).toEqual(['h2']);
    h.hevy = false;
    expect(h.coach.history(ID).map((w) => w.id)).toEqual(['h2']);
  });

  it('never tombstones while Hevy is loading', () => {
    const h = harness({ hevy: true, workouts: [hevyWorkout('h1', 14, 'x', 50, 8)] });
    h.coach.importHevy(ID);
    h.ready = false;
    h.workouts = [];
    h.coach.importHevy(ID);
    h.hevy = false;
    expect(h.coach.history(ID).map((w) => w.id)).toEqual(['h1']);
  });

  it('links are merged, never shrunk by an empty template list', async () => {
    const h = harness({ hevy: true, templates: [HEVY_BENCH], workouts: [hevyWorkout('h1', 14, 'hevy-bench-1', 50, 8)] });
    await h.coach.templateList(ID);
    h.templates = [];
    await h.coach.templateList(ID);
    expect(h.coach.state(ID).links).toEqual({ 'hevy-bench-1': BENCH });
  });

  it('with no history at all the AI is not asked', async () => {
    const h = harness();
    h.coach.start(ID);
    await h.coach.tick(ID);
    expect(h.asked).toHaveLength(0);
    expect(h.coach.state(ID).lastError).toBeNull();
    expect(h.coach.state(ID).next?.source).toBe('rules');
    h.store.putMany(ID, [logged('a', 3, BENCH, 40, 8)]);
    h.coach.state(ID).dirty = true;
    await h.coach.tick(ID);
    expect(h.asked).toHaveLength(1);
  });

  it('a profile that becomes ready imports its Hevy workouts once', async () => {
    const h = harness({ hevy: true, workouts: [hevyWorkout('h1', 14, 'x', 50, 8)] });
    await h.coach.tick(ID);
    expect(h.store.all(ID, 'workout').map((r) => r.id)).toEqual(['h1']);
    const cursor = h.store.changedSince(ID, 0).cursor;
    await h.coach.tick(ID);
    expect(h.store.changedSince(ID, 0).cursor).toBe(cursor);
  });

  it('isRepBased accepts the real Hevy rep types and no timed ones', () => {
    const t = (type: string): ExerciseTemplate => ({ id: 'x', title: 'x', type, primaryMuscle: '', equipment: '' });
    for (const ok of ['weight_reps', 'reps_only', 'bodyweight_reps', 'bodyweight_weighted', 'bodyweight_assisted']) expect(isRepBased(t(ok))).toBe(true);
    for (const no of ['duration', 'weight_duration', 'distance_duration', 'short_distance_weight']) expect(isRepBased(t(no))).toBe(false);
    void initialGymState; void ROW;
  });
});
