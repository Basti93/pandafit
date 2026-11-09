// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useWeekDays } from '../../src/tracking/ui/week-days';
import { fakePort } from './fake-port';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 12).getTime();

it('is loaded once the reads answered, also when the activities or workouts read fails', async () => {
  const { port, state } = fakePort([]);
  const ok = renderHook(() => useWeekDays(port, NOW));
  await waitFor(() => expect(ok.result.current.loaded).toBe(true));
  cleanup();
  state.failList = true;
  const bad = renderHook(() => useWeekDays(port, NOW));
  await waitFor(() => expect(bad.result.current.loaded).toBe(true));
  expect(bad.result.current.rows.every((r) => r.done.length === 0)).toBe(true);
});
