// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RideSummary } from '../../src/coach/metrics';
import type { StateMessage } from '../../src/shared/protocol';
import { beepsAt, SOUND_KEY } from '../../src/ui/countdown';
import { FeedbackView } from '../../src/ui/views/FeedbackView';
import { backupLine } from '../../src/ui/views/backup-line';
import { RideView } from '../../src/ui/views/RideView';
import { StatusBar } from '../../src/ui/views/StatusBar';

const DAY = 86_400_000;
const summary = (rideId: string, day: number, over: Partial<RideSummary> = {}): RideSummary => ({
  rideId, startedAtMs: Date.now() - day * DAY, status: 'finished', sessionId: 'x', sessionName: 'Locker', ftpW: 200, durationS: 1800, avgPowerW: 130, normalizedPowerW: 133,
  intensityFactor: 0.66, tss: 30, avgHrBpm: 140, maxHrBpm: 150, bestMinutePowerW: 140, completedFraction: 1, powerCurve: { 5: 300, 60: 140, 300: 135 }, ...over,
});
const ride: StateMessage = {
  type: 'state', session: null, ride: { rideId: 'r', profileId: 'A', sessionId: 's', startedAtMs: 1, status: 'open' },
  engine: { stepIndex: 0, stepRemainingS: 125, rideElapsedS: 10, targetW: 150, gradePct: null, gear: null, label: 'Warmup', nextLabel: 'Hart', secondsToNext: 125, autoReducedPct: 0, paused: false },
  devices: { trainer: 'connected', hr: 'connected', clicker: 'searching' }, latest: { powerW: 148, hrBpm: 130 }, storageError: false, recovered: false, profiles: [],
};
const engine = (secondsToNext: number, over = {}) => ({ ...ride.engine!, secondsToNext, stepRemainingS: secondsToNext, ...over });

let oscillators = 0;
beforeEach(() => {
  oscillators = 0;
  localStorage.clear();
  class FakeAudio {
    currentTime = 0; destination = {}; state = 'running'; resume() { return Promise.resolve(); }
    createOscillator() { oscillators++; return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
  }
  vi.stubGlobal('AudioContext', FakeAudio);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('countdown', () => {
  test('beeps in the last 3 seconds before a change only', () => {
    expect([5, 4, 3, 2, 1, 0].filter((s) => beepsAt(s, { nextLabel: 'Hart', paused: false }))).toEqual([3, 2, 1]);
    expect(beepsAt(2, { nextLabel: null, paused: false })).toBe(false);
    expect(beepsAt(2, { nextLabel: 'Hart', paused: true })).toBe(false);
  });
  const step = (rerender: (ui: React.ReactElement) => void, s: number, compact = false) => rerender(<RideView state={{ ...ride, engine: engine(s) }} send={vi.fn()} compact={compact} />);
  test('sounds once per second', () => {
    const { rerender } = render(<RideView state={{ ...ride, engine: engine(4) }} send={vi.fn()} />);
    for (const s of [3, 3, 2, 1]) step(rerender, s);
    expect(oscillators).toBe(3);
  });
  test('the film window stays silent, otherwise both windows would sound', () => {
    const { rerender } = render(<RideView state={{ ...ride, engine: engine(4) }} send={vi.fn()} compact />);
    step(rerender, 3, true);
    expect(oscillators).toBe(0);
  });
  test('can be switched off and stays off', () => {
    const { rerender } = render(<RideView state={{ ...ride, engine: engine(4) }} send={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ton: an' }));
    expect(localStorage.getItem(SOUND_KEY)).toBe('off');
    step(rerender, 3);
    expect(oscillators).toBe(0);
    expect(screen.getByRole('button', { name: 'Ton: aus' })).toBeTruthy();
  });
  test('a browser without sound does not disturb the ride', () => {
    vi.stubGlobal('AudioContext', undefined);
    const { rerender } = render(<RideView state={{ ...ride, engine: engine(4) }} send={vi.fn()} />);
    expect(() => step(rerender, 3)).not.toThrow();
  });
});

test('a section that holds the heart rate says so', () => {
  const session = { id: 'p', name: 'Puls', steps: [{ kind: 'erg' as const, durationS: 600, ftpFraction: 0.55, label: 'Puls halten', hrZone: 2, hrHold: true }] };
  render(<RideView state={{ ...ride, session }} send={vi.fn()} hrMaxBpm={200} />);
  expect(screen.getAllByRole('status').some((e) => /Die Watt folgen deinem Puls: Zone 2, 120 bis 140 bpm/.test(e.textContent ?? ''))).toBe(true);
});

describe('problem report', () => {
  test('sends the note and shows where the report is', () => {
    const send = vi.fn();
    const { rerender } = render(<StatusBar state={ride} connected send={send} reportPath={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Problem melden' }));
    fireEvent.change(screen.getByLabelText('Was ist passiert?'), { target: { value: 'Puls weg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bericht speichern' }));
    expect(send).toHaveBeenCalledWith({ type: 'problem-report', note: 'Puls weg' });
    rerender(<StatusBar state={ride} connected send={send} reportPath="/daten/report.txt" />);
    expect(screen.getByText(/\/daten\/report\.txt/)).toBeTruthy();
    expect(screen.getByText(/bleibt auf diesem Mac/)).toBeTruthy();
  });
});

describe('backup line', () => {
  test('one muted line says whether all rides are backed up; nothing for a profile that has not moved', () => {
    const server = (pendingRides?: number) => ({ where: 'server' as const, online: true, sinceMs: null, session: 'server' as const, queued: 0, full: false, ...(pendingRides === undefined ? {} : { pendingRides }) });
    expect(backupLine(server(0))).toBe('Alle Fahrten gesichert');
    expect(backupLine(server(1))).toBe('1 Fahrt wartet auf Upload');
    expect(backupLine(server(3))).toBe('3 Fahrten warten auf Upload');
    expect(backupLine(server())).toBeNull();
    expect(backupLine({ where: 'local' })).toBeNull();
    expect(backupLine({ where: 'moving', done: 1, total: 2, problem: null })).toBeNull();
    expect(backupLine(undefined)).toBeNull();
  });
});

test('after a ride the own progress comes first', () => {
  const summaries = [summary('a', 8), summary('b', 1, { avgHrBpm: 136 })];
  render(<FeedbackView profileId="A" rideId="b" send={vi.fn()} detail={null} summary={summaries[1]} summaries={summaries} />);
  expect(screen.getByTestId('progress').textContent).toMatch(/Gleiche Einheit wie am .*4 bpm weniger Puls/);
});
test('without a comparable ride there is no progress line', () => {
  render(<FeedbackView profileId="A" rideId="b" send={vi.fn()} detail={null} summary={summary('b', 1)} summaries={[summary('b', 1)]} />);
  expect(screen.queryByTestId('progress')).toBeNull();
});

describe('together', () => {
  const together = (over = {}) => ({
    recent: [], metres: 300, lastRideMetres: 300, line: null, summits: [], climbed: [], climbing: [],
    peak: { name: 'Mont Ventoux', done: 300, total: 1600, next: 'Stilfser Joch' },
    people: [{ profileId: 'a', name: 'Anna', ridesThisWeek: 1, minutesThisWeek: 30, streakWeeks: 0, wordsLearned: 3, weeks: [30], onTargetPct: 60 }],
    ...over,
  });
  test('a ride that reached the top says so after the ride', () => {
    const s = summary('b', 1);
    render(<FeedbackView profileId="A" rideId="b" send={vi.fn()} detail={null} summary={s} together={together({ summits: [{ name: 'Alpe d’Huez', atMs: s.startedAtMs }], climbed: [] })} />);
    expect(screen.getByTestId('summit').textContent).toContain('Alpe d’Huez');
  });
});
