// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecoveryDialog } from '../../src/ui/views/RecoveryDialog';
import { RideView } from '../../src/ui/views/RideView';
import { FilmView } from '../../src/ui/views/FilmView';
import { hrZoneColor } from '../../src/ui/hr-zone-style';
import { pickTip, TIP_GAP_S, TIP_SHOW_S, type TipContext } from '../../src/ui/ride-tips';
import type { StateMessage } from '../../src/shared/protocol';

afterEach(cleanup);
const base: StateMessage = {
  type: 'state', session: null,
  ride: { rideId: 'r', profileId: 'A', sessionId: 's', startedAtMs: 1, status: 'open' },
  engine: { stepIndex: 0, stepRemainingS: 125, rideElapsedS: 10, targetW: 150, gradePct: null, gear: null, label: 'Warmup', nextLabel: 'Anstieg', secondsToNext: 125, autoReducedPct: 0, paused: false },
  devices: { trainer: 'connected', hr: 'connected', clicker: 'searching' },
  latest: { powerW: 148, hrBpm: 130, cadenceRpm: 85 },
  storageError: false, recovered: false, profiles: [],
};
const view = (s: Partial<StateMessage> = {}, send = vi.fn()) => { render(<RideView state={{ ...base, ...s }} send={send} />); return send; };

test('shows target, power, heart rate and remaining time', () => {
  view();
  expect(screen.getByTestId('target').textContent).toContain('150');
  expect(screen.getByTestId('power').textContent).toContain('148');
  expect(screen.getByTestId('hr').textContent).toContain('130');
  expect(screen.getByTestId('remaining').textContent).toContain('2:05');
});
test('warns before a step change', () => {
  view({ engine: { ...base.engine!, secondsToNext: 10 } });
  expect(screen.getByRole('alert').textContent).toContain('Anstieg');
});
test('missing heart rate shows dash, not error', () => {
  view({ latest: { powerW: 100 } });
  expect(screen.getByTestId('hr').textContent).toContain('–');
});
test('storage error shows prominent warning', () => {
  view({ storageError: true });
  expect(screen.getByRole('alert').textContent).toContain('Speichern');
});
test('recovery dialog names the original profile', () => {
  const resume = vi.fn();
  render(<RecoveryDialog offer={{ type: 'recovery-offer', rideId: 'r', profileId: 'A', sessionName: 'Berg', rideElapsedS: 80 }} profileName="Anna" send={resume} onClose={() => {}} />);
  expect(screen.getByRole('dialog').textContent).toContain('Anna');
  fireEvent.click(screen.getByText('Weiterfahren'));
  expect(resume).toHaveBeenCalledWith({ type: 'resume', rideId: 'r' });
});
test('a mixed session shows watt bars with the route behind them and the current target', () => {
  const session = { id: 's', name: 'x', steps: [
    { kind: 'erg' as const, durationS: 100, ftpFraction: 0.5, label: 'A' },
    { kind: 'grade' as const, durationS: 100, gradePct: 3, scale: 1, label: 'B' },
  ] };
  const { container } = render(<RideView state={{ ...base, session }} send={vi.fn()} />);
  expect(container.querySelectorAll('.workout-step')).toHaveLength(2);
  expect(container.querySelector('.workout .route')).toBeTruthy();
  expect(container.querySelector('.workout-label')?.textContent).toBe('150 W');
});
test('a session without climbs shows only watt bars', () => {
  const session = { id: 's', name: 'x', steps: [{ kind: 'erg' as const, durationS: 100, ftpFraction: 0.5, label: 'A' }] };
  const { container } = render(<RideView state={{ ...base, session }} send={vi.fn()} />);
  expect(container.querySelector('.route')).toBeNull();
});
test('m key sets a marker', () => {
  const send = view();
  fireEvent.keyDown(window, { key: 'm' });
  expect(send).toHaveBeenCalledWith({ type: 'mark' });
});
test('shows the automatic reduction', () => {
  view({ engine: { ...base.engine!, autoReducedPct: 10 } });
  expect(document.body.textContent).toContain('automatisch um 10 % gesenkt');
});
const rideSession = { id: 's', name: 'x', steps: [
  { kind: 'erg' as const, durationS: 100, ftpFraction: 0.5, label: 'A', hrZone: 2 },
  { kind: 'grade' as const, durationS: 100, gradePct: 6, scale: 1, label: 'Antritt', sudden: true },
] };
test('shows the current heart rate zone against the target', () => {
  render(<RideView state={{ ...base, session: rideSession, latest: { hrBpm: 150 } }} send={vi.fn()} hrMaxBpm={200} />);
  expect(screen.getByTestId('hr-zone').textContent).toContain('Zone 3');
  expect(screen.getByTestId('hr-zone').textContent).toContain('Ziel 2');
});
test('without a known maximum no zone is claimed', () => {
  render(<RideView state={{ ...base, session: rideSession }} send={vi.fn()} />);
  expect(screen.queryByTestId('hr-zone')).toBeNull();
});
test('says so when the strap is missing', () => {
  render(<RideView state={{ ...base, session: rideSession, devices: { ...base.devices, hr: 'searching' } }} send={vi.fn()} hrMaxBpm={200} />);
  expect(document.body.textContent).toContain('nach Watt');
});
test('warns before a sudden climb', () => {
  render(<RideView state={{ ...base, session: rideSession, engine: { ...base.engine!, secondsToNext: 10 } }} send={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain('plötzlich');
});

const filmSession: StateMessage['session'] = { id: 's', name: 'S', steps: [
  { kind: 'erg', ftpFraction: 0.5, durationS: 300, label: 'Warmup' },
  { kind: 'erg', ftpFraction: 0.9, durationS: 240, label: 'Block' },
] };
const filmProfile = { id: 'A', name: 'A', ftpW: 200 } as StateMessage['profiles'][number];
const film = (s: Partial<StateMessage>) => render(<RideView state={{ ...base, ...s }} send={vi.fn()} compact />);

test('film mode shows the watts and power zone of the next section', () => {
  film({ session: filmSession, profiles: [filmProfile] });
  const next = screen.getByTestId('film-next').textContent;
  expect(next).toContain('180 W');
  expect(next).toContain('Z3');
  expect(next).toContain('Block');
});
test('film mode names the heart rate zone when the next section follows the pulse', () => {
  film({ session: { ...filmSession!, steps: [filmSession!.steps[0], { kind: 'erg', ftpFraction: 0.6, hrHold: true, hrZone: 2, durationS: 240, label: 'Halten' }] }, profiles: [filmProfile] });
  expect(screen.getByTestId('film-next').textContent).toContain('Puls Zone 2');
});
test('film mode shows nothing next in the last section', () => {
  film({ session: filmSession, profiles: [filmProfile], engine: { ...base.engine!, stepIndex: 1 } });
  expect(screen.queryByTestId('film-next')).toBeNull();
});
test('film mode beats the heart at the measured rate and shows the profile', () => {
  const { container } = film({ session: filmSession, profiles: [filmProfile] });
  const heart = screen.getByTestId('film-heart');
  expect(heart.className).toContain('beating');
  expect(heart.style.animationDuration).toBe(`${60 / 130}s`);
  expect(container.querySelectorAll('.workout-step')).toHaveLength(2);
});
test('film mode keeps the heart still without a heart rate', () => {
  film({ latest: { powerW: 148, cadenceRpm: 85 } });
  expect(screen.getByTestId('film-heart').className).not.toContain('beating');
});
test('heart rate zones keep their fixed color', () => {
  render(<RideView state={{ ...base, session: filmSession }} send={vi.fn()} hrMaxBpm={200} />);
  const chip = screen.getByTestId('hr-zone').querySelector('[data-zone]');
  expect(chip?.getAttribute('data-zone')).toBe('2');
  expect(hrZoneColor(2)).toBe('var(--hrz2)');
  expect(hrZoneColor(0)).toBeUndefined();
});
test('film mode colors the number by zone, the heart stays red', () => {
  render(<FilmView state={{ ...base, profiles: [{ ...filmProfile, hrMaxBpm: 200 }] }} send={vi.fn()} />);
  expect(screen.getByTestId('hr').getAttribute('style')).toContain('--hrz2');
  expect(screen.getByTestId('film-heart').getAttribute('style')).not.toContain('--hrz');
});
const tipSession: StateMessage['session'] = { id: 's', name: 'S', steps: [{ kind: 'erg', ftpFraction: 0.5, durationS: 3600, label: 'Locker' }] };
const tipEngine = (t: number) => ({ ...base.engine!, rideElapsedS: t, stepRemainingS: 3600 - t, secondsToNext: 3600 - t, nextLabel: null });
test('the coach gives a short tip, keeps its distance and takes it away again', () => {
  const at = (t: number) => <RideView state={{ ...base, session: tipSession, engine: tipEngine(t) }} send={vi.fn()} />;
  const { rerender } = render(at(600));
  rerender(at(600 + TIP_GAP_S - 1));
  expect(screen.queryByTestId('ride-tip')).toBeNull();
  rerender(at(600 + TIP_GAP_S));
  expect(screen.getByTestId('ride-tip').textContent).toContain('Bo:');
  rerender(at(600 + TIP_GAP_S + TIP_SHOW_S));
  expect(screen.queryByTestId('ride-tip')).toBeNull();
});
test('no tip during a pause', () => {
  const at = (t: number, paused: boolean) => <RideView state={{ ...base, session: tipSession, engine: { ...tipEngine(t), paused } }} send={vi.fn()} />;
  const { rerender } = render(at(600, true));
  rerender(at(600 + TIP_GAP_S, true));
  expect(screen.queryByTestId('ride-tip')).toBeNull();
});
const ctx = (over: Partial<TipContext> = {}): TipContext => ({ session: tipSession!, engine: tipEngine(100), cadences: [], zones: [], ...over });
test('tips put the body first: heart rate above target wins', () => {
  expect(pickTip(ctx({ zones: [4, 4], cadences: [50, 50], engine: tipEngine(1300) }), new Set())?.id).toBe('hr-0');
});
test('low cadence gets a tip only if the whole minute was low', () => {
  expect(pickTip(ctx({ cadences: [50, 50] }), new Set())?.id).toBe('cadence-0');
  expect(pickTip(ctx({ cadences: [50, 70] }), new Set())).toBeNull();
});
test('a tip is not repeated', () => {
  expect(pickTip(ctx({ cadences: [50] }), new Set(['cadence-0']))).toBeNull();
});
// Task 6: warnings and the end path beat decoration.
test('storage error and lost trainer: both warnings and Beenden stay reachable', () => {
  const send = view({ storageError: true, devices: { trainer: 'searching', hr: 'connected', clicker: 'connected' } });
  expect(screen.getByRole('alert').textContent).toContain('Speichern');
  expect(document.body.textContent).toContain('Trainer wird gesucht');
  expect(document.body.textContent).toContain('Die Fahrt läuft weiter und ist gespeichert');
  fireEvent.click(screen.getByText('Beenden'));
  expect(send).not.toHaveBeenCalled();
});
test('saving sends stop; discarding is a separate explicit button; continuing sends nothing', () => {
  const send = view({ storageError: true });
  fireEvent.click(screen.getByText('Beenden'));
  expect(screen.getByRole('dialog').textContent).toContain('Verwerfen');
  fireEvent.click(screen.getByText('Weiterfahren'));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Beenden'));
  fireEvent.click(screen.getByText('Speichern und beenden'));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ type: 'stop' });
  fireEvent.click(screen.getByText('Beenden'));
  fireEvent.click(screen.getByText('Verwerfen'));
  expect(send).toHaveBeenLastCalledWith({ type: 'discard' });
});
test('recovery keeps two distinct choices: resume and end here', () => {
  const send = vi.fn();
  const onClose = vi.fn();
  render(<RecoveryDialog offer={{ type: 'recovery-offer', rideId: 'r', profileId: 'A', sessionName: 'Berg', rideElapsedS: 80 }} profileName="Anna" send={send} onClose={onClose} />);
  fireEvent.click(screen.getByText('Fahrt hier beenden'));
  expect(send).toHaveBeenCalledWith({ type: 'discard-resume', rideId: 'r' });
  expect(send).not.toHaveBeenCalledWith({ type: 'resume', rideId: 'r' });
  expect(onClose).toHaveBeenCalled();
});
test('film mode keeps the storage warning', () => {
  film({ storageError: true });
  expect(screen.getByRole('alert').textContent).toContain('Speichern');
});
test('prepares for a harder section ahead', () => {
  const session = { ...tipSession!, steps: [tipSession!.steps[0], { kind: 'erg' as const, ftpFraction: 0.9, durationS: 240, label: 'Block' }] };
  expect(pickTip(ctx({ session, engine: { ...tipEngine(100), stepRemainingS: 60 } }), new Set())?.id).toBe('prepare-0');
});
