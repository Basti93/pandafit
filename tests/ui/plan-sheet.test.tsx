// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GymWorkout } from '../../src/coach/gym/types';
import { ruleRecord } from '../../src/shared/personal';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { planKeyOf, readDraft, writeDraft, type DraftStorage } from '../../src/tracking/plan-draft';
import type { TrackedWorkout } from '../../src/tracking/session';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from '../tracking/fake-port';

afterEach(cleanup);

const NOW = 50 * 86_400_000;
const set = (weightKg: number | null, reps: number) => ({ type: 'normal' as const, weightKg, reps });
const plan: GymWorkout = { name: 'Pull', exercises: [
  { templateId: 'pf-lat-pulldown', title: 'Latzug', restS: null, supersetId: null, notes: '', sets: [set(50, 10), set(50, 10), set(50, 10)] },
  { templateId: 'pf-face-pull', title: 'Face Pull', restS: null, supersetId: null, notes: '', sets: [set(20, 15), set(20, 15)] },
] };
const meta = { atMs: NOW - 3_600_000, reason: 'Rücken steht im Fokus.', note: 'Schulter schonen.', outlook: null };
const KEY = planKeyOf({ atMs: meta.atMs, workout: plan });
const memory = (): DraftStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); }, m };
};
const throwing: DraftStorage = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); }, removeItem: () => { throw new Error('private'); } };
let n = 0;
const ids = { now: () => NOW, newId: () => `id-${++n}` };

function show(seed: TrackedRecord[] = [], storage: DraftStorage = memory(), extra: { openPlan?: boolean } = {}) {
  const f = fakePort(seed);
  const view = render(<WorkoutScreen port={f.port} plan={plan} planMeta={meta} account="mira" storage={storage} {...ids} {...extra} />);
  return { f, storage, view };
}
const openSheet = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Ansehen und anpassen' }));
  return screen.findByRole('dialog', { name: 'Nächstes Training' });
};
const exercise = (sheet: HTMLElement, title: string) => within(within(sheet).getByRole('region', { name: title }));
const type = (el: HTMLElement, value: string) => { fireEvent.focus(el); fireEvent.change(el, { target: { value } }); fireEvent.blur(el); };
const stored = (s: DraftStorage): TrackedWorkout | null => readDraft(s, 'mira', KEY);

describe('the sheet "Nächstes Training"', () => {
  test('shows the reason and every exercise with its sets and the values the start would fill in', async () => {
    show();
    const sheet = await openSheet();
    expect(within(sheet).getByText('Rücken steht im Fokus.')).toBeTruthy();
    const lat = exercise(sheet, 'Latzug');
    expect(lat.getAllByLabelText(/^Wiederholungen Satz/)).toHaveLength(3);
    expect((lat.getByLabelText('Wiederholungen Satz 1') as HTMLInputElement).value).toBe('10');
    expect((lat.getByLabelText('Gewicht Satz 1') as HTMLInputElement).value).toBe('50');
    expect((exercise(sheet, 'Face Pull').getByLabelText('Wiederholungen Satz 2') as HTMLInputElement).value).toBe('15');
    expect(within(sheet).queryByRole('button', { name: /erledigt/ })).toBeNull(); // no done-tick
  });

  test('changing reps, adding a set, removing and swapping an exercise change the draft', async () => {
    const { storage } = show();
    const sheet = await openSheet();
    type(exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 2'), '8');
    await waitFor(() => expect(stored(storage)?.exercises[0]!.sets[1]!.reps).toBe(8));
    fireEvent.click(exercise(sheet, 'Latzug').getByRole('button', { name: 'Satz hinzufügen Latzug' }));
    await waitFor(() => expect(stored(storage)?.exercises[0]!.sets).toHaveLength(4));
    fireEvent.click(exercise(sheet, 'Latzug').getByRole('button', { name: 'Satz entfernen Latzug' }));
    await waitFor(() => expect(stored(storage)?.exercises[0]!.sets).toHaveLength(3));
    fireEvent.click(exercise(sheet, 'Face Pull').getByRole('button', { name: 'Andere Übung statt Face Pull' }));
    const picker = await screen.findByRole('dialog', { name: 'Übung wählen' });
    fireEvent.change(within(picker).getByLabelText('Suchen'), { target: { value: 'Rudern' } });
    const first = (await within(picker).findAllByRole('button', { name: /Rudern/ }))[0]!;
    const picked = first.textContent!;
    fireEvent.click(first);
    await waitFor(() => expect(stored(storage)?.exercises[1]!.title).toBe(picked));
    fireEvent.click(exercise(sheet, 'Latzug').getByRole('button', { name: 'Übung entfernen Latzug' }));
    await waitFor(() => expect(stored(storage)?.exercises.map((e) => e.title)).toEqual([picked]));
  });

  test('"Training starten" in the sheet starts the edited workout: the edited reps are the planned ones', async () => {
    const { f, storage } = show();
    const sheet = await openSheet();
    type(exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 1'), '6');
    await waitFor(() => expect(stored(storage)).not.toBeNull());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Training starten' }));
    const running = await screen.findByRole('region', { name: 'Latzug' });
    expect((within(running).getByLabelText('Wiederholungen Satz 1') as HTMLInputElement).value).toBe('6');
    const saved = f.state.puts.find((r) => r.kind === 'workout')!.body as LoggedWorkout;
    expect(saved.exercises[0]!.sets[0]!.reps).toBe(6);
    expect(saved.exercises[0]!.sets.every((s) => s.doneMs === null)).toBe(true);
    expect(stored(storage)).toBeNull(); // used up
  });

  test('the card says "Angepasst"; "Änderungen verwerfen" goes back to the plan', async () => {
    const { storage } = show();
    const sheet = await openSheet();
    type(exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 1'), '6');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }));
    await screen.findByText('Angepasst');
    fireEvent.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }));
    expect(screen.queryByText('Angepasst')).toBeNull();
    expect(stored(storage)).toBeNull();
    const again = await openSheet();
    expect((exercise(again, 'Latzug').getByLabelText('Wiederholungen Satz 1') as HTMLInputElement).value).toBe('10');
  });

  test('the card start uses the draft too', async () => {
    const s = memory();
    show([], s);
    const sheet = await openSheet();
    fireEvent.click(exercise(sheet, 'Face Pull').getByRole('button', { name: 'Übung entfernen Face Pull' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pull starten' }));
    await screen.findByRole('region', { name: 'Latzug' });
    expect(screen.queryByRole('region', { name: 'Face Pull' })).toBeNull();
  });

  test('a draft of an older plan never starts; the card says so once', async () => {
    const s = memory();
    const old = { ...(plan as unknown as TrackedWorkout), id: 'x', title: 'Pull', startMs: 1, endMs: null, source: 'pandafit' as const, exercises: [] };
    writeDraft(s, 'mira', 'older:Pull', old);
    const { view } = show([], s);
    await screen.findByText('Der Coach hat neu geplant. Deine Änderungen galten dem alten Plan.');
    expect(screen.queryByText('Angepasst')).toBeNull();
    view.unmount();
    show([], s);
    await screen.findByRole('button', { name: 'Ansehen und anpassen' });
    expect(screen.queryByText(/Der Coach hat neu geplant/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pull starten' }));
    await screen.findByRole('region', { name: 'Latzug' }); // the plan, not the empty old draft
  });

  test('a throwing storage: the sheet opens, edits live while it is open, the start works', async () => {
    show([], throwing);
    const sheet = await openSheet();
    type(exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 1'), '7');
    await waitFor(() => expect((exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 1') as HTMLInputElement).value).toBe('7'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Training starten' }));
    const running = await screen.findByRole('region', { name: 'Latzug' });
    expect((within(running).getByLabelText('Wiederholungen Satz 1') as HTMLInputElement).value).toBe('7');
  });

  test('openPlan opens the sheet at once', async () => {
    show([], memory(), { openPlan: true });
    await screen.findByRole('dialog', { name: 'Nächstes Training' });
  });

  test('openPlan also opens the sheet when the plan arrives after the workouts', async () => {
    const f = fakePort([]);
    const props = { port: f.port, planMeta: meta, account: 'mira', storage: memory(), openPlan: true, ...ids };
    const { rerender } = render(<WorkoutScreen {...props} plan={null} />);
    await screen.findByRole('button', { name: 'Leeres Training starten' });
    rerender(<WorkoutScreen {...props} plan={plan} />);
    await screen.findByRole('dialog', { name: 'Nächstes Training' });
  });

  test('a draft made for another studio never starts: it is dropped with the note, the plan starts', async () => {
    const s = memory();
    show([], s);
    let sheet = await openSheet();
    type(exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 1'), '6');
    await waitFor(() => expect(stored(s)).not.toBeNull());
    cleanup();
    const done = (id: string, studio: string): TrackedRecord => ({ kind: 'workout', id, updatedMs: 1, deleted: false,
      body: { id, title: 'T', startMs: NOW - 86_400_000, endMs: NOW - 86_000_000, source: 'pandafit', exercises: [], studio } as LoggedWorkout });
    show([done('b', 'Beta')], s); // now the studio is Beta, the draft was made without one
    await screen.findByText('Der Coach hat neu geplant. Deine Änderungen galten dem alten Plan.');
    expect(screen.queryByText('Angepasst')).toBeNull();
    expect(stored(s)).toBeNull();
    sheet = await openSheet();
    expect((exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 1') as HTMLInputElement).value).toBe('10');
  });

  test('a draft without exercises: the card start starts the plan', async () => {
    const s = memory();
    show([], s);
    const sheet = await openSheet();
    fireEvent.click(exercise(sheet, 'Latzug').getByRole('button', { name: 'Übung entfernen Latzug' }));
    fireEvent.click(exercise(sheet, 'Face Pull').getByRole('button', { name: 'Übung entfernen Face Pull' }));
    await waitFor(() => expect(stored(s)?.exercises).toHaveLength(0));
    expect((within(sheet).getByRole('button', { name: 'Training starten' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pull starten' }));
    await screen.findByRole('region', { name: 'Latzug' });
    expect(screen.getByRole('region', { name: 'Face Pull' })).toBeTruthy();
  });

  test('a start from a draft does not name exercises the rules dropped from the plan', async () => {
    const rule = ruleRecord('r1', { kind: 'exclude', text: 'Ohne Face Pull', sport: 'gym', exerciseIds: ['pf-face-pull'] }, 'active', 'person', NOW - 1000);
    show([rule]);
    const sheet = await openSheet();
    expect(within(sheet).getByText(/Ohne Face Pull/)).toBeTruthy(); // the sheet says it
    type(exercise(sheet, 'Latzug').getByLabelText('Wiederholungen Satz 1'), '6');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Training starten' }));
    await screen.findByRole('region', { name: 'Latzug' });
    expect(screen.queryByText(/Ohne Face Pull/)).toBeNull();
  });

  test('openPlan tells the page once the sheet has opened', async () => {
    const onOpened = vi.fn();
    const f = fakePort([]);
    render(<WorkoutScreen port={f.port} plan={plan} planMeta={meta} account="mira" storage={memory()} openPlan onOpened={onOpened} {...ids} />);
    await screen.findByRole('dialog', { name: 'Nächstes Training' });
    await waitFor(() => expect(onOpened).toHaveBeenCalledTimes(1));
  });

  test('with an open workout there is no button', async () => {
    const open: LoggedWorkout = { id: 'o', title: 'Push', startMs: NOW - 1000, endMs: null, source: 'pandafit', exercises: [] };
    show([{ kind: 'workout', id: 'o', updatedMs: 1, deleted: false, body: open }], memory(), { openPlan: true });
    await screen.findByRole('button', { name: 'Weitermachen' });
    expect(screen.queryByRole('button', { name: 'Ansehen und anpassen' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Nächstes Training' })).toBeNull();
  });
});
