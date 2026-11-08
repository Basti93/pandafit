/** German date and time for the light UI, in the local time zone. One place, used by every screen. */

import { dateKey } from './day-rating';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local day of a time, as YYYY-MM-DD. */
export const localDayKey = dateKey;

/** "Mo., 3. Nov." */
export const shortDate = (ms: number): string => new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

/** "Mo., 3. Nov." from a YYYY-MM-DD key. */
export const shortDateOfKey = (key: string): string => { const [y, m, d] = key.split('-').map(Number); return shortDate(new Date(y!, m! - 1, d!, 12).getTime()); };

/** "3. Nov." from a YYYY-MM-DD key, without the weekday. */
export const dayMonthOfKey = (key: string): string => { const [y, m, d] = key.split('-').map(Number); return new Date(y!, m! - 1, d!, 12).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }); };

/** "26. Okt. – 1. Nov." for the week that starts on this Monday (YYYY-MM-DD). */
export const weekRangeOfKey = (monday: string): string => {
  const [y, m, d] = monday.split('-').map(Number);
  const end = new Date(y!, m! - 1, d! + 6, 12);
  return `${dayMonthOfKey(monday)} – ${end.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`;
};

/** "14:05" */
export const timeLabel = (ms: number): string => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** The heading of a day: "Heute", "Gestern" or "Mo., 3. Nov.". */
export function dayHeading(ms: number, nowMs: number): string {
  const day = localDayKey(ms);
  if (day === localDayKey(nowMs)) return 'Heute';
  const y = new Date(nowMs);
  y.setDate(y.getDate() - 1);
  return day === localDayKey(y.getTime()) ? 'Gestern' : shortDate(ms);
}

/** "November 2026" */
export const monthLabel = (ms: number): string => new Date(ms).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
