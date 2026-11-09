// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { finisherLine } from '../../src/tracking/ui/finisher';
import { doneSentence, progressOf } from '../../src/tracking/ui/workout/live-view';
import { fakePort } from './fake-port';
import { bodyOf, doneNow, ids, open2, rec, set } from './live-helpers';

afterEach(cleanup);
afterEach(() => localStorage.clear());

const resume = async () => fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
const minimize = () => fireEvent.click(screen.getByRole('button', { name: 'Verkleinern, Training läuft weiter' }));
/** Bankdrücken done, Rudern open. */
const benchDone = (): LoggedWorkout => {
  const w = open2();
  w.exercises[0]!.sets = [set(62.5, 8, 2000), set(62.5, 8, 3000)];
  return w;
};

describe('live-view: progress and the done sentence', () => {
  it('progressOf gives the parts for Band: a done exercise full, the focus one by its work sets, open ones empty', () => {
    const w = open2();
    w.exercises.push({ exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [set(80, 5, 1), set(80, 5, 2)] });
    w.exercises[1]!.sets[0]!.doneMs = 5; // Rudern 1 of 3
    const t = (x: LoggedWorkout) => ({ ...x, exercises: x.exercises.map((e, i) => ({ ...e, rid: `e${i}`, sets: e.sets.map((s, j) => ({ ...s, rid: `e${i}s${j}` })) })) }) as never;
    const p = progressOf(t(w), 'e1');
    expect(p.index).toBe(2);
    expect(p.total).toBe(3);
    expect(p.parts).toEqual([{ grow: 1, fill: 0 }, { grow: 1, fill: 1 / 3 }, { grow: 1, fill: 1 }]);
    expect(p.doneTitles).toEqual(['Kniebeuge']);
  });

  it('doneSentence names one or two exercises and counts from three', () => {
    expect(doneSentence([])).toBeNull();
    expect(doneSentence(['Kniebeuge'])).toBe('Kniebeuge hast du schon geschafft.');
    expect(doneSentence(['Kniebeuge', 'Rudern'])).toBe('Kniebeuge und Rudern hast du schon geschafft.');
    expect(doneSentence(['A', 'B', 'C'])).toBe('Drei Übungen hast du schon geschafft.');
  });
});

describe('the frame of the running workout', () => {
  it('Verkleinern leaves the workout running; Weitermachen brings back every confirmed set and the rest', async () => {
    const { port, map } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    doneNow();
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0]!.sets[0]!.doneMs).not.toBeNull());
    minimize();
    const card = await screen.findByRole('region', { name: 'Läuft noch' });
    fireEvent.click(within(card).getByRole('button', { name: 'Weitermachen' }));
    expect(within(await screen.findByRole('region', { name: 'Bankdrücken' })).getByText('Nächster Satz · 2 von 2')).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'Satzpause' })).toBeTruthy();
    expect(bodyOf(map, 'workout:open1').endMs).toBeNull();
  });

  it('Verkleinern while a save fails keeps the workout and writes it later', async () => {
    const { port, map, state } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    state.failPuts = true;
    doneNow();
    expect(await screen.findByText(/konnte gerade nicht gespeichert werden/)).toBeTruthy();
    expect(bodyOf(map, 'workout:open1').exercises[0]!.sets[0]!.doneMs).toBeNull();
    minimize();
    const card = await screen.findByRole('region', { name: 'Läuft noch' });
    fireEvent.click(within(card).getByRole('button', { name: 'Weitermachen' }));
    expect(within(await screen.findByRole('region', { name: 'Bankdrücken' })).getByText('Nächster Satz · 2 von 2')).toBeTruthy();
    state.failPuts = false;
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt nochmal speichern' }));
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0]!.sets[0]!.doneMs).toBe(100_000));
    expect(bodyOf(map, 'workout:open1').endMs).toBeNull();
  });

  it('Verkleinern while a save hangs: Weitermachen brings back the same workout, nothing is confirmed twice, and the record gets the set', async () => {
    const { port, map, state } = fakePort([rec(open2())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    let open!: () => void;
    state.gate = new Promise<void>((r) => { open = r; });
    doneNow();
    minimize(); // the put is still pending: the store stays in the registry
    const card = await screen.findByRole('region', { name: 'Läuft noch' });
    fireEvent.click(within(card).getByRole('button', { name: 'Weitermachen' }));
    // The screen shows what is saved (store view); the store itself already holds the confirmed set.
    // A second tap on the set still shown does not confirm another set.
    doneNow();
    expect(bodyOf(map, 'workout:open1').exercises[0]!.sets[0]!.doneMs).toBeNull();
    state.gate = null;
    open();
    await waitFor(() => expect(bodyOf(map, 'workout:open1').exercises[0]!.sets[0]!.doneMs).toBe(100_000));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Bankdrücken' })).getByText('Nächster Satz · 2 von 2')).toBeTruthy());
    expect(bodyOf(map, 'workout:open1').exercises[0]!.sets[1]!.doneMs).toBeNull();
    expect(bodyOf(map, 'workout:open1').endMs).toBeNull();
  });

  it('asks the effort question once: only about the exercise with the most recently confirmed set', async () => {
    const planned = (doneMs: number) => [{ ...set(60, 8, doneMs), plannedReps: 8 }];
    const w = { ...open2(), exercises: [
      { exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: planned(2000) },
      { exerciseId: 'pf-seated-row-cable', title: 'Rudern', supersetId: null, notes: '', sets: planned(3000) },
      { exerciseId: 'pf-squat', title: 'Kniebeuge', supersetId: null, notes: '', sets: [set(80, 5, null)] },
    ] } as LoggedWorkout;
    const { port } = fakePort([rec(w)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const groups = screen.getAllByRole('group', { name: /noch geschafft\?$/ });
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Wie viele hättest du bei Rudern noch geschafft?']);
    expect(groups[0]!.textContent).toContain('bei Rudern noch geschafft?');
  });

  it('the head says how long it runs; the progress card says what is done and opens Geschafft', async () => {
    const { port } = fakePort([rec(benchDone())]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    expect(screen.getByRole('heading', { level: 1, name: 'Zuhause' })).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'Trainingsdauer' }).textContent).toBe('Läuft seit 1 Min');
    const prog = screen.getByRole('region', { name: 'Dein Training' });
    expect(within(prog).getByText('Übung 2 von 2')).toBeTruthy();
    const doneLink = within(prog).getByRole('button', { name: 'Bankdrücken hast du schon geschafft.' });
    expect(doneLink.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(doneLink);
    const sheet = await screen.findByRole('dialog', { name: 'Geschafft' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Bankdrücken/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Geschafft' })).toBeNull());
    expect(screen.getByRole('region', { name: 'Bankdrücken' })).toBeTruthy();
    // the head menu has no "Läuft seit" line any more
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zum Training' }));
    expect(within(screen.getByRole('dialog', { name: 'Training' })).queryByText(/Läuft seit/)).toBeNull();
  });

  it('the rest is a slim card: tapping skips, 30 s mehr adds', async () => {
    const w = { ...open2(), rest: { startMs: 70_000, durationS: 90 } } as LoggedWorkout;
    const { port, map } = fakePort([rec(w)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    const bar = screen.getByRole('timer', { name: 'Satzpause' });
    expect(bar.textContent).toContain('Pause, noch 1:00');
    fireEvent.click(within(bar).getByRole('button', { name: '30 s mehr' }));
    await waitFor(() => expect((bodyOf(map, 'workout:open1') as unknown as { rest: { durationS: number } }).rest.durationS).toBe(120));
    fireEvent.click(within(screen.getByRole('timer', { name: 'Satzpause' })).getByRole('button', { name: 'Pause überspringen' }));
    await waitFor(() => expect(screen.queryByRole('timer', { name: 'Satzpause' })).toBeNull());
  });

  it('the start notices show on the live screen: without legs and a second session today', async () => {
    const NOW = new Date(2026, 10, 4, 9).getTime(); // Wednesday
    const days = weekDates('2026-11-02').map((date) => (date === '2026-11-04'
      ? { date, sport: 'gym', hardness: 'moderate', fixed: false, legs: false, also: { sport: 'bike', minutes: 20, hardness: 'easy' } }
      : { date, sport: 'rest', hardness: 'moderate', fixed: false }));
    const weekplan: TrackedRecord = { kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false, body: { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days } };
    const plan = { name: 'Ganzkörper', exercises: [
      { templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: 60, reps: 8 }] },
      { templateId: 'pf-bench-press', title: 'Bankdrücken', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal' as const, weightKg: 50, reps: 8 }] },
    ] };
    const { port } = fakePort([weekplan]);
    render(<WorkoutScreen port={port} plan={plan} newId={ids.newId} now={() => NOW} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Training starten' }));
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('Heute geht es ohne Beine, wie abgesprochen.');
    expect(note.textContent).toContain('Dazu heute: 20 Min.');
  });

  it('after Training beenden: Gespeichert as the main card with Fertig, and Bo says the stretch', async () => {
    const w = benchDone();
    w.exercises = [w.exercises[0]!];
    const { port } = fakePort([rec(w)]);
    render(<WorkoutScreen port={port} {...ids} />);
    await resume();
    fireEvent.click(screen.getByRole('button', { name: 'Training beenden' }));
    const summary = await screen.findByRole('region', { name: 'Zusammenfassung' });
    expect(within(summary).getByText('Gespeichert')).toBeTruthy();
    expect(within(summary).getByRole('heading', { name: 'Zuhause' })).toBeTruthy();
    expect(within(summary).getByText('1 Übung in 2 Minuten.')).toBeTruthy();
    expect(within(summary).getByRole('button', { name: 'Fertig' }).className).toContain('primary');
    const line = finisherLine({ cardio: true, stretch: true, reason: null });
    expect(document.querySelector('.tk-bo')!.textContent).toContain(line);
    expect(screen.queryByRole('region', { name: 'Zum Abschluss' })).toBeNull();
  });
});
