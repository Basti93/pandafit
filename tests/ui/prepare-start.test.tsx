// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GymWorkout } from '../../src/shared/gym/types';
import { EXERCISES } from '../../src/shared/exercises';
import { ruleRecord } from '../../src/shared/personal';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { studioStateOf } from '../../src/shared/studio';
import { stepChange } from '../../src/tracking/steps';
import { hereKey } from '../../src/tracking/session';
import { prepareStart, WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from '../tracking/fake-port';

afterEach(cleanup);

const NOW = 50 * 86_400_000;
const done = (kg: number) => ({ type: 'normal' as const, weightKg: kg, reps: 8, durationS: null, doneMs: 1 });
const past = (id: string, startMs: number, kg: number[]): LoggedWorkout => ({
  id, title: 'Beine', startMs, endMs: startMs + 3_600_000, source: 'pandafit', studio: 'Alpha',
  exercises: [
    { exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: kg.map(done) },
    { exerciseId: 'pf-leg-press', title: 'Beinpresse', supersetId: null, notes: '', sets: [done(100), done(110)] },
  ],
});
const wrec = (w: LoggedWorkout): TrackedRecord => ({ kind: 'workout', id: w.id, updatedMs: 1, deleted: false, body: w });
const set = (weightKg: number | null) => ({ type: 'normal' as const, weightKg, reps: 8 });
const plan: GymWorkout = { name: 'Beine A', studio: 'Alpha', exercises: [
  { templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [set(null), set(null), set(null)] },
  { templateId: 'pf-leg-press', title: 'Beinpresse', restS: null, supersetId: null, notes: '', sets: [set(null), set(null)] },
  { templateId: 'pf-deadlift', title: 'Kreuzheben', restS: null, supersetId: null, notes: '', sets: [set(80)] },
] };

test('prepareStart returns exactly the workout the start begins (history, studio, load step, excluded exercise)', async () => {
  const history = [past('p1', NOW - 9 * 86_400_000, [55, 57.5]), past('p2', NOW - 2 * 86_400_000, [57.5, 60, 61])];
  const key = hereKey({ studio: 'Alpha' }, history, studioStateOf([]));
  const seed = [
    ...history.map(wrec),
    stepChange([], 'pf-squat', key, 5, NOW - 1000),
    ruleRecord('r1', { kind: 'exclude', text: 'Ohne Kreuzheben', sport: 'gym', exerciseIds: ['pf-deadlift'] }, 'active', 'person', NOW - 1000),
  ];
  const ids = { now: () => NOW, newId: () => 'new-id' };
  const prepared = await prepareStart(fakePort(seed).port, plan, { ...ids, catalog: EXERCISES, studio: 'Alpha', studios: studioStateOf([]) });

  const f = fakePort(seed);
  render(<WorkoutScreen port={f.port} plan={plan} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Beine A starten' }));
  await waitFor(() => expect(f.state.puts.some((r) => r.kind === 'workout' && r.id === 'new-id')).toBe(true));
  const begun = f.state.puts.find((r) => r.kind === 'workout' && r.id === 'new-id')!.body as LoggedWorkout;

  expect(prepared.workout.exercises.map((e) => e.exerciseId)).toEqual(['pf-squat', 'pf-leg-press']); // the rule drops Kreuzheben
  expect(prepared.workout.studio).toBe('Alpha');
  expect(prepared.workout.exercises[0]!.sets.some((s) => s.weightKg !== null)).toBe(true); // prefilled from the history
  expect(prepared.notice).toContain('Ohne Kreuzheben');
  const strip = (w: unknown) => JSON.parse(JSON.stringify(w, (k, v) => (k === 'rid' ? undefined : v)));
  const { updatedMs: _u, baseMs: _b, ancestors: _a, ...body } = begun as LoggedWorkout & { updatedMs?: number };
  expect(strip(body)).toEqual(strip(prepared.workout));
  await screen.findByText(/Ohne Kreuzheben/); // the same notice on the running screen
});

test('a failed load step or change read keeps the history: the weights still come from it', async () => {
  const history = [past('p1', NOW - 9 * 86_400_000, [55, 57.5]), past('p2', NOW - 2 * 86_400_000, [57.5, 60, 61])];
  const ctx = { now: () => NOW, newId: () => 'new-id', catalog: EXERCISES, studio: 'Alpha', studios: studioStateOf([]) };
  const good = await prepareStart(fakePort(history.map(wrec)).port, plan, ctx);
  for (const failing of ['loadstep', 'change'] as const) {
    const f = fakePort(history.map(wrec));
    const list = f.port.list;
    f.port.list = async (kind) => { if (kind === failing) throw new Error('read'); return list(kind); };
    const got = await prepareStart(f.port, plan, ctx);
    const kg = (w: typeof got.workout) => w.exercises.map((e) => e.sets.map((s) => s.weightKg));
    expect(kg(got.workout)).toEqual(kg(good.workout));
    expect(got.workout.exercises[0]!.sets.some((s) => s.weightKg !== null)).toBe(true);
  }
});
