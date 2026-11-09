// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import type { TrackedRecord } from '../../src/shared/records';
import { changeRecord } from '../../src/shared/changes';
import { weekDates } from '../../src/shared/week-plan';
import { fakePort } from './fake-port';
import { openChat, proposalIn, openMoreProposals } from './open-chat';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 18).getTime();
let n = 0;
const env = { now: () => NOW, newId: () => `id${++n}` };
const proposal = { weekStart: '2026-11-02', days: weekDates('2026-11-02').map((date, i) => ({ date, sport: i === 4 ? 'gym' : 'rest', hardness: 'moderate', fixed: i === 4 })) };
const coachMsg: TrackedRecord = { kind: 'chat', id: 'c1', updatedMs: 2, deleted: false, body: { role: 'coach', text: 'Wie wäre das?', atMs: NOW - 500, replyTo: 'r1', proposal } };
const riderMsg: TrackedRecord = { kind: 'chat', id: 'r1', updatedMs: 1, deleted: false, body: { role: 'rider', text: 'Freitag Studio', atMs: NOW - 1000 } };
const records = (m: Map<string, TrackedRecord>, kind: string) => [...m.values()].filter((r) => r.kind === kind);

const takenPlan: TrackedRecord = { kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false, body: {
  weekStart: '2026-11-02', fromMessage: 'c1', acceptedMs: 1,
  days: weekDates('2026-11-02').map((date, i) => ({ date, sport: i === 0 || i === 4 ? 'gym' : 'rest', hardness: 'moderate', fixed: i === 4 })) } };
const doneMonday: TrackedRecord = { kind: 'workout', id: 'w1', updatedMs: 1, deleted: false, body: { id: 'w1', title: 'Oberkörper', startMs: new Date(2026, 10, 2, 18).getTime(), endMs: new Date(2026, 10, 2, 19).getTime(), source: 'pandafit', exercises: [] } };

test('Woche shows the week card, the days as Erledigt, Heute, Kommt noch, and the goal in one sentence', async () => {
  const { port } = fakePort([takenPlan, doneMonday]);
  render(<CoachScreen port={port} {...env} />);
  const week = await screen.findByRole('region', { name: 'Diese Woche' });
  expect(within(week).getByRole('list', { name: 'Wochenweg' })).toBeTruthy();
  expect(week.textContent).toContain('Dein Ziel:');
  expect(week.textContent).toContain('Du baust Muskeln auf.');
  const days = await screen.findByRole('region', { name: 'Tage' });
  for (const t of ['Erledigt', 'Heute', 'Kommt noch']) expect(days.textContent).toContain(t);
  expect(days.textContent).not.toMatch(/fest eingeplant|Puls bis/); // the details come in the day sheet
  expect(screen.queryByLabelText('Nachricht an Bo')).toBeNull();
  expect(screen.queryByLabelText('Neue Regel')).toBeNull();
});

test('a day row opens the day sheet with the details', async () => {
  const { port } = fakePort([takenPlan, doneMonday]);
  render(<CoachScreen port={port} {...env} />);
  const days = await screen.findByRole('region', { name: 'Tage' });
  expect(screen.queryByText('Dieser Tag ist fest eingeplant.')).toBeNull();
  fireEvent.click(within(days).getByRole('button', { name: /^Fr/ }));
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByText('Dieser Tag ist fest eingeplant.')).toBeTruthy();
});

test('the pencil opens Ziel und Planung, and an unchosen goal is called a suggestion', async () => {
  const { port } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  expect((await screen.findByRole('region', { name: 'Diese Woche' })).textContent).toContain('Das ist ein Vorschlag.');
  fireEvent.click(screen.getByRole('button', { name: 'Ziel und Planung' }));
  expect(await screen.findByRole('dialog', { name: 'Ziel und Planung' })).toBeTruthy();
});

test('the chat opens as a page with the input in it, and closes on Zurück and on Escape', async () => {
  const { port } = fakePort([riderMsg]);
  render(<CoachScreen port={port} {...env} />);
  const chat = await openChat();
  expect(within(chat).getByLabelText('Nachricht an Bo')).toBeTruthy();
  fireEvent.click(within(chat).getByRole('button', { name: 'Zurück' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await openChat();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the open week plan stands in Bo’s bubble with Übernehmen and Nein danke; taking it writes the plan once', async () => {
  const { port, map } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  const chat = await openChat();
  await proposalIn(chat);
  const group = within(chat).getByRole('group', { name: /^Vorschlag Wochenplan/ });
  expect(group.closest('.tk-bubble')).toBeTruthy();
  expect(within(chat).queryByRole('button', { name: /^Bo hat noch/ })).toBeNull();
  fireEvent.click(within(group).getByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(records(map, 'weekplan')).toHaveLength(1));
  await waitFor(() => expect(records(map, 'chat').filter((r) => (r.body as { takes?: string }).takes === 'c1')).toHaveLength(1));
  expect(await within(chat).findByText(/^Du hast den Wochenplan ab .* übernommen\./)).toBeTruthy();
  expect(within(chat).queryByRole('button', { name: 'Übernehmen' })).toBeNull();
});

const ruleMsg: TrackedRecord = { kind: 'chat', id: 'c2', updatedMs: 3, deleted: false, body: { role: 'coach', text: 'Noch etwas.', atMs: NOW - 400, nextChange: 'chg-m1' } };
const proposedChange = changeRecord('m1', [{ op: 'drop', exerciseId: 'pf-squat' }], 'Knie zwickt, deshalb ohne Kniebeuge.', 1000);

test('more open proposals wait behind one strip; exactly one stands in a bubble', async () => {
  const { port } = fakePort([riderMsg, coachMsg, ruleMsg, proposedChange]);
  render(<CoachScreen port={port} {...env} />);
  const chat = await openChat();
  await proposalIn(chat);
  expect(within(chat).getAllByRole('button', { name: 'Übernehmen' })).toHaveLength(1);
  fireEvent.click(within(chat).getByRole('button', { name: /^Bo hat noch einen weiteren Vorschlag/ }));
  expect(await screen.findByRole('dialog', { name: 'Vorschlag' })).toBeTruthy();
});

test('Bo speaks left with his still picture, you speak right, each with the time', async () => {
  const { port } = fakePort([riderMsg, { ...coachMsg, body: { ...(coachMsg.body as object), proposal: undefined, text: 'Alles klar.' } }]);
  render(<CoachScreen port={port} {...env} />);
  const chat = within(await openChat());
  const mine = chat.getByText('Freitag Studio').closest('.tk-bubble')!;
  expect(mine.classList.contains('right')).toBe(true);
  expect(mine.querySelector('time')?.textContent).toMatch(/^\d\d:\d\d$/);
  const bo = chat.getByText('Alles klar.').closest('.tk-bo')!;
  expect(bo.querySelector('img')).toBeTruthy();
  expect(bo.querySelector('.tk-bubble.right')).toBeNull();
  expect(bo.querySelector('time')?.textContent).toMatch(/^\d\d:\d\d$/);
});

test('only the head Bo moves: he listens in the chat head, the bubbles show the still', async () => {
  const { port } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  const chat = await openChat();
  await proposalIn(chat);
  expect(chat.querySelectorAll('canvas')).toHaveLength(1);
  expect(chat.querySelector('.tk-sheet-head canvas')).toBeTruthy();
  expect(chat.querySelector('.tk-bubble canvas, .tk-bo canvas')).toBeNull();
});

test('a chip writes its sentence into the field and goes away with it', async () => {
  const { port } = fakePort([riderMsg]);
  render(<CoachScreen port={port} {...env} />);
  const chat = within(await openChat());
  fireEvent.click(chat.getByRole('button', { name: 'Mir tut etwas weh' }));
  expect((chat.getByLabelText('Nachricht an Bo') as HTMLTextAreaElement).value).toBe('Mir tut etwas weh');
  expect(chat.queryByRole('button', { name: 'Mir tut etwas weh' })).toBeNull();
});

test('Zuletzt geändert is a card on top that opens the list', async () => {
  const stats: TrackedRecord = { kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body: { type: 'stats', atMs: 1, goal: null, days: [], muscles: {}, changes: [{ atMs: NOW - 1000, coach: 'gym', text: 'Bankdrücken 3', reason: 'Schulter' }] } };
  const { port } = fakePort([riderMsg, stats]);
  render(<CoachScreen port={port} {...env} />);
  const chat = within(await openChat());
  fireEvent.click(chat.getByRole('button', { name: /^Zuletzt geändert/ }));
  const sheet = within(await screen.findByRole('dialog', { name: 'Zuletzt geändert' }));
  expect(sheet.getAllByRole('listitem')[0]!.textContent).toContain('Bankdrücken 3, Schulter');
});

test('an old proposal that was never answered is a line in the history, not a pin', async () => {
  const old = { ...coachMsg, body: { ...(coachMsg.body as object), proposal: { weekStart: '2026-10-19', days: weekDates('2026-10-19').map((date) => ({ date, sport: 'rest', hardness: 'moderate', fixed: false })) } } } as TrackedRecord;
  const { port } = fakePort([riderMsg, old]);
  render(<CoachScreen port={port} {...env} />);
  const chat = within(await openChat());
  expect(await chat.findByText('Diese Woche ist vorbei.')).toBeTruthy();
  expect(chat.queryByRole('button', { name: 'Übernehmen' })).toBeNull();
});

test('sends a message and shows that the coach is thinking', async () => {
  const { port, map } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  expect(await screen.findByText('Für diese Woche gibt es noch keinen Plan.')).toBeTruthy();
  await openChat();
  fireEvent.change(screen.getByLabelText('Nachricht an Bo'), { target: { value: '  3× Rad bitte ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
  await waitFor(() => expect(records(map, 'chat').map((r) => r.body)).toEqual([{ role: 'rider', text: '3× Rad bitte', atMs: NOW }]));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Angekommen. Ich antworte dir, sobald ich kann.');
});

test('taking a proposal writes the week plan and shows it; then it cannot be taken twice', async () => {
  const { port, map } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(records(map, 'weekplan')).toHaveLength(1));
  expect(records(map, 'weekplan')[0]).toMatchObject({ id: '2026-11-02', body: { fromMessage: 'c1', weekStart: '2026-11-02' } });
  expect(records(map, 'chat').some((r) => (r.body as { takes?: string }).takes === 'c1')).toBe(true);
  expect(await screen.findByText(/Du hast den Wochenplan ab .* übernommen\./)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Übernehmen' })).toBeNull();
  expect((await screen.findByRole('region', { name: 'Tage' })).textContent).toContain('Kraft, mittel');
  expect(screen.queryByRole('status')).toBeNull();
});

test('declining writes a decline and changes no plan', async () => {
  const { port, map } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  fireEvent.click(await screen.findByRole('button', { name: 'Nein danke' }));
  await waitFor(() => expect(records(map, 'chat').some((r) => (r.body as { declines?: string }).declines === 'c1')).toBe(true));
  expect(records(map, 'weekplan')).toHaveLength(0);
  expect(await screen.findByText(/Du hast den Wochenplan ab .* abgelehnt\./)).toBeTruthy();
});

test('the run coach runs are listed under Kommt noch without a week plan, and sit on their day with a plan', async () => {
  const { runFp } = await import('../../src/shared/run');
  const run = { date: '2026-11-04', kind: 'easy' as const, minutes: 35, hrCap: 150, counts: 'Zeit zählt.', note: null };
  const runWeek: TrackedRecord = { kind: 'run', id: 'week-2026-11-02', updatedMs: 1, deleted: false, body: {
    type: 'week', week: '2026-11-02', announce: true, atMs: 1, phase: 1, source: 'rules', reason: 'Ruhig.', note: null, runs: [{ ...run, fp: runFp(run), done: null }], garmin: null } };
  const { port } = fakePort([runWeek]);
  render(<CoachScreen port={port} {...env} />);
  const noPlanDays = await screen.findByRole('region', { name: 'Tage' });
  expect(noPlanDays.textContent).toContain('Laufen · 35 Min · locker');
  expect(noPlanDays.textContent).not.toContain('Kommt noch'); // today's run belongs under Heute
  expect(noPlanDays.querySelector('.tk-rowcard.highlight')).toBeTruthy();
  cleanup();
  const plan: TrackedRecord = { ...takenPlan, body: { ...(takenPlan.body as object), days: weekDates('2026-11-02').map((date, i) => ({ date, sport: i === 2 ? 'run' : 'rest', hardness: 'moderate', fixed: false })) } };
  const two = fakePort([runWeek, plan]);
  render(<CoachScreen port={two.port} {...env} />);
  const days = await screen.findByRole('region', { name: 'Tage' });
  expect(days.textContent).toContain('Laufen · 35 Min · locker');
  expect(days.textContent?.match(/Laufen/g)).toHaveLength(1);
});

test('a waiting proposal: Bo says so and Vorschlag ansehen opens the proposals sheet with Übernehmen', async () => {
  const { port } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Vorschlag ansehen' }));
  const sheet = await screen.findByRole('dialog', { name: 'Vorschlag' });
  expect(within(sheet).getByRole('button', { name: 'Übernehmen' })).toBeTruthy();
});

test('on Woche the proposals sheet never opens by itself after the last answer', async () => {
  const { port, map, notify } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Vorschlag ansehen' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Vorschlag' })).getByRole('button', { name: 'Nein danke' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Vorschlag' })).toBeNull());
  map.set('chat:c3', { ...ruleMsg, id: 'c3', updatedMs: 9, body: { ...(ruleMsg.body as object), nextChange: 'chg-m3', atMs: NOW - 100 } });
  map.set('change:chg-m3', { ...proposedChange, id: 'chg-m3' });
  notify();
  await screen.findByRole('button', { name: 'Vorschlag ansehen' });
  expect(screen.queryByRole('dialog', { name: /^Vorschl(ag|äge)$/ })).toBeNull();
});

test('without a plan: seven calm dots, no count, and Bo offers Woche planen', async () => {
  const { port } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  const week = await screen.findByRole('region', { name: 'Diese Woche' });
  expect(await within(week).findByRole('list', { name: 'Wochenweg' })).toBeTruthy();
  expect(week.textContent).toContain('Für diese Woche gibt es noch keinen Plan.');
  expect(screen.queryByText(/von \d+ geschafft/)).toBeNull();
  expect(screen.queryByRole('region', { name: 'Tage' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Woche planen' }));
  expect(await screen.findByRole('dialog', { name: 'Bo, dein Sensei' })).toBeTruthy();
});

test('Rückblick, Was Bo beachtet and Nächste Woche open their sheets from quiet rows', async () => {
  const nextPlan: TrackedRecord = { ...takenPlan, id: '2026-11-09', body: { ...(takenPlan.body as object), weekStart: '2026-11-09', days: weekDates('2026-11-09').map((date, i) => ({ date, sport: i === 1 ? 'gym' : 'rest', hardness: 'moderate', fixed: false })) } };
  const { port } = fakePort([takenPlan, nextPlan]);
  render(<CoachScreen port={port} {...env} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Rückblick' }));
  expect(await screen.findByRole('dialog', { name: 'Rückblick' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Was Bo beachtet' }));
  expect(await screen.findByRole('dialog', { name: 'Was Bo beachtet' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Nächste Woche' }));
  expect(within(await screen.findByRole('dialog', { name: 'Nächste Woche' })).getByRole('list', { name: 'Wochenplan nächste Woche' })).toBeTruthy();
});

test('Escape in the proposal sheet closes only that sheet: the chat and its composer stay open and no plan changes', async () => {
  const { port, map, notify } = fakePort([riderMsg, coachMsg, ruleMsg, proposedChange]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await openMoreProposals();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Vorschl(ag|äge)$/ })).toBeNull());
  // answering the last proposal in the sheet closes it
  const sheet = await openMoreProposals();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Nein danke' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Vorschlag' })).toBeNull());
  // a proposal that arrives later waits behind the strip; the sheet does not open by itself
  map.set('chat:c3', { ...ruleMsg, id: 'c3', updatedMs: 9, body: { ...(ruleMsg.body as object), nextChange: 'chg-m3', atMs: NOW - 100 } });
  map.set('change:chg-m3', { ...proposedChange, id: 'chg-m3' });
  notify();
  await screen.findByRole('button', { name: /^Bo hat noch/ });
  expect(screen.queryByRole('dialog', { name: /^Vorschl(ag|äge)$/ })).toBeNull();
  expect(within(screen.getByRole('dialog', { name: 'Bo, dein Sensei' })).getByLabelText('Nachricht an Bo')).toBeTruthy();
  expect(records(map, 'weekplan')).toHaveLength(0); // looking is not taking
});

test('an open proposal older than the shown messages is still reachable behind the strip', async () => {
  const many = Array.from({ length: 31 }, (_, i): TrackedRecord => ({ kind: 'chat', id: `n${String(i).padStart(2, '0')}`, updatedMs: 10 + i, deleted: false, body: { role: 'rider', text: `Nachricht ${i}`, atMs: NOW - 400 + i } }));
  const { port } = fakePort([riderMsg, coachMsg, ...many]);
  render(<CoachScreen port={port} {...env} />);
  const chat = within(await openChat());
  const strip = await chat.findByRole('button', { name: /^Bo hat noch einen weiteren Vorschlag/ });
  expect(chat.queryByRole('group', { name: /^Vorschlag Wochenplan/ })).toBeNull();
  fireEvent.click(strip);
  const sheet = within(await screen.findByRole('dialog', { name: 'Vorschlag' }));
  expect(sheet.getByRole('group', { name: /^Vorschlag Wochenplan/ })).toBeTruthy();
});

test('a double tap on Übernehmen writes the plan and the note once', async () => {
  const { port, map } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  const btn = await proposalIn().then((b) => within(b).getByRole('button', { name: 'Übernehmen' }));
  fireEvent.click(btn);
  fireEvent.click(btn);
  await waitFor(() => expect(records(map, 'chat').filter((r) => (r.body as { takes?: string }).takes === 'c1')).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 50));
  expect(records(map, 'chat').filter((r) => (r.body as { takes?: string }).takes === 'c1')).toHaveLength(1);
  expect(records(map, 'weekplan')).toHaveLength(1);
});

test('Bo shows no "Woche planen" while the waiting proposal is still being read', async () => {
  const { port } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  expect(screen.queryByRole('button', { name: 'Woche planen' })).toBeNull();
  await screen.findByRole('button', { name: 'Vorschlag ansehen' });
  expect(screen.queryByRole('button', { name: 'Woche planen' })).toBeNull();
});
