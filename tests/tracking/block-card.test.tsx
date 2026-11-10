// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlockCard } from '../../src/tracking/ui/BlockCard';
import { openProposals } from '../../src/tracking/ui/chat-open';
import { blockRecord, type BlockBody, type BlockDay } from '../../src/shared/block';
import { chatThread } from '../../src/shared/chat';
import { frameRecord, readFrame } from '../../src/shared/frame';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';

afterEach(cleanup);

const day = (sport: BlockDay['sport'], hardness: BlockDay['hardness'], extra: Partial<BlockDay> = {}): BlockDay => ({ sport, hardness, ...extra });
const proposed: BlockBody = {
  state: 'proposed', atMs: 1,
  rhythm: [day('gym', 'hard', { template: 0 }), day('bike', 'easy'), day('gym', 'moderate', { template: 1 }), day('rest', 'easy'), day('bike', 'hard'), day('run', 'easy'), day('rest', 'easy')],
  templates: [{ name: 'Oberkörper A', core: ['pf-a', 'pf-b', 'pf-c'] }, { name: 'Unterkörper B', core: ['pf-d', 'pf-e', 'pf-f'] }],
};
const NOW = new Date(2026, 10, 29, 12).getTime(); // Sunday 2026-11-29
const chatRec: TrackedRecord = { kind: 'chat', id: 'm1', updatedMs: 1, deleted: false, body: { role: 'coach', text: 'Ein fester Abschnitt?', atMs: 1, block: 'block-m1' } };
const seed = (): TrackedRecord[] => [chatRec, blockRecord('block-m1', proposed, 1), frameRecord({ mode: 'spontaneous', minutes: null }, 2)];
const setup = (records = seed()) => {
  const f = fakePort(records);
  render(<BlockCard port={f.port} blockId="block-m1" msgId="m1" now={() => NOW} />);
  return f;
};
const open = (map: Map<string, TrackedRecord>) => {
  const recs = [...map.values()];
  return openProposals(chatThread(recs), [], [], [], '2026-11-23', recs.filter((r) => r.kind === 'block'));
};
const take = async () => {
  const b = (await screen.findByRole('button', { name: 'Übernehmen' })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b);
};

it('zeigt den Vorschlag mit Datum, Vorlagen und Wochenrhythmus', async () => {
  setup();
  await screen.findByText('Fester Abschnitt bis 27. Dez.');
  expect(screen.getByText(/Oberkörper A mit/)).toBeTruthy();
  expect(screen.getByText(/Unterkörper B mit/)).toBeTruthy();
  expect(screen.getByRole('list', { name: /Wochenrhythmus/ })).toBeTruthy();
});

it('übernimmt den Abschnitt mit Rückgängig', async () => {
  const f = setup();
  expect(open(f.map).map((m) => m.id)).toEqual(['m1']);
  await take();
  await screen.findByText('Gilt ab 30. Nov.');
  expect(f.map.get('block:block-m1')!.body).toMatchObject({ state: 'active', start: '2026-11-30', priorMode: 'spontaneous' });
  expect(readFrame(f.map.get('frame:frame')!.body)?.mode).toBe('week');
  expect([...f.map.values()].filter((r) => r.kind === 'weekplan')).toHaveLength(4);
  expect(open(f.map)).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await screen.findByText('Du hast den Abschnitt rückgängig gemacht.');
  expect(f.map.get('block:block-m1')!.deleted).toBe(true);
  expect(readFrame(f.map.get('frame:frame')!.body)?.mode).toBe('spontaneous');
  expect([...f.map.values()].filter((r) => r.kind === 'weekplan').every((r) => r.deleted)).toBe(true);
});

it('Rückgängig fehlt und der Grund steht da, wenn ein Wochenplan geändert wurde', async () => {
  const f = setup();
  await take();
  await screen.findByText('Gilt ab 30. Nov.');
  const wp = f.map.get('weekplan:2026-12-07')!;
  await f.port.put({ ...wp, updatedMs: wp.updatedMs + 10, body: { ...(wp.body as object), days: [] } });
  await screen.findByText(/Das geht nicht, weil ein Wochenplan/);
  expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
  expect(f.map.get('block:block-m1')!.deleted).toBe(false);
});

it('Nein danke lehnt den Abschnitt ab', async () => {
  const f = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Nein danke' }));
  await screen.findByText('Du hast den Vorschlag abgelehnt.');
  expect(f.map.get('block:block-m1')!.body).toMatchObject({ state: 'declined' });
  expect(open(f.map)).toEqual([]);
});

it('zwei schnelle Taps übernehmen einmal, Rückgängig stellt den alten Wochenplan her', async () => {
  const old: TrackedRecord = { kind: 'weekplan', id: '2026-12-07', updatedMs: 10, deleted: false, body: { weekStart: '2026-12-07', days: [] } };
  const f = setup([...seed(), old]);
  f.state.delayMs = 5;
  const b = (await screen.findByRole('button', { name: 'Übernehmen' })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b);
  fireEvent.click(b);
  await screen.findByText('Gilt ab 30. Nov.');
  expect(f.state.puts.filter((r) => r.kind === 'block')).toHaveLength(1);
  expect(f.map.get('weekplan:2026-12-07')!.body).toMatchObject({ prior: { weekStart: '2026-12-07', days: [] } });
  f.state.delayMs = 0;
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await screen.findByText('Du hast den Abschnitt rückgängig gemacht.');
  expect(f.map.get('weekplan:2026-12-07')!.deleted).toBe(false);
  expect(f.map.get('weekplan:2026-12-07')!.body).toMatchObject({ weekStart: '2026-12-07', days: [] });
});

it('meldet, wenn etwas nicht gespeichert wurde, und lässt den Abschnitt vorgeschlagen', async () => {
  const f = setup();
  f.state.failPuts = true;
  await take();
  await screen.findByText(/nicht gespeichert/);
  expect(f.map.get('block:block-m1')!.body).toMatchObject({ state: 'proposed' });
});
