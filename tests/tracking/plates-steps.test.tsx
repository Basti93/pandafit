// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import { plateLine, stepChange } from '../../src/tracking/steps';
import { WorkoutScreen } from '../../src/tracking/ui/WorkoutScreen';
import { fakePort } from './fake-port';

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
    expect(plateLine(65)).toBe('Scheiben je Seite: 20 + 2,5');
    expect(plateLine(62)).toBe('Das geht mit Scheiben nicht genau. Nimm 60 oder 62,5 kg.');
    expect(plateLine(15)).toBe('Leichter als die Stange (20 kg)');
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
    expect(screen.getByText('Scheiben je Seite: 20')).toBeTruthy();
  });

  test('not for a machine or dumbbell', async () => {
    await running(wo('o', 1000, null, [ex('pf-leg-press', 'Beinpresse', [s(80)]), ex('pf-dumbbell-curl', 'Bizepscurl', [s(12)])]));
    expect(screen.queryByText(/Scheiben je Seite|auflegbar|Stange/)).toBeNull();
  });
});

describe('the weight step line', () => {
  const info = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mehr zu Kniebeuge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mehr' }));
    fireEvent.click(screen.getByRole('button', { name: 'Anleitung Kniebeuge' }));
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
