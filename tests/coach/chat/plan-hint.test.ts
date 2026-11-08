import { planHint } from '../../../src/coach/chat/plan-hint';
import type { TrackedRecord } from '../../../src/shared/records';
import { weekDates } from '../../../src/shared/week-plan';

const NOW = new Date(2026, 10, 7, 9).getTime(); // Saturday 2026-11-07
const plan = (monday: string, sportOn: Record<number, string>): TrackedRecord => ({ kind: 'weekplan', id: monday, updatedMs: 1, deleted: false,
  body: { weekStart: monday, fromMessage: 'm', acceptedMs: 1, days: weekDates(monday).map((date, i) => ({ date, sport: sportOn[i] ?? 'rest', hardness: 'easy', fixed: false })) } });

test('empty without a plan', () => expect(planHint([], NOW, 'gym')).toBe(''));
test('shows the next seven days across the week border, and names the sport', () => {
  const h = planHint([plan('2026-11-02', { 5: 'gym' }), plan('2026-11-09', { 1: 'bike' })], NOW, 'bike');
  expect(h).toContain('"date":"2026-11-07"');
  expect(h).toContain('"date":"2026-11-10"');
  expect(h).not.toContain('2026-11-14');
  expect(h).toContain('sport "bike"');
});

test('a combination day shows both parts and counts for both planners', () => {
  const rec = plan('2026-11-02', {});
  (rec.body as { days: Record<string, unknown>[] }).days[6] = { date: '2026-11-08', sport: 'gym', hardness: 'moderate', fixed: false, also: { sport: 'bike', hardness: 'easy' } };
  const h = planHint([rec], NOW, 'bike');
  expect(h).toContain('"auch":{"sport":"bike","hardness":"easy"}');
  expect(h).toContain('"sport":"gym"');
});

test('legs false is sent as beine false, no legs value sends no key', () => {
  const rec = plan('2026-11-02', { 5: 'gym', 6: 'gym' });
  (rec.body as { days: Record<string, unknown>[] }).days[6]!.legs = false;
  const h = planHint([rec], NOW, 'gym');
  expect(h).toContain('"beine":false');
  expect(h.match(/beine/g)?.length).toBe(2); // one day plus the sentence
  expect(h).toContain('beine false heißt: an diesem Tag keine Beinübungen.');
  expect(planHint([plan('2026-11-02', { 5: 'gym' })], NOW, 'gym')).not.toContain('"beine"');
});

describe('what fits today in the hint', () => {
  const ctx = (mode: 'week' | 'spontaneous') => ({ ratings: {}, goal: { sports: { run: 'focus' as const } }, frame: { mode } });
  it('spontaneous mode gives the advice as the hint, even with a plan', () => {
    const h = planHint([], NOW, 'run', ctx('spontaneous'));
    expect(h).toContain('Heute passt: Laufen, mittel – weil du Laufen am längsten nicht gemacht hast.');
    expect(planHint([plan('2026-11-02', { 5: 'gym' })], NOW, 'run', ctx('spontaneous'))).not.toContain('wochenplan');
  });
  it('week mode: no extra line when the plan day stands, the advice line when it differs', () => {
    const rec = plan('2026-11-02', { 5: 'bike' });
    expect(planHint([rec], NOW, 'bike', ctx('week'))).not.toContain('Heute passt');
    const hard = plan('2026-11-02', { 5: 'bike' });
    (hard.body as { days: { hardness: string }[] }).days[5]!.hardness = 'hard';
    expect(planHint([hard], NOW, 'bike', { ...ctx('week'), readiness: { restingHrRaised: true } })).toContain('Heute passt: Ruhetag – weil dein Ruhepuls erhöht ist.');
  });
  it('week mode: no line at all when today has no plan day', () => {
    const rec = plan('2026-11-02', { 0: 'bike' });
    const h = planHint([rec], NOW, 'bike', ctx('week'));
    expect(h).not.toContain('Heute passt');
    expect(planHint([], NOW, 'run', ctx('week'))).toBe('');
  });
});

describe('planned is never done', () => {
  const rec = plan('2026-11-02', { 5: 'gym', 6: 'bike' });
  test('today lists what was done, an empty list when nothing; future days have none', () => {
    const h = planHint([rec], NOW, 'gym', undefined, {});
    expect(h).toMatch(/"date":"2026-11-07"[^}]*"erledigt":\[\]/);
    expect(h).toContain('Ein vergangener Plantag oder heute ohne den geplanten Sport in erledigt ist nicht gemacht.');
    expect(h.match(/"erledigt"/g)).toHaveLength(1);
  });
  test('done sports of today are named', () => {
    expect(planHint([rec], NOW, 'gym', undefined, { '2026-11-07': ['gym', 'run'] })).toContain('"erledigt":["gym","run"]');
  });
});
