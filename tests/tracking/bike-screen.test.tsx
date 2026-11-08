// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { BikeScreen } from '../../src/tracking/ui/BikeScreen';
import { fakePort } from './fake-port';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 9).getTime(); // Wednesday
const bike: TrackedRecord = { kind: 'bike', id: 'bike', updatedMs: 1, deleted: false, body: {
  type: 'bike', atMs: 1, ftpW: 200, ftpHistory: [], phase: null, alternatives: [], weekHours: [],
  next: { name: 'Schwellen-Intervalle', minutes: 60, hardness: 'hard', reason: 'Gut erholt.', blocks: [] },
} };
const plan = (sports: string[]): TrackedRecord => ({ kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false,
  body: { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days: weekDates('2026-11-02').map((date, i) => ({ date, sport: sports[i] ?? 'rest', hardness: 'moderate', fixed: false })) } });

test('the next ride names its day and says it is ridden on the Mac', async () => {
  const { port } = fakePort([bike, plan(['rest', 'rest', 'rest', 'rest', 'rest', 'bike'])]);
  render(<BikeScreen port={port} now={() => NOW} />);
  expect(await screen.findByText('Sa., 7. Nov. · Fahren am Mac')).toBeTruthy();
});
test('a bike day today says Heute', async () => {
  const { port } = fakePort([bike, plan(['rest', 'rest', 'bike'])]);
  render(<BikeScreen port={port} now={() => NOW} />);
  expect(await screen.findByText('Heute · Fahren am Mac')).toBeTruthy();
});
