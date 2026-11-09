// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TodayCard } from '../../src/tracking/ui/TodayCard';
import type { TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { runFp } from '../../src/shared/run';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 9).getTime(); // Wednesday
const plan = (sports: string[]): TrackedRecord => ({ kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false,
  body: { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days: weekDates('2026-11-02').map((date, i) => ({ date, sport: sports[i] ?? 'rest', hardness: 'moderate', fixed: false })) } });
const run = { date: '2026-11-04', kind: 'easy' as const, minutes: 35, hrCap: 150, counts: 'Zeit zählt.', note: null };
const runWeek: TrackedRecord = { kind: 'run', id: 'week-2026-11-02', updatedMs: 1, deleted: false, body: {
  type: 'week', week: '2026-11-02', announce: true, atMs: 1, phase: 1, source: 'rules', reason: 'Ruhig.', note: null, runs: [{ ...run, fp: runFp(run), done: null }], garmin: null,
} };

test('nothing without a plan for today', () => {
  const { container } = render(<TodayCard weekplans={[]} runs={[]} nowMs={NOW} gym={<p>Gym</p>} />);
  expect(container.textContent).toBe('');
});
test('a strength day shows the strength plan', () => {
  render(<TodayCard weekplans={[plan(['rest', 'rest', 'gym', 'bike'])]} runs={[]} nowMs={NOW} gym={<p>Oberkörper A</p>} />);
  expect(screen.getByRole('heading').textContent).toBe('Kraft, mittel');
  expect(screen.getByText('Oberkörper A')).toBeTruthy();
  expect(screen.queryByText(/Morgen/)).toBeNull();
});
test('a rest day hides the strength plan', () => {
  render(<TodayCard weekplans={[plan([])]} runs={[]} nowMs={NOW} gym={<p>Oberkörper A</p>} />);
  expect(screen.getByRole('heading').textContent).toBe('Ruhetag');
  expect(screen.queryByText('Oberkörper A')).toBeNull();
});
test('a run day is one line, "Laufen, 35 Min", with the button', () => {
  render(<TodayCard weekplans={[plan(['rest', 'rest', 'run'])]} runs={[runWeek]} nowMs={NOW} gym={null} onRun={() => {}} />);
  expect(screen.getByRole('heading').textContent).toBe('Laufen, 35 Min');
  expect(screen.queryByText(/^Lauf:/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Zum Laufen' })).toBeTruthy();
});

test('trained today, in the evening: one line, done', async () => {
  const { fakePort } = await import('./fake-port');
  const at = new Date(2026, 10, 4, 19).getTime();
  const w: TrackedRecord = { kind: 'workout', id: 'w1', updatedMs: 1, deleted: false, body: { id: 'w1', title: 'T', startMs: at - 3_600_000, endMs: at - 600_000, source: 'pandafit', exercises: [] } };
  const { port } = fakePort([w]);
  render(<TodayCard port={port} weekplans={[plan(['rest', 'rest', 'bike'])]} runs={[]} nowMs={at} gym={<p>Gym</p>} />);
  expect((await screen.findByRole('heading')).textContent).toBe('Du hast heute schon trainiert. Gut gemacht!');
});

test('without a plan the suggestion, the way to it and "Etwas anderes heute?" are one card; the sheet says what a time does', async () => {
  const { fakePort } = await import('./fake-port');
  const { port } = fakePort([]);
  const { container } = render(<TodayCard port={port} weekplans={[]} runs={[]} nowMs={NOW} gym={<button type="button">Zum Krafttraining</button>} />);
  await screen.findByRole('heading');
  expect(container.querySelectorAll('.card').length).toBe(1);
  expect(screen.getByRole('button', { name: 'Zum Krafttraining' })).toBeTruthy();
  expect(screen.getByText(/^Das passt heute als ruhiger Einstieg/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Etwas anderes heute?' }));
  expect(screen.getByText('Bo schlägt dir dann etwas für diese Zeit vor.')).toBeTruthy();
});
test('a rest day says it once', () => {
  render(<TodayCard weekplans={[plan([])]} runs={[]} nowMs={NOW} gym={null} />);
  expect(screen.getByText('Erholung gehört zum Training.')).toBeTruthy();
  expect(screen.queryByText(/^Ruhetag\./)).toBeNull();
});
