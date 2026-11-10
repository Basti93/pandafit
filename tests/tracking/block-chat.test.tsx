// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { blockRecord, type BlockBody, type BlockDay } from '../../src/shared/block';
import { blockTakeWrites } from '../../src/shared/block-take';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';
import { openChat } from './open-chat';

afterEach(cleanup);

const day = (sport: BlockDay['sport'], hardness: BlockDay['hardness'], extra: Partial<BlockDay> = {}): BlockDay => ({ sport, hardness, ...extra });
const proposed: BlockBody = {
  state: 'proposed', atMs: 1,
  rhythm: [day('gym', 'hard', { template: 0 }), day('bike', 'easy'), day('gym', 'moderate', { template: 1 }), day('rest', 'easy'), day('bike', 'hard'), day('run', 'easy'), day('rest', 'easy')],
  templates: [{ name: 'Oberkörper A', core: ['pf-a', 'pf-b', 'pf-c'] }, { name: 'Unterkörper B', core: ['pf-d', 'pf-e', 'pf-f'] }],
};
const NOW = new Date(2026, 10, 29, 12).getTime();
const chat = (id: string, body: object): TrackedRecord => ({ kind: 'chat', id, updatedMs: 1, deleted: false, body });

it('die Antwort auf "machen wir" zeigt Rückgängig statt einer falschen Absage', async () => {
  // The review message m1 proposed the section; the coach's reply r2 took it (the block carries the message that took it).
  const base = [blockRecord('block-m1', proposed, 1)];
  const writes = blockTakeWrites({ block: base[0]!, frame: [], plans: [], msgId: 'm1', today: '2026-11-29', nowMs: 100 })!;
  const seed = [
    chat('m1', { role: 'coach', text: 'Ein fester Abschnitt?', atMs: NOW - 5000, block: 'block-m1' }),
    chat('r1', { role: 'rider', text: 'Ja, machen wir', atMs: NOW - 4000 }),
    chat('r2', { role: 'coach', text: 'Gilt ab jetzt.', atMs: NOW - 3000, block: 'block-m1', replyTo: 'r1' }),
    ...writes,
  ];
  const { port, map } = fakePort(seed);
  render(<CoachScreen port={port} now={() => NOW} newId={() => 'new-id'} />);
  await openChat();
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Rückgängig' }).length).toBeGreaterThan(0));
  expect(screen.queryByText(/Das geht nicht/)).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Rückgängig' })[0]!);
  await waitFor(() => expect(map.get('block:block-m1')!.deleted).toBe(true));
  expect([...map.values()].filter((r) => r.kind === 'weekplan').every((r) => r.deleted)).toBe(true);
});
