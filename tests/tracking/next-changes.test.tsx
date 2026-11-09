// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { openChat, proposalIn } from './open-chat';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { applyNextChanges, changeRecord, moveChange, readChange, takenChanges, usedMarks, type NextOp } from '../../src/shared/changes';
import { EXERCISES } from '../../src/shared/exercises';
import { RECORD_KINDS, type LoggedWorkout, type TrackedRecord } from '../../src/shared/records';
import { validBody } from '../../src/web/validate';
import { startFromPlan } from '../../src/tracking/session';
import { ChatCoach } from '../../src/coach/chat/chat-coach';
import { takenChangesOf } from '../../src/coach/tracking/changes';
import type { GymWorkout } from '../../src/shared/gym/types';
import { fakePort } from './fake-port';

afterEach(cleanup);
const plan: GymWorkout = { name: 'Plan', exercises: [
  { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 60, reps: 8 })) },
  { templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [1, 2, 3].map(() => ({ type: 'normal' as const, weightKg: 80, reps: 5 })) },
] };
const drop: NextOp[] = [{ op: 'drop', exerciseId: 'pf-squat' }];
const proposed = (mid = 'm1', ops: NextOp[] = drop) => changeRecord(mid, ops, 'Knie zwickt, deshalb ohne Kniebeuge.', 1000);
const taken = (r = proposed()) => moveChange(r, 'taken', 2000)!;
const stateOf = (map: Map<string, TrackedRecord>, id: string) => (map.get(`change:${id}`)!.body as { state: string }).state;

test('the kind is registered and validated', () => {
  expect(RECORD_KINDS).toContain('change');
  expect(validBody('change', proposed().body)).toBe(true);
  expect(validBody('change', { target: 'next', ops: [], state: 'taken', atMs: 1 })).toBe(false);
  expect(readChange('x', { ...(proposed().body as object), state: 'weird' })).toBeNull();
});

test('a state only moves forward', () => {
  const p = proposed();
  expect(moveChange(p, 'used', 5)).toBeNull();
  const t = moveChange(p, 'taken', 5)!;
  expect(t.updatedMs).toBeGreaterThan(p.updatedMs);
  expect(moveChange(t, 'declined', 6)).toBeNull();
  expect(moveChange(t, 'proposed', 6)).toBeNull();
  const used = moveChange(t, 'used', 7, 'w9')!;
  expect(used.body).toMatchObject({ state: 'used', usedBy: 'w9' });
  expect(moveChange(used, 'undone', 8)).toBeNull();
  expect(moveChange(moveChange(p, 'declined', 5)!, 'taken', 6)).toBeNull();
});

test('an older device cannot revive a used change, whatever its time stamp says', async () => {
  const used = moveChange(taken(), 'used', 3000, 'w1')!;
  const { port, map } = fakePort([used]);
  const stale: TrackedRecord = { ...proposed(), updatedMs: 999_999 };
  const r = await port.put(stale);
  expect(r.kept).toBe(false);
  expect(stateOf(map, 'chg-m1')).toBe('used');
  // and the other way round: a used version replaces a newer-stamped taken one
  const both = fakePort([{ ...taken(), updatedMs: 888_888 }]);
  await both.port.put(used);
  expect(stateOf(both.map, 'chg-m1')).toBe('used');
});

test('a declined or undone change is never applied', () => {
  const declined = moveChange(proposed('a'), 'declined', 5)!;
  const undone = moveChange(taken(proposed('b')), 'undone', 9)!;
  const records = [declined, undone, proposed('c')];
  expect(takenChanges(records)).toEqual([]);
  const w = startFromPlan(plan, [], 0, 'w1', EXERCISES, undefined, undefined, { changes: takenChanges(records), workouts: [] });
  expect(w.exercises).toHaveLength(2);
  expect(w.changes).toBeUndefined();
});

test('taken changes apply oldest first; ops for exercises not in the plan are skipped with a note', () => {
  const lighter = moveChange(changeRecord('l', [{ op: 'lighter', exerciseId: 'pf-bench-press' }, { op: 'sets', exerciseId: 'pf-bench-press', sets: 2 }], 'Leichter.', 500), 'taken', 600)!;
  const gone = moveChange(changeRecord('g', [{ op: 'drop', exerciseId: 'nope' }], 'x', 700), 'taken', 800)!;
  const out = applyNextChanges(plan, takenChanges([gone, taken(), lighter]), EXERCISES);
  expect(out.plan.exercises.map((e) => e.templateId)).toEqual(['pf-bench-press']);
  expect(out.plan.exercises[0]!.sets.map((s) => s.weightKg)).toEqual([54, 54]);
  expect(out.notes).toHaveLength(1);
  let lines: string[] = [];
  const w = startFromPlan(plan, [], 0, 'w1', EXERCISES, undefined, undefined, { changes: takenChanges([gone]), workouts: [], onSkipped: (l) => { lines = l; } });
  // the line goes to the rider's screen, never into the exercise notes (those are exported)
  expect(lines.join(' ')).toContain('passte nicht mehr');
  expect(w.exercises[0]!.notes).toBe('');
  expect(w.changes).toBeUndefined();
});

test('lighter lands on the exercise\'s weight ladder of the workout\'s studio, not on 0.5 kg', () => {
  const day = 86_400_000;
  const session = (startMs: number, studio: string | undefined, kgs: number[]): LoggedWorkout => ({ id: `h${startMs}`, title: 'H', startMs, endMs: startMs + 1, source: 'pandafit', ...(studio ? { studio } : {}), exercises: [{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: kgs.map((kg) => ({ type: 'normal' as const, weightKg: kg, reps: 8, durationS: null, doneMs: startMs + 1 })) }] });
  const history = [20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60].map((kg, i) => session(day * (i + 1), 'Gym A', [kg]));
  const t = moveChange(changeRecord('l', [{ op: 'lighter', exerciseId: 'pf-bench-press' }], 'Leichter.', 500), 'taken', 600)!;
  const w = startFromPlan(plan, history, 0, 'w1', EXERCISES, 'Gym A', undefined, { changes: takenChanges([t]), workouts: [] });
  const kgs = w.exercises[0]!.sets.map((s) => s.weightKg!);
  // 60 kg less 10 % is 54; this machine here moves in steps of 4 kg, so it lands on 52, not on 54.
  expect(kgs).toEqual([52, 52, 52]);
});

test('sets on an exercise without working sets is skipped with a note', () => {
  const onlyWarm: GymWorkout = { ...plan, exercises: [{ ...plan.exercises[0]!, sets: [{ type: 'warmup', weightKg: 20, reps: 10 }] }] };
  const c = moveChange(changeRecord('s', [{ op: 'sets', exerciseId: 'pf-bench-press', sets: 3 }], 'x', 1), 'taken', 2)!;
  const out = applyNextChanges(onlyWarm, takenChanges([c]), EXERCISES);
  expect(out.plan.exercises[0]!.sets).toEqual(onlyWarm.exercises[0]!.sets);
  expect(out.notes).toHaveLength(1);
});

test('starting twice does not apply a change twice, and a start that died before the mark is made up', () => {
  const t = taken();
  const first = startFromPlan(plan, [], 10, 'w1', EXERCISES, undefined, undefined, { changes: takenChanges([t]), workouts: [] });
  expect(first.exercises).toHaveLength(1);
  expect(first.changes).toEqual([{ id: 'chg-m1', atMs: 10, prior: [], pos: [], after: [] }]);
  // the app died before `used` was written: the change is still taken, but the workout lists it
  const second = startFromPlan(plan, [], 20, 'w2', EXERCISES, undefined, undefined, { changes: takenChanges([t]), workouts: [first as LoggedWorkout] });
  expect(second.exercises).toHaveLength(2);
  expect(second.changes).toBeUndefined();
  const marks = usedMarks([t], [first as LoggedWorkout], 30);
  expect(marks).toHaveLength(1);
  expect(marks[0]!.body).toMatchObject({ state: 'used', usedBy: 'w1' });
  expect(usedMarks(marks, [first as LoggedWorkout], 40)).toEqual([]);
});

test('a change is listed (and later used) only if one of its ops applied; otherwise it stays taken', () => {
  const upper: GymWorkout = { ...plan, name: 'Oberkörper', exercises: [plan.exercises[0]!] };
  const t = taken();
  const a = startFromPlan(upper, [], 10, 'w1', EXERCISES, undefined, undefined, { changes: takenChanges([t]), workouts: [] });
  expect(a.changes).toBeUndefined();
  expect(usedMarks([t], [a as LoggedWorkout], 20)).toEqual([]);
  expect(takenChanges([t]).map((c) => c.id)).toEqual(['chg-m1']);
  const b = startFromPlan(plan, [], 30, 'w2', EXERCISES, undefined, undefined, { changes: takenChanges([t]), workouts: [a as LoggedWorkout] });
  expect(b.exercises).toHaveLength(1);
  expect(b.changes?.map((c) => c.id)).toEqual(['chg-m1']);
  expect(usedMarks([t], [a as LoggedWorkout, b as LoggedWorkout], 40)[0]!.body).toMatchObject({ state: 'used', usedBy: 'w2' });
});

test('a thrown-away workout leaves the change taken; it is marked used when a workout is finished', async () => {
  const { port, map } = fakePort([taken()]);
  const { unmount } = render(<WorkoutScreen port={port} plan={plan} routine={plan} {...env} newId={() => 'w-a'} />);
  await waitFor(() => expect(map.has('workout:w-a')).toBe(true));
  expect((map.get('workout:w-a')!.body as LoggedWorkout).changes?.map((c) => c.id)).toEqual(['chg-m1']);
  expect(stateOf(map, 'chg-m1')).toBe('taken');
  unmount();
  // thrown away: the workout is deleted
  map.set('workout:w-a', { ...map.get('workout:w-a')!, deleted: true, updatedMs: NOW + 5 });
  render(<WorkoutScreen port={port} plan={plan} routine={plan} {...env} newId={() => 'w-b'} />);
  await waitFor(() => expect(map.has('workout:w-b')).toBe(true));
  expect((map.get('workout:w-b')!.body as LoggedWorkout).exercises.map((e) => e.exerciseId)).toEqual(['pf-bench-press']);
  expect(stateOf(map, 'chg-m1')).toBe('taken');
  // finished: the mark is made up
  const done = map.get('workout:w-b')!;
  map.set('workout:w-b', { ...done, updatedMs: NOW + 9, body: { ...(done.body as object), endMs: NOW + 8 } });
  cleanup();
  render(<WorkoutScreen port={port} plan={plan} routine={null} {...env} newId={() => 'w-c'} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Training starten' }));
  await waitFor(() => expect(stateOf(map, 'chg-m1')).toBe('used'));
  expect(map.get('change:chg-m1')!.body).toMatchObject({ usedBy: 'w-b' });
});

const chatRec = (id: string, body: object, updatedMs = 1): TrackedRecord => ({ kind: 'chat', id, updatedMs, deleted: false, body });
const NOW = new Date(2026, 10, 4, 18).getTime();
const env = { now: () => NOW, newId: () => 'new-id' };

test('propose -> take -> the plan is regenerated -> reopen -> start: the change is in the workout (still taken until it is finished)', async () => {
  // the coach side proposes
  const recs = new Map<string, TrackedRecord>([['chat:r1', chatRec('r1', { role: 'rider', text: 'Nächstes Mal ohne Kniebeuge', atMs: NOW - 1000 })]]);
  const store = {
    all: (_id: string, kind: string) => [...recs.values()].filter((r) => r.kind === kind),
    put: (_id: string, r: TrackedRecord) => { recs.set(`${r.kind}:${r.id}`, r); return r; },
  };
  recs.set('plan:current', { kind: 'plan', id: 'current', updatedMs: 1, deleted: false, body: { workout: plan, reason: 'x' } });
  const coach = new ChatCoach({
    store: store as never, nowMs: () => NOW, newId: () => 'm1',
    ask: (async () => ({ text: 'Okay, notiert.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], tasks: [], nextChange: { reason: 'Ohne Kniebeuge, weil du es so wolltest.', ops: [{ op: 'drop', exerciseId: 'pf-squat' }] } })) as never,
  });
  await coach.tick('p');
  const msg = recs.get('chat:m1')!.body as { nextChange?: string };
  expect(msg.nextChange).toBe('chg-m1');
  expect(recs.get('change:chg-m1')!.body).toMatchObject({ target: 'next', state: 'proposed' });

  // the rider takes it on the coach screen
  const { port, map } = fakePort([...recs.values()]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(stateOf(map, 'chg-m1')).toBe('taken'));
  expect(await screen.findByRole('button', { name: 'Rückgängig' })).toBeTruthy();
  cleanup();

  // the coach side re-plans: it reads the taken change and never writes or clears it
  expect(takenChangesOf({ all: (_i: string, k?: string) => [...map.values()].filter((r) => r.kind === k) } as never, 'p').map((c) => c.id)).toEqual(['chg-m1']);
  const before = JSON.stringify(map.get('change:chg-m1'));

  // close and reopen: start from the plan
  render(<WorkoutScreen port={port} plan={plan} routine={plan} {...env} newId={() => 'w-new'} />);
  await waitFor(() => expect(map.has('workout:w-new')).toBe(true));
  const w = map.get('workout:w-new')!.body as LoggedWorkout;
  expect(w.exercises.map((e) => e.exerciseId)).toEqual(['pf-bench-press']);
  expect(w.changes?.map((c) => c.id)).toEqual(['chg-m1']);
  // used only when the workout is finished, not at the start
  expect(stateOf(map, 'chg-m1')).toBe('taken');
  expect(JSON.stringify(map.get('change:chg-m1'))).toBe(before);
});

test('the rider can say no, and undo while it is not used', async () => {
  const { port, map } = fakePort([chatRec('c1', { role: 'coach', text: 'Vorschlag.', atMs: NOW - 500, nextChange: 'chg-m1' }), proposed(), chatRec('c2', { role: 'coach', text: 'Zwei.', atMs: NOW - 400, nextChange: 'chg-m2' }), proposed('m2')]);
  render(<CoachScreen port={port} {...env} />);
  await openChat();
  await proposalIn();
  const nein = await screen.findAllByRole('button', { name: 'Nein danke' });
  fireEvent.click(nein[0]!);
  await waitFor(() => expect(stateOf(map, 'chg-m1')).toBe('declined'));
  fireEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
  await waitFor(() => expect(stateOf(map, 'chg-m2')).toBe('taken'));
  fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(stateOf(map, 'chg-m2')).toBe('undone'));
});
