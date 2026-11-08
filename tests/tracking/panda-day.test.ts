import { dayClip } from '../../src/tracking/ui/panda-day';
import type { PlanDay } from '../../src/shared/week-plan';

const day = (sport: PlanDay['sport'], also?: PlanDay['also']): PlanDay => ({ date: '2026-11-08', sport, hardness: 'moderate', fixed: false, ...(also ? { also } : {}) });
const base = { dateKey: '2026-11-08', mobility: false, finisher: false, open: false, offset: 0 };

test('a ride day, a run day and a strength day each get their clip', () => {
  expect(dayClip({ ...base, today: day('bike') })).toBe('bike');
  expect(dayClip({ ...base, today: day('run') })).toBe('run');
  expect(dayClip({ ...base, today: day('gym') })).toBe('flex');
});

test('the first session of a double day decides', () => {
  expect(dayClip({ ...base, today: day('run', { sport: 'gym', hardness: 'easy' }) })).toBe('run');
  expect(dayClip({ ...base, today: day('gym', { sport: 'bike', hardness: 'easy' }) })).toBe('flex');
});

test('mobility and the finisher give yoga', () => {
  expect(dayClip({ ...base, today: day('mobility') })).toBe('yoga');
  expect(dayClip({ ...base, today: day('gym'), finisher: true })).toBe('yoga');
  expect(dayClip({ ...base, today: day('rest'), mobility: true })).toBe('yoga');
});

test('a plain rest day alternates read and knit by the date', () => {
  const a = dayClip({ ...base, today: day('rest'), dateKey: '2026-11-08' });
  const b = dayClip({ ...base, today: day('rest'), dateKey: '2026-11-09' });
  expect(new Set([a, b])).toEqual(new Set(['read', 'knit']));
  expect(dayClip({ ...base, today: day('rest'), dateKey: '2026-11-10' })).toBe(a);
});

test('no clip on Gestern or Morgen, with an open workout, or without a plan', () => {
  expect(dayClip({ ...base, today: day('bike'), offset: -1 })).toBeNull();
  expect(dayClip({ ...base, today: day('bike'), offset: 1 })).toBeNull();
  expect(dayClip({ ...base, today: day('bike'), open: true })).toBeNull();
  expect(dayClip({ ...base, today: day('gym'), finisher: true, open: true })).toBeNull();
  expect(dayClip({ ...base, today: null })).toBeNull();
});
