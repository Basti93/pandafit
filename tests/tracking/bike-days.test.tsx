// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import type { TrackedRecord } from '../../src/shared/records';
import { useTodayAdvice, ratingsFromRecords } from '../../src/tracking/ui/frame-hooks';
import { fakePort } from './fake-port';

const NOW = new Date(2026, 10, 4, 9).getTime(); // Wednesday morning
const DAY = 86_400_000;
const ride = (id: string, ago: number, hardness: 'easy' | 'moderate' | 'hard'): TrackedRecord => ({ kind: 'ride', id, updatedMs: 1, deleted: false, body: {
  type: 'ride', startedAtMs: NOW - ago, sessionName: 'Intervalle', durationS: 3600, hardness, avgPowerW: 180, normalizedPowerW: 200, avgHrBpm: 150, maxHrBpm: 170, tss: 70, completedFraction: 1, curve: [],
} });

test('ratings include the rides the coach published', () => {
  const r = ratingsFromRecords([], [], [], ['2026-11-03', '2026-11-04'], [{ type: 'ride', startedAtMs: NOW - DAY, durationS: 3000, hardness: 'hard', avgPowerW: 1, normalizedPowerW: 1, avgHrBpm: 1, maxHrBpm: 1, tss: 1, completedFraction: 1, curve: [] }]);
  expect(r['2026-11-03']).toMatchObject({ hardness: 'hard', minutes: 50, sports: ['bike'] });
  expect(r['2026-11-04']!.hardness).toBeNull();
});

test('the own advice knows the rides: two hard days of riding make today easy', async () => {
  const { port } = fakePort([ride('a', DAY, 'hard'), ride('b', 2 * DAY, 'hard')]);
  const { result } = renderHook(() => useTodayAdvice(port, NOW));
  await waitFor(() => expect(result.current.advice.reason).toContain('harte Tage hintereinander'));
  expect(result.current.advice.hardness).toBe('easy');
});

test('without rides the same morning has no such reason', async () => {
  const { port } = fakePort([]);
  const { result } = renderHook(() => useTodayAdvice(port, NOW));
  await waitFor(() => expect(result.current.advice).toBeTruthy());
  expect(result.current.advice.reason).not.toContain('harte Tage');
});
