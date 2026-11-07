// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AccountStatus, CoachHome } from '../../src/shared/coach-protocol';
import { App } from '../../src/ui/App';

afterEach(cleanup);
const h = vi.hoisted(() => ({ account: { state: 'linked', name: 'anna', reason: null, refused: 0, offline: false, lastSyncMs: null, webOrigin: 'https://pandafit.example.org' } as unknown, home: { where: 'server', online: true, sinceMs: null, session: 'server', queued: 0, full: false, pendingRides: 0 } as unknown, garmin: { state: 'idle' } as unknown, ride: false }));
vi.mock('../../src/ui/useCoach', () => ({ useCoach: () => ({
  state: { profileId: 'a', ftpW: 200, ftpHistory: [], phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [], next: { session: { id: 'ki', name: 'Grundlage plus', steps: [{ kind: 'erg', durationS: 600, ftpFraction: 0.5, label: 'Warmup' }] }, reason: 'y', source: 'claude' }, changes: [], notes: [], feedback: {}, summaries: [], processedRides: [], awaitingFeedback: null, dirty: false, dirtySinceMs: null, lastError: null, lastAttemptMs: null }, thinking: false, connected: true, send: () => {}, hevy: { state: 'idle' }, garmin: h.garmin, together: null, strengthHealth: null, garminHealth: null,
  account: h.account as AccountStatus, coachHome: h.home as CoachHome, serverProfile: null, detail: null, debriefing: false,
}) }));
vi.mock('../../src/ui/useRide', () => ({ useRide: () => ({
  state: { type: 'state', ride: h.ride ? { profileId: 'a' } : null, engine: null, devices: {}, latest: {}, storageError: false, recovered: false, profiles: [{ id: 'a', name: 'Mia', ftpW: 200 }] },
  offer: null, clearOffer: () => {}, connected: true, send: () => {}, error: null, fresh: true,
}) }));

const enter = () => { render(<App />); fireEvent.click(screen.getByText('Mia')); };

test('after choosing a profile the menu is Fahren and Profil, and the start screen has the ride, the backup line and the web link', () => {
  enter();
  const nav = screen.getByRole('navigation', { name: 'Hauptmenü' });
  expect(Array.from(nav.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Fahren', 'Profil', 'Profil wechseln']);
  expect(screen.getByText('Los')).toBeTruthy();
  expect(screen.getByTestId('ride-backup').textContent).toBe('Alle Fahrten gesichert');
  expect(screen.getByRole('button', { name: 'Web-App öffnen' })).toBeTruthy();
});

test('a profile whose coach runs on the server has Hevy, Garmin and the rest in the web app; the account stays here', () => {
  enter();
  fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
  expect(screen.getByText(/stellst du in der Web-App unter Profil ein/)).toBeTruthy();
  expect(screen.queryByText(/Hevy verbunden|Garmin verbinden/)).toBeNull();
  expect(screen.getByRole('button', { name: /Sprachen lernen/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Krafttraining starten' })).toBeNull();
});

test('a profile whose coach runs on the Mac keeps Hevy and Garmin here, and a not linked one hears about the web app once', () => {
  h.home = { where: 'local' };
  h.account = { state: 'idle', name: null, reason: null, refused: 0, offline: false, lastSyncMs: null };
  enter();
  fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
  expect(screen.getByText('Garmin verbinden (optional)')).toBeTruthy();
  expect(screen.getByText(/Kraft, Laufen, Essen und Statistik gibt es in der Web-App – dafür das Konto verbinden/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fahren' }));
  expect(screen.queryByRole('button', { name: 'Web-App öffnen' })).toBeNull();
});

test('health lives in the web app: no Gesundheit page on the Mac profile page, even with Garmin connected', () => {
  h.garmin = { state: 'connected' };
  enter();
  fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
  expect(screen.getByRole('button', { name: 'Profil' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByRole('button', { name: /Gesundheit/ })).toBeNull();
});
