// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DriftCard } from '../../src/tracking/ui/DriftCard';
import { openProposals } from '../../src/tracking/ui/chat-open';
import { activeBlock, blockRecord, type BlockBody } from '../../src/shared/block';
import { chatThread } from '../../src/shared/chat';
import { frameRecord, readFrame } from '../../src/shared/frame';
import { goalRecord } from '../../src/shared/personal';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';

afterEach(cleanup);

const active: BlockBody = {
  state: 'active', atMs: 1, start: '2026-11-30', end: '2026-12-27', priorMode: 'spontaneous', takenFrom: 'm0', frameMs: 10,
  rhythm: [
    { sport: 'gym', hardness: 'hard', template: 0 }, { sport: 'bike', hardness: 'easy' }, { sport: 'gym', hardness: 'moderate', template: 1 },
    { sport: 'rest', hardness: 'easy' }, { sport: 'bike', hardness: 'hard' }, { sport: 'run', hardness: 'easy' }, { sport: 'rest', hardness: 'easy' },
  ],
  templates: [{ name: 'Oberkörper A', core: ['a', 'b', 'c'] }, { name: 'Unterkörper B', core: ['d', 'e', 'f'] }],
};
const NOW = new Date(2026, 11, 14, 12).getTime(); // Monday 2026-12-14
const msg = (): TrackedRecord => ({ kind: 'chat', id: 'm1', updatedMs: 1, deleted: false, body: { role: 'coach', text: 'Die letzten zwei Wochen sahen anders aus als geplant. Sollen wir wieder locker planen?', atMs: 1, push: true, drift: 'block-m0' } });
const goal = goalRecord({ sports: { bike: 'high' } } as never, 3);
const seed = (): TrackedRecord[] => [msg(), blockRecord('block-m0', active, 1), frameRecord({ mode: 'week', minutes: 45 }, 10), goal];
let n = 0;
let clock = NOW;
const setup = (records = seed()) => {
  const f = fakePort(records);
  n = 0; clock = NOW;
  const entry = { ...(msg().body as object), id: 'm1' } as never;
  render(<DriftCard port={f.port} now={() => ++clock} newId={() => `r${String(++n).padStart(3, '0')}`} m={entry} />);
  return f;
};
const open = (f: { map: Map<string, TrackedRecord> }) => {
  const recs = [...f.map.values()];
  return openProposals(chatThread(recs), [], [], [], '2026-12-14', recs.filter((r) => r.kind === 'block'));
};
const yes = async () => {
  const b = (await screen.findByRole('button', { name: 'Ja, locker planen' })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b);
};

it('plant locker, lässt das Ziel stehen und macht es rückgängig', async () => {
  const f = setup();
  expect(open(f).map((m) => m.id)).toEqual(['m1']);
  await yes();
  await screen.findByText('Ab jetzt plane ich wieder locker, dein Ziel bleibt.');
  expect(f.map.get('block:block-m0')!.body).toMatchObject({ state: 'ended' });
  expect(readFrame(f.map.get('frame:frame')!.body)).toMatchObject({ mode: 'spontaneous', minutes: 45 });
  expect(f.map.get('goal:goal')).toEqual(goal);
  expect(open(f)).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await screen.findByText(/Der feste Abschnitt gilt weiter/);
  // An ended record never moves back, so the section runs on as a new record.
  expect(f.map.get('block:block-m0-b')!.body).toMatchObject({ state: 'active', start: '2026-11-30', end: '2026-12-27' });
  expect(activeBlock([...f.map.values()], '2026-12-14')?.id).toBe('block-m0-b');
  expect(readFrame(f.map.get('frame:frame')!.body)).toMatchObject({ mode: 'week', minutes: 45 });
  expect(f.map.get('goal:goal')).toEqual(goal);
});

it('lässt die Wochenpläne unberührt', async () => {
  const plan: TrackedRecord = { kind: 'weekplan', id: '2026-12-14', updatedMs: 4, deleted: false, body: { weekStart: '2026-12-14', days: [] } };
  const f = setup([...seed(), plan]);
  await yes();
  await screen.findByText('Ab jetzt plane ich wieder locker, dein Ziel bleibt.');
  expect(f.map.get('weekplan:2026-12-14')).toEqual(plan);
});

it('stellt einen danach geänderten Rahmen nicht zurück', async () => {
  const f = setup();
  await yes();
  await screen.findByRole('button', { name: 'Rückgängig' });
  await f.port.put(frameRecord({ mode: 'spontaneous', minutes: 30 }, NOW + 500));
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(f.map.get('block:block-m0-b')!.body).toMatchObject({ state: 'active' }));
  expect(readFrame(f.map.get('frame:frame')!.body)).toMatchObject({ mode: 'spontaneous', minutes: 30 });
});

it('bleibt beim Abschnitt bei „Nein, weiter so“', async () => {
  const f = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Nein, weiter so' }));
  await screen.findByText(/wir bleiben beim festen Abschnitt/);
  expect(f.map.get('block:block-m0')!.body).toMatchObject({ state: 'active' });
  expect(readFrame(f.map.get('frame:frame')!.body)?.mode).toBe('week');
  expect(open(f)).toEqual([]);
});

it('schreibt bei einem Doppeltipp nur einmal', async () => {
  const f = setup();
  const b = (await screen.findByRole('button', { name: 'Ja, locker planen' })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b); fireEvent.click(b);
  await screen.findByText('Ab jetzt plane ich wieder locker, dein Ziel bleibt.');
  expect(f.state.puts.filter((r) => r.kind === 'block')).toHaveLength(1);
});

it('meldet einen Fehler beim Speichern', async () => {
  const f = setup();
  f.state.failPuts = true;
  await yes();
  await screen.findByText(/nicht gespeichert/);
});

it('zeigt Rückgängig auch, wenn die Antwort im Chat nicht gespeichert wurde', async () => {
  const f = fakePort(seed());
  const port = { ...f.port, put: (r: TrackedRecord) => (r.kind === 'chat' ? Promise.reject(new Error('disk')) : f.port.put(r)) };
  const entry = { ...(msg().body as object), id: 'm1' } as never;
  const view = render(<DriftCard port={port} now={() => ++clock} newId={() => 'r1'} m={entry} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, locker planen' }));
  await screen.findByRole('button', { name: 'Rückgängig' });
  expect(f.map.get('block:block-m0')!.body).toMatchObject({ state: 'ended', endedBy: 'm1' });
  view.unmount();
  render(<DriftCard port={f.port} now={() => ++clock} newId={() => 'r2'} m={entry} />);
  await screen.findByRole('button', { name: 'Rückgängig' });
  expect(open(f)).toEqual([]);
});

const takenSeed = (): TrackedRecord[] => [
  msg(), blockRecord('block-m0', { ...active, state: 'ended', endedBy: 'm1' }, 2), frameRecord({ mode: 'spontaneous', minutes: 45 }, 20), goal,
];

it('bietet kein Rückgängig, wenn inzwischen ein neuer Abschnitt läuft', async () => {
  const other = blockRecord('block-m5', { ...active, start: '2026-12-21', end: '2027-01-31', takenFrom: 'm5' }, 3);
  setup([...takenSeed(), other]);
  await screen.findByText('Inzwischen läuft ein neuer Abschnitt.');
  expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
});

it('bietet kein Rückgängig, wenn ein Eintrag des Abschnitts gelöscht ist', async () => {
  const gone: TrackedRecord = { ...blockRecord('block-m0-b', active, 3), deleted: true };
  setup([...takenSeed(), gone]);
  await screen.findByText('Ab jetzt plane ich wieder locker, dein Ziel bleibt.');
  expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
});
