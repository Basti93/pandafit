// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CoachChat } from '../../src/tracking/ui/CoachChat';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';

const seen = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock('../../src/tracking/ui/PandaPortrait', () => ({
  PandaPortrait: ({ gesture }: { gesture?: { kind: string; id: string } }) => {
    // Records every event the way the real portrait consumes it: once per id.
    const e = gesture ? `${gesture.kind}:${gesture.id}` : null;
    if (e && !seen.events.includes(e)) seen.events.push(e);
    return null;
  },
}));

beforeEach(() => { seen.events.length = 0; });
afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 18).getTime();
const msg = (id: string, role: 'rider' | 'coach', atMs: number, text = id): TrackedRecord => ({ kind: 'chat', id, updatedMs: atMs, deleted: false, body: { role, text, atMs, ...(role === 'coach' ? { replyTo: 'r0' } : {}) } });
const mount = (seed: TrackedRecord[]) => {
  const p = fakePort(seed);
  render(<CoachChat port={p.port} now={() => NOW} newId={() => 'n'} onClose={() => {}} />);
  return p;
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test('opening the chat listens once; the history that is already there never nods', async () => {
  mount([msg('r0', 'rider', NOW - 5000), msg('c0', 'coach', NOW - 4000)]);
  await settle();
  expect(seen.events).toEqual(['listen:listen-open']);
});

test('a coach reply that arrives later nods once by record id, also after retries and rerenders', async () => {
  const p = mount([msg('r0', 'rider', NOW - 5000)]);
  await settle();
  await act(async () => { await p.port.put(msg('c1', 'coach', NOW - 100)); });
  await settle();
  expect(seen.events).toEqual(['listen:listen-open', 'nod:nod-c1']);
  // the same record again (a sync retry with a newer updatedMs) and an unrelated change: no new nod
  await act(async () => { await p.port.put({ ...msg('c1', 'coach', NOW - 100), updatedMs: NOW + 5 }); });
  await act(async () => { p.notify(); });
  await settle();
  expect(seen.events).toEqual(['listen:listen-open', 'nod:nod-c1']);
  // a rider message is no reply
  await act(async () => { await p.port.put(msg('r2', 'rider', NOW - 50)); });
  await settle();
  expect(seen.events).toHaveLength(2);
  // a second reply nods again
  await act(async () => { await p.port.put(msg('c2', 'coach', NOW - 10)); });
  await settle();
  expect(seen.events).toEqual(['listen:listen-open', 'nod:nod-c1', 'nod:nod-c2']);
});

test('old history that syncs in late does not nod', async () => {
  const p = mount([msg('r0', 'rider', NOW - 5000)]);
  await settle();
  await act(async () => { await p.port.put(msg('c-old', 'coach', NOW - 3 * 86_400_000)); });
  await settle();
  expect(seen.events).toEqual(['listen:listen-open']);
});

test('loading older messages does not nod', async () => {
  const seed: TrackedRecord[] = [];
  for (let i = 0; i < 40; i++) seed.push(msg(`c${i}`, i % 2 ? 'coach' : 'rider', NOW - (100 - i) * 1000));
  mount(seed);
  await settle();
  fireEvent.click(await screen.findByRole('button', { name: 'Ältere anzeigen' }));
  await settle();
  expect(seen.events).toEqual(['listen:listen-open']);
});
