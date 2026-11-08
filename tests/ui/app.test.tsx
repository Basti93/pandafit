// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { App } from '../../src/ui/App';

afterEach(cleanup);
vi.mock('../../src/ui/useCoach', () => ({ useCoach: () => ({ state: null, thinking: false, connected: false, send: () => {} }) }));
vi.mock('../../src/ui/useRide', () => ({ useRide: () => ({
  state: { type: 'state', ride: null, engine: null, devices: {}, latest: {}, storageError: false, recovered: false, profiles: [] },
  offer: null, clearOffer: () => {}, connected: true, send: () => {}, error: 'Speicher voll',
}) }));
test('service errors are shown', () => {
  render(<App />);
  expect(screen.getByRole('alert').textContent).toContain('Speicher voll');
});
test('a found interrupted ride is offered even before a profile is chosen', async () => {
  vi.resetModules();
  vi.doMock('../../src/ui/useCoach', () => ({ useCoach: () => ({ state: null, thinking: false, connected: false, send: () => {} }) }));
  vi.doMock('../../src/ui/useRide', () => ({ useRide: () => ({
    state: { type: 'state', ride: null, engine: null, devices: {}, latest: {}, storageError: false, recovered: false, profiles: [{ id: 'A', name: 'Anna' }] },
    offer: { type: 'recovery-offer', rideId: 'r', profileId: 'A', sessionName: 'Berg', rideElapsedS: 80 }, clearOffer: () => {}, connected: true, send: () => {}, error: null,
  }) }));
  const { App: Fresh } = await import('../../src/ui/App');
  render(<Fresh />);
  expect(screen.getByRole('dialog').textContent).toContain('Unterbrochene Fahrt');
  expect(screen.getByText('Weiterfahren')).toBeTruthy();
  expect(screen.getByText('Fahrt hier beenden')).toBeTruthy();
});
test('the small film window has no status bar, so the numbers stay visible', () => {
  window.location.hash = '#film';
  render(<App />);
  expect(screen.queryByText('Problem melden')).toBeNull();
  window.location.hash = '';
});
