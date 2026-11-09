// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { takeWeekPlan, undoWeekPlan, TAKE_REFUSED, UNDO_REFUSED } from '../../src/tracking/week-take';
import type { TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { fakePort } from './fake-port';
import { openChat, proposalIn } from './open-chat';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 18).getTime();
const env = { now: () => NOW, newId: () => 'x' + Math.random() };
const mk = (sport: string) => ({ weekStart: '2026-11-02', days: weekDates('2026-11-02').map((date) => ({ date, sport, hardness: 'easy', fixed: false })) });
const proposal = mk('gym') as never;
const old: TrackedRecord = { kind: 'weekplan', id: '2026-11-02', updatedMs: 5, deleted: false, body: { ...mk('bike'), fromMessage: 'old', acceptedMs: 5 } };
const coachMsg: TrackedRecord = { kind: 'chat', id: 'c1', updatedMs: 2, deleted: false, body: { role: 'coach', text: 'Wie wäre das?', atMs: NOW - 500, proposal } };
const sportOf = (map: Map<string, TrackedRecord>) => { const r = map.get('weekplan:2026-11-02')!; return r.deleted ? null : (r.body as { days: { sport: string }[] }).days[0]!.sport; };

test('take then undo restores the previous plan; without a previous plan the plan goes', async () => {
  const { port, map } = fakePort([old]);
  expect(await takeWeekPlan(port, { proposal, changeId: 'c1', shownMs: 5, now: NOW })).toEqual({ ok: true });
  expect(sportOf(map)).toBe('gym');
  expect(await undoWeekPlan(port, { proposal, changeId: 'c1', now: NOW })).toEqual({ ok: true });
  expect(sportOf(map)).toBe('bike');
  expect(map.get('weekplan:2026-11-02')!.body).not.toHaveProperty('takenFrom');
  const fresh = fakePort();
  await takeWeekPlan(fresh.port, { proposal, changeId: 'c1', shownMs: 0, now: NOW });
  await undoWeekPlan(fresh.port, { proposal, changeId: 'c1', now: NOW });
  expect(sportOf(fresh.map)).toBeNull();
});

test('a take is refused when the stored plan is newer than the shown one', async () => {
  const { port, map } = fakePort([old]);
  expect(await takeWeekPlan(port, { proposal, changeId: 'c1', shownMs: 4, now: NOW })).toEqual({ ok: false, reason: TAKE_REFUSED });
  expect(sportOf(map)).toBe('bike');
});

test('an undo after a later change is refused', async () => {
  const { port, map } = fakePort();
  await takeWeekPlan(port, { proposal, changeId: 'c1', shownMs: 0, now: NOW });
  await takeWeekPlan(port, { proposal: mk('run') as never, changeId: 'c2', shownMs: map.get('weekplan:2026-11-02')!.updatedMs, now: NOW });
  expect(await undoWeekPlan(port, { proposal, changeId: 'c1', now: NOW })).toEqual({ ok: false, reason: UNDO_REFUSED });
  expect(sportOf(map)).toBe('run');
});

test('an undo is refused when the stored days are no longer the proposal\'s, even with the same take id', async () => {
  const { port, map } = fakePort();
  await takeWeekPlan(port, { proposal, changeId: 'c1', shownMs: 0, now: NOW });
  const stored = map.get('weekplan:2026-11-02')!;
  map.set('weekplan:2026-11-02', { ...stored, updatedMs: stored.updatedMs + 5, body: { ...(stored.body as object), days: (mk('run') as { days: unknown[] }).days } });
  expect(await undoWeekPlan(port, { proposal, changeId: 'c1', now: NOW })).toEqual({ ok: false, reason: UNDO_REFUSED });
  expect(sportOf(map)).toBe('run');
});

test('a take compares the stored plan with the time of the proposal message', async () => {
  const { port } = fakePort([{ ...old, updatedMs: NOW - 1000 }]);
  expect(await takeWeekPlan(port, { proposal, changeId: 'c1', shownMs: NOW - 500, now: NOW })).toEqual({ ok: true });
  const newer = fakePort([{ ...old, updatedMs: NOW - 100 }]);
  expect(await takeWeekPlan(newer.port, { proposal, changeId: 'c1', shownMs: NOW - 500, now: NOW })).toEqual({ ok: false, reason: TAKE_REFUSED });
});

test('records without the new fields still read; screen: Rückgängig on the taken message, refusal line when changed', async () => {
  const { port, map } = fakePort([old, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(sportOf(map)).toBe('bike'));
  expect(await screen.findByText(/rückgängig gemacht/)).toBeTruthy();
});

test('screen: a take on a plan changed after the proposal was shown shows the reason', async () => {
  const { port, map, notify } = fakePort([old, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  await screen.findByRole('button', { name: 'Übernehmen' });
  map.set('weekplan:2026-11-02', { ...old, updatedMs: NOW }); notify();
  fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
  expect((await screen.findByRole('alert')).textContent).toBe(TAKE_REFUSED);
  expect(sportOf(map)).toBe('bike');
});

test('screen: the undone state is remembered in the chat, a reload shows it; a lost "Übernommen." note still shows taken', async () => {
  const { port, map } = fakePort([old, coachMsg]);
  const first = render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(sportOf(map)).toBe('bike'));
  first.unmount();
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  expect(await screen.findByText(/Du hast den Wochenplan ab/)).toBeTruthy();
  expect([...map.values()].some((r) => r.kind === 'chat' && (r.body as { undoes?: string }).undoes === 'c1')).toBe(true);
  cleanup();
  // the plan was written but the chat note was not: still shown as taken
  const lost = fakePort([old, coachMsg]);
  await takeWeekPlan(lost.port, { proposal, changeId: 'c1', shownMs: 5, now: NOW });
  render(<CoachScreen port={lost.port} {...env} />);
  await openChat();
  expect(await screen.findByText(/Du hast den Wochenplan ab .* übernommen\./)).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Rückgängig' })).toBeTruthy();
});

test('screen: when the undo is not possible any more the reason stands there instead of a missing button', async () => {
  const { port, map, notify } = fakePort([old, coachMsg]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  await screen.findByRole('button', { name: 'Rückgängig' });
  const cur = map.get('weekplan:2026-11-02')!;
  map.set('weekplan:2026-11-02', { ...cur, updatedMs: cur.updatedMs + 10, body: { ...(cur.body as object), days: (mk('run') as { days: unknown[] }).days } }); notify();
  expect(await screen.findByText(UNDO_REFUSED)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull();
});
