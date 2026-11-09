// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { runFp } from '../../src/shared/run';
import { weekOf } from '../../src/shared/meals';
import { addDays } from '../../src/shared/week-plan';
import type { TrackedRecord } from '../../src/shared/records';
import { useSportWeek } from '../../src/tracking/ui/sport-week';
import { fakePort } from './fake-port';

afterEach(cleanup);
const NOW = new Date(2026, 10, 4, 12).getTime(); // Wednesday

it('uses the run coach runs as the plan for Laufen', async () => {
  const week = weekOf(NOW);
  const planned = { date: addDays(week, 4), kind: 'easy' as const, minutes: 30, hrCap: 150, counts: 'Zeit.', note: null };
  const rec: TrackedRecord = { kind: 'run', id: `week-${week}`, updatedMs: NOW - 1000, deleted: false, body: { type: 'week', week, announce: true, atMs: NOW - 900, phase: 1, source: 'rules', reason: 'r', note: null, runs: [{ ...planned, fp: runFp(planned), done: null }], garmin: null } };
  const { port } = fakePort([rec]);
  const { result } = renderHook(() => useSportWeek(port, NOW, 'lauf'));
  await waitFor(() => expect(result.current.loaded && result.current.planned === 1).toBe(true));
  expect(result.current.marks).toEqual(['open']);
  expect(result.current.text).toBe('Diese Woche ist noch kein Lauf erledigt. Der nächste kommt am Freitag.');
  expect(result.current.label).toBe('0 von 1 Läufen');
});
