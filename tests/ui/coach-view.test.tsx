// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CoachState } from '../../src/coach/state';
import { CoachView } from '../../src/ui/views/CoachView';

afterEach(cleanup);
const session = { id: 'ki', name: 'Grundlage plus', steps: [{ kind: 'erg' as const, durationS: 600, ftpFraction: 0.5, label: 'Warmup' }] };
const profile = { id: 'pa', name: 'Anna', ftpW: 150, maxHrBpm: 175 };
const state = { profileId: 'pa', ftpW: 180, ftpHistory: [], phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [], next: { session, reason: 'y', source: 'claude' }, changes: [], notes: [], feedback: {}, summaries: [], processedRides: [], awaitingFeedback: null, dirty: false, dirtySinceMs: null, lastError: null, lastAttemptMs: null } as CoachState;
const view = (s: CoachState | null) => {
  const ride = vi.fn();
  render(<CoachView profile={profile} state={s} thinking={false} coachConnected={!!s} sendRide={ride} sendCoach={vi.fn()} />);
  return ride;
};
test('start uses coach session, coach FTP and the pulse limit', () => {
  const ride = view(state);
  fireEvent.click(screen.getByText('Los'));
  expect(ride).toHaveBeenCalledWith({ type: 'start', profileId: 'pa', session, ftpW: 180, maxHrBpm: 175 });
});
test('without the coach you can still ride a starter session', () => {
  const ride = view(null);
  fireEvent.click(within(screen.getByText('Locker, 30 Minuten').closest('article')!).getByText('Auswählen'));
  expect(ride).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Los'));
  expect(ride.mock.calls[0][0]).toMatchObject({ type: 'start', ftpW: 150 });
});

test('the bike page has no menu buttons and no connection cards of its own', () => {
  render(<CoachView profile={profile} state={state} thinking={false} coachConnected sendRide={vi.fn()} sendCoach={vi.fn()} garmin={{ state: 'idle' }} />);
  for (const name of ['Verlauf', 'Profil bearbeiten', 'Profil wechseln', 'Krafttraining starten', 'Gesundheit', 'Übersicht', 'Sprachen lernen: an']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByText(/Garmin verbinden|Hevy verbinden|Pandafit-Konto|Garmin verbunden/)).toBeNull();
});
test('a Garmin login that ran out is mentioned calmly, with the way to the profile', () => {
  const onProfile = vi.fn();
  render(<CoachView profile={profile} state={state} thinking={false} coachConnected sendRide={vi.fn()} sendCoach={vi.fn()} garmin={{ state: 'connected' }} garminSync={{ running: false, complete: true, lastRunMs: null, problem: 'reauth' } as never} onProfile={onProfile} />);
  expect(screen.getByText(/Garmin-Anmeldung ist abgelaufen/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Zum Profil' }));
  expect(onProfile).toHaveBeenCalled();
});
test('the start screen has the backup line and, only with a link, the button to the web app', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const server = { where: 'server' as const, online: true, sinceMs: null, session: 'server' as const, queued: 0, full: false, pendingRides: 2 };
  const { rerender } = render(<CoachView profile={profile} state={state} thinking={false} coachConnected coachHome={server} sendRide={vi.fn()} sendCoach={vi.fn()} />);
  expect(screen.getByTestId('ride-backup').textContent).toBe('2 Fahrten warten auf Upload');
  expect(screen.queryByRole('button', { name: 'Web-App öffnen' })).toBeNull();
  rerender(<CoachView profile={profile} state={state} thinking={false} coachConnected coachHome={server} webOrigin="https://pandafit.example.org" sendRide={vi.fn()} sendCoach={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Web-App öffnen' }));
  expect(open).toHaveBeenCalledWith('https://pandafit.example.org', '_blank', 'noopener');
  open.mockRestore();
});
test('no chat, motivation, mobility or together cards on the Mac start screen', () => {
  view(state);
  expect(screen.queryByRole('textbox', { name: 'Hinweis an Bo' })).toBeNull();
  expect(screen.queryByText('Bo, dein Sensei')).toBeNull();
  expect(screen.getByText('Los')).toBeTruthy();
});
