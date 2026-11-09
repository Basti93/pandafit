export { EQUIPMENT, MUSCLES, TYPES } from '../../shared/muscles';
import { EQUIPMENT, MUSCLES } from '../../shared/muscles';
import { dayMonthLongOfKey, weekdayOfKey } from '../../shared/dates';
import { dateKeyOf } from './run-view';
export const muscleLabel = (m: string): string => MUSCLES[m] ?? m;
export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export { shortDate as dateLabel } from '../../shared/dates';
/** A date in words with the long month ("Montag, 9. November"): it never ends in a period, so a sentence can end right after it. */
export const longDayOfKey = (key: string): string => `${weekdayOfKey(key)}, ${dayMonthLongOfKey(key)}`;
export const longDateLabel = (ms: number): string => longDayOfKey(dateKeyOf(ms));
/** The kicker of a day card: "Heute" only for today, else the weekday and the date. */
export const dayKicker = (key: string, todayKey: string): string => (key === todayKey ? 'Heute' : longDayOfKey(key));
const words = (t: string): string[] => t.toLocaleLowerCase('de').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The equipment label for a title, or '' when the title already names the equipment (any word of the label, case-insensitive). */
export function equipmentSuffix(title: string, equipment: string): string {
  const label = EQUIPMENT[equipment] ?? equipment;
  const inTitle = new Set(words(title));
  return words(label).some((w) => w.length > 3 && w !== 'oder' && inTitle.has(w)) ? '' : label;
}

/** The catalog's display groups: about eight instead of one per muscle. A display mapping only; the muscle data stays. */
export const CATALOG_GROUPS: { label: string; muscles: string[] }[] = [
  { label: 'Brust', muscles: ['chest'] },
  { label: 'Rücken', muscles: ['lats', 'upper_back', 'lower_back', 'traps'] },
  { label: 'Schultern', muscles: ['shoulders', 'front_delts', 'side_delts', 'rear_delts'] },
  { label: 'Arme', muscles: ['biceps', 'triceps', 'forearms'] },
  { label: 'Bauch', muscles: ['abdominals'] },
  { label: 'Beine', muscles: ['quadriceps', 'hamstrings', 'calves', 'abductors', 'adductors'] },
  { label: 'Gesäß', muscles: ['glutes'] },
  { label: 'Ganzkörper & Ausdauer', muscles: ['full_body', 'cardio', 'other'] },
];
/** The display group of a muscle; an unknown muscle belongs to the last one. */
export const catalogGroup = (muscle: string): string => (CATALOG_GROUPS.find((g) => g.muscles.includes(muscle)) ?? CATALOG_GROUPS[CATALOG_GROUPS.length - 1]).label;
