// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatCoach } from '../../src/coach/chat/chat-coach';
import { excludedOf, goalOfProfile } from '../../src/coach/tracking/personal';
import { checkOps } from '../../src/tracking/workout-change';
import { EXERCISES } from '../../src/shared/exercises';
import { goalRecord } from '../../src/shared/personal';
import type { TrackedRecord } from '../../src/shared/records';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { fakePort } from '../tracking/fake-port';
import { openChat, openProposals } from '../tracking/open-chat';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 18).getTime();
const env = { now: () => NOW, newId: () => 'new-id' };
const chatRec = (id: string, body: object): TrackedRecord => ({ kind: 'chat', id, updatedMs: 1, deleted: false, body });
const ANSWER = { text: 'Okay.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], tasks: [], nextChange: null };

function setup(ruleDraft: unknown, opts: { rider?: boolean; ask?: (i: { prompt: string }) => unknown } = {}) {
  const recs = new Map<string, TrackedRecord>([['chat:r1', chatRec('r1', { role: 'rider', text: 'künftig keine Kniebeugen', atMs: NOW - 1000 })]]);
  const store = {
    all: (_id: string, kind?: string) => [...recs.values()].filter((r) => !kind || r.kind === kind),
    put: (_id: string, r: TrackedRecord) => { recs.set(`${r.kind}:${r.id}`, r); return r; },
  };
  const coach = new ChatCoach({ store: store as never, nowMs: () => NOW, newId: () => 'm1', ask: (async (i: { prompt: string }) => opts.ask?.(i) ?? { ...ANSWER, ruleDraft }) as never });
  return { recs, store, coach };
}
const state = (m: Map<string, TrackedRecord>, id: string) => (m.get(`rule:${id}`)!.body as { state: string }).state;

test('a rider message becomes a proposed exclude rule with valid ids; taking it makes the enforcement hold', async () => {
  const { recs, store, coach } = setup({ kind: 'exclude', text: 'Keine Kniebeugen mehr', sport: 'gym', exerciseIds: ['pf-squat', 'pf-front-squat', 'nope'] });
  await coach.tick('p');
  expect(recs.get('chat:m1')!.body).toMatchObject({ rule: 'rule-m1' });
  expect(recs.get('rule:rule-m1')!.body).toMatchObject({ kind: 'exclude', state: 'proposed', source: 'chat', exerciseIds: ['pf-squat', 'pf-front-squat'] });
  expect(excludedOf(store as never, 'p', EXERCISES).size).toBe(0);

  const { port, map } = fakePort([...recs.values()]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await openProposals();
  expect(await screen.findByText(/Betrifft: Kniebeuge, Frontkniebeuge/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(state(map, 'rule-m1')).toBe('active'));
  expect(await screen.findByText(/^Übernommen: Keine Kniebeugen mehr/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Übernehmen' })).toBeNull(); // it left the pin
  const excluded = excludedOf({ all: (_i: string, k?: string) => [...map.values()].filter((r) => r.kind === k) } as never, 'p', EXERCISES);
  expect([...excluded].sort()).toEqual(['pf-front-squat', 'pf-squat']);
  // Task 2 enforcement: a swap into it is refused
  const w = { id: 'w', title: 'T', startMs: 0, endMs: null, exercises: [{ rid: 'a', exerciseId: 'pf-bench-press', title: 'B', sets: [{ type: 'normal', weightKg: 1, reps: 1, doneMs: null }] }] } as never;
  expect(checkOps({ workoutId: 'w', ops: [{ op: 'swap', ex: 'a', to: 'pf-squat' }] }, w, EXERCISES, excluded).ops).toEqual([]);

  // reload keeps the state, and Rückgängig deletes the rule
  cleanup();
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(map.get('rule:rule-m1')!.deleted).toBe(true));
});

test('Nein danke declines', async () => {
  const { recs, coach } = setup({ kind: 'wish', text: 'Lieber kurze Pausen', sport: 'gym' });
  await coach.tick('p');
  const { port, map } = fakePort([...recs.values()]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await openProposals();
  fireEvent.click(await screen.findByRole('button', { name: 'Nein danke' }));
  await waitFor(() => expect(state(map, 'rule-m1')).toBe('declined'));
});

test('unknown ids are dropped; without any valid id the exclude rule becomes a wish with a reason (after one try with the catalog)', async () => {
  const prompts: string[] = [];
  const { recs, coach } = setup(null, { ask: (i) => { prompts.push(i.prompt); return { ...ANSWER, ruleDraft: { kind: 'exclude', text: 'Kein Bankdrücken', sport: 'gym', exerciseIds: ['unknown-1'] } }; } });
  await coach.tick('p');
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).not.toContain('<katalog');
  expect(prompts[1]).toContain('"id":"pf-squat"');
  expect(recs.get('rule:rule-m1')!.body).toMatchObject({ kind: 'wish', state: 'proposed', text: 'Kein Bankdrücken' });
  expect((recs.get('rule:rule-m1')!.body as { exerciseIds?: unknown }).exerciseIds).toBeUndefined();
  expect((recs.get('chat:m1')!.body as { text: string }).text).toContain('allgemeinen Wunsch');
});

test('the catalog is asked for once: ids named in the first answer need no second try', async () => {
  let calls = 0;
  const { coach } = setup(null, { ask: () => { calls++; return { ...ANSWER, ruleDraft: { kind: 'exclude', text: 'x', sport: 'gym', exerciseIds: ['pf-squat'] } }; } });
  await coach.tick('p');
  expect(calls).toBe(1);
});

test('coach-initiated messages cannot create rule drafts', async () => {
  const { recs, coach } = setup(null, { ask: () => ({ ...ANSWER, ruleDraft: { kind: 'wish', text: 'Nie Sonntag', sport: 'all' } }) });
  await coach.openWeek('p');
  expect([...recs.keys()].some((k) => k.startsWith('rule:'))).toBe(false);
  expect((recs.get('chat:m1')!.body as { rule?: string }).rule).toBeUndefined();
});

test('a goal proposal writes the goal record on take, merged into the current goal', async () => {
  const { recs, store, coach } = setup({ kind: 'goal', text: 'Mehr Kraft, Schwerpunkt Brust', sport: 'all', goal: { strength: 'strength', focus: ['chest'] } });
  recs.set('goal:goal', goalRecord({ strength: 'muscle', focus: [], sports: { run: 'keep' } }, 5));
  await coach.tick('p');
  expect(goalOfProfile(store as never, 'p', '2026-11-04').strength).toBe('muscle');
  const { port, map } = fakePort([...recs.values()]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await openProposals();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(state(map, 'rule-m1')).toBe('active'));
  const g = goalOfProfile({ all: (_i: string, k?: string) => [...map.values()].filter((r) => r.kind === k) } as never, 'p', '2026-11-04');
  expect(g).toEqual({ strength: 'strength', focus: ['chest'], sports: { run: 'keep' } });
  // Rückgängig restores the prior goal while it is unchanged since
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(map.get('rule:rule-m1')!.deleted).toBe(true));
  expect(goalOfProfile({ all: (_i: string, k?: string) => [...map.values()].filter((r) => r.kind === k) } as never, 'p', '2026-11-04')).toEqual({ strength: 'muscle', focus: [], sports: { run: 'keep' } });
});

test('a goal Rückgängig is refused once the goal changed since', async () => {
  const { recs, coach } = setup({ kind: 'goal', text: 'Mehr Kraft', sport: 'all', goal: { strength: 'strength' } });
  await coach.tick('p');
  const { port, map } = fakePort([...recs.values()]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await openProposals();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(state(map, 'rule-m1')).toBe('active'));
  await port.put(goalRecord({ strength: 'fitness', focus: [], sports: {} }, NOW + 99_000, map.get('goal:goal')));
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  expect(await screen.findByText('Geht nicht mehr, weil das Ziel danach geändert wurde.')).toBeTruthy();
  expect(map.get('rule:rule-m1')!.deleted).toBe(false);
});

test('an empty goal draft is dropped', async () => {
  const { recs, coach } = setup({ kind: 'goal', text: 'Irgendwas', sport: 'all', goal: {} });
  await coach.tick('p');
  expect([...recs.keys()].some((k) => k.startsWith('rule:'))).toBe(false);
});

test('a rule deleted elsewhere reads Gelöscht', async () => {
  const { recs, coach } = setup({ kind: 'wish', text: 'Lieber kurze Pausen', sport: 'gym' });
  await coach.tick('p');
  const r = recs.get('rule:rule-m1')!;
  const { port } = fakePort([...recs.values()].map((x) => (x === r ? { ...r, deleted: true, updatedMs: r.updatedMs + 5 } : x)));
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  expect(await screen.findByText('Die Regel ist gelöscht.')).toBeTruthy();
});

test('an unreadable goal draft is dropped', async () => {
  const { recs, coach } = setup({ kind: 'goal', text: 'x', sport: 'all', goal: { strength: 'bogus' } });
  await coach.tick('p');
  expect([...recs.keys()].some((k) => k.startsWith('rule:'))).toBe(false);
});

test('a goal proposal with weeks writes a temporary focus and leaves the base; Rückgängig restores it', async () => {
  const { recs, coach } = setup({ kind: 'goal', text: 'Vier Wochen Rücken', sport: 'all', goal: { focus: ['back'], weeks: 4 } });
  recs.set('goal:goal', goalRecord({ strength: 'muscle', focus: ['chest'], sports: {} }, 5));
  await coach.tick('p');
  expect(recs.get('rule:rule-m1')!.body).toMatchObject({ kind: 'goal', goal: { focus: ['back'], weeks: 4 } });
  const { port, map } = fakePort([...recs.values()]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await openProposals();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(state(map, 'rule-m1')).toBe('active'));
  const all = { all: (_i: string, k?: string) => [...map.values()].filter((r) => r.kind === k) } as never;
  const stored = map.get('goal:goal')!.body as { focus: string[]; temporary: { focus: string[]; until: string } };
  expect(stored.focus).toEqual(['chest']);
  expect(stored.temporary).toEqual({ focus: ['back'], until: '2026-12-02' });
  expect(goalOfProfile(all, 'p', '2026-11-04').focus).toEqual(['back']);
  expect(goalOfProfile(all, 'p', '2026-12-03').focus).toEqual(['chest']);
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(map.get('rule:rule-m1')!.deleted).toBe(true));
  expect((map.get('goal:goal')!.body as { temporary?: unknown }).temporary).toBeUndefined();
  expect(goalOfProfile(all, 'p', '2026-11-04').focus).toEqual(['chest']);
});
