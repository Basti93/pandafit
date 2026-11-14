// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExperienceCard } from '../../src/tracking/ui/ExperienceCard';
import { openProposals } from '../../src/tracking/ui/chat-open';
import { chatThread, readChat, type ChatEntry } from '../../src/shared/chat';
import { storedGoalOf } from '../../src/shared/personal';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';

afterEach(cleanup);

const ask: ChatEntry = { id: 'e1', role: 'coach', text: 'Wie lange trainierst du schon mit Gewichten?', atMs: 1000, push: true, askExperience: true };
const askRec: TrackedRecord = { kind: 'chat', id: ask.id, updatedMs: 1000, deleted: false, body: { role: ask.role, text: ask.text, atMs: ask.atMs, push: true, askExperience: true } };
const goal: TrackedRecord = { kind: 'goal', id: 'goal', updatedMs: 1, deleted: false, body: { strength: 'muscle', focus: [], sports: {}, push: 'normal', atMs: 1 } };
let n = 0;
const setup = (seed: TrackedRecord[] = [goal]) => {
  const f = fakePort([askRec, ...seed]);
  render(<ExperienceCard port={f.port} now={() => 5000 + n} newId={() => `id${++n}`} m={ask} />);
  return f;
};
const open = (map: Map<string, TrackedRecord>) => openProposals(chatThread([...map.values()]), [], [], [], '2026-11-09');
const pick = async (name: string) => {
  const b = screen.getByRole('button', { name }) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b);
};
const goalOf = (map: Map<string, TrackedRecord>) => storedGoalOf([...map.values()]);

it('liest die Frage und die Antwort aus dem Chat', () => {
  expect(readChat({ ...(askRec.body as object) })?.askExperience).toBe(true);
  expect(readChat({ role: 'rider', text: 'x', atMs: 1, experienceChange: { from: null, to: 'neu' } })?.experienceChange).toEqual({ from: null, to: 'neu' });
  expect(readChat({ role: 'rider', text: 'x', atMs: 1, experienceChange: { from: null, to: 'profi' } })).toBeNull();
});

it('eine Antwort setzt die Erfahrung im Ziel, Rückgängig stellt es wieder her', async () => {
  const f = setup();
  expect(open(f.map).map((m) => m.id)).toEqual(['e1']);
  await pick('Ich fange gerade an');
  await screen.findByText('Danke, ich plane dein Krafttraining danach.');
  expect(goalOf(f.map)).toEqual({ strength: 'muscle', focus: [], sports: {}, push: 'normal', experience: 'neu' });
  expect(open(f.map)).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await screen.findByText('Du hast das rückgängig gemacht.');
  expect('experience' in goalOf(f.map)).toBe(false);
  expect(goalOf(f.map).push).toBe('normal');
});

it('Später schließt die Frage, ohne das Ziel zu ändern', async () => {
  const f = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Später' }));
  await waitFor(() => expect(open(f.map)).toEqual([]));
  expect('experience' in goalOf(f.map)).toBe(false);
  await screen.findByText('Kein Problem, ich richte mich nach deinen Trainings.');
});
