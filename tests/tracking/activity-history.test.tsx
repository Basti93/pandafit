// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ActivityItem } from '../../src/shared/activities';
import type { TrackedRecord } from '../../src/shared/records';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { ActivityHistory } from '../../src/tracking/ui/ActivityHistory';
import { fakePort } from './fake-port';

afterEach(cleanup);
const NOW = new Date(2026, 10, 6, 18).getTime();
const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
const item = (p: Partial<ActivityItem> & { key: string; startMs: number }): ActivityItem =>
  ({ kind: 'lauf', title: null, sport: 'running', minutes: 40, distanceM: 6200, avgHr: 151, ref: null, ...p });
const activities = (items: ActivityItem[]): TrackedRecord => ({ kind: 'activities', id: 'activities', updatedMs: 1, deleted: false, body: { type: 'activities', atMs: 1, items } });
const workout: TrackedRecord = { kind: 'workout', id: 'w1', updatedMs: 1, deleted: false, body: { id: 'w1', title: 'Oberkörper', startMs: at(6, 9), endMs: at(6, 10), source: 'pandafit', exercises: [] } };
const seed = [
  activities([item({ key: 'garmin-1', startMs: at(4, 8) }), item({ key: 'garmin-2', kind: 'andere', sport: 'yoga', startMs: at(2, 7), minutes: 30, distanceM: null, avgHr: null })]),
  workout,
];

test('the list shows run, yoga and Kraft, newest first', async () => {
  const { port } = fakePort(seed);
  render(<ActivityHistory port={port} now={() => NOW} onClose={() => {}} />);
  const rows = await screen.findAllByRole('button', { name: /Kraft|Lauf|Yoga/ });
  expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/^Kraft Oberkörper/), expect.stringMatching(/^Lauf 6,2 km/), expect.stringMatching(/^Yoga 30 Min/)]);
});

test('empty history says so', async () => {
  const { port } = fakePort();
  render(<ActivityHistory port={port} now={() => NOW} onClose={() => {}} />);
  expect(await screen.findByText('Hier erscheinen deine Aktivitäten.')).toBeTruthy();
});

test('a Garmin run opens a small sheet with distance and pulse', async () => {
  const { port } = fakePort(seed);
  render(<ActivityHistory port={port} now={() => NOW} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Lauf 6,2 km/ }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Lauf 6,2 km' }));
  expect(sheet.getByText('40 Min · 6,2 km · Ø Puls 151')).toBeTruthy();
});

test('a Kraft entry opens the workout detail; one without local record falls back to the small sheet', async () => {
  const hevy = item({ key: 'kraft-h9', kind: 'kraft', sport: 'strength', title: 'Beine', startMs: at(1, 9), ref: 'h9', distanceM: null, avgHr: null });
  const { port } = fakePort([activities([hevy]), workout]);
  render(<ActivityHistory port={port} now={() => NOW} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Kraft Oberkörper/ }));
  expect(await screen.findByRole('heading', { name: 'Oberkörper' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Kraft Beine/ }));
  expect(await screen.findByRole('dialog', { name: 'Kraft Beine' })).toBeTruthy();
});

test('the row Verlauf on the week page shows the newest activity and opens the list', async () => {
  const { port } = fakePort(seed);
  render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
  const row = await screen.findByRole('button', { name: /^Verlauf/ });
  await screen.findByText(/^\S\S · Kraft Oberkörper$/, { selector: '.tk-ellipsis' });
  fireEvent.click(row);
  expect(await screen.findByRole('dialog', { name: 'Verlauf' })).toBeTruthy();
});

test('inside the Verlauf sheet an exercise has one "‹ Zurück", and it steps back one level', async () => {
  const ex = { rid: 'e1', exerciseId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [{ rid: 's1', type: 'normal', weightKg: 60, reps: 8, doneMs: at(6, 9) }] };
  const w: TrackedRecord = { ...workout, body: { ...(workout.body as object), exercises: [ex] } };
  const { port } = fakePort([w]);
  render(<ActivityHistory port={port} now={() => NOW} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Kraft Oberkörper/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Bankdrücken/ }));
  expect(await screen.findByRole('heading', { name: 'Bankdrücken' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '‹ Zurück' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(await screen.findByRole('heading', { name: 'Oberkörper' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '‹ Zurück' })).toHaveLength(1);
});
