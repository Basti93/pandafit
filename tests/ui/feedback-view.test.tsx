// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FeedbackView } from '../../src/ui/views/FeedbackView';
import type { RideSummary } from '../../src/coach/metrics';
import type { RideDetail } from '../../src/coach/protocol';

afterEach(cleanup);

const summary: RideSummary = {
  rideId: 'r1', startedAtMs: 0, status: 'finished', sessionId: 'test-10', sessionName: 'Testfahrt, 10 Minuten', ftpW: 150, durationS: 600,
  avgPowerW: 112, normalizedPowerW: 130, intensityFactor: 0.87, tss: 12, avgHrBpm: 119, maxHrBpm: 155, bestMinutePowerW: 211, completedFraction: 1,
};
const detail: RideDetail = { rideId: 'r1', points: [
  { t: 10, powerW: 100, hrBpm: 110, cadenceRpm: 70 },
  { t: 20, powerW: 120, hrBpm: 120, cadenceRpm: 80 },
] };

test('asks for the ride data as soon as it opens', () => {
  const send = vi.fn();
  render(<FeedbackView profileId="p" rideId="r1" send={send} summary={summary} detail={null} />);
  expect(send).toHaveBeenCalledWith({ type: 'ride-detail', profileId: 'p', rideId: 'r1' });
});

test('shows the key numbers of the ride', () => {
  render(<FeedbackView profileId="p" rideId="r1" send={vi.fn()} summary={summary} detail={null} />);
  expect(screen.getByText('Testfahrt, 10 Minuten')).toBeTruthy();
  expect(screen.getByText('10 Min.')).toBeTruthy();
  expect(screen.getByText('112 W')).toBeTruthy();
  expect(screen.getByText('155 bpm')).toBeTruthy();
});

test('draws power, heart rate and cadence over time', () => {
  render(<FeedbackView profileId="p" rideId="r1" send={vi.fn()} summary={summary} detail={detail} />);
  expect(screen.getByRole('img', { name: /Leistung/ })).toBeTruthy();
  expect(screen.getByRole('img', { name: /Puls/ })).toBeTruthy();
  expect(screen.getByRole('img', { name: /Trittfrequenz/ })).toBeTruthy();
});

test('ignores the data of another ride', () => {
  render(<FeedbackView profileId="p" rideId="r1" send={vi.fn()} summary={summary} detail={{ ...detail, rideId: 'other' }} />);
  expect(screen.queryByRole('img', { name: /Leistung/ })).toBeNull();
});

test('rating still works, even without a summary', () => {
  const send = vi.fn();
  render(<FeedbackView profileId="p" rideId="r1" send={send} summary={undefined} detail={null} />);
  fireEvent.click(screen.getByRole('button', { name: /Genau richtig/ }));
  expect(send).toHaveBeenCalledWith({ type: 'feedback', profileId: 'p', rideId: 'r1', rating: 'right' });
});

test('asks only once, even when the parent hands in a new send function', () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = render(<FeedbackView profileId="p" rideId="r1" send={first} summary={summary} detail={null} />);
  rerender(<FeedbackView profileId="p" rideId="r1" send={second} summary={summary} detail={detail} />);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
});
