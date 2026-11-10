// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';
import { setsSheet } from './live-helpers';

afterEach(cleanup);

const rec = (w: LoggedWorkout): TrackedRecord => ({ kind: 'workout', id: w.id, updatedMs: 1, deleted: false, body: w });
const set = (weightKg: number | null, reps: number | null, doneMs: number | null) => ({ type: 'normal' as const, weightKg, reps, durationS: null, doneMs });
const ids = { newId: () => 'new-id', now: () => 100_000 };
const bodyOf = (m: Map<string, TrackedRecord>) => m.get('workout:w1')!.body as LoggedWorkout;
const three = (): LoggedWorkout => ({
  id: 'w1', title: 'Push', startMs: 1000, endMs: null, source: 'pandafit',
  exercises: [
    { exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(60, 8, 5000), set(60, 8, 6000)] },
    { exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [set(80, 5, 7000), set(80, 5, null), set(80, 5, null)] },
    { exerciseId: 'pf-deadlift', title: 'Kreuzheben', supersetId: null, notes: '', sets: [set(100, 5, null)] },
  ],
});
async function running(w = three()) {
  const f = fakePort([rec(w)]);
  render(<WorkoutScreen port={f.port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  await screen.findByRole('region', { name: 'Kniebeuge' });
  return f;
}
test('the hints sit on the next open set only', async () => {
  await running(); // Kniebeuge: set 1 done, set 2 is next
  const rows = within(await setsSheet(1)).getAllByLabelText(/^Gewicht Satz/).map((i) => i.closest('.tk-set')!);
  expect(rows).toHaveLength(3);
  expect(rows.map((r) => r.querySelector('.tk-hint, .tk-plates') !== null)).toEqual([false, true, false]); // plates for the next set with a weight
});

test('the menu actions reach the same functions: add a set, a note on request, move, edit mode', async () => {
  const f = await running();
  fireEvent.click(screen.getByRole('button', { name: 'Satz hinzufügen Kniebeuge' })); // the plus in the dot row
  await waitFor(() => expect(bodyOf(f.map).exercises[1]!.sets).toHaveLength(4));
  expect(screen.queryByLabelText('Notiz zu Kniebeuge')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Menü Kniebeuge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Notiz hinzufügen Kniebeuge' }));
  expect(screen.getByLabelText('Notiz zu Kniebeuge')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Menü Kniebeuge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reihenfolge ändern Kniebeuge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kniebeuge nach unten' })); // the one list: arrows (or a drag) there
  await waitFor(() => expect(bodyOf(f.map).exercises.map((e) => e.title)).toEqual(['Bankdrücken', 'Kreuzheben', 'Kniebeuge']));
});

test('an existing note is shown without asking', async () => {
  const w = three();
  w.exercises[1]!.notes = 'Tiefer gehen';
  await running(w);
  expect((screen.getByLabelText('Notiz zu Kniebeuge') as HTMLTextAreaElement).value).toBe('Tiefer gehen');
});

test('the end sheet: not entering is the primary choice, Trotzdem als gemacht eintragen the second, Zurück changes nothing', async () => {
  const f = await running();
  fireEvent.click(screen.getByRole('button', { name: 'Training beenden' }));
  const sheet = await screen.findByRole('dialog', { name: '3 Sätze sind noch offen' });
  const buttons = within(sheet).getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Schließen');
  expect(buttons.map((b) => b.textContent)).toEqual(['Offene Sätze nicht eintragen', 'Trotzdem als gemacht eintragen', 'Zurück']);
  expect(buttons[0]!.className).not.toMatch(/secondary|link/); // the filled one
  expect(buttons[1]!.className).toContain('secondary');
  fireEvent.click(within(sheet).getByRole('button', { name: 'Zurück' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(bodyOf(f.map).endMs).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Training beenden' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Trotzdem als gemacht eintragen' }));
  await waitFor(() => expect(bodyOf(f.map).exercises.flatMap((e) => e.sets).every((s) => s.doneMs !== null)).toBe(true));
  expect(bodyOf(f.map).endMs).not.toBeNull();
});

test('the header menu: discard asks first and then removes the workout; Studio and Coach open from there', async () => {
  const f = await running();
  fireEvent.click(screen.getByRole('button', { name: 'Mehr zum Training' }));
  const menu = screen.getByRole('dialog', { name: 'Training' });
  for (const name of [/^Studio wechseln/, /^Bo fragen/, /^Training beenden/]) expect(within(menu).getByRole('button', { name })).toBeTruthy();
  fireEvent.click(within(menu).getByRole('button', { name: 'Training verwerfen' }));
  expect(f.map.get('workout:w1')!.deleted).toBe(false);
  fireEvent.click(within(menu).getByRole('button', { name: 'Ja' }));
  await waitFor(() => expect(f.map.get('workout:w1')!.deleted).toBe(true));
  expect(await screen.findByRole('button', { name: /^(Anderes Training|Leeres Training starten)$/ })).toBeTruthy();
});

test('Bo fragen from the header menu opens the coach panel', async () => {
  await running();
  expect(screen.queryByRole('region', { name: 'Bo im Training' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mehr zum Training' }));
  fireEvent.click(screen.getByRole('button', { name: /^Bo fragen/ }));
  expect(await screen.findByRole('region', { name: 'Bo im Training' })).toBeTruthy();
});

// The rest card and the head ("Läuft seit") are in live-frame.test.tsx.

test('the start screen: studio is a pill, the others live behind "Anderes Training"', async () => {
  const f = fakePort([]);
  const plan = { name: 'Plan', exercises: [{ templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: 60, reps: 8 }] }] };
  render(<WorkoutScreen port={f.port} plan={plan} {...ids} />);
  await screen.findByRole('button', { name: /^(Anderes Training|Leeres Training starten)$/ });
  expect(screen.queryByRole('button', { name: 'Leeres Training starten' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Anderes Training' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Anderes Training' })).getByRole('button', { name: 'Leeres Training starten' }));
  await waitFor(() => expect(f.state.puts.some((p) => p.kind === 'workout')).toBe(true));
});

test('Reihenfolge from the menu: the arrow buttons move one place', async () => {
  const f = await running();
  fireEvent.click(screen.getByRole('button', { name: 'Menü Kniebeuge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reihenfolge ändern Kniebeuge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kreuzheben nach oben' }));
  await waitFor(() => expect(bodyOf(f.map).exercises.map((e) => e.title).join(',')).toBe('Bankdrücken,Kreuzheben,Kniebeuge'));
});

test('zeigt alle Aktionen einer Übung in einer Liste', async () => {
  await running();
  fireEvent.click(screen.getByRole('button', { name: 'Menü Kniebeuge' }));
  const list = within(screen.getByRole('list', { name: 'Menü Kniebeuge' }));
  for (const name of [/tauschen/, /Pause ändern/, /Reihenfolge ändern/]) expect(list.getByRole('button', { name })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Entfernen' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Mehr$/ })).toBeNull();
  expect(list.queryByRole('button', { name: 'Satz hinzufügen Kniebeuge' })).toBeNull(); // the plus does that now
});
