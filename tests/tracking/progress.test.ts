import { estimatedMax, progressRows } from '../../src/tracking/progress';
import type { LoggedWorkout } from '../../src/shared/records';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 12).getTime();
const set = (weightKg: number | null, reps: number | null, type: 'normal' | 'warmup' = 'normal') => ({ type, weightKg, reps, durationS: null, doneMs: 1 });
const wo = (daysAgo: number, exerciseId: string, title: string, sets: ReturnType<typeof set>[]): LoggedWorkout => ({
  id: `${exerciseId}${daysAgo}`, title: 'T', startMs: NOW - daysAgo * DAY, endMs: NOW - daysAgo * DAY + 3600_000, source: 'pandafit',
  exercises: [{ exerciseId, title, supersetId: null, notes: '', sets }],
});
const base = { nowMs: NOW, ftp: [], weightKg: null, runPace: null, workouts: [] };

test('estimated max: Epley from working sets of 1 to 12 reps, warm-ups and bodyweight ignored', () => {
  expect(estimatedMax([set(60, 10)])).toBe(80);
  expect(estimatedMax([set(100, 1), set(80, 10, 'warmup')])).toBe(100);
  expect(estimatedMax([set(50, 20), set(null, 10)])).toBeNull();
});

test('nothing to show: no rows', () => expect(progressRows(base)).toEqual([]));

test('bike: FTP now with W/kg and the change against about eight weeks ago', () => {
  const rows = progressRows({ ...base, ftp: [{ atMs: NOW - 70 * DAY, ftpW: 200 }, { atMs: NOW - 30 * DAY, ftpW: 205 }, { atMs: NOW - 2 * DAY, ftpW: 212 }], weightKg: 80 });
  expect(rows).toEqual([{ text: 'Rad: FTP 212 W (2,7 W/kg), 12 W mehr als vor 10 Wochen' }]);
});

test('run: easy pace now and against twelve weeks ago, faster is a minus', () => {
  const rows = progressRows({ ...base, runPace: { now: 370, weeks4: 375, weeks12: 382 } });
  expect(rows).toEqual([{ text: 'Laufen: lockeres Tempo 6:10 /km, 12 s schneller als vor 12 Wochen' }]);
});

test('strength: one sentence per lift, the three most trained, the change in words', () => {
  const w = [
    wo(3, 'pf-bench-press', 'Bankdrücken', [set(60, 10)]), wo(40, 'pf-bench-press', 'Bankdrücken', [set(57.5, 10)]), wo(50, 'pf-bench-press', 'Bankdrücken', [set(55, 10)]),
    wo(5, 'pf-squat', 'Kniebeuge', [set(80, 5)]), wo(45, 'pf-squat', 'Kniebeuge', [set(80, 5)]),
    wo(6, 'pf-row', 'Rudern', [set(50, 10)]),
    wo(7, 'pf-curl', 'Curls', [set(12, 10)]), wo(100, 'pf-old', 'Alt', [set(10, 10)]),
  ];
  expect(progressRows({ ...base, workouts: w }).map((r) => r.text)).toEqual([
    // Rudern has no earlier value: no sentence rather than a bare number.
    'Bankdrücken: stärker als vor 12 Wochen', 'Kniebeuge: wie vor 12 Wochen',
  ]);
});

test('strength: a clear rise or drop is named, no signs or tildes', () => {
  const w = [wo(3, 'a', 'Anker', [set(100, 1)]), wo(40, 'a', 'Anker', [set(80, 1)]), wo(4, 'b', 'Boden', [set(60, 1)]), wo(41, 'b', 'Boden', [set(70, 1)])];
  const rows = progressRows({ ...base, workouts: w }).map((r) => r.text);
  expect(rows).toEqual(['Anker: stärker als vor 12 Wochen', 'Boden: schwächer als vor 12 Wochen']);
  expect(rows.join()).not.toMatch(/[~±()+−]/);
});
