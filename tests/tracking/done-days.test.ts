import type { ActivityItem } from '../../src/shared/activities';
import type { TrackedRecord } from '../../src/shared/records';
import type { PlanDay } from '../../src/shared/week-plan';
import { planDayText } from '../../src/tracking/ui/plan-text';
import { activitiesOn, activityText, doneDays, mergedActivities } from '../../src/tracking/ui/done-days';

const original = process.env.TZ;
afterAll(() => { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; });

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const item = (p: Partial<ActivityItem> & { key: string; startMs: number }): ActivityItem =>
  ({ kind: 'lauf', title: null, sport: 'running', minutes: 40, distanceM: 6000, avgHr: null, ref: null, ...p });
const actRec = (items: ActivityItem[]): TrackedRecord => ({ kind: 'activities', id: 'activities', updatedMs: 1, deleted: false, body: { type: 'activities', atMs: 1, items } });
const wo = (id: string, startMs: number, mins: number, deleted = false): TrackedRecord => ({ kind: 'workout', id, updatedMs: 1, deleted, body: { id, title: 'Oberkörper', startMs, endMs: startMs + mins * 60000, source: 'pandafit', exercises: [] } });
const day = (date: string, sport: PlanDay['sport']): PlanDay => ({ date, sport, hardness: 'moderate', fixed: false });
const merge = (items: ActivityItem[]) => mergedActivities([actRec(items)], []);
const DATES = ['2026-11-02', '2026-11-03', '2026-11-04'];

test('past day shows only what was done', () => {
  const rows = doneDays(DATES, '2026-11-04', DATES.map((d) => day(d, 'gym')), merge([item({ key: 'lauf-1', startMs: at(2, 8) })]));
  expect(rows[0]).toMatchObject({ done: ['Lauf 6 km'], plan: null, rest: false });
});

test('past day without activity is Ruhetag', () => {
  expect(doneDays(DATES, '2026-11-04', null, merge([]))[1]).toMatchObject({ done: [], plan: null, rest: true });
});

test('without the activities record no past day claims Ruhetag', () => {
  const merged = mergedActivities(null, []);
  expect(merged.known).toBe(false);
  expect(doneDays(DATES, '2026-11-04', null, merged).every((r) => !r.rest)).toBe(true);
});

test('today shows done and the remaining plan', () => {
  const row = doneDays(DATES, '2026-11-04', DATES.map((d) => day(d, 'gym')), merge([item({ key: 'lauf-1', startMs: at(4, 7) })]))[2]!;
  expect(row.done).toEqual(['Lauf 6 km']);
  expect(row.plan?.sport).toBe('gym');
});

test('today hides the plan once the planned sport is done', () => {
  const row = doneDays(DATES, '2026-11-04', DATES.map((d) => day(d, 'run')), merge([item({ key: 'lauf-1', startMs: at(4, 7) })]))[2]!;
  expect(row.plan).toBeNull();
});

test('future days show the plan only', () => {
  const rows = doneDays(['2026-11-05'], '2026-11-04', [day('2026-11-05', 'bike')], merge([]));
  expect(rows[0]).toMatchObject({ done: [], rest: false });
  expect(rows[0]!.plan?.sport).toBe('bike');
});

test('a local workout and its server copy count once', () => {
  const m = mergedActivities([actRec([item({ key: 'kraft-other', kind: 'kraft', sport: 'strength', title: 'Oberkörper', startMs: at(3, 18, 5), minutes: 50, distanceM: null, ref: 'other' })])], [wo('w1', at(3, 18), 55)]);
  expect(m.items.map((i) => i.key)).toEqual(['kraft-w1']);
  const same = mergedActivities([actRec([item({ key: 'kraft-w1', kind: 'kraft', sport: 'strength', startMs: at(3, 18), minutes: 55, distanceM: null, ref: 'w1' })])], [wo('w1', at(3, 18), 55)]);
  expect(same.items).toHaveLength(1);
});

test('an activity at 00:30 local time belongs to the local day, not the UTC day before', () => {
  process.env.TZ = 'Europe/Berlin';
  const startMs = new Date(2026, 10, 3, 0, 30).getTime();
  expect(new Date(startMs).toISOString()).toBe('2026-11-02T23:30:00.000Z');
  const rows = doneDays(['2026-11-02', '2026-11-03'], '2026-11-04', null, merge([item({ key: 'lauf-1', startMs })]));
  expect(rows[0]!.rest).toBe(true);
  expect(rows[1]!.done).toEqual(['Lauf 6 km']);
});

test('the week counts a workout and its kept copy once, the history keeps both', () => {
  const copy: TrackedRecord = { kind: 'workout', id: 'w2', updatedMs: 1, deleted: false, body: { id: 'w2', title: 'Oberkörper', startMs: at(3, 18), endMs: at(3, 18) + 55 * 60000, source: 'pandafit', exercises: [], keptCopyOf: 'w1' } };
  const ws = [wo('w1', at(3, 18), 55), copy];
  const rows = doneDays(['2026-11-03'], '2026-11-04', null, mergedActivities(null, ws, true));
  expect(rows[0]!.done).toEqual(['Kraft Oberkörper']);
  expect(mergedActivities(null, ws).items).toHaveLength(2);
});

test('a deleted local workout disappears although the server still lists it', () => {
  const m = mergedActivities([actRec([item({ key: 'kraft-w1', kind: 'kraft', sport: 'strength', startMs: at(3, 18), ref: 'w1' })])], [wo('w1', at(3, 18), 55, true)]);
  expect(m.items).toEqual([]);
});

test('activityText', () => {
  expect(activityText(item({ key: 'a', startMs: 0 }))).toBe('Lauf 6 km');
  expect(activityText(item({ key: 'a', startMs: 0, distanceM: 5500 }))).toBe('Lauf 5,5 km');
  expect(activityText(item({ key: 'a', startMs: 0, distanceM: 12400 }))).toBe('Lauf 12 km');
  expect(activityText(item({ key: 'a', startMs: 0, kind: 'kraft', sport: 'strength', title: 'Oberkörper' }))).toBe('Kraft Oberkörper');
  expect(activityText(item({ key: 'a', startMs: 0, kind: 'andere', sport: 'yoga', minutes: 30, distanceM: null }))).toBe('Yoga 30 Min');
  expect(activityText(item({ key: 'a', startMs: 0, kind: 'rad', sport: 'cycling', minutes: 45, distanceM: 20000 }))).toBe('Rad 45 Min');
});

test('today with several parts keeps only the open parts', () => {
  const d: PlanDay = { ...day('2026-11-04', 'bike'), also: { sport: 'gym', hardness: 'moderate' } };
  const row = doneDays(['2026-11-04'], '2026-11-04', [d], merge([item({ key: 'kraft-1', kind: 'kraft', sport: 'strength', title: 'Beine', startMs: at(4, 7), distanceM: null })]))[0]!;
  expect(row.done).toEqual(['Kraft Beine']);
  expect(planDayText(row.plan!)).toBe('Rad · mittel');
  const both = doneDays(['2026-11-04'], '2026-11-04', [d], merge([]))[0]!;
  expect(planDayText(both.plan!)).toBe('Rad · mittel + Kraft · mittel');
  expect(planDayText({ date: '2026-11-02', sport: 'gym', hardness: 'moderate', fixed: false, also: { sport: 'bike', hardness: 'easy', minutes: 15 } })).toBe('Kraft · mittel + Rad · locker · 15 Min.');
});

// activitiesOn
const itemK = (key: string, startMs: number): ActivityItem => ({ key, kind: 'rad', title: null, sport: null, startMs, minutes: 30, distanceM: null, avgHr: null, ref: null });
describe('activitiesOn', () => {
  it('keeps only the date, oldest first', () => {
    const merged = { known: true, items: [itemK('b', at(3, 18)), itemK('x', at(4, 8)), itemK('a', at(3, 7))] };
    expect(activitiesOn(merged, '2026-11-03')!.map((i) => i.key)).toEqual(['a', 'b']);
  });
  it('is empty when known and nothing happened, null when unknown', () => {
    expect(activitiesOn({ known: true, items: [] }, '2026-11-03')).toEqual([]);
    expect(activitiesOn({ known: false, items: [itemK('x', at(4, 8))] }, '2026-11-03')).toBeNull();
    expect(activitiesOn({ known: false, items: [itemK('a', at(3, 8))] }, '2026-11-03')!.length).toBe(1);
  });
});

