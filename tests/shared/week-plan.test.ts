import { checkWeekPlan, dayLabel, mondayOf, parseProposal, planFor, weekDates, type PlanDay } from '../../src/shared/week-plan';

const day = (date: string, sport: PlanDay['sport'], hardness: PlanDay['hardness'] = 'easy', extra: Partial<PlanDay> = {}): PlanDay => ({ date, sport, hardness, fixed: false, ...extra });
const week = (days: Partial<Record<number, PlanDay>>) => weekDates('2026-11-02').map((d, i) => days[i] ? { ...days[i]!, date: d } : day(d, 'rest'));

test('weeks start on Monday', () => {
  expect(mondayOf('2026-11-04')).toBe('2026-11-02');
  expect(mondayOf('2026-11-08')).toBe('2026-11-02');
  expect(mondayOf('2026-11-09')).toBe('2026-11-09');
  expect(weekDates('2026-11-02')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
});

test('a calm week breaks no rule', () => {
  expect(checkWeekPlan(week({ 0: day('', 'gym', 'moderate', { legs: true }), 2: day('', 'bike', 'hard'), 4: day('', 'run', 'easy') }))).toEqual([]);
});
test('three hard days break the first rule', () => {
  const v = checkWeekPlan(week({ 0: day('', 'bike', 'hard'), 2: day('', 'bike', 'hard'), 4: day('', 'run', 'hard') }));
  expect(v).toEqual(['Die Woche hat mehr als zwei harte Tage.']);
});
test('no hard bike or run day after a hard leg day, and no long session after any leg day', () => {
  expect(checkWeekPlan(week({ 0: day('', 'gym', 'hard', { legs: true }), 1: day('', 'run', 'hard') })))
    .toEqual(['Am Dienstag folgt ein harter Rad- oder Lauftag auf einen harten Beintag.']);
  expect(checkWeekPlan(week({ 0: day('', 'gym', 'easy', { legs: true }), 1: day('', 'bike', 'moderate', { long: true }) })))
    .toEqual(['Am Dienstag folgt eine lange Einheit auf einen Beintag.']);
  expect(checkWeekPlan(week({ 0: day('', 'gym', 'hard', { legs: false }), 1: day('', 'run', 'hard') }))).toEqual([]);
});

test('a proposal must be seven valid days of one week, otherwise it is dropped', () => {
  const ok = { weekStart: '2026-11-02', days: week({ 1: day('', 'gym', 'moderate', { legs: true, note: 'Studio' }) }) };
  expect(parseProposal(ok)).toEqual(ok);
  expect(parseProposal({ ...ok, days: ok.days.slice(1) })).toBeNull();
  expect(parseProposal({ ...ok, weekStart: '2026-11-03' })).toBeNull();
  expect(parseProposal({ ...ok, days: ok.days.map((d, i) => (i === 2 ? { ...d, sport: 'swim' } : d)) })).toBeNull();
  expect(parseProposal({ ...ok, days: ok.days.map((d, i) => (i === 2 ? { ...d, date: '2026-12-01' } : d)) })).toBeNull();
});

test('planFor gives the plan of a date from the accepted plan records, deleted ones ignored', () => {
  const plan = { weekStart: '2026-11-02', days: week({ 3: day('', 'bike', 'hard') }), fromMessage: 'm1', acceptedMs: 1 };
  const recs = [{ kind: 'weekplan' as const, id: '2026-11-02', updatedMs: 1, deleted: false, body: plan }];
  expect(planFor(recs, '2026-11-05')).toMatchObject({ sport: 'bike', hardness: 'hard' });
  expect(planFor(recs, '2026-11-12')).toBeNull();
  expect(planFor([{ ...recs[0], deleted: true }], '2026-11-05')).toBeNull();
});

test('a hard gym day that does not say whether legs were trained counts as a leg day', () => {
  expect(checkWeekPlan(week({ 0: day('', 'gym', 'hard'), 1: day('', 'bike', 'hard') }))).toEqual(['Am Dienstag folgt ein harter Rad- oder Lauftag auf einen harten Beintag.']);
});

const also = (sport: PlanDay['sport'], hardness: PlanDay['hardness'] = 'easy') => ({ sport, hardness });
test('a gym day with an easy bike part is fine; old days without also parse unchanged', () => {
  const w = week({ 1: day('', 'gym', 'moderate', { legs: true, also: also('bike') }) });
  expect(checkWeekPlan(w)).toEqual([]);
  expect(parseProposal({ weekStart: '2026-11-02', days: w })!.days[1]!.also).toEqual({ sport: 'bike', hardness: 'easy' });
  const old = { weekStart: '2026-11-02', days: week({ 1: day('', 'gym', 'moderate') }) };
  expect(parseProposal(old)).toEqual(old);
});
test('two hard parts in one day give the message', () => {
  expect(checkWeekPlan(week({ 1: day('', 'gym', 'hard', { also: also('bike', 'hard') }) }))).toEqual(['Zwei Einheiten an einem Tag gehen nur, wenn höchstens eine davon hart ist.']);
});
test('rest plus something, or the same sport twice, loses the second part', () => {
  const p = parseProposal({ weekStart: '2026-11-02', days: week({ 0: day('', 'rest', 'easy', { also: also('bike') }), 1: day('', 'gym', 'easy', { also: also('gym') }) }) })!;
  expect(p.days[0]!.also).toBeUndefined();
  expect(p.days[1]!.also).toBeUndefined();
});
test('the day-after rules use the combined day', () => {
  // gym hard legs in the combined day before: the bike part hard the next day breaks it, also when it is the second part
  expect(checkWeekPlan(week({ 0: day('', 'run', 'easy', { also: also('gym', 'hard'), legs: true }), 1: day('', 'gym', 'easy', { also: also('bike', 'hard') }) })))
    .toEqual(['Am Dienstag folgt ein harter Rad- oder Lauftag auf einen harten Beintag.']);
  expect(checkWeekPlan(week({ 0: day('', 'bike', 'easy', { also: also('gym', 'easy') }), 1: day('', 'gym', 'easy', { long: true, also: also('run') }) })))
    .toEqual(['Am Dienstag folgt eine lange Einheit auf einen Beintag.']);
});
test('the harder part counts for hard days', () => {
  const v = checkWeekPlan(week({ 0: day('', 'gym', 'hard', { also: also('bike') }), 2: day('', 'bike', 'easy', { also: also('run', 'hard') }), 4: day('', 'run', 'hard') }));
  expect(v).toEqual(['Die Woche hat mehr als zwei harte Tage.']);
});

test('a second part is dropped when both parts are hard', () => {
  const days = week({ 1: day('', 'gym', 'hard', { also: { sport: 'bike', hardness: 'hard' } }), 2: day('', 'gym', 'hard', { also: { sport: 'bike', hardness: 'easy' } }) });
  const p = parseProposal({ weekStart: '2026-11-02', days })!;
  expect(p.days[1]!.also).toBeUndefined();
  expect(p.days[2]!.also).toEqual({ sport: 'bike', hardness: 'easy' });
});

test('a second session keeps valid minutes only, and the label says them', () => {
  const parse = (minutes: unknown) => parseProposal({ weekStart: '2026-11-02', days: week({ 1: day('', 'gym', 'moderate', { also: { sport: 'bike', hardness: 'easy', minutes } as never }) }) })!.days[1]!;
  expect(parse(15).also).toEqual({ sport: 'bike', hardness: 'easy', minutes: 15 });
  expect(parse(500).also).toEqual({ sport: 'bike', hardness: 'easy' });
  expect(parse('15').also).toEqual({ sport: 'bike', hardness: 'easy' });
  expect(parse(null).also).toEqual({ sport: 'bike', hardness: 'easy' });
  expect(parse(12.5).also).toEqual({ sport: 'bike', hardness: 'easy' });
  expect(dayLabel(parse(15))).toBe('Kraft, mittel + Rad, locker, 15 Min.');
});
