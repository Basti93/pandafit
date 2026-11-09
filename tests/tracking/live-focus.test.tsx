// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import type { LoggedWorkout } from '../../src/shared/records';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from './fake-port';
import { bodyOf, doneNow, ids, open2, rec, set, setsSheet } from './live-helpers';

afterEach(cleanup);
afterEach(() => localStorage.clear());

const resume = async () => fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
const focusOf = (title: string) => within(screen.getByRole('region', { name: title }));
const sets = (m: Parameters<typeof bodyOf>[0], i: number) => bodyOf(m, 'workout:open1').exercises[i]!.sets;
/** Longer than the double-tap guard: the next tap is a new tap. */
const later = () => new Promise((r) => setTimeout(r, 750));
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
    await later();
    doneNow(); // B1
    await waitFor(() => expect(sets(map, 1)[0]!.doneMs).toBe(100_000));
    expect(sets(map, 0)[1]!.doneMs).toBeNull();
    expect(await screen.findByRole('region', { name: 'Bankdrücken' })).toBeTruthy();
    expect(focusOf('Bankdrücken').getByText('Nächster Satz · 2 von 2')).toBeTruthy();
    await later();
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

  it('a double tap on Satz geschafft with a fast save confirms one set; a later tap confirms the next', async () => {
    const { port, map } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    doneNow();
    await new Promise((r) => setTimeout(r, 30)); // saved, and the card already shows set 2 in the same place
    expect(focusOf('Bankdrücken').getByText('Nächster Satz · 2 von 2')).toBeTruthy();
    doneNow();
    await new Promise((r) => setTimeout(r, 30));
    expect(sets(map, 0).map((s) => s.doneMs)).toEqual([100_000, null]);
    await later();
    doneNow();
    await waitFor(() => expect(sets(map, 0).map((s) => s.doneMs)).toEqual([100_000, 100_000]));
  });

  it('finishing an exercise picked under Danach moves the focus to the next open set', async () => {
    const w = open2();
    w.exercises[1]!.sets = [set(40, 10, 5000), set(40, 10, null)];
    const { port, map } = fakePort([rec(w)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    fireEvent.click(screen.getByRole('button', { name: /Rudern/ }));
    expect(focusOf('Rudern').getByText('Nächster Satz · 2 von 2')).toBeTruthy();
    doneNow();
    await waitFor(() => expect(sets(map, 1)[1]!.doneMs).toBe(100_000));
    expect(await screen.findByRole('region', { name: 'Bankdrücken' })).toBeTruthy();
    expect(focusOf('Bankdrücken').getByText('Nächster Satz · 1 von 2')).toBeTruthy();
    expect(screen.queryByText('Alle Sätze geschafft')).toBeNull();
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
    expect(focus.getByText('Du kannst einen Satz anhängen, eine Übung hinzufügen oder das Training beenden.')).toBeTruthy(); // nothing open anywhere
    expect(focus.queryByLabelText(/^Gewicht Satz/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Satz geschafft' })).toBeNull();
    const add = focus.getByRole('button', { name: 'Satz hinzufügen' });
    fireEvent.click(add); fireEvent.click(add); // a double tap adds one set
    await waitFor(() => expect(sets(map, 0)).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 30));
    expect(sets(map, 0)).toHaveLength(3);
    expect(await screen.findByText('Nächster Satz · 3 von 3')).toBeTruthy();
    cleanup();
    const empty = fakePort();
    render(<WorkoutScreen port={empty.port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leeres Training starten' }));
    expect(await screen.findByText('Noch keine Übung im Training.')).toBeTruthy();
    const addEx = screen.getAllByRole('button', { name: 'Übung hinzufügen' });
    expect(addEx).toHaveLength(1);
    expect(addEx[0]!.className).toContain('primary');
    fireEvent.click(addEx[0]!);
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
    await later();
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

describe('holding an exercise opens Reihenfolge with it lifted', () => {
  const down = (el: Element, y = 100) => fireEvent.pointerDown(el, { clientX: 10, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' });
  const orderList = () => screen.queryByRole('list', { name: 'Reihenfolge der Übungen' });
  const start = async () => {
    const { port, map } = fakePort([rec(open2())]); // Bankdrücken (focus), Rudern (Danach)
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    return map;
  };
  afterEach(() => { vi.useRealTimers(); });
  const danach = () => within(screen.getByRole('list', { name: 'Danach' })).getByRole('button', { name: /Rudern/ });
  const title = () => focusOf('Bankdrücken').getByRole('heading', { name: 'Bankdrücken' });

  it('a long press on a row under Danach opens it; a short tap does not', async () => {
    await start();
    down(danach());
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerUp(danach());
    act(() => { vi.advanceTimersByTime(600); });
    expect(orderList()).toBeNull();
    down(danach());
    act(() => { vi.advanceTimersByTime(460); });
    expect(orderList()).toBeTruthy();
    expect(within(orderList()!).getAllByRole('listitem').find((li) => li.className.includes('lifted'))?.textContent).toContain('Rudern');
  });

  it('a long press on the title of the focus exercise opens it too', async () => {
    await start();
    down(title());
    act(() => { vi.advanceTimersByTime(460); });
    expect(orderList()).toBeTruthy();
  });

  it('moving more than 8 px before the timer is a scroll, not a hold', async () => {
    await start();
    down(title());
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerMove(title(), { clientX: 10, clientY: 120, pointerId: 1 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(orderList()).toBeNull();
  });

  it('the same finger drags on: release higher up writes the new order', async () => {
    const map = await start();
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const i = Number((this as HTMLElement).dataset.i ?? -1);
      return { top: i * 50, height: 50, bottom: i * 50 + 50, left: 0, right: 0, width: 0, x: 0, y: i * 50, toJSON: () => ({}) };
    });
    down(danach(), 75);
    act(() => { vi.advanceTimersByTime(460); });
    const list = orderList()!;
    [...list.children].forEach((el, i) => (el as HTMLElement).setAttribute('data-i', String(i)));
    // rects are read when a drag begins: grab the grip again so they are measured with the marks
    fireEvent.pointerDown(within(list.children[1] as HTMLElement).getByText('⋮⋮'), { clientX: 10, clientY: 75, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 5, pointerId: 1 });
    spy.mockRestore();
    vi.useRealTimers();
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises.map((e) => e.title).join(',')).toBe('Rudern,Bankdrücken'));
  });
});
