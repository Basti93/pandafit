import { todayAdvice, type TodayInput } from '../../src/shared/today';
import type { DayRating } from '../../src/shared/day-rating';
import { ratingsFromEntries, rateIntensity } from '../../src/shared/day-rating';
import { addDays, type PlanDay } from '../../src/shared/week-plan';

const TODAY = '2026-11-07';
const past = (n: number, r: Partial<DayRating>): [string, DayRating] => { const date = addDays(TODAY, -n); return [date, { date, hardness: null, legs: false, minutes: 0, ...r }]; };
const rated = (...rs: [string, DayRating][]) => Object.fromEntries(rs);
const base = (o: Partial<TodayInput> = {}): TodayInput => ({ date: TODAY, ratings: {}, goal: { sports: {} }, frame: { mode: 'week' }, ...o });
const planDay = (o: Partial<PlanDay>): PlanDay => ({ date: TODAY, sport: 'bike', hardness: 'hard', fixed: false, ...o });

describe('todayAdvice', () => {
  it('1: a raised resting pulse makes a hard day a rest day and a moderate one easy', () => {
    const hard = todayAdvice(base({ planDay: planDay({}), readiness: { restingHrRaised: true } }));
    expect(hard).toMatchObject({ sport: 'rest', fromPlan: false, line: 'Ruhetag – weil dein Ruhepuls erhöht ist' });
    expect(todayAdvice(base({ planDay: planDay({ hardness: 'moderate' }), readiness: { restingHrRaised: true } })))
      .toMatchObject({ sport: 'bike', hardness: 'easy', reason: 'weil dein Ruhepuls erhöht ist' });
  });

  it('1b: a raised resting pulse also leaves the legs out when gym with legs follows hard legs', () => {
    const ratings = rated(past(1, { hardness: 'hard', legs: true, sports: ['gym'] }));
    expect(todayAdvice(base({ ratings, readiness: { restingHrRaised: true }, planDay: planDay({ sport: 'gym', hardness: 'moderate' }) })))
      .toMatchObject({ sport: 'gym', hardness: 'easy', legs: false, reason: 'weil dein Ruhepuls erhöht ist' });
  });

  it('2: hard legs yesterday, no hard leg day today', () => {
    const ratings = rated(past(1, { hardness: 'hard', legs: true, sports: ['gym'] }));
    // the planned sport stays: strength goes on without legs, bike and run get less hard
    expect(todayAdvice(base({ ratings, planDay: planDay({ sport: 'gym', hardness: 'hard' }) })))
      .toMatchObject({ sport: 'gym', hardness: 'hard', legs: false, label: 'Kraft ohne Beine', line: 'Kraft ohne Beine – weil deine Beine gestern hart gearbeitet haben', fromPlan: false });
    expect(todayAdvice(base({ ratings, planDay: planDay({ sport: 'gym', hardness: 'moderate', also: { sport: 'bike', hardness: 'hard' } }) })))
      .toMatchObject({ sport: 'gym', legs: false, label: 'Kraft ohne Beine + Rad, mittel', also: { sport: 'bike', hardness: 'moderate' } });
    expect(todayAdvice(base({ ratings, planDay: planDay({ sport: 'bike', hardness: 'hard' }) })))
      .toMatchObject({ sport: 'bike', hardness: 'moderate', reason: 'weil deine Beine gestern hart gearbeitet haben' });
    // a plan day that leaves the legs out anyway is fine as it is
    expect(todayAdvice(base({ ratings, planDay: planDay({ sport: 'gym', hardness: 'moderate', legs: false }) })))
      .toMatchObject({ sport: 'gym', fromPlan: true, legs: false });
    // spontaneous: the gym is not picked even if it was done longest ago
    const a = todayAdvice(base({ ratings: rated(past(1, { hardness: 'hard', legs: true, sports: ['gym'] }), past(3, { hardness: 'easy', sports: ['bike'] })), frame: { mode: 'spontaneous' }, goal: { sports: { gym: 'equal', bike: 'equal' } } }));
    expect(a.sport).toBe('bike');
  });

  it('3: two hard days in a row, easy today', () => {
    const ratings = rated(past(1, { hardness: 'hard', sports: ['bike'] }), past(2, { hardness: 'hard', sports: ['bike'] }));
    expect(todayAdvice(base({ ratings, planDay: planDay({ sport: 'run', hardness: 'moderate' }) })))
      .toMatchObject({ sport: 'run', hardness: 'easy', reason: 'weil du zwei harte Tage hintereinander hattest' });
  });

  it('4: a plan day that passes the rules is taken, with no extra reason needed', () => {
    const a = todayAdvice(base({ planDay: planDay({ sport: 'gym', hardness: 'moderate', also: { sport: 'bike', hardness: 'easy' } }) }));
    expect(a).toMatchObject({ sport: 'gym', hardness: 'moderate', also: { sport: 'bike', hardness: 'easy' }, fromPlan: true, reason: 'laut deinem Wochenplan', label: 'Kraft, mittel + Rad, locker' });
  });

  it('without any history the reason is a calm start, not "longest ago"', () => {
    const a = todayAdvice(base({ ratings: {}, frame: { mode: 'spontaneous' } }));
    expect(a).toMatchObject({ hardness: 'moderate', reason: 'ein ruhiger Einstieg' });
    expect(a.line).toBe(`${a.label} – ein ruhiger Einstieg`);
  });

  it('5: spontaneous, the focus sport done longest ago, else the one done longest ago, at moderate', () => {
    const ratings = rated(past(1, { hardness: 'easy', sports: ['bike'] }), past(3, { hardness: 'moderate', sports: ['gym'] }), past(6, { hardness: 'easy', sports: ['run'] }));
    const eq = todayAdvice(base({ ratings, frame: { mode: 'spontaneous' }, goal: { sports: { gym: 'equal', bike: 'equal', run: 'equal' } } }));
    expect(eq).toMatchObject({ sport: 'run', hardness: 'moderate', reason: 'weil du Laufen am längsten nicht gemacht hast', line: 'Laufen, mittel – weil du Laufen am längsten nicht gemacht hast' });
    const focus = todayAdvice(base({ ratings, frame: { mode: 'spontaneous' }, goal: { sports: { gym: 'focus', bike: 'focus', run: 'equal' } } }));
    expect(focus.sport).toBe('gym');
  });

  it('6: after six days without a break, rest', () => {
    const ratings = rated(...[1, 2, 3, 4, 5, 6].map((n) => past(n, { hardness: 'easy', sports: ['bike'] })));
    expect(todayAdvice(base({ ratings, planDay: planDay({ hardness: 'easy' }) })))
      .toMatchObject({ sport: 'rest', reason: 'weil du seit 6 Tagen ohne Pause trainierst' });
    const gap = rated(...[1, 2, 3, 5, 6].map((n) => past(n, { hardness: 'easy', sports: ['bike'] })));
    expect(todayAdvice(base({ ratings: gap, planDay: planDay({ hardness: 'easy' }) })).sport).toBe('bike');
  });

  it('a missed plan day is not carried over', () => {
    // yesterday was planned (hard gym) but nothing was done: today only sees today
    const a = todayAdvice(base({ ratings: rated(past(1, {})), planDay: planDay({ sport: 'mobility', hardness: 'easy' }) }));
    expect(a).toMatchObject({ sport: 'mobility', hardness: 'easy', fromPlan: true });
  });

  it('week mode without a deviation: from the plan; spontaneous mode ignores the plan day', () => {
    expect(todayAdvice(base({ planDay: planDay({ sport: 'run', hardness: 'easy' }) })).fromPlan).toBe(true);
    const s = todayAdvice(base({ frame: { mode: 'spontaneous' }, planDay: planDay({ sport: 'run', hardness: 'easy' }), goal: { sports: { gym: 'focus' } } }));
    expect(s).toMatchObject({ sport: 'gym', fromPlan: false });
  });

  it('a plain rater turns app records into ratings', () => {
    const r = ratingsFromEntries([{ date: TODAY, hardness: rateIntensity(0.85), legs: false, minutes: 40.4, sport: 'bike' }, { date: TODAY, hardness: 'moderate', legs: true, minutes: 30, sport: 'gym' }], [TODAY]);
    expect(r[TODAY]).toEqual({ date: TODAY, hardness: 'hard', legs: true, minutes: 70, sports: ['bike', 'gym'] });
  });
});

describe('done today', () => {
  const trained = rated([TODAY, { date: TODAY, hardness: 'moderate', legs: false, minutes: 50, sports: ['gym'] }]);
  it('trained today and the evening: rest, done', () => {
    expect(todayAdvice(base({ ratings: trained, hour: 18, planDay: planDay({ sport: 'bike' }) })))
      .toMatchObject({ sport: 'rest', done: true, reason: 'weil du heute schon trainiert hast', fromPlan: false });
  });
  it('before the hour, without training or without an hour it stays as it was', () => {
    expect(todayAdvice(base({ ratings: trained, hour: 17, planDay: planDay({ sport: 'bike' }) })).done).toBeUndefined();
    expect(todayAdvice(base({ ratings: trained, planDay: planDay({ sport: 'bike' }) })).done).toBeUndefined();
    const none = rated([TODAY, { date: TODAY, hardness: null, legs: false, minutes: 0 }]);
    expect(todayAdvice(base({ ratings: none, hour: 21, planDay: planDay({ sport: 'bike' }) })).done).toBeUndefined();
  });
});
