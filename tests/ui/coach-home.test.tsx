// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { CoachState } from '../../src/coach/state';
import type { CoachHome } from '../../src/coach/protocol';
import type { Profile } from '../../src/shared/profiles';
import { settleServerProfile, useServerProfile } from '../../src/ui/useServerProfile';
import { AccountCard } from '../../src/ui/views/AccountCard';
import { CoachView } from '../../src/ui/views/CoachView';
import { ProfileSettingsView } from '../../src/ui/views/ProfileSettingsView';

afterEach(cleanup);
const session = { id: 'ki', name: 'Grundlage plus', steps: [{ kind: 'erg' as const, durationS: 600, ftpFraction: 0.5, label: 'Warmup' }] };
const local: Profile = { id: 'p', name: 'Anna', ftpW: 150, maxHrBpm: 175, ftpCapW: 180 };
const server: Profile = { id: 'p', name: 'Anna', ftpW: 210, maxHrBpm: 175 };
const state = { profileId: 'p', ftpW: 210, ftpHistory: [], phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [], next: { session, reason: 'y', source: 'claude' }, changes: [], notes: [], feedback: {}, summaries: [], processedRides: [], awaitingFeedback: null, dirty: false, dirtySinceMs: null, lastError: null, lastAttemptMs: null } as CoachState;
const home = (o: Partial<Extract<CoachHome, { where: 'server' }>> = {}): CoachHome => ({ where: 'server', online: true, sinceMs: null, session: 'server', queued: 0, full: false, ...o });

test("a moved profile's server values reach the ride service", () => {
  const send = vi.fn();
  const { rerender } = renderHook(({ s }) => useServerProfile(local, s, false, send), { initialProps: { s: server } });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ type: 'save-profile', profile: { id: 'p', name: 'Anna', ftpW: 210, maxHrBpm: 175 } });
  rerender({ s: { ...server } });
  expect(send).toHaveBeenCalledTimes(1);
});
test('no save-profile while a ride is open', () => {
  const send = vi.fn();
  const { rerender } = renderHook(({ r }) => useServerProfile(local, server, r, send), { initialProps: { r: true } });
  expect(send).not.toHaveBeenCalled();
  rerender({ r: false });
  expect(send).toHaveBeenCalledTimes(1);
});
test('nothing is sent when the values already match', () => {
  const send = vi.fn();
  renderHook(() => useServerProfile({ ...server, weightKg: undefined }, server, false, send));
  expect(send).not.toHaveBeenCalled();
});
test('an edit on the Mac sends profile-update to the coach and save-profile to the ride service', () => {
  const sendRide = vi.fn(); const sendCoach = vi.fn();
  render(<ProfileSettingsView profile={local} ftpW={150} coachConnected coachHome={home()} sendRide={sendRide} sendCoach={sendCoach} onBack={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Gewicht (kg)'), { target: { value: '70' } });
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(sendCoach).toHaveBeenCalledWith({ type: 'profile-update', profileId: 'p', profile: { ...local, sex: 'unknown', weightKg: 70 } });
  expect(sendRide).toHaveBeenCalledWith({ type: 'save-profile', profile: expect.objectContaining({ weightKg: 70 }) });
});
const coachView = (s: CoachState | null, h: CoachHome) => {
  const ride = vi.fn();
  render(<CoachView profile={local} state={s} thinking={false} coachConnected coachHome={h} sendRide={ride} sendCoach={vi.fn()} />);
  return ride;
};
test('offline shows the time of the last state and which session it is', () => {
  const at = new Date(2026, 10, 3, 7, 5).getTime();
  coachView(state, home({ online: false, sinceMs: at, session: 'cached', queued: 2 }));
  expect(screen.getByText('Server nicht erreichbar. Stand von 07:05.')).toBeTruthy();
  expect(screen.getByText('Gespeicherte Einheit vom Server')).toBeTruthy();
  expect(screen.getByText('2 Änderungen werden gesendet, sobald der Server erreichbar ist.')).toBeTruthy();
});
test('rules session, full queue and drift are told calmly', () => {
  coachView(state, home({ session: 'rules', full: true, drift: ['profile'] }));
  expect(screen.getByText('Einheit nach Regeln')).toBeTruthy();
  expect(screen.getByText(/Warteschlange voll/)).toBeTruthy();
  expect(screen.getByText('Ein paar Änderungen kurz vor dem Umzug sind nur auf diesem Mac.')).toBeTruthy();
});
test('start uses the cached session and FTP when offline', () => {
  const ride = coachView(state, home({ online: false, sinceMs: 1, session: 'cached' }));
  fireEvent.click(screen.getByText('Los'));
  expect(ride).toHaveBeenCalledWith({ type: 'start', profileId: 'p', session, ftpW: 210, maxHrBpm: 175 });
});
test('moving shows the progress and the problem in the account card', () => {
  const status = { state: 'linked', name: 'anna', reason: null, refused: 0, offline: false, lastSyncMs: null } as const;
  render(<AccountCard profileId="p" status={status} send={vi.fn()} coachHome={{ where: 'moving', done: 3, total: 8, problem: 'unreadable' }} />);
  expect(screen.getByText('Umzug zum Server: 3 von 8')).toBeTruthy();
  expect(screen.getByText('Eine Datei konnte nicht gelesen werden. Der Umzug wartet.')).toBeTruthy();
});
test('an unlinked profile shows no note and the coach page renders as before', () => {
  coachView(state, { where: 'local' });
  expect(screen.queryByText(/Server|Umzug/)).toBeNull();
  expect(screen.getByText('Los')).toBeTruthy();
});

test('nothing is sent until the ride service state is known', () => {
  const send = vi.fn();
  const { rerender } = renderHook(({ k }) => useServerProfile(local, server, false, send, k), { initialProps: { k: false } });
  expect(send).not.toHaveBeenCalled();
  rerender({ k: true });
  expect(send).toHaveBeenCalledTimes(1);
});
test('a message the ride service did not take is tried again for the same server state', () => {
  const send = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const { rerender } = renderHook(({ k }) => useServerProfile(local, server, false, send, k), { initialProps: { k: true } });
  expect(send).toHaveBeenCalledTimes(1);
  rerender({ k: false });
  rerender({ k: true });
  expect(send).toHaveBeenCalledTimes(2);
  rerender({ k: false });
  rerender({ k: true });
  expect(send).toHaveBeenCalledTimes(2);
});
test('a cleared estimate limit on the server is cleared locally', () => {
  const send = vi.fn();
  renderHook(() => useServerProfile(local, { ...server, ftpW: 150 }, false, send));
  expect(send.mock.calls[0][0].profile.ftpCapW).toBeUndefined();
});
test('a server profile older than a local edit is skipped until it reflects the edit or 30 seconds pass', () => {
  const edit = { ...server, weightKg: 70 };
  const pending = { profile: edit, atMs: 1000 };
  expect(settleServerProfile(pending, server, 2000)).toEqual({ accept: false, pending });
  expect(settleServerProfile(pending, edit, 2000)).toEqual({ accept: true, pending: null });
  expect(settleServerProfile(pending, server, 32_000)).toEqual({ accept: true, pending: null });
  expect(settleServerProfile(null, server, 2000)).toEqual({ accept: true, pending: null });
});
