// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GarminWorkoutUpload } from '../../src/tracking/ui/GarminWorkoutUpload';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const workout = { id: 'w1', startMs: new Date(2026, 10, 14, 9, 0).getTime(), endMs: new Date(2026, 10, 14, 9, 45).getTime() };
const show = (over: Partial<Parameters<typeof GarminWorkoutUpload>[0]> = {}) => {
  const onUpload = vi.fn();
  render(<GarminWorkoutUpload workout={workout} connected mode="ask" onUpload={onUpload} {...over} />);
  return onUpload;
};

test('nothing shows without a Garmin link or with uploads off', () => {
  const { container, rerender } = render(<GarminWorkoutUpload workout={workout} connected={false} mode="ask" onUpload={() => {}} />);
  expect(container.innerHTML).toBe('');
  rerender(<GarminWorkoutUpload workout={workout} connected mode="off" onUpload={() => {}} />);
  expect(container.innerHTML).toBe('');
});

test('the first click only shows the preview', () => {
  const onUpload = show();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  expect(screen.getByText('Krafttraining')).toBeTruthy();
  expect(screen.getByText('45 Min.')).toBeTruthy();
  expect(screen.getByText(/keine Übungen/)).toBeTruthy();
  expect(onUpload).not.toHaveBeenCalled();
});

test('confirming uploads, with the project link when ticked', () => {
  const a = show();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt hochladen' }));
  expect(a).toHaveBeenCalledWith(false);
  cleanup();
  const b = show();
  fireEvent.click(screen.getByRole('button', { name: 'Zu Garmin hochladen' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Jetzt hochladen' }));
  expect(b).toHaveBeenCalledWith(true);
});

test('uploaded and failed states', () => {
  show({ status: { status: 'uploaded', atMs: 1 } });
  expect((screen.getByRole('button', { name: 'Bei Garmin' }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  show({ status: { status: 'failed', atMs: 1, reason: 'reauth' } });
  expect(screen.getByRole('alert').textContent).toContain('Anmeldung ist abgelaufen');
  expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
});
