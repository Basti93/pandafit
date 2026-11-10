import { longTermHint, weekHistory } from '../../../src/coach/chat/long-term';
import type { TrackedRecord } from '../../../src/shared/records';

const NOW = new Date(2026, 10, 4, 9).getTime(); // Wednesday, week of 2026-11-02
const day = (date: string, minutes: Partial<Record<string, number>>, hardness: string | null = 'easy') =>
  ({ date, minutes: { bike: 0, strength: 0, run: 0, mobility: 0, other: 0, ...minutes }, hardness, legs: false });
const stats = (days: object[]): TrackedRecord => ({ kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body: { type: 'stats', atMs: 1, goal: null, days, muscles: {} } });

test('eight weeks, oldest first, with minutes per sport and hard days; quiet weeks stay in as empty weeks', () => {
  const w = weekHistory([stats([day('2026-10-20', { run: 30.4 }), day('2026-11-02', { bike: 45 }), day('2026-11-03', { strength: 60 }, 'hard')])], NOW);
  expect(w).toHaveLength(8);
  expect(w[7]).toEqual({ woche: '2026-11-02', minuten: { bike: 45, strength: 60 }, harteTage: 1, aktuell: true });
  expect(w[6]).toEqual({ woche: '2026-10-26', minuten: {}, harteTage: 0 });
  expect(w[5]!.minuten).toEqual({ run: 30 });
  expect(w[0]!.woche).toBe('2026-09-14');
});

test('without a stats record there is no hint; with one it carries the guide', () => {
  expect(longTermHint([], NOW)).toBe('');
  const h = longTermHint([stats([day('2026-11-02', { bike: 45 })])], NOW);
  expect(h).toContain('wochenVerlauf');
  expect(h).toContain('Richtschnur, kein Plan');
});

test('the number of weeks can be set; without it there are eight', () => {
  const s = stats([day('2026-11-02', { bike: 45 })]);
  expect(weekHistory([s], NOW, 13)).toHaveLength(13);
  expect(weekHistory([s], NOW, 13)[0]!.woche).toBe('2026-08-10');
  expect(weekHistory([s], NOW)).toHaveLength(8);
});
