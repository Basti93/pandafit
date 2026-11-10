// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { BlockLine } from '../../src/tracking/ui/BlockLine';
import { blockRecord, blockWeeks, type BlockBody } from '../../src/shared/block';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';

afterEach(cleanup);

const active: BlockBody = {
  state: 'active', atMs: 1, start: '2026-11-30', end: '2026-12-27',
  rhythm: [
    { sport: 'gym', hardness: 'hard', template: 0 }, { sport: 'bike', hardness: 'easy' }, { sport: 'gym', hardness: 'moderate', template: 1 },
    { sport: 'rest', hardness: 'easy' }, { sport: 'bike', hardness: 'hard' }, { sport: 'run', hardness: 'easy' }, { sport: 'rest', hardness: 'easy' },
  ],
  templates: [{ name: 'Oberkörper A', core: ['a', 'b', 'c'] }, { name: 'Unterkörper B', core: ['d', 'e', 'f'] }],
};
const NOW = new Date(2026, 11, 8, 12).getTime(); // Tuesday 2026-12-08
const weekplans = (): TrackedRecord[] => blockWeeks(active).map((w) => ({ kind: 'weekplan', id: w.weekStart, updatedMs: 1, deleted: false, body: { ...w, fromMessage: 'm', acceptedMs: 1 } }));

it('zeigt die Zeile des Abschnitts', async () => {
  const f = fakePort([blockRecord('block-m1', active, 1), ...weekplans()]);
  render(<BlockLine port={f.port} now={() => NOW} />);
  await screen.findByText('Woche 2 von 4 im festen Abschnitt. Als Nächstes kommt Unterkörper B am Mittwoch.');
});

it('zeigt ohne Abschnitt nichts', async () => {
  const f = fakePort([]);
  const { container } = render(<BlockLine port={f.port} now={() => NOW} />);
  await new Promise((r) => setTimeout(r, 20));
  expect(container.textContent).toBe('');
});

it('nennt nach der erledigten Einheit von heute den nächsten Krafttag', async () => {
  const monday = new Date(2026, 11, 7, 18).getTime();
  const done: TrackedRecord = { kind: 'workout', id: 'w1', updatedMs: 1, deleted: false, body: { startMs: new Date(2026, 11, 7, 9).getTime(), endMs: new Date(2026, 11, 7, 10).getTime(), exercises: [] } };
  const f = fakePort([blockRecord('block-m1', active, 1), ...weekplans(), done]);
  render(<BlockLine port={f.port} now={() => monday} />);
  await screen.findByText('Woche 2 von 4 im festen Abschnitt. Als Nächstes kommt Unterkörper B am Mittwoch.');
});
