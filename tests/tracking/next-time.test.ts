import { nextTimeLine } from '../../src/tracking/next-time';
import { confirmSet, editSet, setEffort, startFromPlan, type TrackedWorkout } from '../../src/tracking/session';
import { NO_STUDIOS } from '../../src/shared/studio';
import type { Exercise } from '../../src/shared/exercises';
import type { LoggedWorkout } from '../../src/shared/records';
import type { GymWorkout } from '../../src/shared/gym/types';

const NOW = Date.UTC(2026, 10, 13, 12);
const DAY = 86_400_000;
// Invented chest lift on plates (rep range 6-12, steps of 2,5 kg).
const LIFT: Exercise = { id: 'pf-x0', title: 'X0', type: 'weight_reps', primaryMuscle: 'chest', equipment: 'barbell' };
const plan: GymWorkout = { name: 'P', exercises: [{ templateId: 'pf-x0', title: 'X0', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 60, reps: 8 }] }] };
const past = (daysAgo: number, weightKg: number, reps: number): LoggedWorkout => ({ id: `h${daysAgo}`, title: 'A', startMs: NOW - daysAgo * DAY, endMs: NOW - daysAgo * DAY + 1000, source: 'pandafit',
  exercises: [{ exerciseId: 'pf-x0', title: 'X0', supersetId: null, notes: '', sets: [{ type: 'normal', weightKg, reps, durationS: null, doneMs: NOW - daysAgo * DAY + 1 }] }] });
const today = (weightKg: number, reps: number, effort?: 'none' | 'some' | 'plenty'): TrackedWorkout => {
  let w = startFromPlan(plan, [], NOW - 3600_000, 'w');
  const ex = w.exercises[0];
  w = editSet(w, ex.rid, ex.sets[0].rid, { weightKg, reps });
  w = confirmSet(w, ex.rid, ex.sets[0].rid, NOW - 1000);
  return effort ? setEffort(w, ex.rid, effort) : w;
};
const line = (w: TrackedWorkout, history: LoggedWorkout[]) => nextTimeLine(w, w.exercises[0].rid, { history, catalog: [LIFT], studios: NO_STUDIOS, overrides: new Map(), nowMs: NOW });

test('viel übrig bringt eine Wiederholung mehr', () => {
  expect(line(today(60, 8, 'plenty'), [past(7, 60, 8)])).toBe('Nächstes Mal 9 statt 8 Wiederholungen mit 60 kg.');
});
test('viel übrig am Bereichsende bringt mehr Gewicht', () => {
  expect(line(today(60, 12, 'plenty'), [past(7, 60, 12)])).toBe('Nächstes Mal 62,5 kg statt 60 kg.');
});
test('noch 1 bis 2 übrig ohne alle Wiederholungen: es bleibt', () => {
  expect(line(today(60, 7, 'some'), [past(7, 60, 8)])).toBe('Nächstes Mal bleibt es bei 60 kg.');
});
test('eine Übung ohne bestätigten Satz hat keine Zeile', () => {
  const w = startFromPlan(plan, [], NOW - 3600_000, 'w');
  expect(line(w, [])).toBeNull();
});
