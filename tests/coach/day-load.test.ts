import { crossSportCut, dayRatings, rateRide, rateRun, rateSession, trainsLegs, type DayInput } from '../../src/coach/day-load';
import type { RideSummary } from '../../src/coach/metrics';
import type { Session } from '../../src/shared/session';
import type { StrengthWorkout } from '../../src/coach/hevy';
import type { TrainingWeek } from '../../src/coach/all-training';

const at = (d: number, h = 10) => new Date(2027, 5, d, h).getTime(); // 14 June 2027 is a Monday
const DATES = Array.from({ length: 7 }, (_, i) => `2027-06-${String(14 + i).padStart(2, '0')}`);
const ride = (startedAtMs: number, intensityFactor: number | null, durationS = 3600): RideSummary => ({
  rideId: `r${startedAtMs}`, startedAtMs, status: 'finished', sessionId: 's', ftpW: 200, durationS, avgPowerW: null, normalizedPowerW: null,
  intensityFactor, tss: 0, avgHrBpm: null, maxHrBpm: null, bestMinutePowerW: null, completedFraction: 1,
});
const lift = (startMs: number, titles: string[]): StrengthWorkout => ({
  id: `w${startMs}`, title: 'Gym', startMs, durationS: 3000,
  exercises: titles.map((title, i) => ({ title, templateId: `t${i}`, sets: 3, reps: 8, volumeKg: 0, workSets: [] })),
});
const muscleOf = (_id: string, title: string): string | null => (/squat/i.test(title) ? 'quadriceps' : /bench/i.test(title) ? 'chest' : null);
const input = (o: Partial<DayInput> = {}): DayInput => ({ rides: [], bikeNext: null, gym: [], gymNext: null, muscleOf, bikeDays: [], gymDays: [], today: DATES[0]!, ...o });
const session = (fractions: number[], id = 'x'): Session => ({ id, name: 'S', steps: fractions.map((f) => ({ kind: 'erg' as const, ftpFraction: f, durationS: 300, label: 'a' })) });

test('a ride with intensity 0.85 makes its day hard, 0.72 moderate, 0.6 easy', () => {
  const r = dayRatings(input({ rides: [ride(at(14), 0.85), ride(at(15), 0.72), ride(at(16), 0.6), ride(at(17), null)] }), DATES);
  expect([r['2027-06-14'].hardness, r['2027-06-15'].hardness, r['2027-06-16'].hardness, r['2027-06-17'].hardness]).toEqual(['hard', 'moderate', 'easy', 'easy']);
  expect(r['2027-06-14'].minutes).toBe(60);
  expect(rateRide(ride(0, 0.8))).toBe('hard');
  expect(rateRide(ride(0, 0.7))).toBe('moderate');
});

test('sessions rate hard by ramp or erg step from 0.8, moderate by a main step from 0.7', () => {
  expect(rateSession(session([0.5], 'ramp-test'))).toBe('hard');
  expect(rateSession(session([0.5, 0.9, 0.5]))).toBe('hard');
  expect(rateSession(session([0.5, 0.75, 0.5]))).toBe('moderate');
  expect(rateSession(session([0.5, 0.6, 0.5]))).toBe('easy');
});

test('the planned interval session lands on the next usual bike day as hard', () => {
  const r = dayRatings(input({ bikeNext: session([0.5, 0.95, 0.5]), bikeDays: [2] }), DATES);
  expect(DATES.filter((d) => r[d].hardness === 'hard')).toEqual(['2027-06-16']);
  expect(DATES.filter((d) => r[d].hardness === null)).toHaveLength(6);
});

test('a planned session never lands on a past date: a missed usual gym day is not planned', () => {
  const gymNext = { id: 'g', name: 'G', exercises: [{ templateId: 't0', title: 'Back Squat', sets: [{ reps: 8, weightKg: 60 }] }] } as unknown as DayInput['gymNext'];
  const r = dayRatings(input({ gymNext, gymDays: [0, 3], today: '2027-06-16' }), DATES);
  expect(r['2027-06-14']!.hardness).toBeNull();
  expect(r['2027-06-17']!.hardness).toBe('hard');
});

test('a gym day with squats is hard with legs; an upper-body day is moderate without legs', () => {
  const r = dayRatings(input({ gym: [lift(at(14), ['Back Squat']), lift(at(15), ['Bench Press'])] }), DATES);
  expect(r['2027-06-14']).toMatchObject({ hardness: 'hard', legs: true });
  expect(r['2027-06-15']).toMatchObject({ hardness: 'moderate', legs: false });
  expect(trainsLegs([{ templateId: 'a', title: 'Back Squat' }], muscleOf)).toBe(true);
  expect(trainsLegs([{ templateId: 'a', title: 'Bench Press' }, { templateId: 'b', title: 'Unknown' }], muscleOf)).toBe(false);
});

test('the planned gym workout lands on the next usual gym day and counts its estimated minutes', () => {
  const sets = Array.from({ length: 3 }, () => ({ type: 'normal' as const, weightKg: 60, reps: 8 }));
  const exercises = ['Back Squat', 'Bench Press', 'Row'].map((title, i) => ({ templateId: `t${i}`, title, restS: 90, supersetId: null, notes: '', sets }));
  const r = dayRatings(input({ gymNext: { name: 'Beine', exercises }, gymDays: [3] }), DATES);
  expect(r['2027-06-17']).toMatchObject({ hardness: 'hard', legs: true, minutes: 30 });
});

test('a planned gym workout without exercises counts the fallback minutes', () => {
  const r = dayRatings(input({ gymNext: { name: 'x', exercises: [] }, gymDays: [3] }), DATES);
  expect(r['2027-06-17'].minutes).toBe(45);
});

test('a planned session skips a day that already has a finished one of the same source', () => {
  const bike = dayRatings(input({ rides: [ride(at(14), 0.5)], bikeNext: session([0.5, 0.95, 0.5]), bikeDays: [0, 2] }), DATES);
  expect(bike['2027-06-14'].hardness).toBe('easy');
  expect(bike['2027-06-16'].hardness).toBe('hard');
  const gym = dayRatings(input({ gym: [lift(at(14), ['Bench Press'])], gymNext: { name: 'B', exercises: [] }, gymDays: [0, 3] }), DATES);
  expect(gym['2027-06-14'].minutes).toBe(50);
  expect(gym['2027-06-17'].minutes).toBe(45);
  // a gym day does not block the bike plan
  const mixed = dayRatings(input({ gym: [lift(at(14), ['Bench Press'])], bikeNext: session([0.5, 0.95, 0.5]), bikeDays: [0] }), DATES);
  expect(mixed['2027-06-14'].hardness).toBe('hard');
});

test('without usual days the planned session takes the first plannable date', () => {
  expect(dayRatings(input({ bikeNext: session([0.5, 0.95, 0.5]), bikeDays: [] }), DATES)['2027-06-14'].hardness).toBe('hard');
  const r = dayRatings(input({ rides: [ride(at(14), 0.5)], bikeNext: session([0.5, 0.95, 0.5]) }), DATES);
  expect(r['2027-06-15'].hardness).toBe('hard');
  expect(dayRatings(input({ gymNext: { name: 'B', exercises: [] }, gymDays: [] }), DATES)['2027-06-14'].hardness).toBe('moderate');
});

test('a warm-up at 0.75 before an easy main block still rates easy', () => {
  expect(rateSession(session([0.75, 0.5, 0.5]))).toBe('easy');
});

test('two things on one day: the harder wins and legs stays set', () => {
  const r = dayRatings(input({ rides: [ride(at(14, 8), 0.9), ride(at(14, 18), 0.5)], gym: [lift(at(14, 12), ['Bench Press'])] }), DATES);
  expect(r['2027-06-14']).toMatchObject({ hardness: 'hard', legs: false, minutes: 60 + 60 + 50 });
  const s = dayRatings(input({ rides: [ride(at(14, 8), 0.9)], gym: [lift(at(14, 12), ['Back Squat'])] }), DATES);
  expect(s['2027-06-14'].legs).toBe(true);
  const t = dayRatings(input({ rides: [ride(at(14, 8), 0.5)], gym: [lift(at(14, 12), ['Bench Press'])] }), DATES);
  expect(t['2027-06-14'].hardness).toBe('moderate');
});

test('a day with nothing has hardness null and 0 minutes', () => {
  expect(dayRatings(input(), DATES)['2027-06-18']).toEqual({ date: '2027-06-18', hardness: null, legs: false, minutes: 0 });
});

const week = (minutes: number): TrainingWeek => ({
  weekStartMs: 0, rad: { sessions: 1, minutes: minutes - 50 }, kraft: { sessions: 1, minutes: 50 }, andere: { sessions: 0, minutes: 0 }, sessions: 2, minutes,
});
test('crossSportCut cuts the excess but at most 20 %', () => {
  const weeks = [...Array(6).fill(0).map(() => week(0)), ...Array(4).fill(0).map(() => week(200)), week(300), week(10)];
  expect(crossSportCut(weeks, 120)).toBe(24);
  expect(crossSportCut(weeks, 1000)).toBe(100);
});

test('crossSportCut cuts nothing at or below the average or without history', () => {
  const flat = [...Array(4).fill(0).map(() => week(200)), week(200), week(0)];
  expect(crossSportCut(flat, 120)).toBe(0);
  expect(crossSportCut([week(300), week(0)], 120)).toBe(0);
  expect(crossSportCut([], 120)).toBe(0);
  expect(crossSportCut([...Array(4).fill(0).map(() => week(0)), week(300), week(0)], 120)).toBe(0);
});

test('crossSportCut cuts nothing with only one to three earlier weeks', () => {
  for (const n of [1, 2, 3]) {
    const weeks = [...Array(n).fill(0).map(() => week(200)), week(300), week(0)];
    expect(crossSportCut(weeks, 120)).toBe(0);
  }
});

test('a hard run makes its day hard and adds its minutes, without legs', () => {
  const r = dayRatings(input({ runs: [{ startMs: at(15), durationS: 1800, hardness: 'hard' }] }), DATES);
  expect(r['2027-06-15']).toMatchObject({ hardness: 'hard', legs: false, minutes: 30 });
});

test('rateRun: test is hard, long or 75 minutes and more is moderate, else easy', () => {
  expect(rateRun({ durationS: 1200, planned: 'test' })).toBe('hard');
  expect(rateRun({ durationS: 1200, planned: 'long' })).toBe('moderate');
  expect(rateRun({ durationS: 75 * 60, planned: null })).toBe('moderate');
  expect(rateRun({ durationS: 74 * 60, planned: 'easy' })).toBe('easy');
});

test('a bike and a gym session on the same day sum their minutes and take the harder rating and the legs', () => {
  const sets = Array.from({ length: 3 }, () => ({ type: 'normal' as const, weightKg: 60, reps: 8 }));
  const exercises = ['Back Squat', 'Bench Press', 'Row'].map((title, i) => ({ templateId: `t${i}`, title, restS: 90, supersetId: null, notes: '', sets }));
  const gym = dayRatings(input({ gymNext: { name: 'Beine', exercises }, gymDays: [0] }), DATES)['2027-06-14'];
  const bike = dayRatings(input({ bikeNext: session([0.5, 0.5, 0.5]), bikeDays: [0] }), DATES)['2027-06-14'];
  const both = dayRatings(input({ bikeNext: session([0.5, 0.5, 0.5]), bikeDays: [0], gymNext: { name: 'Beine', exercises }, gymDays: [0] }), DATES)['2027-06-14'];
  expect(bike.minutes).toBeGreaterThan(0);
  expect(both).toMatchObject({ hardness: 'hard', legs: true, minutes: gym.minutes + bike.minutes });
});

test('a planned gym session is planned, not done', () => {
  const r = dayRatings(input({ gymNext: { name: 'B', exercises: [] }, gymDays: [6] }), DATES)['2027-06-20'];
  expect(r.sports).toBeUndefined();
  expect(r.plannedSports).toEqual(['gym']);
  expect(r.minutes).toBeGreaterThan(0);
  const done = dayRatings(input({ gym: [lift(at(14), ['Bench Press'])] }), DATES)['2027-06-14'];
  expect(done.sports).toEqual(['gym']);
  expect(done.plannedSports).toBeUndefined();
});
