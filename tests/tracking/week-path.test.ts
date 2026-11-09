import { describe, expect, it } from 'vitest';
import type { PlanDay } from '../../src/shared/week-plan';
import type { DayRow } from '../../src/tracking/ui/done-days';
import { KIND_ICON, restDaysText, SPORT_ICON, weekCount, weekCountText, weekPathOf, weekRangeText, weekSentence } from '../../src/tracking/ui/week-path';

const [MO, DI, MI, DO, FR, SA, SO] = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const WEEK = [MO, DI, MI, DO, FR, SA, SO] as string[];
const day = (date: string, sport: PlanDay['sport'], hardness: PlanDay['hardness'] = 'moderate'): PlanDay => ({ date, sport, hardness, fixed: false });
const gym = day(DO!, 'gym');
const bike = day(FR!, 'bike', 'easy');
const rest = day(SA!, 'rest');
const run = day(SO!, 'run', 'easy');
const row = (date: string | undefined, o: { done?: string[]; plan?: PlanDay }): DayRow =>
  ({ date: date!, done: o.done ?? [], kinds: (o.done ?? []).map(() => 'kraft' as const), plan: o.plan ?? null, rest: false });

describe('the week path', () => {
  it('walks the week: done before today, the ring today, plans after, small dots for rest', () => {
    const p = weekPathOf(WEEK, [row(MO, { done: ['Kraft'] }), row(DI, {}), row(MI, { done: ['Kraft'] }), row(DO, { plan: gym }), row(FR, { plan: bike }), row(SA, { plan: rest }), row(SO, { plan: run })], DO!);
    expect(p.map((d) => d.state)).toEqual(['done', 'rest', 'done', 'today', 'planned', 'rest', 'planned']);
    expect(p[0]!.short).toBe('Mo');
    expect(p[3]!.done).toBe(false);
  });
  it('a week without a plan is seven calm dots and no count', () => {
    const p = weekPathOf(WEEK, [row(MO, {}), row(DI, {})], DI!);
    expect(p.map((d) => d.state)).toEqual(['rest', 'today', 'rest', 'rest', 'rest', 'rest', 'rest']);
    expect(weekCountText(weekCount([row(MO, {}), row(DI, {})], null))).toBeNull();
  });
  it('marks today as done when something was done today', () => {
    expect(weekPathOf(WEEK, [row(DO, { done: ['Rad 40 Min'] })], DO!)[3]).toMatchObject({ state: 'today', done: true });
  });
  it('counts done days against the planned training days', () => {
    expect(weekCountText({ done: 2, planned: 5 })).toBe('2 von 5 geschafft');
    expect(weekCountText({ done: 2, planned: null })).toBe('2 geschafft');
    expect(weekCountText({ done: 3, planned: 2 })).toBe('3 geschafft');
    expect(weekCount([row(MO, { done: ['Kraft'] }), row(DI, {})], [gym, bike, rest])).toEqual({ done: 1, planned: 2 });
  });
  it('says the week in whole sentences', () => {
    expect(weekSentence([row(MO, { done: ['Kraft'] }), row(MI, { done: ['Kraft'] }), row(DO, { plan: gym }), row(FR, { plan: bike }), row(SO, { plan: run })], DO!, [gym, bike, run]))
      .toBe('Zwei Einheiten hast du schon geschafft. Heute ist Kraft, mittel dran. Danach kommen noch zwei Einheiten.');
    expect(weekSentence([row(MO, {}), row(DO, { plan: rest })], DO!, [day(DO!, 'rest')])).toBe('Die Woche fängt gerade an. Heute ist Ruhetag.');
    expect(weekSentence([row(MO, { done: ['Kraft'] }), row(DO, {}), row(FR, { plan: bike })], DO!, [bike])).toBe('Eine Einheit hast du schon geschafft. Danach kommt noch eine Einheit.');
  });
  it('says the week "fängt gerade an" only at its start, otherwise calmly that nothing is done yet', () => {
    expect(weekSentence([row(DI, { plan: gym })], DI!, [day(MO!, 'gym'), gym])).toMatch(/^Die Woche fängt gerade an\./);
    expect(weekSentence([row(SA, {})], SA!, [day(MO!, 'gym'), gym])).toBe('Diese Woche ist noch keine Einheit erledigt.');
    expect(weekSentence([row(DO, { plan: gym })], DO!, [day(MO!, 'rest'), gym])).toMatch(/^Die Woche fängt gerade an\./);
  });
  it('names the rest days after today', () => {
    expect(restDaysText([row(DI, { plan: rest }), row(SA, { plan: rest })], MO!)).toBe('Dienstag und Samstag sind Ruhetage.');
    expect(restDaysText([row(SA, { plan: rest })], MO!)).toBe('Samstag ist ein Ruhetag.');
    expect(restDaysText([row(DI, { plan: rest }), row(DO, { plan: rest }), row(SA, { plan: rest })], MO!)).toBe('Dienstag, Donnerstag und Samstag sind Ruhetage.');
    expect(restDaysText([row(FR, { plan: bike })], MO!)).toBeNull();
  });
  it('writes the week range', () => {
    expect(weekRangeText('2026-11-09')).toBe('9. bis 15. November');
    expect(weekRangeText('2026-11-30')).toBe('30. November bis 6. Dezember');
  });
  it('maps sports and kinds to icons', () => {
    expect(SPORT_ICON).toMatchObject({ gym: 'kraft', bike: 'ausdauer', run: 'lauf', mobility: 'spross', rest: 'mond' });
    expect(KIND_ICON).toMatchObject({ kraft: 'kraft', rad: 'ausdauer', lauf: 'lauf', andere: 'spross' });
  });
});
