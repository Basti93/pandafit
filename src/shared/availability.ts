/**
 * What the household can get at the moment: the outdoor season of fresh produce in Germany, and what a discounter usually lacks.
 * Both are data tables; ingredients are matched by their canonical name, so spelling and plural do not matter.
 */
import { canonName } from './ingredient-key';
import type { Section, Store } from './meals';
import { ruleNumber } from './training-policy';

/** Months, 1 to 12. A range may wrap over the new year (11 to 2). */
type Months = readonly (readonly [number, number])[];
const ALL: Months = [[1, 12]];

/** Fresh produce with the months of its outdoor season (or its storage time). What is not in the table has no limit. Imported staples and storage crops are all year. */
const SEASON: readonly (readonly [string, Months])[] = [
  ['Spargel', [[4, 6]]], ['Rhabarber', [[4, 6]]], ['Erdbeere', [[5, 7]]], ['Kirsche', [[6, 8]]], ['Himbeere', [[6, 8]]], ['Johannisbeere', [[6, 7]]],
  ['Stachelbeere', [[6, 7]]], ['Heidelbeere', [[7, 9]]], ['Brombeere', [[7, 9]]], ['Aprikose', [[7, 8]]], ['Pfirsich', [[7, 9]]], ['Nektarine', [[7, 9]]], ['Melone', [[7, 9]]],
  ['Pflaume', [[8, 9]]], ['Zwetschge', [[8, 10]]], ['Birne', [[8, 11]]], ['Weintraube', [[8, 10]]], ['Feige', [[8, 10]]], ['Quitte', [[9, 11]]],
  ['Zucchini', [[6, 10]]], ['Aubergine', [[7, 10]]], ['Gurke', [[6, 9]]], ['Tomate', [[6, 10]]], ['Paprika', [[7, 10]]], ['Mais', [[7, 10]]],
  ['Brokkoli', [[6, 11]]], ['Blumenkohl', [[6, 11]]], ['Kohlrabi', [[5, 10]]], ['Radieschen', [[4, 10]]], ['Frühlingszwiebel', [[4, 9]]], ['Salat', [[5, 10]]],
  ['Mangold', [[6, 10]]], ['Erbse', [[6, 7]]], ['Bohne', [[7, 10]]], ['Spinat', [[3, 6], [9, 11]]], ['Pfifferling', [[6, 10]]], ['Steinpilz', [[7, 10]]],
  ['Kürbis', [[9, 12]]], ['Rote Bete', [[1, 3], [6, 12]]], ['Grünkohl', [[10, 2]]], ['Rosenkohl', [[10, 2]]], ['Wirsing', [[9, 3]]], ['Rotkohl', [[9, 3]]],
  ['Feldsalat', [[10, 3]]], ['Chicorée', [[11, 3]]], ['Pastinake', [[10, 3]]], ['Steckrübe', [[10, 3]]], ['Schwarzwurzel', [[10, 3]]],
  ['Mandarine', [[11, 2]]], ['Clementine', [[11, 2]]],
  // Storage crops and imported staples.
  ['Kartoffel', ALL], ['Zwiebel', ALL], ['Karotte', ALL], ['Apfel', ALL], ['Weißkohl', ALL], ['Sellerie', ALL], ['Lauch', ALL], ['Champignon', ALL],
  ['Banane', ALL], ['Zitrone', ALL], ['Limette', ALL], ['Orange', ALL], ['Avocado', ALL], ['Ingwer', ALL], ['Knoblauch', ALL],
];

const words = (canon: string): string[] => canon.split(' ');
/** True when every word of the key is a word of the ingredient. */
const hasAll = (canon: string, key: string): boolean => { const w = new Set(words(canon)); return words(key).every((k) => w.has(k)); };

const SEASON_KEYED = SEASON.map(([name, months]) => ({ name, key: canonName(name), months }));
const inMonths = (months: Months, month: number): boolean => months.some(([a, b]) => (a <= b ? month >= a && month <= b : month >= a || month <= b));

export const FRESH: Section = 'Obst und Gemüse';

/** Whether a fresh ingredient is out of its season in this month (1 to 12). Only fresh produce counts; an unknown one has no limit. */
export function seasonProblem(name: string, section: Section, month: number): boolean {
  if (section !== FRESH) return false;
  const c = canonName(name);
  const hits = SEASON_KEYED.filter((s) => hasAll(c, s.key));
  return hits.length > 0 && hits.every((h) => !inMonths(h.months, month));
}

/** The names of produce that is out of season in this month, for the AI prompt. */
export const outOfSeasonNames = (month: number): string[] => SEASON_KEYED.filter((s) => !inMonths(s.months, month)).map((s) => s.name);

/** The month (1 to 12) of a time. */
export const monthOf = (ms: number): number => new Date(ms).getMonth() + 1;

/** What a German discounter usually does not carry (any section), with a common substitute. A name may be spelled several ways. Not the shop's own range, only the usual one. */
const RARE_AT_DISCOUNTER: readonly { names: readonly string[]; substitute: string }[] = [
  { names: ['Austernpilz', 'Austernpilze', 'Kräuterseitling'], substitute: 'braune Champignons' },
  { names: ['Shiitake'], substitute: 'braune Champignons' },
  { names: ['Pak Choi', 'Pak-Choi'], substitute: 'Chinakohl' },
  { names: ['Tahin', 'Tahini', 'Sesampaste'], substitute: 'Erdnussmus' },
  { names: ['Harissa'], substitute: 'Tomatenmark mit etwas Chili' },
  { names: ['Rote-Linsen-Nudeln', 'Rote Linsen Nudeln', 'Linsennudeln'], substitute: 'Vollkornnudeln' },
  { names: ['Sojagranulat', 'Sojaschnetzel'], substitute: 'Linsen' },
  { names: ['Thai-Basilikum', 'Zitronengras', 'Kaffirlimettenblätter', 'Galgant'], substitute: 'Ingwer und Limettenschale' },
  { names: ['Miso', 'Misopaste'], substitute: 'Sojasauce' },
  { names: ['Tempeh', 'Seitan'], substitute: 'Tofu' },
];
const RARE_KEYED = RARE_AT_DISCOUNTER.flatMap((r) => r.names.map((n) => ({ key: canonName(n), substitute: r.substitute, name: r.names[0]! })));

/** The usual substitute of an ingredient that a discounter rarely carries, or null: only for the discounter, for any other shop and for an ingredient that is there. */
export function rareSubstitute(name: string, store: Store): string | null {
  if (store !== 'discounter') return null;
  const c = canonName(name);
  return RARE_KEYED.find((r) => hasAll(c, r.key))?.substitute ?? null;
}

/** The names a discounter rarely carries, for the AI prompt. */
export const rareNames = (): string[] => RARE_AT_DISCOUNTER.map((r) => r.names[0]!);

/** The moment and the shop a plan is made for. */
export type Availability = { month: number; store: Store };
type Line = { name: string; section: Section };

/** The ingredients that are out of season, and those a discounter rarely carries. */
export const problems = (lines: readonly Line[], av: Availability): { season: Line[]; rare: Line[] } => ({
  season: lines.filter((l) => seasonProblem(l.name, l.section, av.month)),
  rare: lines.filter((l) => rareSubstitute(l.name, av.store) !== null),
});

/** Whether a recipe is clean: no more problem ingredients than `meals.season-preference` and `meals.discounter-range` allow. */
export function isClean(lines: readonly Line[], av: Availability): boolean {
  const p = problems(lines, av);
  return p.season.length <= ruleNumber('meals.season-preference') && p.rare.length <= ruleNumber('meals.discounter-range');
}

/**
 * Of some candidates, the clean ones when there is at least one; otherwise all of them, because a plan with a problem is better than no plan.
 */
export function preferAvailable<T>(items: readonly T[], linesOf: (t: T) => readonly Line[], av?: Availability): T[] {
  if (!av) return [...items];
  const clean = items.filter((t) => isClean(linesOf(t), av));
  return clean.length > 0 ? clean : [...items];
}

/** A short hint for a shopping row: a rare ingredient with its substitute, an out-of-season one, or null. */
export function shopHint(name: string, section: Section, av: Availability): string | null {
  const sub = rareSubstitute(name, av.store);
  const parts = [
    ...(sub ? [`Gibt es beim Discounter selten. Ersatz: ${sub}.`] : []),
    ...(seasonProblem(name, section, av.month) ? ['Hat gerade keine Saison.'] : []),
  ];
  return parts.length > 0 ? parts.join(' ') : null;
}
