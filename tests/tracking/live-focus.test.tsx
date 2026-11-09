// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LoggedWorkout } from '../../src/shared/records';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from './fake-port';
import { bodyOf, doneNow, ids, open2, rec, set, setsSheet } from './live-helpers';

afterEach(cleanup);
afterEach(() => localStorage.clear());

const resume = async () => fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
const focusOf = (title: string) => within(screen.getByRole('region', { name: title }));
const sets = (m: Parameters<typeof bodyOf>[0], i: number) => bodyOf(m, 'workout:open1').exercises[i]!.sets;
const withExercises = (exercises: LoggedWorkout['exercises']): LoggedWorkout => ({ ...open2(), exercises });

describe('the focus card', () => {
  it('the next set stands large with weight, reps and Satz geschafft; the other exercises wait quietly below', async () => {
    const { port, map } = fakePort([rec(open2())]); // Bankdrücken 2 Sätze, Rudern 3 Sätze
    render(<WorkoutScreen port={port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
    const focus = screen.getByRole('region', { name: 'Bankdrücken' });
    expect(within(focus).getByText('Nächster Satz · 1 von 2')).toBeTruthy();
    expect((within(focus).getByLabelText('Gewicht Satz 1') as HTMLInputElement).value).toBe('62,5');
    expect((within(focus).getByLabelText('Wiederholungen Satz 1') as HTMLInputElement).value).toBe('8');
    fireEvent.click(within(focus).getByRole('button', { name: 'Satz geschafft' }));
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].sets[0].doneMs).not.toBeNull());
    expect(within(screen.getByRole('region', { name: 'Bankdrücken' })).getByText('Nächster Satz · 2 von 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rudern/ }).closest('.card.soft')).toBeTruthy();
    // the second set starts fresh: empty, with the set before as its placeholder
    const w2 = focusOf('Bankdrücken').getByLabelText('Gewicht Satz 2') as HTMLInputElement;
    expect(w2.value).toBe('');
    expect(w2.placeholder).toBe('62,5');
  });

  it('a tap on a set circle opens the set table; a later set can be ticked there', async () => {
    const { port, map } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    expect(focusOf('Bankdrücken').getByRole('button', { name: 'Satz 1: dran' })).toBeTruthy();
    expect(focusOf('Bankdrücken').getByRole('button', { name: 'Satz 2: offen' })).toBeTruthy();
    const sheet = await setsSheet(2);
    expect(within(sheet).getByRole('heading', { name: 'Bankdrücken' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Satz 2 erledigt' }));
    await waitFor(() => expect(sets(map, 0)[1]!.doneMs).toBe(100_000));
    expect(sets(map, 0)[0]!.doneMs).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focusOf('Bankdrücken').getByRole('button', { name: 'Satz 2: geschafft' })).toBeTruthy();
  });

  it('in a superset the focus follows the rounds and Satz geschafft ticks only the shown set', async () => {
    const w = withExercises([
      { exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: 1, notes: '', sets: [set(60, 8, null), set(60, 8, null)] },
      { exerciseId: 'pf-seated-row-cable', title: 'Rudern', supersetId: 1, notes: '', sets: [set(40, 10, null), set(40, 10, null)] },
    ]);
    const { port, map } = fakePort([rec(w)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    expect(focusOf('Bankdrücken').getByText('Im Wechsel mit Rudern.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rudern/ })).toBeNull(); // the partner is not a row under Danach
    doneNow(); // A1
    await waitFor(() => expect(sets(map, 0)[0]!.doneMs).toBe(100_000));
    expect(sets(map, 1)[0]!.doneMs).toBeNull();
    expect(await screen.findByRole('region', { name: 'Rudern' })).toBeTruthy();
    expect(focusOf('Rudern').getByText('Nächster Satz · 1 von 2')).toBeTruthy();
    doneNow(); // B1
    await waitFor(() => expect(sets(map, 1)[0]!.doneMs).toBe(100_000));
    expect(sets(map, 0)[1]!.doneMs).toBeNull();
    expect(await screen.findByRole('region', { name: 'Bankdrücken' })).toBeTruthy();
    expect(focusOf('Bankdrücken').getByText('Nächster Satz · 2 von 2')).toBeTruthy();
    doneNow(); // A2
    await waitFor(() => expect(sets(map, 0)[1]!.doneMs).toBe(100_000));
    expect(sets(map, 1)[1]!.doneMs).toBeNull(); // the partner stays open
  });

  it('a double tap on Satz geschafft during a slow save confirms only the shown set', async () => {
    const { port, map, state } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    state.delayMs = 40;
    const btn = screen.getByRole('button', { name: 'Satz geschafft' });
    fireEvent.click(btn); fireEvent.click(btn);
    await waitFor(() => expect(sets(map, 0)[0]!.doneMs).toBe(100_000));
    await new Promise((r) => setTimeout(r, 120));
    expect(sets(map, 0).map((s) => s.doneMs)).toEqual([100_000, null]);
  });

  it('a warm-up is circle A and comes first', async () => {
    const w = withExercises([{ exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [{ ...set(20, 10, null), type: 'warmup' }, set(60, 8, null), set(60, 8, null)] }]);
    const { port, map } = fakePort([rec(w)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const circle = focusOf('Kniebeuge').getByRole('button', { name: 'Aufwärmsatz: dran' });
    expect(circle.textContent).toBe('A');
    expect(focusOf('Kniebeuge').getByText('Aufwärmsatz')).toBeTruthy();
    expect((focusOf('Kniebeuge').getByLabelText('Gewicht Satz 1') as HTMLInputElement).value).toBe('20');
    doneNow();
    await waitFor(() => expect(sets(map, 0)[0]!.doneMs).toBe(100_000));
    expect(await screen.findByText('Nächster Satz · 1 von 2')).toBeTruthy();
    expect(focusOf('Kniebeuge').getByRole('button', { name: 'Satz 2: dran' }).textContent).toBe('1');
    expect(focusOf('Kniebeuge').getByRole('button', { name: 'Aufwärmsatz: geschafft' })).toBeTruthy();
  });

  it('unreadable input blocks Satz geschafft and writes nothing', async () => {
    const { port, map } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const ok = screen.getByRole('button', { name: 'Satz geschafft' }) as HTMLButtonElement;
    const reps = focusOf('Bankdrücken').getByLabelText('Wiederholungen Satz 1');
    fireEvent.change(reps, { target: { value: 'abc' } });
    expect(ok.disabled).toBe(true);
    fireEvent.click(ok);
    fireEvent.change(reps, { target: { value: '8,5' } });
    expect(focusOf('Bankdrücken').getByText('Bitte eine ganze Zahl')).toBeTruthy();
    expect(ok.disabled).toBe(true);
    fireEvent.change(focusOf('Bankdrücken').getByLabelText('Gewicht Satz 1'), { target: { value: 'abc' } });
    fireEvent.change(reps, { target: { value: '8' } });
    expect(ok.disabled).toBe(true); // the weight is still unreadable
    await new Promise((r) => setTimeout(r, 20));
    expect(sets(map, 0)[0]).toMatchObject({ weightKg: 62.5, reps: 8, doneMs: null });
  });

  it('typing fast into a big field while saves are slow keeps every digit', async () => {
    const { port, map, state } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const f = focusOf('Bankdrücken').getByLabelText('Gewicht Satz 1') as HTMLInputElement;
    state.delayMs = 40;
    fireEvent.focus(f);
    for (const v of ['6', '65', '655']) fireEvent.change(f, { target: { value: v } });
    await new Promise((r) => setTimeout(r, 60));
    expect(state.puts.length).toBeGreaterThan(0);
    expect(f.value).toBe('655');
    await new Promise((r) => setTimeout(r, 200));
    expect(f.value).toBe('655');
    expect(sets(map, 0)[0]!.weightKg).toBe(655);
  });

  it('all sets done: no empty card, Satz hinzufügen instead; no exercise: Übung hinzufügen', async () => {
    const done = withExercises([{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(60, 8, 5000), set(60, 8, 6000)] }]);
    const { port, map } = fakePort([rec(done)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const focus = focusOf('Bankdrücken');
    expect(focus.getByText('Alle Sätze geschafft')).toBeTruthy();
    expect(focus.getByText('Du kannst einen Satz anhängen oder zur nächsten Übung gehen.')).toBeTruthy();
    expect(focus.queryByLabelText(/^Gewicht Satz/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Satz geschafft' })).toBeNull();
    fireEvent.click(focus.getByRole('button', { name: 'Satz hinzufügen' }));
    await waitFor(() => expect(sets(map, 0)).toHaveLength(3));
    expect(await screen.findByText('Nächster Satz · 3 von 3')).toBeTruthy();
    cleanup();
    const empty = fakePort();
    render(<WorkoutScreen port={empty.port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leeres Training starten' }));
    expect(await screen.findByText('Noch keine Übung im Training.')).toBeTruthy();
    const add = screen.getAllByRole('button', { name: 'Übung hinzufügen' });
    expect(add).toHaveLength(1);
    expect(add[0]!.className).toContain('primary');
    fireEvent.click(add[0]!);
    expect(await screen.findByLabelText('Suchen')).toBeTruthy();
  });

  it('tapping a row under Danach makes it the focus', async () => {
    const { port } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const row = screen.getByRole('button', { name: /Rudern/ });
    expect(row.textContent).toContain('3 Sätze');
    fireEvent.click(row);
    expect(focusOf('Rudern').getByText('Nächster Satz · 1 von 3')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Bankdrücken' })).toBeNull();
    expect(screen.getByRole('button', { name: /Bankdrücken/ }).textContent).toContain('2 Sätze');
  });

  it('the effort question is its own card after the last set and thanks once', async () => {
    const plannedSet = { ...set(60, 8, null), plannedReps: 8 };
    const planned = withExercises([{ exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [plannedSet] }]);
    const { port, map } = fakePort([rec(planned)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const name = 'Wie viele hättest du bei Bankdrücken noch geschafft?';
    expect(screen.queryByRole('group', { name })).toBeNull();
    doneNow();
    const q = await screen.findByRole('group', { name });
    expect(q.closest('.card.soft')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Bankdrücken' }).contains(q)).toBe(false);
    fireEvent.click(within(q).getByRole('button', { name: '1–2' }));
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0].effort).toBe('some'));
    expect(screen.queryByRole('group', { name })).toBeNull();
    expect(screen.getAllByText('Danke! Das fließt in den nächsten Vorschlag ein.')).toHaveLength(1);
    const sheet = await setsSheet(1);
    expect(within(sheet).getByText('Noch möglich: 1–2')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
    fireEvent.click(focusOf('Bankdrücken').getByRole('button', { name: 'Satz hinzufügen' }));
    await waitFor(() => expect(sets(map, 0)).toHaveLength(2));
    doneNow();
    await waitFor(() => expect(sets(map, 0)[1]!.doneMs).toBe(100_000));
    expect(screen.queryByText('Danke! Das fließt in den nächsten Vorschlag ein.')).toBeNull();
  });

  it('Anleitung and Mehr open their sheets; a note stays in the focus card', async () => {
    const w = open2();
    w.exercises[0]!.notes = 'Schulter tief';
    const { port } = fakePort([rec(w)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    expect((focusOf('Bankdrücken').getByLabelText('Notiz zu Bankdrücken') as HTMLTextAreaElement).value).toBe('Schulter tief');
    fireEvent.click(focusOf('Bankdrücken').getByRole('button', { name: 'Anleitung' }));
    const info = await screen.findByRole('dialog');
    expect(within(info).getByRole('note', { name: 'Anleitung Bankdrücken' })).toBeTruthy();
    fireEvent.click(within(info).getByRole('button', { name: 'Schließen' }));
    fireEvent.click(focusOf('Bankdrücken').getByRole('button', { name: 'Mehr zu Bankdrücken' }));
    expect(screen.getByRole('list', { name: 'Menü Bankdrücken' })).toBeTruthy();
  });
});
