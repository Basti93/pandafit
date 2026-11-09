// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { BikeScreen } from '../../src/tracking/ui/BikeScreen';
import { blockBand, blockWatts, bikeTrendSentence } from '../../src/tracking/ui/bike-view';
import { fakePort } from './fake-port';

afterEach(cleanup);
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 9).getTime(); // Wednesday
const BLOCKS = [{ label: '10 Min locker', minutes: 10, pct: 55 }, { label: '3 × 8 Min bei 95 %, dazwischen 4 Min locker', minutes: 36, pct: 95 }];
const bikeRec = (over: object = {}, next: object | null = {}): TrackedRecord => ({ kind: 'bike', id: 'bike', updatedMs: 1, deleted: false, body: {
  type: 'bike', atMs: 1, ftpW: 200, ftpHistory: [], phase: { name: 'Aufbau', weeksLeft: 3, goal: 'Ausdauer aufbauen' }, alternatives: [], weekHours: [{ week: '2026-10-26', hours: 3 }],
  next: next === null ? null : { name: 'Intervalle', minutes: 60, hardness: 'hard', reason: 'Die Beine sind frisch.', blocks: BLOCKS, ...next }, ...over,
} });
const rideRec = (): TrackedRecord => ({ kind: 'ride', id: 'r1', updatedMs: NOW - DAY, deleted: false, body: {
  type: 'ride', startedAtMs: NOW - DAY, sessionName: 'Grundlage', durationS: 3120, hardness: 'easy', avgPowerW: 150, normalizedPowerW: 160, avgHrBpm: 130, maxHrBpm: 150, tss: 40, completedFraction: 1,
  debrief: 'Ruhig gefahren.', curve: [] } });
const plan = (sports: string[]): TrackedRecord => ({ kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false,
  body: { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days: weekDates('2026-11-02').map((date, i) => ({ date, sport: sports[i] ?? 'rest', hardness: 'moderate', fixed: false })) } });
const bikeFriday = plan(['rest', 'rest', 'rest', 'rest', 'bike']);

test('Rad shows the week stand, the next ride as the main card with the band, and Ablauf ansehen with watts only for the hard blocks', async () => {
  const { port } = fakePort([bikeRec(), bikeFriday]);
  render(<BikeScreen port={port} now={() => NOW} />);
  expect(await screen.findByRole('region', { name: 'Rad · diese Woche' })).toBeTruthy();
  const main = screen.getByRole('region', { name: 'Nächste Fahrt' });
  expect(main.textContent).toContain('Freitag, 6. November');
  expect(main.textContent).toContain('60 Minuten, hart. Du fährst sie in der Mac-App.');
  expect(within(main).getByLabelText(/^Ablauf: 10 Min locker/)).toBeTruthy();
  expect(document.querySelector('.tk-bo')!.textContent).toContain('Die Beine sind frisch.');
  fireEvent.click(within(main).getByRole('button', { name: 'Ablauf ansehen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Intervalle' });
  expect(sheet.textContent).toContain('etwa 190 W');
  expect(sheet.textContent).not.toContain('110 W');
  expect(sheet.textContent).not.toContain('(190 W)');
});

test('a bike day today says Heute', async () => {
  const { port } = fakePort([bikeRec(), plan(['rest', 'rest', 'bike'])]);
  render(<BikeScreen port={port} now={() => NOW} />);
  expect(await screen.findByText('Heute')).toBeTruthy();
});

test('without a next ride there is no empty main card', async () => {
  const { port } = fakePort([bikeRec({}, null), rideRec()]);
  render(<BikeScreen port={port} now={() => NOW} />);
  expect(await screen.findByRole('region', { name: 'Rad · diese Woche' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Nächste Fahrt' })).toBeNull();
  expect(screen.queryByText('Noch keine Fahrt geplant.')).toBeNull();
  expect(screen.getByRole('button', { name: /Deine Entwicklung/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Letzte Fahrt/ })).toBeTruthy();
});

test('a ride without blocks has no band and no Ablauf button', async () => {
  const { port } = fakePort([bikeRec({}, { blocks: [] })]);
  render(<BikeScreen port={port} now={() => NOW} />);
  const main = await screen.findByRole('region', { name: 'Nächste Fahrt' });
  expect(within(main).queryByRole('button', { name: 'Ablauf ansehen' })).toBeNull();
  expect(main.querySelector('.tk-band')).toBeNull();
});

test('Deine Entwicklung is one sentence without a number; the sheet keeps FTP, phase and hours', async () => {
  const hist = [{ atMs: NOW - 120 * DAY, ftpW: 190, source: 'manual' }, { atMs: NOW - DAY, ftpW: 200, source: 'coach' }];
  const { port } = fakePort([bikeRec({ ftpHistory: hist })]);
  render(<BikeScreen port={port} now={() => NOW} />);
  const row = await screen.findByRole('button', { name: /Deine Entwicklung/ });
  expect(row.textContent).toMatch(/Seit \w+ trittst du kräftiger\./);
  expect(row.textContent).not.toMatch(/\d/);
  fireEvent.click(row);
  const sheet = await screen.findByRole('dialog', { name: 'Entwicklung' });
  expect(sheet.textContent).toContain('FTP (Dauerleistung) 200 W');
  expect(sheet.textContent).toContain('Phase Aufbau');
  expect(within(sheet).getByRole('region', { name: 'Stunden pro Woche' })).toBeTruthy();
});

test('without a trend the row invites to look', async () => {
  const { port } = fakePort([bikeRec()]);
  render(<BikeScreen port={port} now={() => NOW} />);
  expect((await screen.findByRole('button', { name: /Deine Entwicklung/ })).textContent).toContain('Entwicklung ansehen');
});

test('the last ride is a row card that opens the ride sheet', async () => {
  const { port } = fakePort([bikeRec(), rideRec()]);
  render(<BikeScreen port={port} now={() => NOW} />);
  const row = await screen.findByRole('button', { name: /Letzte Fahrt/ });
  expect(row.textContent).toContain('Grundlage, 52 Minuten');
  fireEvent.click(row);
  expect(await screen.findByRole('dialog', { name: 'Grundlage' })).toBeTruthy();
});

describe('bike-view', () => {
  test('blockWatts only for hard blocks with pct and an FTP', () => {
    expect(blockWatts({ label: 'x', minutes: 8, pct: 95 }, 200)).toBe('etwa 190 W');
    expect(blockWatts({ label: 'x', minutes: 8, pct: 65 }, 200)).toBeNull();
    expect(blockWatts({ label: 'x', minutes: 8 }, 200)).toBeNull();
    expect(blockWatts({ label: 'x', minutes: 8, pct: 95 }, null)).toBeNull();
  });
  test('blockBand: grow = minutes, tall and fill from pct > 65', () => {
    expect(blockBand(BLOCKS)).toEqual([{ grow: 10, fill: 0, tall: false }, { grow: 36, fill: 1, tall: true }]);
  });
  test('bikeTrendSentence', () => {
    const b = (h: { atMs: number; ftpW: number }[]) => ({ ftpHistory: h.map((x) => ({ ...x, source: 's' })) }) as never;
    expect(bikeTrendSentence(b([{ atMs: NOW - 5 * DAY, ftpW: 200 }]))).toBeNull();
    expect(bikeTrendSentence(b([{ atMs: NOW - 60 * DAY, ftpW: 190 }, { atMs: NOW, ftpW: 200 }]))).toMatch(/^Seit \w+ trittst du kräftiger\.$/);
    expect(bikeTrendSentence(b([{ atMs: NOW - 60 * DAY, ftpW: 210 }, { atMs: NOW, ftpW: 200 }]))).toMatch(/ist deine Dauerleistung etwas gesunken\.$/);
    expect(bikeTrendSentence(b([{ atMs: NOW - 60 * DAY, ftpW: 200 }, { atMs: NOW, ftpW: 200 }]))).toMatch(/hältst du deine Dauerleistung\.$/);
  });
});
