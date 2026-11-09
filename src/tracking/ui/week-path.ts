import type { ActivityKind } from '../../shared/activities';
import { dayMonthLongOfKey, weekdayOfKey } from '../../shared/dates';
import { addDays, type PlanDay, type Sport } from '../../shared/week-plan';
import type { DayRow } from './done-days';
import type { IconName } from './kit/Icon';
import { planDayLabel } from './plan-text';

export type PathState = 'done' | 'today' | 'planned' | 'rest';
export type PathDay = { date: string; short: string; state: PathState; done: boolean };

export const SPORT_ICON: Record<Sport, IconName> = { gym: 'kraft', bike: 'ausdauer', run: 'lauf', mobility: 'spross', rest: 'mond' };
export const KIND_ICON: Record<ActivityKind, IconName> = { kraft: 'kraft', rad: 'ausdauer', lauf: 'lauf', andere: 'spross' };

const isRest = (p: PlanDay | null): boolean => p !== null && p.sport === 'rest' && !p.also;
const isTraining = (p: PlanDay | null): p is PlanDay => p !== null && !isRest(p);

/** The seven days of the week path: done before today, the ring today, the plan after today. A missing row is a rest day. */
export function weekPathOf(dates: string[], rows: DayRow[], today: string): PathDay[] {
  return dates.map((date): PathDay => {
    const r = rows.find((x) => x.date === date);
    const hasDone = (r?.done.length ?? 0) > 0;
    const short = weekdayOfKey(date).slice(0, 2);
    if (date === today) return { date, short, state: 'today', done: hasDone };
    if (date < today) return { date, short, state: hasDone ? 'done' : 'rest', done: hasDone };
    return { date, short, state: isTraining(r?.plan ?? null) ? 'planned' : 'rest', done: false };
  });
}

export function weekCount(rows: DayRow[], planDays: PlanDay[] | null): { done: number; planned: number | null } {
  return { done: rows.filter((r) => r.done.length > 0).length, planned: planDays ? planDays.filter(isTraining).length : null };
}

/** "2 von 5 geschafft"; without a plan "2 geschafft"; without a plan and nothing done: null. */
export function weekCountText(c: { done: number; planned: number | null }): string | null {
  if (c.planned !== null) return `${c.done} von ${c.planned} geschafft`;
  return c.done > 0 ? `${c.done} geschafft` : null;
}

const WORD = ['null', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben'];
const word = (n: number): string => WORD[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The week in three short sentences: what is done, what today is, what comes after. */
export function weekSentence(rows: DayRow[], today: string): string {
  const done = rows.filter((r) => r.date <= today && r.done.length > 0).length;
  const parts: string[] = [];
  parts.push(done === 0 ? 'Die Woche fängt gerade an.' : done === 1 ? 'Eine Einheit hast du schon geschafft.' : `${cap(word(done))} Einheiten hast du schon geschafft.`);
  const todayPlan = rows.find((r) => r.date === today)?.plan ?? null;
  if (isTraining(todayPlan)) parts.push(`Heute ist ${planDayLabel(todayPlan)} dran.`);
  else if (isRest(todayPlan)) parts.push('Heute ist Ruhetag.');
  const later = rows.filter((r) => r.date > today && isTraining(r.plan)).length;
  if (later === 1) parts.push('Danach kommt noch eine Einheit.');
  else if (later > 1) parts.push(`Danach kommen noch ${word(later)} Einheiten.`);
  return parts.join(' ');
}

/** The rest days after today: "Samstag ist ein Ruhetag.", "Dienstag und Samstag sind Ruhetage."; null without one. */
export function restDaysText(rows: DayRow[], today: string): string | null {
  const names = rows.filter((r) => r.date > today && isRest(r.plan)).map((r) => weekdayOfKey(r.date));
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} ist ein Ruhetag.`;
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} sind Ruhetage.`;
}

/** "9. bis 15. November"; across a month "30. November bis 6. Dezember". */
export function weekRangeText(monday: string): string {
  const sunday = addDays(monday, 6);
  const from = dayMonthLongOfKey(monday);
  const to = dayMonthLongOfKey(sunday);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  return sameMonth ? `${from.split('.')[0]}. bis ${to}` : `${from} bis ${to}`;
}
