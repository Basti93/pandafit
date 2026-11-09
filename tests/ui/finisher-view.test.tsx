// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { LoggedWorkout } from '../../src/shared/records';
import { WorkoutSummary } from '../../src/tracking/ui/WorkoutSummary';

afterEach(cleanup);
const NOON = new Date(2026, 10, 8, 12).getTime();
const w: LoggedWorkout = { id: 'w', title: 'Beine', startMs: NOON - 50 * 60_000, endMs: NOON, source: 'pandafit', exercises: [] };
const props = { workout: w, next: [], nowMs: NOON + 60_000, today: null, activities: [], complaintsOpen: false };

test('the summary shows the finisher with the cardio line and keeps one Fertig button', () => {
  let done = 0;
  render(<WorkoutSummary {...props} onDone={() => { done++; }} />);
  expect(screen.getByRole('heading', { name: 'Locker ausklingen' })).toBeTruthy();
  expect(screen.getByText('Mach 20 Min lockeres Cardio auf dem Rad, dem Crosstrainer oder dem Laufband. Du kannst dabei noch reden.')).toBeTruthy();
  expect(screen.getByText('Dehn ein paar Minuten, was sich fest anfühlt.')).toBeTruthy();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
  expect(done).toBe(1);
});

test('the summary says only stretching counts when cardio does not fit', () => {
  render(<WorkoutSummary {...props} complaintsOpen onDone={() => {}} />);
  expect(screen.getByText('Heute reicht Dehnen.')).toBeTruthy();
  expect(screen.queryByText(/20 Min locker Cardio/)).toBeNull();
});
