import { atLeast, experienceFromData, experienceOf, maxExperience } from '../../src/shared/experience';
import { goalOf, readGoal, storedGoalOf } from '../../src/shared/personal';
import type { TrackedRecord } from '../../src/shared/records';

/** `n` strength dates, one every `every` days, the last one on 2026-11-14. */
const dates = (n: number, every: number): string[] =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 10, 14) - (n - 1 - i) * every * 86_400_000).toISOString().slice(0, 10));
const today = '2026-11-14';

describe('experience from the data', () => {
  it('is neu without data and with little history', () => {
    expect(experienceFromData([], today)).toBe('neu');
    expect(experienceFromData(dates(11, 7), today)).toBe('neu');
    // many sessions in a short time stay neu
    expect(experienceFromData(dates(20, 2), today)).toBe('neu');
  });

  it('needs both the sessions and the time for each level', () => {
    expect(experienceFromData(dates(12, 4), today)).toBe('einige');
    expect(experienceFromData(dates(39, 7), today)).toBe('einige');
    expect(experienceFromData(dates(40, 5), today)).toBe('erfahren');
    // a year ago once, then a few weeks: einige, never erfahren
    expect(experienceFromData(['2025-10-01', ...dates(11, 3)], today)).toBe('einige');
    expect(experienceFromData(['2025-10-01', ...dates(10, 3)], today)).toBe('neu');
  });

  it('counts a date once and ignores dates after today', () => {
    const d = dates(12, 4);
    expect(experienceFromData([...d, ...d], today)).toBe('einige');
    expect(experienceFromData([...dates(11, 4), '2026-12-01'], today)).toBe('neu');
  });
});

describe('experience estimate', () => {
  it('is the higher of the answer and the data', () => {
    expect(experienceOf({ dates: [], answer: 'erfahren', today })).toBe('erfahren');
    expect(experienceOf({ dates: dates(40, 5), answer: 'neu', today })).toBe('erfahren');
    expect(experienceOf({ dates: dates(12, 4), today })).toBe('einige');
  });

  it('orders the levels, a missing level counts as erfahren', () => {
    expect(atLeast('neu', 'einige')).toBe(false);
    expect(atLeast('einige', 'einige')).toBe(true);
    expect(atLeast(undefined, 'erfahren')).toBe(true);
    expect(maxExperience('einige', 'neu')).toBe('einige');
  });
});

describe('the answer in the goal record', () => {
  const rec = (body: object): TrackedRecord => ({ kind: 'goal', id: 'goal', updatedMs: 1, deleted: false, body });
  it('keeps the answer and refuses an unknown one', () => {
    const body = { strength: 'muscle', focus: [], sports: {}, experience: 'einige', atMs: 1 };
    expect(readGoal(body)?.experience).toBe('einige');
    expect(readGoal({ ...body, experience: 'profi' })).toBeNull();
    expect(storedGoalOf([rec(body)]).experience).toBe('einige');
    expect(goalOf([rec(body)], today).experience).toBe('einige');
    expect('experience' in storedGoalOf([rec({ ...body, experience: undefined })])).toBe(false);
  });
});
