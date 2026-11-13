// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { RoutinesScreen } from '../../src/tracking/ui/RoutinesScreen';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { WorkoutDetail } from '../../src/tracking/ui/HistoryScreen';
import { ExercisesScreen } from '../../src/tracking/ui/ExercisesScreen';
import { ExercisePicker } from '../../src/tracking/ui/ExercisePicker';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import type { GymWorkout } from '../../src/shared/gym/types';
import { fakePort } from './fake-port';
import { bodyOf, doneNow, ids, rec, set, setsSheet } from './live-helpers';
import { EQUIPMENT, MUSCLES, TYPES } from '../../src/tracking/ui/labels';

afterEach(cleanup);

const open = (extra: object = {}): LoggedWorkout => ({
  id: 'open1', title: 'Zuhause', startMs: 1000, endMs: null, source: 'pandafit',
  exercises: [{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(62.5, 8, null), set(null, null, null)] }],
  ...extra,
});
const finished = (id = 'f1', endMs = 9000): LoggedWorkout => ({
  id, title: 'Beine', startMs: endMs - 1000, endMs, source: 'pandafit',
  exercises: [{ exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [set(80, 5, endMs), set(85, 5, endMs)] }],
});

test('reopening with an open workout offers to continue it', async () => {
  const { port } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  expect(await screen.findByText('Bankdrücken')).toBeTruthy();
});

test('shows 62,5 kg, and accepts comma or dot, with a short placeholder only', async () => {
  const { port, map } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  const w1 = (await screen.findByLabelText('Gewicht Satz 1')) as HTMLInputElement;
  expect(w1.value).toBe('62,5');
  const sheet = within(await setsSheet(2));
  const w2 = sheet.getByLabelText('Gewicht Satz 2') as HTMLInputElement;
  expect(w2.value).toBe('');
  expect(w2.placeholder).toBe('62,5'); // an empty row shows the set before as its preset
  fireEvent.change(w2, { target: { value: '40.5' } });
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[1].weightKg).toBe(40.5));
  fireEvent.change(w2, { target: { value: '41,5' } });
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[1].weightKg).toBe(41.5));
  // reps only is valid: confirm set 2 with no reps
  fireEvent.change(w2, { target: { value: '' } });
  fireEvent.change(sheet.getByLabelText('Wiederholungen Satz 2'), { target: { value: '12' } });
  fireEvent.click(sheet.getByRole('button', { name: 'Satz 2 erledigt' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[1]).toMatchObject({ weightKg: null, reps: 12, doneMs: 100_000 }));
});

test('the rest timer survives a reload through its stored start', async () => {
  const w = { ...open(), rest: { startMs: 70_000, durationS: 90 } };
  const { port } = fakePort([rec(w as LoggedWorkout)]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  expect((await screen.findByRole('timer', { name: 'Satzpause' })).textContent).toContain('1:00');
});

test('the rest end is armed once with the end time, and skipping or unmounting cancels it', async () => {
  const w = { ...open(), rest: { startMs: 70_000, durationS: 90 } };
  const { port } = fakePort([rec(w as LoggedWorkout)]);
  const restAlarm = vi.fn();
  port.restAlarm = restAlarm;
  const view = render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  await screen.findByRole('timer', { name: 'Satzpause' });
  expect(restAlarm.mock.calls).toEqual([[160_000]]);
  fireEvent.click(screen.getByRole('button', { name: 'Pause beenden' }));
  await waitFor(() => expect(restAlarm).toHaveBeenLastCalledWith(null));
  expect(restAlarm).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(restAlarm).toHaveBeenLastCalledWith(null);
});

test('a rest that is already over arms nothing, and a port without restAlarm works', async () => {
  const over = { ...open(), rest: { startMs: 1000, durationS: 90 } };
  const { port } = fakePort([rec(over as LoggedWorkout)]);
  const restAlarm = vi.fn();
  port.restAlarm = restAlarm;
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  await screen.findByText('Bankdrücken');
  expect(restAlarm.mock.calls.every((c) => c[0] === null)).toBe(true);
  cleanup();
  const plain = fakePort([rec({ ...open(), rest: { startMs: 70_000, durationS: 90 } } as LoggedWorkout)]);
  render(<WorkoutScreen port={plain.port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  expect(await screen.findByRole('timer', { name: 'Satzpause' })).toBeTruthy();
});

test('starting from the plan prefills the range and saves at once', async () => {
  const plan: GymWorkout = { name: 'Plan', exercises: [{ templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: null, repRange: { start: 8, end: 12 } }] }] };
  const { port, map } = fakePort();
  render(<WorkoutScreen port={port} plan={plan} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Training starten' }));
  expect(((await screen.findByLabelText('Wiederholungen Satz 1')) as HTMLInputElement).value).toBe('8');
  expect(screen.getByText(/8–12/)).toBeTruthy();
  expect(map.get('workout:new-id')).toBeTruthy();
});

test('finish with open sets asks, and leaving them out keeps them unconfirmed', async () => {
  const { port, map } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Satz geschafft' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[0].doneMs).toBe(100_000));
  fireEvent.click(screen.getByRole('button', { name: 'Training beenden' }));
  expect(await screen.findByRole('button', { name: 'Trotzdem als gemacht eintragen' })).toBeTruthy();
  expect((await screen.findByRole('dialog', { name: 'Ein Satz ist noch offen' })).textContent).toContain('Offene Sätze nicht eintragen');
  fireEvent.click(screen.getByRole('button', { name: 'Offene Sätze nicht eintragen' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').endMs).toBe(100_000));
  expect(bodyOf(map, 'workout:open1').exercises[0].sets[1].doneMs).toBeNull();
});

test('finish without confirmed sets asks first and never deletes silently', async () => {
  const { port, map } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Training beenden' }));
  expect(map.get('workout:open1')!.deleted).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Weiter trainieren' }));
  expect(map.get('workout:open1')!.deleted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Training beenden' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Training verwerfen' }));
  expect(map.get('workout:open1')!.deleted).toBe(false); // the link asks once more
  fireEvent.click(await screen.findByRole('button', { name: 'Ja' }));
  await waitFor(() => expect(map.get('workout:open1')!.deleted).toBe(true)); // tombstone, record still there
});

test('a failing save shows a calm message, keeps the set, and the next action saves it', async () => {
  const { port, map, state } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  state.failPuts = true;
  fireEvent.click(await screen.findByRole('button', { name: 'Satz geschafft' }));
  expect((await screen.findByRole('status')).textContent).toMatch(/nicht gespeichert/);
  state.failPuts = false;
  fireEvent.click(within(await setsSheet(2)).getByRole('button', { name: 'Satz 2 erledigt' }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(bodyOf(map, 'workout:open1').exercises[0].sets.map((s) => s.doneMs)).toEqual([100_000, 100_000]);
});

test('an exercise can be swapped from the workout screen', async () => {
  const { port, map } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Menü Bankdrücken' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Bankdrücken tauschen' }));
  const similar = await screen.findByRole('region', { name: 'Ähnliche Übungen' });
  expect(within(similar).getAllByRole('button').map((b) => b.textContent)[0]).toMatch(/Bankdrücken|Schrägbankdrücken/); // a built-in leads, not a base variant
  fireEvent.click(within(similar).getByRole('button', { name: /^Brustpresse/ }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises.map((e) => e.exerciseId)).toEqual(['pf-chest-press-machine']));
});

test('a search in the picker finds the English Hevy name', async () => {
  const { port } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Menü Bankdrücken' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Bankdrücken tauschen' }));
  fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'squat' } });
  expect(screen.getByRole('button', { name: 'Kniebeuge' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Ähnliche Übungen' })).toBeNull();
});

test('past workouts can be edited and deleted', async () => {
  const { port, map } = fakePort([rec(finished())]);
  render(<WorkoutDetail port={port} record={rec(finished())} now={ids.now} onBack={() => {}} />);
  expect(await screen.findByText('80 kg × 5 · 85 kg × 5')).toBeTruthy(); // read mode first: one line, no fields
  expect(screen.queryByLabelText('Gewicht Satz 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  fireEvent.change(await screen.findByLabelText('Gewicht Satz 1'), { target: { value: '82,5' } });
  await waitFor(() => expect(bodyOf(map, 'workout:f1').exercises[0].sets[0].weightKg).toBe(82.5));
  fireEvent.click(screen.getByRole('button', { name: 'Training löschen' }));
  expect(map.get('workout:f1')!.deleted).toBe(false);
  fireEvent.click(await screen.findByRole('button', { name: 'Ja' }));
  await waitFor(() => expect(map.get('workout:f1')!.deleted).toBe(true));
});

test('history shows progress per exercise', async () => {
  const { port } = fakePort([rec(finished('a', 5000)), rec(finished('b', 9000))]);
  render(<WorkoutDetail port={port} record={rec(finished('b', 9000))} now={ids.now} onBack={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Kniebeuge/ }));
  expect(await screen.findByText('Bester Satz je Training')).toBeTruthy();
  expect(screen.queryByText(/^Seit /)).toBeNull(); // the best weight did not change
  fireEvent.click(screen.getAllByRole('button', { name: /85 kg × 5/ })[0]!);
  expect(screen.getByText('80 kg × 5 · 85 kg × 5')).toBeTruthy();
});

test('history says how the best weight moved since the first time', async () => {
  const first = finished('a', 5000);
  first.exercises[0]!.sets = [set(50, 5, 5000)];
  const { port } = fakePort([rec(first), rec(finished('b', 9000))]);
  render(<WorkoutDetail port={port} record={rec(finished('b', 9000))} now={ids.now} onBack={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Kniebeuge/ }));
  expect(await screen.findByText(/^Seit .+ von 50 auf 85 kg$/)).toBeTruthy();
});

test('confirming a set with no value at all takes the set before it', async () => {
  const w = open({ exercises: [{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(60, 8, 1500), set(null, null, null)] }] });
  const { port, map } = fakePort([rec(w)]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Satz geschafft' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[1]).toMatchObject({ weightKg: 60, reps: 8, doneMs: 100_000 }));
});

test('a routine can be created, edited and started', async () => {
  const { port, map } = fakePort();
  const onStart = vi.fn();
  render(<RoutinesScreen port={port} onStart={onStart} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Neue Routine' }));
  fireEvent.change(screen.getByLabelText('Name der Routine'), { target: { value: 'Push' } });
  fireEvent.click(screen.getByRole('button', { name: 'Übung hinzufügen' }));
  fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'Bankdrücken' } });
  fireEvent.click(await screen.findByRole('button', { name: "Bankdrücken" }));
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(map.get('routine:new-id')).toBeTruthy());
  expect((map.get('routine:new-id')!.body as GymWorkout).name).toBe('Push');
  fireEvent.click(await screen.findByRole('button', { name: /^Push/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  fireEvent.change(screen.getByLabelText('Name der Routine'), { target: { value: 'Push A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect((map.get('routine:new-id')!.body as GymWorkout).name).toBe('Push A'));
  fireEvent.click(await screen.findByRole('button', { name: /^Push A/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Training starten' }));
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'Push A' }));
});

test('custom exercises can be added', async () => {
  const { port, map } = fakePort();
  const onPick = vi.fn();
  render(<ExercisePicker port={port} onPick={onPick} onClose={() => {}} {...ids} />);
  // muscle groups collapsed, searchable; a search without a hit offers the own exercise
  expect(screen.getAllByRole('button', { name: /Brust|Rücken|Beine|Quadrizeps/ }).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Kniebeuge' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'kniebeuge' } });
  expect(screen.getAllByRole('button', { name: /Kniebeuge/ }).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'zzzz' } });
  expect(screen.getByText('Nichts gefunden.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Eigene Übung anlegen' }));
  const save = screen.getByRole('button', { name: 'Übung speichern' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tire Flip' } });
  const choose = (row: string, option: string) => { fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${row}`) })); fireEvent.click(screen.getByRole('button', { name: option })); };
  choose('Muskelgruppe', MUSCLES.quadriceps!);
  choose('Gerät', EQUIPMENT.other!);
  choose('Zählt nach', TYPES.duration!);
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(map.get('exercise:new-id')).toBeTruthy());
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-id', title: 'Tire Flip', type: 'duration' }));
});

test('own exercises show up in the picker, timed ones get a seconds field', async () => {
  const own = { id: 'own-1', title: 'Plank Eigen', type: 'duration', primaryMuscle: 'abdominals', equipment: 'none' };
  const w = { ...open(), exercises: [{ exerciseId: 'own-1', title: 'Plank Eigen', supersetId: null, notes: '', timed: true, sets: [set(null, null, null)] }] };
  const { port } = fakePort([{ kind: 'exercise', id: 'own-1', updatedMs: 1, deleted: false, body: own }, rec(w as unknown as LoggedWorkout)]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  expect(await screen.findByLabelText('Sekunden Satz 1')).toBeTruthy();
  expect(screen.queryByLabelText('Wiederholungen Satz 1')).toBeNull();
});

test('shows calmly that a finished workout is not on the server yet', async () => {
  const { port, state } = fakePort([rec(finished())]);
  state.pending = 1;
  render(<ExercisesScreen port={port} {...ids} />);
  const note = await screen.findByRole('status');
  expect(note.textContent).toMatch(/noch nicht auf dem Server/i);
  expect(note.textContent).toMatch(/sicher/);
  within(note); // calm text, no alarm role
  expect(screen.queryByRole('alert')).toBeNull();
});

// ---- fix round ----
const twoEx = (): LoggedWorkout => open({ exercises: [
  { exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(60, 8, null), set(60, 8, null)] },
  { exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [set(80, 5, null)] },
] });
const resume = async () => fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
// The exercise menu ("⋯"): sets are removed in edit mode, a note appears on request.
const openMenu = async (title: string) => fireEvent.click(await screen.findByRole('button', { name: `Menü ${title}` }));
const editSets = async (title: string) => { fireEvent.click(await screen.findByRole('button', { name: /^(Satz 1|Aufwärmsatz):/ })); };
const noteField = async (title: string) => { await openMenu(title); fireEvent.click(screen.getByRole('button', { name: `Notiz hinzufügen ${title}` })); return (await screen.findByLabelText(`Notiz zu ${title}`)) as HTMLTextAreaElement; };

test('a double tap on remove never removes the next row', async () => {
  const { port, map } = fakePort([rec(twoEx())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await editSets('Bankdrücken');
  const btn = (await screen.findAllByRole('button', { name: 'Satz 1 entfernen' }))[0];
  fireEvent.click(btn); fireEvent.click(btn);
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets).toHaveLength(1));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Bankdrücken' })).getByRole('button', { name: /^(Schließen|‹ Zurück)$/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Menü Bankdrücken' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
  const ex = await screen.findByRole('button', { name: 'Ja' });
  fireEvent.click(ex); fireEvent.click(ex);
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises.map((e) => e.title)).toEqual(['Kniebeuge']));
});

test('removing a confirmed set asks first, an unconfirmed one does not', async () => {
  const w = open({ exercises: [{ exerciseId: 'a', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(60, 8, 500), set(60, 8, null)] }] });
  const { port, map } = fakePort([rec(w)]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await editSets('Bankdrücken');
  fireEvent.click(await screen.findByRole('button', { name: 'Satz 2 entfernen' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Satz 1 entfernen' }));
  expect(bodyOf(map, 'workout:open1').exercises[0].sets).toHaveLength(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Ja, entfernen' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets).toHaveLength(0));
});

test('typing with slow saves keeps every digit, also while earlier saves land', async () => {
  const { port, state } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await screen.findByLabelText('Gewicht Satz 1');
  const f = within(await setsSheet(2)).getByLabelText('Gewicht Satz 2') as HTMLInputElement;
  state.delayMs = 40;
  fireEvent.focus(f);
  for (const v of ['6', '62', '625']) fireEvent.change(f, { target: { value: v } });
  await new Promise((r) => setTimeout(r, 60)); // the first save has landed, the others are still pending
  expect(state.puts.length).toBeGreaterThan(0);
  expect(f.value).toBe('625');
  await new Promise((r) => setTimeout(r, 200));
  expect(f.value).toBe('625');
});

test('unreadable text shows calmly as invalid and blocks confirming; reps are not rounded', async () => {
  const { port, map } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await screen.findByLabelText('Gewicht Satz 1');
  const sheet = within(await setsSheet(2));
  const w = sheet.getByLabelText('Gewicht Satz 2');
  const ok = sheet.getByRole('button', { name: 'Satz 2 erledigt' }) as HTMLButtonElement;
  fireEvent.change(w, { target: { value: 'abc' } });
  expect(w.getAttribute('aria-invalid')).toBe('true');
  expect(sheet.getByText('Bitte eine Zahl')).toBeTruthy();
  expect(ok.disabled).toBe(true);
  fireEvent.change(w, { target: { value: '20' } });
  expect(ok.disabled).toBe(false);
  const reps = sheet.getByLabelText('Wiederholungen Satz 2');
  fireEvent.change(reps, { target: { value: '8,5' } });
  expect(sheet.getByText('Bitte eine ganze Zahl')).toBeTruthy();
  await new Promise((r) => setTimeout(r, 20));
  expect(bodyOf(map, 'workout:open1').exercises[0].sets[1].reps).not.toBe(9);
  expect(bodyOf(map, 'workout:open1').exercises[0].sets[1].reps).not.toBe(8.5);
});

test('notes keep what is typed and save after a short pause and on blur', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { port, map } = fakePort([rec(open())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const n = await noteField('Bankdrücken');
    fireEvent.focus(n);
    for (const v of ['S', 'Sc', 'Sch']) fireEvent.change(n, { target: { value: v } });
    expect(n.value).toBe('Sch');
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].notes).toBe('Sch'));
    expect(n.value).toBe('Sch');
    fireEvent.change(n, { target: { value: 'Schulter' } });
    fireEvent.blur(n);
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].notes).toBe('Schulter'));
  } finally { vi.useRealTimers(); }
});

test('a note typed right before finishing is in the finished record', async () => {
  const w = open();
  w.exercises[0].sets = [set(60, 5, 1000)];
  const { port, state } = fakePort([rec(w)]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  const n = await noteField('Bankdrücken');
  fireEvent.focus(n);
  fireEvent.change(n, { target: { value: 'Schluss' } });
  fireEvent.click(screen.getByRole('button', { name: 'Training beenden' }));
  await waitFor(() => expect(state.puts.some((p) => (p.body as LoggedWorkout).endMs !== null)).toBe(true));
  const final = state.puts.filter((p) => (p.body as LoggedWorkout).endMs !== null).at(-1)!.body as LoggedWorkout;
  expect(final.exercises[0].notes).toBe('Schluss');
});

test('nothing confirmed also offers to mark all sets done', async () => {
  const { port, map } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  fireEvent.click(await screen.findByRole('button', { name: 'Training beenden' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Alle Sätze als erledigt markieren' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets.every((s) => s.doneMs !== null)).toBe(true));
});

test('an old open workout shows its date and can be continued, ended or discarded; others are listed too', async () => {
  const older = { ...open({ id: 'old', title: 'Gestern', startMs: 5000 }) };
  const { port, map } = fakePort([rec(open({ startMs: 90_000 })), rec(older)]);
  render(<WorkoutScreen port={port} {...ids} />);
  expect(await screen.findByRole('button', { name: 'Weitermachen' })).toBeTruthy();
  expect(screen.getAllByText(/Gestartet/).length).toBe(2); // both visible
  fireEvent.click(screen.getByRole('button', { name: /Gestern/ })); // the older one is a row card with a small sheet
  const sheet = await screen.findByRole('dialog');
  expect(within(sheet).getByRole('button', { name: /^Weitermachen Gestern/ })).toBeTruthy();
  expect(within(sheet).getByRole('button', { name: /^Training beenden Gestern/ })).toBeTruthy();
  fireEvent.click(within(sheet).getByRole('button', { name: /Training verwerfen Gestern/ }));
  expect(map.get('workout:old')!.deleted).toBe(false);
  fireEvent.click(await within(sheet).findByRole('button', { name: 'Ja' }));
  await waitFor(() => expect(map.get('workout:old')!.deleted).toBe(true));
});

test('ending an old open workout from the list asks the finish question', async () => {
  const { port } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Training beenden' }));
  expect(await screen.findByRole('button', { name: 'Training verwerfen' })).toBeTruthy(); // nothing confirmed question
});

test('a double tap on start creates only one workout', async () => {
  const { port, state } = fakePort();
  let n = 0;
  render(<WorkoutScreen port={port} now={() => 100_000} newId={() => `id${++n}`} />);
  const b = await screen.findByRole('button', { name: 'Leeres Training starten' });
  fireEvent.click(b); fireEvent.click(b);
  await screen.findByText('Training');
  expect(state.puts.filter((p) => p.kind === 'workout').map((p) => p.id)).toEqual(['id1']);
});

test('a copy finished on another device is announced, not reopened', async () => {
  const { port, map, notify } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await screen.findByLabelText('Gewicht Satz 1');
  map.set('workout:open1', { ...rec(open({ endMs: 99_999 })), updatedMs: 5_000_000 });
  notify();
  expect((await screen.findByRole('status')).textContent).toMatch(/anderen Gerät beendet/);
  expect(screen.queryByRole('button', { name: 'Weitermachen' })).toBeNull();
});

test('a newer remote copy of an open workout is continued from', async () => {
  const { port, map, notify } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await screen.findByLabelText('Gewicht Satz 1');
  const remote = open({ exercises: [{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(99, 8, null)] }] });
  map.set('workout:open1', { ...rec(remote), updatedMs: 5_000_000 });
  notify();
  await waitFor(() => expect((screen.getByLabelText('Gewicht Satz 1') as HTMLInputElement).value).toBe('99'));
});

test('a failed first read shows a calm message with a retry, not the start screen', async () => {
  const { port, state } = fakePort([rec(open())]);
  state.failList = true;
  render(<WorkoutScreen port={port} {...ids} />);
  expect((await screen.findByRole('status')).textContent).toMatch(/nicht gelesen/);
  expect(screen.queryByRole('button', { name: 'Leeres Training starten' })).toBeNull();
  state.failList = false;
  fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }));
  expect(await screen.findByRole('button', { name: 'Weitermachen' })).toBeTruthy();
});

test('WorkoutScreen starts a given routine', async () => {
  const routine: GymWorkout = { name: 'Push', exercises: [{ templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: null }] }] };
  const { port } = fakePort();
  render(<WorkoutScreen port={port} routine={routine} {...ids} />);
  expect(await screen.findByText('Bankdrücken')).toBeTruthy();
  expect(screen.getByText('Push')).toBeTruthy();
});

test('Übungen: "Deine Übungen" lists the exercises done, a tap shows last values and progress, the catalog follows', async () => {
  const { port } = fakePort([rec(finished('a', 5000)), rec(finished('b', 9000))]);
  render(<ExercisesScreen port={port} {...ids} />);
  const mine = await screen.findByRole('list', { name: 'Deine Übungen' });
  expect(screen.getByRole('heading', { name: 'Anleitungen nachschlagen' })).toBeTruthy();
  fireEvent.click(within(mine).getByRole('button', { name: 'Kniebeuge' }));
  expect(await screen.findByText('Bester Satz je Training')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
  expect(await screen.findByRole('list', { name: 'Deine Übungen' })).toBeTruthy();
});

test('Übungen: one word per exercise for how it moves, none without an earlier value', async () => {
  const day = 86_400_000;
  const now = 200 * day;
  const lift = (id: string, at: number, kg: number, exerciseId = 'pf-squat', title = 'Kniebeuge'): LoggedWorkout => ({
    id, title: 'Beine', startMs: at, endMs: at + 1000, source: 'pandafit',
    exercises: [{ exerciseId, title, supersetId: null, notes: '', sets: [set(kg, 5, at)] }],
  });
  const { port } = fakePort([
    rec(lift('old', now - 50 * day, 80)), rec(lift('new', now - 3 * day, 90)),
    rec(lift('b-old', now - 50 * day, 60, 'pf-bench-press', 'Bankdrücken')), rec(lift('b-new', now - 3 * day, 60, 'pf-bench-press', 'Bankdrücken')),
    rec(lift('r-new', now - 3 * day, 40, 'pf-row', 'Rudern')),
  ]);
  render(<ExercisesScreen port={port} now={() => now} newId={ids.newId} />);
  const mine = await screen.findByRole('list', { name: 'Deine Übungen' });
  expect(within(mine).getByRole('button', { name: /^Kniebeuge/ }).textContent).toBe('Kniebeugesteigt›');
  expect(within(mine).getByRole('button', { name: /^Bankdrücken/ }).textContent).toBe('Bankdrückengleich›');
  expect(within(mine).getByRole('button', { name: /^Rudern/ }).textContent).toBe('Rudern›');
});

// ---- fix round 2 ----
test('a failed first save with a list that lacks the record keeps the screen open and retrying', async () => {
  const { port, map, state } = fakePort();
  state.failPuts = true;
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Leeres Training starten' }));
  expect((await screen.findByRole('status')).textContent).toMatch(/nicht gespeichert/);
  await new Promise((r) => setTimeout(r, 30));
  expect(screen.getByRole('button', { name: 'Training beenden' })).toBeTruthy(); // not stepped aside
  state.failPuts = false;
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt nochmal speichern' }));
  await waitFor(() => expect(map.get('workout:new-id')).toBeTruthy());
});

test('a delete from elsewhere on a clean screen mentions the copy when one was kept', async () => {
  const { port, map, notify } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await screen.findByRole('button', { name: 'Training beenden' });
  const copy = { ...finished('open1-kopie-1'), keptCopyOf: 'open1' };
  map.set('workout:open1-kopie-1', rec(copy));
  map.set('workout:open1', { ...rec(open()), deleted: true, updatedMs: 5_000_000 });
  notify();
  expect((await screen.findByRole('status')).textContent).toMatch(/gelöscht.*Die Fassung mit mehr Sätzen liegt als Kopie im Verlauf\./);
});

async function dirtyOpen() {
  const h = fakePort([rec(open())]);
  render(<WorkoutScreen port={h.port} {...ids} />);
  await resume();
  h.state.failPuts = true;
  fireEvent.click(await screen.findByRole('button', { name: 'Satz geschafft' }));
  await screen.findByRole('status');
  return h;
}

test('a tombstone from elsewhere with unsaved work here: stay open, say so, and the next write wins', async () => {
  const { map, state, notify } = await dirtyOpen();
  map.set('workout:open1', { ...rec(open()), deleted: true, updatedMs: 5_000_000 });
  notify();
  expect((await screen.findByRole('note')).textContent).toMatch(/anderen Gerät/);
  expect(screen.getByLabelText('Gewicht Satz 2')).toBeTruthy(); // still open, the focus on the next set
  state.failPuts = false;
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt nochmal speichern' }));
  await waitFor(() => expect(map.get('workout:open1')!.deleted).toBe(false));
  expect(map.get('workout:open1')!.updatedMs).toBeGreaterThan(5_000_000);
  expect(bodyOf(map, 'workout:open1').exercises[0].sets[0].doneMs).toBe(100_000);
});

test('a remote finish with unsaved work here: stay open and keep writing', async () => {
  const { map, state, notify } = await dirtyOpen();
  map.set('workout:open1', { ...rec(open({ endMs: 99_999 })), updatedMs: 5_000_000 });
  notify();
  expect((await screen.findByRole('note')).textContent).toMatch(/beendet/);
  state.failPuts = false;
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt nochmal speichern' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[0].doneMs).toBe(100_000));
  expect(map.get('workout:open1')!.updatedMs).toBeGreaterThan(5_000_000);
});

test('a failed discard from the open-workout card does not retry; the workout can be resumed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { port, map, state } = fakePort([rec(open())]);
    render(<WorkoutScreen port={port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Training verwerfen' }));
    state.failPuts = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Ja' }));
    await screen.findByRole('status');
    state.failPuts = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(map.get('workout:open1')!.deleted).toBe(false);
    expect(state.puts.some((p) => p.deleted)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Weitermachen' }));
    expect(await screen.findByLabelText('Gewicht Satz 1')).toBeTruthy();
  } finally { vi.useRealTimers(); }
});

test('leaving the screen with an unsaved set keeps retrying in the background', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const { port, map, state } = fakePort([rec(open())]);
    const view = render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    state.failPuts = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Satz geschafft' }));
    await screen.findByRole('status');
    view.unmount();
    state.failPuts = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(bodyOf(map, 'workout:open1').exercises[0].sets[0].doneMs).toBe(100_000);
  } finally { vi.useRealTimers(); }
});

test('removing a set asks when it is confirmed in the newest state, even if the display lags', async () => {
  const { port, map, state } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  await editSets('Bankdrücken');
  let release!: () => void; state.gate = new Promise<void>((r) => { release = r; });
  fireEvent.click(await screen.findByRole('button', { name: 'Satz 1 erledigt' })); // display not updated until put answers
  fireEvent.click(screen.getByRole('button', { name: 'Satz 1 entfernen' }));
  expect(await screen.findByRole('button', { name: 'Ja, entfernen' })).toBeTruthy();
  state.gate = null; release();
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets).toHaveLength(2));
});

test('after a failed finish, a successful retry leaves the screen', async () => {
  const w = open({ exercises: [{ exerciseId: 'a', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(60, 8, 500), set(60, 8, null)] }] });
  const { port, map, state } = fakePort([rec(w)]);
  render(<WorkoutScreen port={port} {...ids} />);
  await resume();
  fireEvent.click(await screen.findByRole('button', { name: 'Training beenden' }));
  state.failPuts = true;
  fireEvent.click(await screen.findByRole('button', { name: 'Offene Sätze nicht eintragen' }));
  await screen.findByRole('status');
  state.failPuts = false;
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt nochmal speichern' }));
  expect(await screen.findByRole('region', { name: 'Zusammenfassung' })).toBeTruthy();
  expect(bodyOf(map, 'workout:open1').endMs).not.toBeNull();
});

test('a double tap on saving a routine makes one routine with one id per draft', async () => {
  const { port, state } = fakePort();
  let n = 0;
  render(<RoutinesScreen port={port} onStart={() => {}} now={() => 100_000} newId={() => `r${++n}`} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Neue Routine' }));
  fireEvent.change(screen.getByLabelText('Name der Routine'), { target: { value: 'Push' } });
  expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Gib einen Namen und mindestens eine Übung an.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Übung hinzufügen' }));
  fireEvent.change(screen.getByLabelText('Suchen'), { target: { value: 'Bankdrücken' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Bankdrücken' }));
  const save = screen.getByRole('button', { name: 'Speichern' });
  fireEvent.click(save); fireEvent.click(save);
  await screen.findByRole('button', { name: /^Push/ });
  expect(state.puts.filter((p) => p.kind === 'routine').map((p) => p.id)).toEqual(['r1']);
});

test('the set table: headers, chips, one grid, a clear done box and last time as a hint', async () => {
  const w = open({ exercises: [{ exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [{ ...set(20, 10, null), type: 'warmup' }, set(40, 8, null), { ...set(40, 6, null), type: 'failure' }] }] });
  const { port } = fakePort([rec(w), rec(finished())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  await screen.findByLabelText('Gewicht Satz 1');
  const dialog = await setsSheet(1);
  const sheet = within(dialog);
  expect(sheet.getByRole('button', { name: 'Satz 1 entfernen' })).toBeTruthy(); // the table is always editable
  const head = dialog.querySelector('.tk-head')!;
  expect(head.textContent).toBe('SatzkgWdh');
  const rows = [...dialog.querySelectorAll('.tk-set:not(.tk-head)')];
  expect(rows.map((r) => r.querySelector('.tk-chip')!.textContent)).toEqual(['Aufw.', '1', 'F']);
  // every row and the header have the same five cells (× first), whatever the set type
  for (const r of [head, ...rows]) expect([...r.children].filter((c) => !c.matches('.tk-hint, .tk-plates, .tk-wide')).length).toBe(5);
  // full names in the choice
  expect([...(sheet.getByLabelText('Satztyp Satz 1') as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Aufwärmen', 'Normaler Satz', 'Bis zum Versagen', 'Dropset']);
  // the hints belong to the next open set only (the warm-up has no earlier one)
  expect(screen.queryByText(/zuletzt/)).toBeNull();
  fireEvent.click(sheet.getByRole('button', { name: 'Satz 1 erledigt' }));
  // last time: the finished session had 80 × 5 and 85 × 5 as working sets
  expect(await sheet.findByText('Zuletzt 80 kg × 5 · 85 kg × 5')).toBeTruthy(); // once, above the table
  const check = sheet.getByRole('button', { name: 'Satz 2 erledigt' });
  expect(check.textContent).toBe('✓');
  expect(check.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(sheet.getByRole('button', { name: 'Schließen' }));
  // swap and remove live behind one menu
  expect(screen.queryByRole('button', { name: 'Kniebeuge tauschen' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Menü Kniebeuge' }));
  expect(screen.getByRole('button', { name: 'Kniebeuge tauschen' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Kniebeuge' })).getByRole('button', { name: 'Schließen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Menü Kniebeuge' }));
  // the note is a growing text field, there when asked for
  expect(screen.queryByLabelText('Notiz zu Kniebeuge')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Notiz hinzufügen Kniebeuge' }));
  expect(screen.getByLabelText('Notiz zu Kniebeuge').tagName).toBe('TEXTAREA');
});

test('a plan without weights says "Das Gewicht wählst du nach Gefühl." once, under the title', async () => {
  const plan: GymWorkout = { name: 'Plan', exercises: [{ templateId: 'pf-leg-press', title: 'Beinpresse', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: 10 }, { type: 'normal', weightKg: null, reps: 10 }] }] };
  const { port } = fakePort();
  render(<WorkoutScreen port={port} plan={plan} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Training starten' }));
  expect(await screen.findAllByText('Das Gewicht wählst du nach Gefühl.')).toHaveLength(1);
  expect((screen.getByLabelText('Gewicht Satz 1') as HTMLInputElement).placeholder).toBe('–');
});

test('the workout shows how long it has been running', async () => {
  const { port } = fakePort([rec(open())]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Mehr zum Training' }));
  expect((await screen.findByRole('timer', { name: 'Trainingsdauer' })).textContent).toBe('Läuft seit 1 Min');
});

test('two exercises can be joined to a superset and taken apart again from the menu', async () => {
  const w = open({ exercises: [
    { exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(60, 8, null)] },
    { exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [set(80, 5, null)] },
  ] });
  const { port, map } = fakePort([rec(w)]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Menü Bankdrücken' }));
  fireEvent.click(screen.getByRole('button', { name: /^Supersatz mit/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Supersatz mit' })).getByRole('button', { name: 'Kniebeuge' }));
  await waitFor(() => {
    const g = bodyOf(map, 'workout:open1').exercises.map((e) => e.supersetId);
    expect(g[0]).not.toBeNull();
    expect(g[0]).toBe(g[1]);
  });
  expect(await screen.findByText('Im Wechsel mit Kniebeuge.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Menü Bankdrücken' }));
  expect(screen.queryByRole('button', { name: /^Supersatz mit/ })).toBeNull(); // no partner left
  fireEvent.click(screen.getByRole('button', { name: 'Bankdrücken aus dem Superset lösen' }));
  await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises.map((e) => e.supersetId)).toEqual([null, null]));
});

describe('effort question after an exercise', () => {
  const planned = (): LoggedWorkout => open({ exercises: [{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [{ ...set(60, 8, null), plannedReps: 8 }] }] });
  afterEach(() => localStorage.clear());
  it('asks after the last set when the plan was hit, and stores the answer', async () => {
    const { port, map } = fakePort([rec(planned())]);
    render(<WorkoutScreen port={port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
    expect(screen.queryByRole('group', { name: 'Wie liefen die letzten Wiederholungen bei Bankdrücken?' })).toBeNull();
    doneNow();
    const q = await screen.findByRole('group', { name: 'Wie liefen die letzten Wiederholungen bei Bankdrücken?' });
    fireEvent.click(within(q).getByRole('button', { name: 'Langsamer, aber sauber' }));
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].effort).toBe('some'));
    expect(screen.queryByRole('group', { name: 'Wie liefen die letzten Wiederholungen bei Bankdrücken?' })).toBeNull();
    expect(within(await setsSheet(1)).getByText('Letzte Wiederholungen: Langsamer, aber sauber.')).toBeTruthy();
  });
  it('fragt nach dem Tempo der letzten Wiederholungen', async () => {
    const { port, map } = fakePort([rec(planned())]);
    render(<WorkoutScreen port={port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
    doneNow();
    const q = await screen.findByRole('group', { name: 'Wie liefen die letzten Wiederholungen bei Bankdrücken?' });
    expect(within(q).getAllByRole('button').slice(0, 3).map((b) => b.textContent)).toEqual(['So schnell wie die ersten', 'Langsamer, aber sauber', 'Die letzte ging kaum noch hoch']);
    fireEvent.click(within(q).getByRole('button', { name: 'So schnell wie die ersten' }));
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].effort).toBe('plenty'));
  });
  it('zeigt nach der Antwort, was das nächste Mal passiert, und lässt sie ändern', async () => {
    const { port } = fakePort([rec(planned())]);
    render(<WorkoutScreen port={port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
    doneNow();
    fireEvent.click(within(await screen.findByRole('group', { name: 'Wie liefen die letzten Wiederholungen bei Bankdrücken?' })).getByRole('button', { name: 'Langsamer, aber sauber' }));
    expect(await screen.findByText(/^Nächstes Mal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Doch anders' }));
    expect(screen.queryByText(/^Nächstes Mal/)).toBeNull();
    const again = await screen.findByRole('group', { name: 'Wie liefen die letzten Wiederholungen bei Bankdrücken?' });
    fireEvent.click(within(again).getByRole('button', { name: 'So schnell wie die ersten' }));
    expect(await screen.findByText(/^Nächstes Mal/)).toBeTruthy();
  });
  it('can be skipped, and switched off on this device', async () => {
    const { port, map } = fakePort([rec(planned())]);
    render(<WorkoutScreen port={port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
    doneNow();
    fireEvent.click(within(await screen.findByRole('group', { name: /^Wie liefen die letzten Wiederholungen/ })).getByRole('button', { name: 'Nicht mehr fragen' }));
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].effort).toBe('skip'));
    expect(localStorage.getItem('pandafit-effort-questions')).toBe('off');
    expect(screen.queryByRole('group', { name: /^Wie liefen die letzten Wiederholungen/ })).toBeNull();
  });
});

test('the start screen shows what the plan holds before starting', async () => {
  const { port } = fakePort();
  const plan: GymWorkout = { name: 'Oberkörper', exercises: [
    { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [
      { type: 'warmup', weightKg: 20, reps: 10 }, { type: 'normal', weightKg: 62.5, reps: 8 }, { type: 'normal', weightKg: 62.5, reps: 8 }, { type: 'normal', weightKg: 62.5, reps: 8 }] },
    { templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: null, repRange: { start: 8, end: 12 } }, { type: 'normal', weightKg: null, reps: null, repRange: { start: 8, end: 12 } }] },
  ] };
  render(<WorkoutScreen port={port} plan={plan} {...ids} />);
  const card = await screen.findByRole('region', { name: 'Nächstes Training' });
  expect(within(card).getByText('Oberkörper')).toBeTruthy();
  expect(within(card).getByText(/^Krafttraining, etwa \d+ Minuten, 2 Übungen$/)).toBeTruthy(); // one line, no exercise list
  expect(card.querySelector('li')).toBeNull();
  expect(within(card).getByRole('button', { name: 'Training starten' })).toBeTruthy();
});

test('the rest timer has 30 s mehr, and the per-exercise Pause select sets the rest', async () => {
  const w = { ...open(), rest: { startMs: 70_000, durationS: 90 } };
  const { port, map } = fakePort([rec(w as LoggedWorkout)]);
  render(<WorkoutScreen port={port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  fireEvent.click(await screen.findByRole('button', { name: '30 s mehr' }));
  await waitFor(() => expect((bodyOf(map, 'workout:open1') as unknown as { rest: { durationS: number } }).rest.durationS).toBe(120));
  fireEvent.click(screen.getByRole('button', { name: 'Menü Bankdrücken' }));
  fireEvent.click(within(screen.getByRole('list', { name: 'Menü Bankdrücken' })).getByRole('button', { name: /^Pause ändern/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Pause ändern' })).getByRole('button', { name: '180 s' }));
  await waitFor(() => expect((bodyOf(map, 'workout:open1').exercises[0] as unknown as { restS: number }).restS).toBe(180));
});

describe('next time, in the history of the latest workout', () => {
  const stats = (next: object[]): TrackedRecord => ({ kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body: { type: 'stats', atMs: 1, goal: null, days: [], muscles: {}, next } });
  const step = (over: object = {}) => ({ exerciseId: 'pf-squat', title: 'Kniebeuge', weightKg: 62.5, reps: 8, why: 'progress', reason: 'weil du alle Wiederholungen geschafft hast', forWorkoutId: 'b', atMs: 8000, ...over });
  it('shows one line per exercise with the reason', async () => {
    const { port } = fakePort([rec(finished('a', 5000)), rec(finished('b', 9000)), stats([step()])]);
    render(<WorkoutDetail port={port} record={rec(finished('b', 9000))} now={ids.now} onBack={() => {}} />);
    expect(await screen.findByText('Nächstes Mal: 62,5 kg × 8, weil du alle Wiederholungen geschafft hast.')).toBeTruthy();
    expect(screen.queryByText('Kommt nach der Auswertung')).toBeNull();
  });
  it('shows nothing about the next time until the publish arrives', async () => {
    const { port } = fakePort([rec(finished('a', 5000)), rec(finished('b', 9000))]);
    render(<WorkoutDetail port={port} record={rec(finished('b', 9000))} now={ids.now} onBack={() => {}} />);
    await screen.findByText('Kniebeuge');
    expect(screen.queryByText(/Nächstes Mal|nach der Auswertung/)).toBeNull();
  });
  it('an older workout shows neither', async () => {
    const { port } = fakePort([rec(finished('a', 5000)), rec(finished('b', 9000)), stats([step()])]);
    render(<WorkoutDetail port={port} record={rec(finished('a', 5000))} now={ids.now} onBack={() => {}} />);
    await screen.findByText('Kniebeuge');
    expect(screen.queryByText(/Nächstes Mal/)).toBeNull();
    expect(screen.queryByText('Kommt nach der Auswertung')).toBeNull();
  });
  it('a step for another workout is not shown for this one', async () => {
    const { port } = fakePort([rec(finished('b', 9000)), stats([step({ forWorkoutId: 'zzz', atMs: 1 })])]);
    render(<WorkoutDetail port={port} record={rec(finished('b', 9000))} now={ids.now} onBack={() => {}} />);
    await screen.findByText('Kniebeuge');
    expect(screen.queryByText(/Nächstes Mal|nach der Auswertung/)).toBeNull();
  });
});

// ---- Milestone L, task 5: picker, routines, history ----
test('the picker offers the last used exercises first, and groups open one at a time', async () => {
  const { port } = fakePort([rec(finished())]);
  const onPick = vi.fn();
  render(<ExercisePicker port={port} onPick={onPick} onClose={() => {}} {...ids} />);
  const recent = await screen.findByRole('region', { name: 'Zuletzt benutzt' });
  fireEvent.click(within(recent).getByRole('button', { name: 'Kniebeuge' }));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'pf-squat' }));
  const groups = screen.getByRole('list', { name: 'Muskelgruppen' });
  const heads = within(groups).getAllByRole('button', { expanded: false });
  fireEvent.click(heads[0]!);
  fireEvent.click(heads[1]!);
  expect(within(groups).getAllByRole('button', { expanded: true })).toHaveLength(1);
});

test('a routine opens in a sheet; deleting needs a confirm', async () => {
  const routine: TrackedRecord = { kind: 'routine', id: 'r1', updatedMs: 1, deleted: false, body: { name: 'Push', exercises: [{ templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: null }] }] } };
  const { port, map } = fakePort([routine]);
  render(<RoutinesScreen port={port} onStart={() => {}} {...ids} />);
  const row = await screen.findByRole('button', { name: /^Push/ });
  expect(row.textContent).toMatch(/1 Übung/);
  fireEvent.click(row);
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  fireEvent.click(screen.getByRole('button', { name: 'Routine löschen' }));
  expect(map.get('routine:r1')!.deleted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
  await waitFor(() => expect(map.get('routine:r1')!.deleted).toBe(true));
});

test('the routine editor has steppers per exercise and removes an exercise', async () => {
  const routine: TrackedRecord = { kind: 'routine', id: 'r1', updatedMs: 1, deleted: false, body: { name: 'Push', exercises: [
    { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: null }, { type: 'normal', weightKg: null, reps: null }] },
    { templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: null }] },
  ] } };
  const { port, map } = fakePort([routine]);
  render(<RoutinesScreen port={port} onStart={() => {}} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Push/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  expect(document.activeElement).toBe(screen.getByLabelText('Name der Routine'));
  fireEvent.click(screen.getByRole('button', { name: 'Satz hinzufügen Bankdrücken' }));
  fireEvent.click(screen.getByRole('button', { name: 'Satz hinzufügen Bankdrücken' }));
  fireEvent.click(screen.getByRole('button', { name: 'Satz entfernen Bankdrücken' }));
  fireEvent.click(screen.getByRole('button', { name: 'Übung entfernen Kniebeuge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect((map.get('routine:r1')!.body as GymWorkout).exercises.map((e) => e.sets.length)).toEqual([3]));
});

describe('Zuletzt geändert in the chat', () => {
  const at = (day: number) => new Date(2026, 10, day, 12).getTime();
  const note = (i: number) => ({ atMs: at(i), coach: 'gym', text: `Bankdrücken ${i}`, reason: `Grund ${i}` });
  const stats: TrackedRecord = { kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body: { type: 'stats', atMs: 1, goal: null, days: [], muscles: {}, changes: [1, 2, 3, 4, 5, 6, 7].map(note) } };
  it('the chat opens the newest 5 with date, text and reason', async () => {
    const { port } = fakePort([stats]);
    render(<CoachScreen port={port} now={() => at(8)} newId={() => 'x'} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Frag Bo/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Zuletzt geändert/ }));
    const lines = within(screen.getByRole('list', { name: 'Zuletzt geändert' })).getAllByRole('listitem');
    expect(lines).toHaveLength(5);
    expect(lines[0]!.textContent).toBe('Sa., 7. Nov. · Bankdrücken 7, Grund 7');
  });
});
