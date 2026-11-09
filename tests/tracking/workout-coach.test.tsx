// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkoutCoach } from '../../src/tracking/ui/WorkoutCoach';
import { useState } from 'react';
import { takeChange, undoChange } from '../../src/tracking/workout-change';
import { confirmSet } from '../../src/tracking/session';
import { EXERCISES } from '../../src/shared/exercises';
import type { TrackedRecord } from '../../src/shared/records';
import type { TrackedWorkout } from '../../src/tracking/session';
import { fakePort } from './fake-port';

afterEach(cleanup);
const NOW = 1_000_000;
let n = 0;
const props = { catalog: EXERCISES, now: () => NOW, newId: () => `id${++n}` };
const w: TrackedWorkout = { id: 'w1', title: 'Oberkörper', startMs: NOW - 600_000, endMs: null, source: 'pandafit', rest: null, exercises: [
  { rid: 'e1', exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [{ rid: 's1', type: 'normal', weightKg: 60, reps: 8, durationS: null, doneMs: null }] },
] };
const chat = (id: string, body: object): TrackedRecord => ({ kind: 'chat', id, updatedMs: 1, deleted: false, body: { atMs: NOW - 1000, ...body } });
const all = (m: Map<string, TrackedRecord>) => [...m.values()].map((r) => r.body as Record<string, unknown>);

test('closed until asked; a message is sent for this workout and the coach is shown as thinking', async () => {
  const { port, map } = fakePort();
  render(<WorkoutCoach port={port} workout={w} {...props} onTake={() => {}} onUndo={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bo fragen' }));
  fireEvent.change(screen.getByLabelText('Nachricht an Bo im Training'), { target: { value: 'Bank belegt' } });
  fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
  await waitFor(() => expect(all(map)).toEqual([{ role: 'rider', text: 'Bank belegt', atMs: NOW, inWorkout: 'w1' }]));
  expect(await screen.findByRole('status')).toBeTruthy();
});

/** Like the screen: the workout lives in a store-like state; take and undo are one update of it. */
let current: TrackedWorkout;
function Harness({ port, initial }: { port: ReturnType<typeof fakePort>['port']; initial: TrackedWorkout }) {
  const [x, set] = useState(initial);
  const act = (f: (w: TrackedWorkout) => TrackedWorkout) => { current = f(current); set(current); };
  current = x;
  return <WorkoutCoach port={port} workout={x} {...props}
    onTake={(id, c) => act((y) => takeChange(y, id, c, [], EXERCISES, { renames: [], picks: [] } as never, NOW).workout)} onUndo={(id) => act((y) => undoChange(y, id).workout)} />;
}
const two: TrackedWorkout = { ...w, exercises: [{ ...w.exercises[0]!, sets: [
  { rid: 's1', type: 'normal', weightKg: 60, reps: 8, durationS: null, doneMs: 5 }, { rid: 's2', type: 'normal', weightKg: 60, reps: 8, durationS: null, doneMs: null }, { rid: 's3', type: 'normal', weightKg: 60, reps: 8, durationS: null, doneMs: null }] }] };
const seed = () => [
  chat('r1', { role: 'rider', text: 'Zu schwer', inWorkout: 'w1' }),
  chat('c1', { role: 'coach', text: 'Etwas leichter.', replyTo: 'r1', inWorkout: 'w1', workoutChange: { workoutId: 'w1', ops: [{ op: 'lighter', ex: 'e1', pct: 10 }] } }),
];

test('taking is one workout write; a new component from the stored workout shows it taken and cannot take again', async () => {
  const { port } = fakePort(seed());
  const first = render(<Harness port={port} initial={two} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  expect(current.changes).toHaveLength(1);
  expect(current.exercises[0]!.sets.map((s) => [s.weightKg, s.doneMs])).toEqual([[60, 5], [54, null], [54, null]]);
  first.unmount();
  const stored = current;
  render(<Harness port={port} initial={stored} />);
  expect(await screen.findByText('Übernommen.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Übernehmen' })).toBeNull();
  expect(takeChange(stored, 'c1:0', { workoutId: 'w1', ops: [{ op: 'lighter', ex: 'e1', pct: 10 }] }, [], EXERCISES, { renames: [], picks: [] } as never, NOW).workout).toBe(stored);
});

test('undo restores the rows; after a set was confirmed in them it is refused with the reason', async () => {
  const { port } = fakePort(seed());
  render(<Harness port={port} initial={two} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  expect(current).toEqual(two);
  expect(await screen.findByText('Du hast das rückgängig gemacht.')).toBeTruthy();
});

test('undo is refused when a set of that row was confirmed afterwards, and done sets are never touched', async () => {
  const { port } = fakePort(seed());
  render(<Harness port={port} initial={two} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  const e = current.exercises[0]!;
  const confirmed = confirmSet(current, e.rid, 's2', NOW + 10);
  cleanup();
  render(<Harness port={port} initial={confirmed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  expect(await screen.findByText('Das geht nicht, weil du in dieser Übung schon weitertrainiert hast.')).toBeTruthy();
  expect(current).toBe(confirmed);
  expect(current.exercises[0]!.sets[0]!.doneMs).toBe(5);
});

test('undo is refused when the rows were edited since', () => {
  const { workout } = takeChange(two, 'c1:0', { workoutId: 'w1', ops: [{ op: 'lighter', ex: 'e1', pct: 10 }] }, [], EXERCISES, { renames: [], picks: [] } as never, NOW);
  const edited = { ...workout, exercises: workout.exercises.map((x) => ({ ...x, sets: x.sets.map((s) => (s.rid === 's3' ? { ...s, reps: 12 } : s)) })) };
  const r = undoChange(edited, 'c1:0');
  expect(r.refusal).toBe('Das geht nicht, weil du sie inzwischen selbst geändert hast.');
  expect(r.workout).toBe(edited);
});

test('a take with an op that became invalid says why and changes nothing', async () => {
  const done = { ...two, exercises: [{ ...two.exercises[0]!, sets: two.exercises[0]!.sets.map((s) => ({ ...s, doneMs: 5 })) }] };
  const { port, map } = fakePort(seed());
  render(<Harness port={port} initial={done} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  expect(await screen.findByText('Nicht übernommen. Das geht nicht, weil der Satz schon erledigt ist.')).toBeTruthy();
  expect(current).toBe(done);
  await waitFor(() => expect(all(map).some((b) => b.declines === 'c1')).toBe(true));
  expect(all(map).some((b) => b.text === 'Übernommen.')).toBe(false);
});

test('a line from a take is gone after the next undo', async () => {
  const mixed = [seed()[0]!, chat('c1', { role: 'coach', text: 'Leichter und weg.', replyTo: 'r1', inWorkout: 'w1', workoutChange: { workoutId: 'w1', ops: [{ op: 'lighter', ex: 'e1', pct: 10 }, { op: 'drop', ex: 'gone' }] } })];
  const { port } = fakePort(mixed);
  render(<Harness port={port} initial={two} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  expect(await screen.findByText('Das geht nicht, weil die Übung nicht mehr da ist.')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  expect(await screen.findByText('Du hast das rückgängig gemacht.')).toBeTruthy();
  expect(screen.queryByText('Das geht nicht, weil die Übung nicht mehr da ist.')).toBeNull();
});
