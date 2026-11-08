import type { TrackedRecord } from './records';

/**
 * The coach's sentence for today, one record per profile written by the coach server. The web shows `text` only when
 * `date` is the current local day; otherwise it shows a saying from the fixed list.
 */
export const DAYTEXT_ID = 'today';
export const DAY_TEXT_MAX = 220;
const ABOUT_MAX = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DayText = { type: 'daytext'; date: string; text: string; atMs: number; about?: string };

/** Words that put pressure on a person; no coach sentence and no saying may contain one (lower case, substring). */
export const PRESSURE_WORDS: readonly string[] = ['musst', 'müssen', 'endlich', 'keine ausrede', 'faul', 'schwach', 'versagt', 'disziplin', 'schuld'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The body, or null when it is not whole. */
export function readDayText(body: unknown): DayText | null {
  if (!isObj(body) || body.type !== 'daytext') return null;
  const { date, text, atMs, about } = body;
  if (typeof date !== 'string' || !DATE.test(date)) return null;
  if (typeof text !== 'string' || text.length < 1 || text.length > DAY_TEXT_MAX) return null;
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs < 0) return null;
  if (about !== undefined && (typeof about !== 'string' || about.length > ABOUT_MAX)) return null;
  return { type: 'daytext', date, text, atMs, ...(about !== undefined ? { about } : {}) };
}

/** Calm, short, du-form, original. No digits, no pressure words. */
export const SAYINGS: readonly string[] = [
  'Ein ruhiger Schritt heute zählt mehr als ein lauter Plan.',
  'Du darfst in deinem eigenen Tempo vorankommen.',
  'Was du regelmäßig tust, trägt dich weiter als jeder Kraftakt.',
  'Heute reicht es, wenn du freundlich zu dir bist.',
  'Dein Körper dankt dir für jede Bewegung, die dir guttut.',
  'Kleine Schritte sind auch Schritte.',
  'Ruhe gehört zum Training dazu, genau wie der Schweiß.',
  'Fang einfach an, der Rest ergibt sich unterwegs.',
  'Du bist heute schon weiter, als du denkst.',
  'Geduld ist die leise Schwester der Stärke.',
  'Ein guter Tag beginnt mit einem tiefen Atemzug.',
  'Du baust etwas auf, auch wenn man es heute noch nicht sieht.',
  'Bewegung ist ein Geschenk an dich selbst.',
  'Gönn dir heute das, was dir wirklich guttut.',
  'Jedes Mal, wenn du dranbleibst, wirst du ein Stück sicherer.',
  'Es geht nicht um schneller, sondern um weiter.',
  'Spür hin, was dein Körper heute braucht.',
  'Gelassenheit ist auch eine Form von Kraft.',
  'Dein Weg gehört dir, niemand sonst läuft ihn.',
  'Ein bisschen Bewegung macht den Kopf frei.',
  'Du darfst stolz sein auf alles, was du schon geschafft hast.',
  'Mit jedem Tag wächst dein Vertrauen in dich.',
  'Erholung ist ein Teil des Fortschritts.',
  'Heute ist ein guter Tag, um dir etwas Gutes zu tun.',
  'Freude an der Bewegung ist der beste Antrieb.',
  'Sanft anfangen ist völlig in Ordnung.',
  'Du hast deinen eigenen Rhythmus, und der ist richtig.',
  'Was gestern war, darf ruhig gestern bleiben.',
  'Atme ein, lass los, und mach dann den nächsten Schritt.',
  'Du wirst stärker, auch in den ruhigen Tagen.',
];

/** A stable 32-bit hash (FNV-1a). */
export const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
};

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
};

/** The saying of a day: fixed by seed (the profile) and date, and a different one on every following day. */
export function sayingFor(seed: string, date: string): string {
  const n = SAYINGS.length;
  return SAYINGS[(hashOf(`${seed}|`) + (DATE.test(date) ? dayNumber(date) : hashOf(date))) % n]!;
}

/** The coach's text when the record is from `date`, else the saying. */
export function dayLine(records: TrackedRecord[] | null, seed: string, date: string): { text: string; fromCoach: boolean } {
  const rec = (records ?? []).find((r) => r.id === DAYTEXT_ID && !r.deleted);
  const body = rec ? readDayText(rec.body) : null;
  if (body && body.date === date) return { text: body.text, fromCoach: true };
  return { text: sayingFor(seed, date), fromCoach: false };
}
