import type { TrackedRecord } from '../../shared/records';
import { addDays, mondayOf, planOfWeek, SPORT_LABEL, WEEKDAY_LABEL, type Sport } from '../../shared/week-plan';
import { dateKey } from '../day-load';
import { dataBlock } from '../meals/prompt';
import { todayAdvice, type TodayInput } from '../../shared/today';

/** What the hint needs beyond the week plan to say what fits today. */
export type TodayContext = Pick<TodayInput, 'ratings' | 'goal' | 'frame' | 'readiness' | 'hour'>;

/**
 * The accepted week plan for a coach's prompt: the next seven days from today, and what it means for this coach. Empty without
 * a plan: the coach plans as before. The plan is a strong hint; the coach's own load logic (complaints, a hard day before) wins
 * when it says less.
 */
export function planHint(records: TrackedRecord[], nowMs: number, sport: Exclude<Sport, 'rest' | 'mobility'>, ctx?: TodayContext, done?: Record<string, Sport[]>): string {
  const today = dateKey(nowMs);
  const planDay = planOfWeek(records, mondayOf(today))?.days.find((x) => x.date === today) ?? null;
  // In week mode a day without a plan day says nothing; the advice only comments on a plan day (spontaneous mode always has one).
  const advice = ctx && (ctx.frame.mode === 'spontaneous' || planDay) ? todayAdvice({ ...ctx, date: today, planDay }) : null;
  const todayLine = advice ? `\nHeute passt: ${advice.line}.` : '';
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i)).flatMap((date) => {
    const d = planOfWeek(records, mondayOf(date))?.days.find((x) => x.date === date);
    return d ? [{ date, tag: WEEKDAY_LABEL[(new Date(`${date}T12:00:00`).getDay() + 6) % 7], sport: d.sport, hardness: d.hardness, ...(d.also ? { auch: { sport: d.also.sport, hardness: d.also.hardness, ...(d.also.minutes ? { minuten: d.also.minutes } : {}) } } : {}), fest: d.fixed, ...(date <= today ? { erledigt: done?.[date] ?? [] } : {}), ...(d.legs === false ? { beine: false } : {}), ...(d.long ? { lang: true } : {}), ...(d.note ? { notiz: d.note } : {}) }] : [];
  });
  // Spontaneous mode, or no plan: the advice is the hint. Week mode: as before, plus the advice when it differs from the plan.
  if (ctx?.frame.mode === 'spontaneous' || days.length === 0) return todayLine ? `${todayLine} Plane deine nächste Einheit (${SPORT_LABEL[sport]}, sport "${sport}") passend dazu: Ist heute eine andere Sportart dran, plane deine Einheit für später und locker. Sagen deine eigenen Daten weniger (Beschwerden, harte Tage davor), gilt weniger.` : '';
  return `\n${dataBlock('wochenplan', days)}\nDie Person hat diesen Wochenplan mit dem Coach abgesprochen. Plane deine nächste Einheit (${SPORT_LABEL[sport]}, sport "${sport}") für den nächsten Tag im Wochenplan mit diesem Sport (auch als zweite Einheit eines Kombinationstags, auch; minuten ist deren Dauer) und bleib in dessen hardness (easy locker, moderate mittel, hard hart; lang ist die lange Einheit). erledigt nennt, was an dem Tag wirklich gemacht wurde. Ein vergangener Plantag oder heute ohne den geplanten Sport in erledigt ist nicht gemacht. Ruhetage (rest) bleiben frei. beine false heißt: an diesem Tag keine Beinübungen. Steht dein Sport in den nächsten sieben Tagen nicht im Plan, plane trotzdem eine Einheit, aber locker. Sagen deine eigenen Daten weniger (Beschwerden, harte Tage davor), gilt weniger.${advice && !advice.fromPlan ? todayLine : ''}`;
}
