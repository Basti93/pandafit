// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { barWeightId } from '../../src/shared/bars';
import { plateLine, stepChange } from '../../src/tracking/steps';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from './fake-port';
import { setsSheet } from './live-helpers';

afterEach(cleanup);

const s = (weightKg: number | null, doneMs: number | null = null, type: 'normal' | 'warmup' = 'normal') => ({ type, weightKg, reps: 8, durationS: null, doneMs });
const ex = (exerciseId: string, title: string, sets: ReturnType<typeof s>[]) => ({ exerciseId, title, supersetId: null, notes: '', sets });
const wo = (id: string, startMs: number, endMs: number | null, exercises: LoggedWorkout['exercises']): LoggedWorkout => ({ id, title: 'Training', startMs, endMs, source: 'pandafit', exercises });
const rec = (w: LoggedWorkout): TrackedRecord => ({ kind: 'workout', id: w.id, updatedMs: 1, deleted: false, body: w });
const ids = { newId: () => 'new-id', now: () => 100_000 };

async function running(open: LoggedWorkout, past: LoggedWorkout[] = []) {
  const f = fakePort([rec(open), ...past.map(rec)]);
  render(<WorkoutScreen port={f.port} {...ids} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
  await screen.findAllByRole('heading', { level: 2 });
  return f;
}

describe('plate line texts', () => {
  test('exact, between and below the bar', () => {
    expect(plateLine(65, 20)).toBe('Scheiben je Seite: 20 + 2,5');
    expect(plateLine(62, 20)).toBe('Das geht mit Scheiben nicht genau. Nimm 60 oder 62,5 kg.');
    expect(plateLine(15, 20)).toBe('Leichter als die Stange (20 kg)');
    expect(plateLine(5, 8.5)).toBe('Leichter als die Stange (8,5 kg)');
    expect(plateLine(8.5, 8.5)).toBe('Nur die Stange (8,5 kg)');
    expect(plateLine(23.5, 8.5)).toBe('Scheiben je Seite: 5 + 2,5');
  });
});

describe('plates in the workout', () => {
  test('barbell: only the next open set with a weight gets the line', async () => {
    await running(wo('o', 1000, null, [ex('pf-squat', 'Kniebeuge', [s(40, 5), s(65), s(65)])]));
    expect(screen.getAllByText(/Scheiben je Seite/)).toHaveLength(1);
    expect(screen.getByText('Scheiben je Seite: 20 + 2,5')).toBeTruthy();
  });

  test('a set without a weight is skipped for the next one with a weight', async () => {
    await running(wo('o', 1000, null, [ex('pf-squat', 'Kniebeuge', [s(null), s(60)])]));
    expect(screen.queryByText(/Scheiben je Seite/)).toBeNull(); // the focus set has no weight yet
    expect(within(await setsSheet(1)).getByText('Scheiben je Seite: 20')).toBeTruthy(); // the table marks the next set with one
  });

  test('not for a machine or dumbbell', async () => {
    await running(wo('o', 1000, null, [ex('pf-leg-press', 'Beinpresse', [s(80)]), ex('pf-dumbbell-curl', 'Bizepscurl', [s(12)])]));
    expect(screen.queryByText(/Scheiben je Seite|auflegbar|Stange/)).toBeNull();
  });
});

describe('the weight step line', () => {
  const info = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Anleitung' }));
    await screen.findByRole('note', { name: 'Anleitung Kniebeuge' });
  };
  const past = (n: number, kg: number[]) => wo(`p${n}`, 100 + n, 200 + n, [ex('pf-squat', 'Kniebeuge', kg.map((k) => s(k, 5)))]);

  test('learned from the history', async () => {
    await running(wo('o', 10_000, null, [ex('pf-squat', 'Kniebeuge', [s(60)])]), [past(1, [50, 57]), past(2, [64, 71])]);
    await info();
    expect(screen.getByText('Gewichtsstufen hier: 7 kg (gelernt)')).toBeTruthy();
  });

  test('choosing a value writes the record, "gelernt" a tombstone, and the line says "von dir"', async () => {
    const f = await running(wo('o', 10_000, null, [ex('pf-squat', 'Kniebeuge', [s(60)])]), [past(1, [50, 57]), past(2, [64, 71])]);
    await info();
    const select = screen.getByLabelText('Gewichtsstufe Kniebeuge');
    fireEvent.change(select, { target: { value: '2.5' } });
    await waitFor(() => expect(f.state.puts.filter((r) => r.kind === 'loadstep')).toHaveLength(1));
    const put = f.state.puts.find((r) => r.kind === 'loadstep')!;
    expect(put.deleted).toBe(false);
    expect(put.body).toMatchObject({ exerciseId: 'pf-squat', stepKg: 2.5 });
    await screen.findByText('Gewichtsstufen hier: 2,5 kg (von dir)');
    fireEvent.change(within(screen.getByRole('note', { name: 'Anleitung Kniebeuge' })).getByLabelText('Gewichtsstufe Kniebeuge'), { target: { value: '' } });
    await waitFor(() => expect(f.state.puts.filter((r) => r.kind === 'loadstep')).toHaveLength(2));
    const tomb = f.state.puts.filter((r) => r.kind === 'loadstep')[1];
    expect(tomb.deleted).toBe(true);
    expect(tomb.id).toBe(put.id);
    expect(tomb.updatedMs).toBeGreaterThan(put.updatedMs);
    await screen.findByText('Gewichtsstufen hier: 7 kg (gelernt)');
  });

  test('a tombstone is stamped above what is stored', () => {
    const first = stepChange([], 'x', '', 5, 1000);
    expect(stepChange([first], 'x', '', null, 500).updatedMs).toBe(1001);
  });
});

describe('set hint', () => {
  test('shows the exercise\'s own rep range', async () => {
    await running(wo('o', 1000, null, [ex('pf-squat', 'Kniebeuge', [s(60)])]));
    expect(screen.getByText(/^Ziel \d+–\d+/)).toBeTruthy();
  });
});

describe('set hint on the first working set only', () => {
  test('the later sets keep only the last-time part', async () => {
    await running(wo('o', 1000, null, [ex('pf-squat', 'Kniebeuge', [s(60), s(60), s(60)])]));
    expect(screen.getAllByText(/^Ziel \d+–\d+/)).toHaveLength(1);
  });
});

describe('studio line', () => {
  test('a typed new studio is saved on the started workout, reusing a known name by case', async () => {
    const f = fakePort([]);
    render(<WorkoutScreen port={f.port} {...ids} />);
    await screen.findByRole('button', { name: /^(Anderes Training|Leeres Training starten)$/ });
    fireEvent.click(screen.getByRole('button', { name: /^Studio/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Neues Studio …' }));
    const input = await screen.findByLabelText('Name des neuen Studios');
    fireEvent.change(input, { target: { value: 'Testhalle' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Leeres Training starten' }));
    await waitFor(() => expect(f.state.puts.some((r) => r.kind === 'workout' && (r.body as LoggedWorkout).studio === 'Testhalle')).toBe(true));
  });
});

describe('the bar line', () => {
  const info = async (title: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Anleitung' }));
    await screen.findByRole('note', { name: `Anleitung ${title}` });
  };

  test('shows the SZ bar of a preacher curl, and nothing for a machine', async () => {
    await running(wo('o', 1000, null, [ex('pf-preacher-curl', 'Scott-Curl', [s(20)])]));
    await info('Scott-Curl');
    expect(screen.getByRole('button', { name: 'Stange Scott-Curl' }).textContent).toBe('Stange: SZ-Stange, 10 kg');
    cleanup();
    await running(wo('o', 1000, null, [ex('pf-leg-press', 'Beinpresse', [s(80)])]));
    await info('Beinpresse');
    expect(screen.queryByText(/^Stange:/)).toBeNull();
  });

  test('the plate line uses the weight of the bar', async () => {
    const f = fakePort([rec(wo('o', 1000, null, [ex('pf-preacher-curl', 'Scott-Curl', [s(23.5)])])), { kind: 'bar', id: barWeightId('sz', ''), updatedMs: 1, deleted: false, body: { what: 'weight', type: 'sz', studio: '', kg: 8.5 } }]);
    render(<WorkoutScreen port={f.port} {...ids} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weitermachen' }));
    expect(await screen.findByText('Scheiben je Seite: 5 + 2,5')).toBeTruthy();
  });

  test('choosing the type and typing the weight write the records', async () => {
    const f = await running(wo('o', 1000, null, [ex('pf-preacher-curl', 'Scott-Curl', [s(20)])]));
    await info('Scott-Curl');
    fireEvent.click(screen.getByRole('button', { name: 'Stange Scott-Curl' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Langhantel' }));
    await waitFor(() => expect(f.state.puts.filter((r) => r.kind === 'bar')).toHaveLength(1));
    expect(f.state.puts.find((r) => r.kind === 'bar')!.body).toEqual({ what: 'use', exerciseId: 'pf-preacher-curl', type: 'langhantel' });
    fireEvent.change(screen.getByLabelText('Gewicht der Stange'), { target: { value: '17,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(f.state.puts.filter((r) => r.kind === 'bar')).toHaveLength(2));
    expect(f.state.puts.filter((r) => r.kind === 'bar')[1].body).toEqual({ what: 'weight', type: 'langhantel', studio: '', kg: 17.5 });
    await screen.findByText('Stange: Langhantel, 17,5 kg');
  });

  test('adding a custom bar and choosing it', async () => {
    const f = await running(wo('o', 1000, null, [ex('pf-squat', 'Kniebeuge', [s(60)])]));
    await info('Kniebeuge');
    fireEvent.click(screen.getByRole('button', { name: 'Stange Kniebeuge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eigene Stange hinzufügen' }));
    fireEvent.change(screen.getByLabelText('Name der neuen Stange'), { target: { value: ' Trap-Bar ' } });
    fireEvent.change(screen.getByLabelText('Gewicht der neuen Stange'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(f.state.puts.filter((r) => r.kind === 'bar')).toHaveLength(1));
    const put = f.state.puts.find((r) => r.kind === 'bar')!;
    expect(put.body).toMatchObject({ what: 'type', name: 'Trap-Bar', kg: 25 });
    fireEvent.click(await screen.findByRole('radio', { name: 'Trap-Bar' }));
    await waitFor(() => expect(f.state.puts.filter((r) => r.kind === 'bar')).toHaveLength(2));
    expect(f.state.puts.filter((r) => r.kind === 'bar')[1].body).toMatchObject({ what: 'use', exerciseId: 'pf-squat', type: (put.body as { id: string }).id });
    await screen.findByText('Stange: Trap-Bar, 25 kg');
  });

  test('an invalid weight is not saved', async () => {
    await running(wo('o', 1000, null, [ex('pf-squat', 'Kniebeuge', [s(60)])]));
    await info('Kniebeuge');
    fireEvent.click(screen.getByRole('button', { name: 'Stange Kniebeuge' }));
    fireEvent.change(screen.getByLabelText('Gewicht der Stange'), { target: { value: '0' } });
    expect((screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
