// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { TodayCard } from '../../src/tracking/ui/TodayCard';
import type { TrackedRecord } from '../../src/shared/records';
import { frameRecord } from '../../src/shared/frame';
import { weekDates } from '../../src/shared/week-plan';
import { fakePort } from './fake-port';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 18).getTime(); // Wednesday
const env = { now: () => NOW, newId: () => 'id' };
const plan = (sports: string[]): TrackedRecord => ({ kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false,
  body: { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days: weekDates('2026-11-02').map((date, i) => ({ date, sport: sports[i] ?? 'rest', hardness: 'moderate', fixed: false })) } });
const frames = (m: Map<string, TrackedRecord>) => [...m.values()].filter((r) => r.kind === 'frame');
const frameBody = (m: Map<string, TrackedRecord>) => frames(m)[0]!.body;

test('the planning and time rows in the goal sheet write the frame, stamped above a stored one', async () => {
  const stored = { ...frameRecord({ mode: 'week', minutes: null }, NOW + 5000), updatedMs: NOW + 9000 };
  const { port, map } = fakePort([stored]);
  render(<CoachScreen port={port} {...env} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Mein Ziel/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^Planung/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Spontan' }));
  await waitFor(() => expect(frameBody(map)).toMatchObject({ mode: 'spontaneous', minutes: null }));
  expect(frames(map)[0]!.updatedMs).toBeGreaterThan(NOW + 9000);
  fireEvent.click(screen.getByRole('button', { name: /^Zeit pro Einheit/ }));
  fireEvent.click(await screen.findByRole('button', { name: '45 Min' }));
  await waitFor(() => expect(frameBody(map)).toMatchObject({ mode: 'spontaneous', minutes: 45 }));
});

test('spontaneous mode shows the advice instead of the week', async () => {
  const { port } = fakePort([plan(['gym', 'bike', 'run']), frameRecord({ mode: 'spontaneous', minutes: null }, 1)]);
  render(<CoachScreen port={port} {...env} />);
  expect(await screen.findByRole('heading', { name: /^Heute: .* – weil / })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Wochenplan diese Woche' })).toBeNull();
});

test('spontaneous mode lists Monday to today without any plan', async () => {
  const { port } = fakePort([plan(['gym', 'bike', 'run', 'gym', 'bike']), frameRecord({ mode: 'spontaneous', minutes: null }, 1)]);
  render(<CoachScreen port={port} {...env} />);
  const week = await screen.findByRole('list', { name: 'Diese Woche' });
  const items = within(week).getAllByRole('listitem');
  expect(items.map((li) => li.textContent)).toEqual(['Montag', 'Dienstag', 'Mittwoch']);
  expect(items).toHaveLength(3);
  expect(week.textContent).not.toMatch(/Kraft|Rad|Laufen/);
});

test('"Heute nur" writes frame.today for today only', async () => {
  const { port, map } = fakePort([plan(['gym', 'bike', 'run'])]);
  render(<TodayCard port={port} weekplans={[plan(['gym', 'bike', 'run'])]} runs={[]} nowMs={NOW} gym={null} />);
  expect(screen.queryByRole('group', { name: 'Heute nur' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: /^Anders heute/ }));
  expect(screen.getByRole('dialog', { name: 'Anders heute?' })).toBeTruthy(); // a small sheet, and no line about tomorrow
  expect(screen.queryByText(/Morgen/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '30 Min' }));
  await waitFor(() => expect(frameBody(map)).toMatchObject({ mode: 'week', today: { date: '2026-11-04', minutes: 30 } }));
});

test('the start screen without a plan shows the advice with its reason', async () => {
  const { port } = fakePort([]);
  render(<TodayCard port={port} weekplans={[]} runs={[]} nowMs={NOW} gym={null} />);
  expect(await screen.findByRole('heading')).toBeTruthy();
  expect(screen.getByText(/^weil /)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Anders heute/ }));
  expect(screen.getByRole('group', { name: 'Heute nur' })).toBeTruthy();
});

test('week mode: the plan day is the headline when it fits; when it does not, the advice is, with the plan in one muted line', async () => {
  const legs = { kind: 'workout', id: 'w', updatedMs: 1, deleted: false, body: { id: 'w', title: 'Beine', startMs: NOW - 86_400_000, endMs: NOW - 86_400_000 + 3_600_000, source: 'pandafit', exercises: [{ exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [] }] } } as TrackedRecord;
  const fits = fakePort([plan(['rest', 'rest', 'bike'])]);
  render(<TodayCard port={fits.port} weekplans={[plan(['rest', 'rest', 'bike'])]} runs={[]} nowMs={NOW} gym={null} />);
  expect((await screen.findByRole('heading')).textContent).toBe('Rad, mittel');
  expect(screen.queryByText(/Geplant war/)).toBeNull();
  cleanup();
  const { port } = fakePort([plan(['rest', 'rest', 'gym']), legs]);
  render(<TodayCard port={port} weekplans={[plan(['rest', 'rest', 'gym'])]} runs={[]} nowMs={NOW} gym={<button type="button">Zum Krafttraining</button>} />);
  await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Kraft ohne Beine'));
  expect(screen.getByText(/^weil deine Beine gestern/)).toBeTruthy();
  expect(screen.getByText('Geplant war: Kraft, mittel')).toBeTruthy();
  expect(screen.getByText('Zum Krafttraining')).toBeTruthy();
  expect(screen.queryByText(/Heute passt/)).toBeNull();
});
