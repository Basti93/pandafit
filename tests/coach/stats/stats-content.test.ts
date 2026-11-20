import type { TrackedRecord } from '../../../src/shared/records';
import { statsContent, sportMinutes, type StatsContentInput } from '../../../src/coach/stats/stats-content';

// Wednesday 16 June 2027, local time; the nine weeks start on Monday 19 April.
const NOW = new Date(2027, 5, 16, 15).getTime();
const at = (d: number, h = 10, m = 5) => new Date(2027, m, d, h).getTime();
const base = (over: Partial<StatsContentInput> = {}): StatsContentInput => ({
  nowMs: NOW, rides: [], history: [], runs: [], mobility: [], activities: [], ratings: () => ({}), goal: 'muscle', ...over,
});
const act = (startMs: number, durationS: number, sport: string, fromBikeCoach = false) => ({ startMs, durationS, sport, fromBikeCoach });
const mob = (id: string, body: unknown, deleted = false): TrackedRecord => ({ kind: 'mobility', id, updatedMs: 1, deleted, body } as TrackedRecord);
const dayOf = (c: ReturnType<typeof statsContent>, date: string) => c!.days.find((d) => d.date === date)!;

test('null when there is nothing in the nine weeks', () => {
  expect(statsContent(base())).toBeNull();
  expect(statsContent(base({ rides: [{ startedAtMs: at(1, 10, 0), durationS: 3600 }] }))).toBeNull();
});

test('what counts as other: not runs, not own rides, not cycling over a ride, not strength over a workout', () => {
  const c = statsContent(base({
    rides: [{ startedAtMs: at(14), durationS: 3600 }],
    history: [{ startMs: at(15), durationS: 3600, exercises: [] }],
    activities: [
      act(at(14), 3600, 'cycling', true), // the app's own ride, uploaded
      act(at(14), 3600, 'road_biking'), // the same ride, recorded on the watch too
      act(at(15), 3600, 'strength_training'), // the workout, on the watch too
      act(at(16), 1800, 'running'), // runs come from the run coach
      act(at(16, 18), 1200, 'hiking'),
      act(at(15, 18), 1200, 'strength_training'), // a strength session only the watch knows
    ],
  }));
  expect(dayOf(c, '2027-06-14').minutes).toMatchObject({ bike: 60, other: 0 });
  expect(dayOf(c, '2027-06-15').minutes).toMatchObject({ strength: 60, other: 20 });
  expect(dayOf(c, '2027-06-16').minutes).toMatchObject({ run: 0, other: 20 });
});

test('cycling only the watch knows counts as Rad', () => {
  const c = statsContent(base({ activities: [act(at(14), 2700, 'cycling'), act(at(15), 1800, 'indoor_cycling')] }));
  expect(dayOf(c, '2027-06-14').minutes).toMatchObject({ bike: 45, other: 0 });
  expect(dayOf(c, '2027-06-15').minutes).toMatchObject({ bike: 30, other: 0 });
});

test('mobility: own minutes, the default for broken ones, nothing for a broken time or a deleted record, clamped to a day', () => {
  const c = statsContent(base({
    mobility: [
      mob('a', { doneMs: at(14), minutes: 15 }),
      mob('b', { doneMs: at(15), minutes: -5 }),
      mob('c', { doneMs: at(15, 12), minutes: 'x' }),
      mob('d', { doneMs: Number.NaN, minutes: 20 }),
      mob('e', { doneMs: at(16), minutes: 20 }, true),
      mob('f', null),
      mob('g', { doneMs: at(16), minutes: 99_999 }),
    ],
  }));
  expect(dayOf(c, '2027-06-14').minutes.mobility).toBe(15);
  expect(dayOf(c, '2027-06-15').minutes.mobility).toBe(20);
  expect(dayOf(c, '2027-06-16').minutes.mobility).toBe(1440);
});

test('muscles only from workouts within the dates, sorted by id', () => {
  const ex = (templateId: string, title: string) => ({ templateId, title });
  const c = statsContent(base({
    history: [
      { startMs: at(14), durationS: 3600, exercises: [ex('t-squat', 'Squat'), ex('t-bench', 'Bench Press')] },
      { startMs: at(1, 10, 0), durationS: 3600, exercises: [ex('t-old', 'Leg Curl')] },
    ],
  }));
  expect(c!.muscles).toEqual({ 't-bench': 'chest', 't-squat': 'quadriceps' });
  expect(Object.keys(c!.muscles)).toEqual(['t-bench', 't-squat']);
  expect(c!.goal).toBe('muscle');
});

test('the ratings decide hardness and legs', () => {
  const c = statsContent(base({ ratings: (dates) => ({ [dates[0]]: { date: dates[0], hardness: 'hard', legs: true, minutes: 0 } }) }));
  expect(c!.days[0]).toMatchObject({ date: '2027-04-19', hardness: 'hard', legs: true });
});

test('muscles come from the known templates first, the guess by title only after that', () => {
  const c = statsContent(base({
    history: [{ startMs: at(14), durationS: 3600, exercises: [
      { templateId: 'CUSTOM-1', title: 'Seitheben Maschine Stehend' },
      { templateId: 'HEVY-2', title: 'Fliegende (Maschine)' },
      { templateId: 'HEVY-3', title: 'Bicep Curl (Barbell)' },
    ] }],
    templateMuscle: (id) => ({ 'CUSTOM-1': 'shoulders', 'HEVY-2': 'chest' } as Record<string, string>)[id] ?? null,
  }));
  expect(c?.muscles).toEqual({ 'CUSTOM-1': 'shoulders', 'HEVY-2': 'chest', 'HEVY-3': 'biceps' });
});

describe('sportMinutes (Sportanteil)', () => {
  const from = at(1, 0, 4), to = NOW;
  it('summiert die Minuten je Sportart im Zeitraum mit denselben Dublettenregeln wie die Statistik', () => {
    const m = sportMinutes(base({
      rides: [{ startedAtMs: at(14), durationS: 3600 }],
      history: [{ startMs: at(15), durationS: 1800, exercises: [] }],
      runs: [{ startMs: at(16), durationS: 1200 }],
      activities: [act(at(14), 3600, 'cycling', true), act(at(14), 3600, 'road_biking'), act(at(15), 1800, 'strength_training'), act(at(13), 2700, 'cycling'), act(at(16, 18), 600, 'hiking')],
    }), from, to);
    expect(m).toMatchObject({ bike: 105, strength: 30, run: 20, other: 10 });
  });
  it('zählt nur Tage im Zeitraum, auch weiter zurück als die neun Wochen der Statistik', () => {
    const m = sportMinutes(base({ rides: [{ startedAtMs: at(1, 10, 2), durationS: 3600 }, { startedAtMs: at(14), durationS: 1800 }] }), at(1, 0, 2), to);
    expect(m.bike).toBe(90);
    expect(sportMinutes(base({ rides: [{ startedAtMs: at(1, 10, 2), durationS: 3600 }] }), at(1, 0, 4), to).bike).toBe(0);
  });
});
