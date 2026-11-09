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

test('Woche shows the week and the rows Mein Ziel, Regeln and Coach; the old forms are not on the page', async () => {
  const { port } = fakePort([riderMsg, coachMsg, { kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false, body: { ...proposal, fromMessage: 'c1', acceptedMs: 1 } }]);
  render(<CoachScreen port={port} {...env} />);
  expect(await screen.findByRole('list', { name: 'Wochenplan diese Woche' })).toBeTruthy();
  for (const name of [/^Ziel und Planung/, /^Was Bo beachtet/, /^Bo/]) expect(screen.getByRole('button', { name })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Ziel und Planung/ }).textContent).toContain('Muskeln aufbauen');
  expect(screen.getByRole('button', { name: /^Was Bo beachtet/ }).textContent).toContain('nichts');
  expect(screen.queryByLabelText('Nachricht an Bo')).toBeNull();
  expect(screen.queryByLabelText('Neue Regel')).toBeNull();
  expect(screen.queryByLabelText('Planung')).toBeNull();
});

test('the Coach row previews the last message and shows no second "waiting" while the card does', async () => {
  const { port } = fakePort([riderMsg, { ...coachMsg, body: { ...(coachMsg.body as object), proposal: undefined, text: 'Alles klar.' } }]);
  render(<CoachScreen port={port} {...env} />);
  expect((await screen.findByRole('button', { name: /^Bo/ })).textContent).toContain('Alles klar.');
  cleanup();
  const waiting = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={waiting.port} {...env} />);
  expect((await screen.findByRole('button', { name: /^Bo/ })).textContent).not.toContain('Ein Vorschlag wartet auf dich');
  expect(screen.getAllByText('Ein Vorschlag wartet auf dich')).toHaveLength(1);
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
  expect(await screen.findByText(/Es gibt noch keinen Wochenplan/)).toBeTruthy();
  await openChat();
  fireEvent.change(screen.getByLabelText('Nachricht an Bo'), { target: { value: '  3× Rad bitte ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
  await waitFor(() => expect(records(map, 'chat').map((r) => r.body)).toEqual([{ role: 'rider', text: '3× Rad bitte', atMs: NOW }]));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Gesendet. Bo antwortet, sobald er kann.');
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
  expect(screen.getByRole('list', { name: 'Wochenplan diese Woche' }).textContent).toContain('Kraft · mittel');
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

test('the run coach runs sit on their days in the week, and are listed alone without a week plan', async () => {
  const { runFp } = await import('../../src/shared/run');
  const run = { date: '2026-11-04', kind: 'easy' as const, minutes: 35, hrCap: 150, counts: 'Zeit zählt.', note: null };
  const runWeek: TrackedRecord = { kind: 'run', id: 'week-2026-11-02', updatedMs: 1, deleted: false, body: {
    type: 'week', week: '2026-11-02', announce: true, atMs: 1, phase: 1, source: 'rules', reason: 'Ruhig.', note: null, runs: [{ ...run, fp: runFp(run), done: null }], garmin: null } };
  const { port } = fakePort([runWeek]);
  render(<CoachScreen port={port} {...env} />);
  expect((await screen.findByRole('list', { name: 'Läufe diese Woche' })).textContent).toContain('Laufen · 35 Min · locker · Puls bis 150');
  cleanup();
  const plan: TrackedRecord = { kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false, body: { ...proposal, fromMessage: 'c1', acceptedMs: 1 } };
  const two = fakePort([runWeek, plan]);
  render(<CoachScreen port={two.port} {...env} />);
  const wed = (await screen.findByRole('list', { name: 'Wochenplan diese Woche' })).querySelectorAll('li')[2]!;
  expect(wed.textContent).toContain('Laufen · 35 Min · locker'); expect(wed.textContent?.match(/Laufen/g)).toHaveLength(1);
});

test('the coach writes by itself only when switched on here; the settings are saved as a record', async () => {
  const { port, map } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  const evening = await screen.findByRole('switch', { name: /Am Vorabend sagen/ }) as HTMLInputElement;
  expect(evening.checked).toBe(false);
  fireEvent.click(evening);
  await waitFor(() => expect(records(map, 'coachprefs')[0]?.body).toEqual({ week: { on: false, day: 6, hour: 18 }, evening: { on: true, hour: 19 } }));
  expect(await screen.findByRole('button', { name: /Uhrzeit am Vorabend/ })).toBeTruthy();
});

test('without a week plan: one "Woche planen" button, no empty day list, no second Coach row; the goal is a suggestion', async () => {
  const { port } = fakePort();
  render(<CoachScreen port={port} {...env} />);
  expect(await screen.findByRole('button', { name: 'Woche planen' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Wochenplan diese Woche' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Bo/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^Ziel und Planung/ }).textContent).toContain('Vorschlag: Muskeln aufbauen');
  await openChat();
});

test('a waiting proposal gets a card under the week with Ansehen, which opens the chat', async () => {
  const { port } = fakePort([riderMsg, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  const card = await screen.findByRole('region', { name: 'Ein Vorschlag wartet auf dich' });
  fireEvent.click(within(card).getByRole('button', { name: 'Ansehen' }));
  expect(await screen.findByRole('dialog', { name: 'Bo, dein Sensei' })).toBeTruthy();
});

test('Escape in the proposal sheet closes only that sheet: the chat and its composer stay open and no plan changes', async () => {
  const { port, map } = fakePort([riderMsg, coachMsg, ruleMsg, proposedChange]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await openMoreProposals();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Vorschl(ag|äge)$/ })).toBeNull());
  // answering the last proposal in the sheet closes it
  const sheet = await openMoreProposals();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Nein danke' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Vorschlag' })).toBeNull());
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
