// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PushCard } from '../../src/tracking/ui/PushCard';
import { openProposals } from '../../src/tracking/ui/chat-open';
import { chatThread, type ChatEntry } from '../../src/shared/chat';
import { storedGoalOf } from '../../src/shared/personal';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';

afterEach(cleanup);

const ask: ChatEntry = { id: 'a1', role: 'coach', text: 'Wie sehr soll ich dich beim Krafttraining fordern? Du kannst das jederzeit im Profil ändern.', atMs: 1000, push: true, askPush: true };
const askRec: TrackedRecord = { kind: 'chat', id: ask.id, updatedMs: 1000, deleted: false, body: { role: ask.role, text: ask.text, atMs: ask.atMs, push: true, askPush: true } };
const goal: TrackedRecord = { kind: 'goal', id: 'goal', updatedMs: 1, deleted: false, body: { strength: 'muscle', focus: ['quads'], sports: { bike: 'focus' }, atMs: 1 } };
let n = 0;
const setup = (seed: TrackedRecord[] = [goal]) => {
  const f = fakePort([askRec, ...seed]);
  render(<PushCard port={f.port} now={() => 5000 + n} newId={() => `id${++n}`} m={ask} />);
  return f;
};
const open = (map: Map<string, TrackedRecord>) => openProposals(chatThread([...map.values()]), [], [], [], '2026-11-09');
/** The card reads the goal first; the choices wait for it. */
const pick = async (name: string) => {
  const b = screen.getByRole('button', { name }) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b);
};
const goalOf = (map: Map<string, TrackedRecord>) => storedGoalOf([...map.values()]);

it('Wahl setzt die Härte, Rückgängig stellt das Ziel wieder her', async () => {
  const f = setup();
  expect(open(f.map).map((m) => m.id)).toEqual(['a1']);
  await pick('Vorsichtig');
  await screen.findByText('Gilt ab jetzt: Vorsichtig.');
  expect(goalOf(f.map)).toEqual({ strength: 'muscle', focus: ['quads'], sports: { bike: 'focus' }, push: 'gentle' });
  const takes = chatThread([...f.map.values()]).find((m) => m.takes === 'a1');
  expect(takes?.role).toBe('rider');
  expect(open(f.map)).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await screen.findByText('Du hast das rückgängig gemacht.');
  expect(goalOf(f.map)).toEqual({ strength: 'muscle', focus: ['quads'], sports: { bike: 'focus' } });
  expect('push' in goalOf(f.map)).toBe(false);
  expect(chatThread([...f.map.values()]).some((m) => m.undoes === 'a1')).toBe(true);
});

it('Rückgängig stellt einen vorher gewählten Wert wieder her', async () => {
  const f = setup([{ ...goal, body: { ...(goal.body as object), push: 'hard' } }]);
  await pick('Normal');
  await screen.findByText('Gilt ab jetzt: Normal.');
  expect(goalOf(f.map).push).toBe('normal');
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await screen.findByText('Du hast das rückgängig gemacht.');
  expect(goalOf(f.map).push).toBe('hard');
});

it('Später schließt die Frage, ohne das Ziel zu ändern', async () => {
  const f = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Später' }));
  await waitFor(() => expect(open(f.map)).toEqual([]));
  expect(chatThread([...f.map.values()]).some((m) => m.declines === 'a1')).toBe(true);
  expect(goalOf(f.map).push).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Vorsichtig' })).toBeNull();
});
