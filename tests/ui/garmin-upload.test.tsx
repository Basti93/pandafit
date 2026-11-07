// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CoachState } from '../../src/coach/state';
import type { RideSummary } from '../../src/coach/metrics';
import { FeedbackView } from '../../src/ui/views/FeedbackView';
import { FilmView } from '../../src/ui/views/FilmView';
import { GarminCard } from '../../src/ui/views/GarminCard';
import { GarminUploadButton } from '../../src/ui/views/GarminUploadButton';

afterEach(cleanup);
const ride = { rideId: 'r1', startedAtMs: 1, status: 'finished', sessionId: 's', ftpW: 200, durationS: 1800, avgPowerW: 100, normalizedPowerW: 100, intensityFactor: 0.5, tss: 10, avgHrBpm: 100, maxHrBpm: 120, bestMinutePowerW: 120, completedFraction: 1 } as RideSummary;
const up = (status: 'uploading' | 'uploaded' | 'failed', reason?: string) => ({ status, atMs: 1, ...(reason ? { reason } : {}) });
const button = (status?: ReturnType<typeof up>, connected = true) => {
  const onUpload = vi.fn();
  render(<GarminUploadButton ride={{ ...ride, sessionName: 'Grundlage' }} status={status} connected={connected} onUpload={onUpload} />);
  return onUpload;
};
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Jetzt hochladen' }));

test('the first click only shows a preview, nothing goes up', () => {
  const onUpload = button();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  const preview = screen.getByRole('dialog').textContent;
  for (const text of ['Indoor Cycling', '30 Min.', '100 W', '100 bpm', 'r1.fit', 'doppelt']) expect(preview).toContain(text);
  expect(onUpload).not.toHaveBeenCalled();
});
test('it goes up only after confirming', () => {
  const onUpload = button();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  confirm();
  expect(onUpload).toHaveBeenCalledTimes(1);
});
test('cancelling sends nothing and closes the preview', () => {
  const onUpload = button();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(onUpload).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('unmeasured values do not show as null', () => {
  render(<GarminUploadButton ride={{ ...ride, avgPowerW: null, avgHrBpm: null, maxHrBpm: null }} connected onUpload={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  expect(screen.getByRole('dialog').textContent).not.toContain('null');
});
test('shows that an upload is running and cannot be pressed twice', () => {
  button(up('uploading'));
  expect((screen.getByRole('button', { name: 'Wird hochgeladen …' }) as HTMLButtonElement).disabled).toBe(true);
});
test('shows that the ride is up', () => {
  button(up('uploaded'));
  expect((screen.getByRole('button', { name: 'Bei Garmin' }) as HTMLButtonElement).disabled).toBe(true);
});
test('a failed upload says why and asks again before retrying', () => {
  const onUpload = button(up('failed', 'reauth'));
  expect(screen.getByRole('alert').textContent).toContain('neu anmelden');
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(onUpload).not.toHaveBeenCalled();
  confirm();
  expect(onUpload).toHaveBeenCalled();
});
test('no button without a Garmin connection', () => {
  button(undefined, false);
  expect(screen.queryByRole('button')).toBeNull();
});

const feedback = (mode: 'off' | 'ask', connected = true) => {
  const send = vi.fn();
  render(<FeedbackView profileId="p" rideId="r1" summary={ride} send={send} detail={null} garminConnected={connected} upload={{ mode, rides: {} }} />);
  return send;
};
test('the feedback screen stays quiet while uploading is off', () => {
  feedback('off');
  expect(screen.queryByRole('button', { name: 'Zu Garmin hochladen' })).toBeNull();
});
test('the feedback screen offers the upload when asking is chosen', () => {
  const send = feedback('ask');
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'garmin-upload' }));
  confirm();
  expect(send).toHaveBeenCalledWith({ type: 'garmin-upload', profileId: 'p', rideId: 'r1', repoLink: false });
});

const card = (upload?: Parameters<typeof GarminCard>[0]['upload']) => {
  const send = vi.fn();
  render(<GarminCard profileId="p" status={{ state: 'connected' }} send={send} upload={upload} />);
  return send;
};
test('uploading starts switched off and offers no automatic mode', () => {
  card();
  expect((screen.getByLabelText('Aus') as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByLabelText('Automatisch')).toBeNull();
  expect(screen.queryByText(/doppelt/)).toBeNull();
});
test('choosing to be asked is sent to the coach', () => {
  const send = card();
  fireEvent.click(screen.getByLabelText('Jedes Mal fragen'));
  expect(send).toHaveBeenCalledWith({ type: 'garmin-upload-settings', profileId: 'p', mode: 'ask' });
});
test('says that every upload needs a confirmation', () => {
  card({ mode: 'ask', rides: {} });
  expect(screen.getByText(/nur nach deiner Bestätigung/)).toBeTruthy();
});

test('after the ride the film window leads back to the main window', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  render(<FilmView state={null} send={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Zum Hauptfenster' }));
  expect(open).toHaveBeenCalledWith('#main', 'main');
  open.mockRestore();
});
test('without a Garmin connection the feedback screen shows no upload at all', () => {
  feedback('ask', false);
  expect(screen.queryByRole('button', { name: 'Zu Garmin hochladen' })).toBeNull();
});
describe('repo link', () => {
  beforeEach(() => localStorage.clear());
  const open = (onUpload = vi.fn()) => {
    render(<GarminUploadButton ride={ride} connected onUpload={onUpload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
    return onUpload;
  };
  test('stays out unless the rider ticks it', () => {
    const onUpload = open();
    expect((screen.getByLabelText(/Link zum Projekt/) as HTMLInputElement).checked).toBe(false);
    confirm();
    expect(onUpload).toHaveBeenCalledWith(false);
  });
  test('goes along when ticked, and the choice is remembered', () => {
    const onUpload = open();
    fireEvent.click(screen.getByLabelText(/Link zum Projekt/));
    expect(screen.getByRole('dialog').textContent).toContain('github.com');
    confirm();
    expect(onUpload).toHaveBeenCalledWith(true);
    cleanup();
    open();
    expect((screen.getByLabelText(/Link zum Projekt/) as HTMLInputElement).checked).toBe(true);
  });
});
