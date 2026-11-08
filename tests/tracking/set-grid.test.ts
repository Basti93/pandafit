import { exerciseHasNoWeight, setHint, setLabels, TYPE_NAMES } from '../../src/tracking/ui/setGrid';
import type { LoggedSet } from '../../src/shared/records';

const s = (type: LoggedSet['type'], weightKg: number | null = null, reps: number | null = null, durationS: number | null = null): LoggedSet => ({ type, weightKg, reps, durationS, doneMs: 1 });

test('chips: A for warmup, running numbers for working sets, F and D for failure and drop sets', () => {
  expect(setLabels([s('warmup'), s('normal'), s('normal'), s('failure'), s('dropset'), s('normal')])).toEqual(['Aufw.', '1', '2', 'F', 'D', '5']);
  expect(setLabels([])).toEqual([]);
});

test('the options carry the full names', () => {
  expect(TYPE_NAMES).toEqual({ warmup: 'Aufwärmen', normal: 'Normaler Satz', failure: 'Bis zum Versagen', dropset: 'Dropset' });
});

test('the hint shows the target range and last time, muted text only', () => {
  expect(setHint({ repRange: { start: 8, end: 12 } }, s('normal', 42.5, 7), false)).toBe('Ziel 8–12 · zuletzt 42,5 kg × 7');
  expect(setHint({}, s('normal', null, 10), false)).toBe('zuletzt 10 Wdh.');
  expect(setHint({}, s('normal', null, null, 45), true)).toBe('zuletzt 45 Sek.');
  expect(setHint({ repRange: { start: 8, end: 12 } }, null, false)).toBe('Ziel 8–12');
  expect(setHint({}, null, false)).toBeNull();
  expect(setHint({ repRange: { start: 8, end: 12 } }, s('normal', 42.5, 7), false, undefined, false)).toBe('zuletzt 42,5 kg × 7');
  expect(setHint({}, null, false, { min: 6, max: 12 }, false)).toBeNull();
  expect(setHint({}, s('normal'), false)).toBeNull();
});

test('an exercise planned without any weight says so once', () => {
  expect(exerciseHasNoWeight({ timed: false, sets: [{ weightKg: null }, { weightKg: null }] })).toBe(true);
  expect(exerciseHasNoWeight({ timed: false, sets: [{ weightKg: null }, { weightKg: 40 }] })).toBe(false);
  expect(exerciseHasNoWeight({ timed: true, sets: [{ weightKg: null }] })).toBe(false);
  expect(exerciseHasNoWeight({ sets: [] })).toBe(false);
});

test('the target range is its own text, working sets only', async () => {
  const { setTargetHint } = await import('../../src/tracking/ui/setGrid');
  expect(setTargetHint({ repRange: { start: 8, end: 12 } }, false)).toBe('Ziel 8–12');
  expect(setTargetHint({ type: 'warmup' }, false, { min: 6, max: 12 })).toBeNull();
  expect(setTargetHint({ type: 'normal' }, false, { min: 6, max: 12 })).toBe('Ziel 6–12');
});
