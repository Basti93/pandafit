// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { RunScreen } from '../../src/tracking/ui/RunScreen';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { runFp, type RunStatusBody } from '../../src/shared/run';
import { fakePort } from './fake-port';

afterEach(() => { cleanup(); localStorage.clear(); });

const set = (weightKg: number | null, reps: number | null, doneMs: number | null) => ({ type: 'normal' as const, weightKg, reps, durationS: null, doneMs });
const open: LoggedWorkout = { id: 'o1', title: 'Beine', startMs: 1000, endMs: null, source: 'pandafit', exercises: [{ exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [set(80, 5, 2000), set(80, 5, 3000)] }] };
const wrec = (w: LoggedWorkout): TrackedRecord => ({ kind: 'workout', id: w.id, updatedMs: 1, deleted: false, body: w });
const stats = (next: object[]): TrackedRecord => ({ kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body: { type: 'stats', atMs: 1, goal: null, days: [], muscles: {}, next } });
const ids = { newId: () => 'new', now: () => 100_000 };

async function finish(seed: TrackedRecord[]) {
  const r = fakePort([wrec(open), ...seed]);
  render(<WorkoutScreen port={r.port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Training beenden' }));
  return r;
}

test('after the finish the summary lists the next step per exercise, and Fertig dismisses it for good', async () => {
  const next = { exerciseId: 'pf-squat', title: 'Kniebeuge', weightKg: 82.5, reps: 5, why: 'progress', reason: 'weil du alle Wiederholungen geschafft hast', forWorkoutId: 'o1', atMs: 1000 };
  await finish([stats([next])]);
  expect((await screen.findByText(/Gut gemacht · 1 Übung · 2 Min/))).toBeTruthy();
  expect(screen.getByText(/Kniebeuge · Nächstes Mal: 82,5 kg × 5 – weil du alle/).className).toContain('muted');
  fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
  expect(screen.queryByRole('region', { name: 'Zusammenfassung' })).toBeNull();
  expect(localStorage.getItem('pandafit-summary-pending')).toBeNull();
});

test('before the publish the summary shows no placeholder, and a reload still shows it', async () => {
  const { port } = await finish([]);
  expect(await screen.findByText(/^Gut gemacht · 1 Übung/)).toBeTruthy();
  expect(screen.queryByText(/nach der Auswertung/)).toBeNull();
  cleanup();
  render(<WorkoutScreen port={port} {...ids} />);
  expect(await screen.findByText(/^Gut gemacht · 1 Übung/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
  cleanup();
  render(<WorkoutScreen port={port} {...ids} />);
  await screen.findByRole('button', { name: /^(Anderes Training|Leeres Training starten)$/ });
  expect(screen.queryByRole('region', { name: 'Zusammenfassung' })).toBeNull();
});

// ---- feel ----
const NOW = new Date(2026, 10, 4, 10, 0).getTime();
const status = (date: string): TrackedRecord => ({ kind: 'run', id: 'status', updatedMs: 1, deleted: false, body: {
  type: 'status', atMs: 1, on: true, suggest: false, needsAnswers: false, garmin: false, suggestedDays: [1], hrCap: null, complaint: null,
  numbers: { easyPace: { now: null, weeks4: null, weeks12: null, trend: [] }, weeks: [], longest: { blockKm: null, lastBlockKm: null }, tests: [] },
  card: { runId: 'g1', date, kind: 'easy', counted: 'c', result: 'r', sentence: 's' },
} satisfies RunStatusBody });
void runFp;

test('the run question is answered once, thanks, and then gone', async () => {
  const { port, state } = fakePort([status('2026-11-03')]);
  render(<RunScreen port={port} now={() => NOW} newId={() => 'u'} />);
  expect(await screen.findByText(/Wie war er\?/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'schwer' }));
  await waitFor(() => expect(state.puts.filter((p) => p.id === 'run-feel-g1')).toHaveLength(1));
  expect(state.puts.find((p) => p.id === 'run-feel-g1')!.body).toMatchObject({ type: 'feel', runId: 'g1', feel: 'hard', atMs: NOW });
  expect(await screen.findByText(/Danke – das fließt in den nächsten Laufplan ein/)).toBeTruthy();
  expect(screen.queryByText(/Wie war der Lauf/)).toBeNull();
});

test('skipping writes a null feel and asks no more; an old run is not asked about', async () => {
  const a = fakePort([status('2026-11-03')]);
  render(<RunScreen port={a.port} now={() => NOW} newId={() => 'u'} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Überspringen' }));
  await waitFor(() => expect(a.state.puts.find((p) => p.id === 'run-feel-g1')!.body).toMatchObject({ feel: null }));
  expect(screen.queryByText(/Wie war der Lauf/)).toBeNull();
  expect(screen.queryByText(/Danke/)).toBeNull();
  cleanup();
  const b = fakePort([status('2026-10-25')]);
  render(<RunScreen port={b.port} now={() => NOW} newId={() => 'u'} />);
  await waitFor(() => expect(document.querySelector('.tk-run')).toBeTruthy());
  expect(screen.queryByText(/Wie war der Lauf/)).toBeNull();
});
