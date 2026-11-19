/**
 * One canonical name per ingredient: spelling, word order, plural and filler words do not make a second item.
 * Rules first; a small synonym table (data) for real synonyms.
 */

/** Real synonyms, on the normalised (singular) word. */
const SYNONYMS: Record<string, string> = {
  möhre: 'karotte', mohrrübe: 'karotte', karotte: 'karotte',
  naturtofu: 'tofu', speisezwiebel: 'zwiebel', vollmilch: 'milch',
  kichererbse: 'kichererbse', garbanzo: 'kichererbse',
  aubergine: 'aubergine', eierfrucht: 'aubergine',
};
/** Parts of compound words that are the same thing. */
const PARTS: [string, string][] = [['kirsch', 'cherry'], ['sosse', 'sauce']];

const COLOURS = ['rot', 'gelb', 'grün', 'weiss', 'schwarz', 'braun', 'orange'];
const HERBS_AND_SPICES = new Set([
  'oregano', 'thymian', 'basilikum', 'majoran', 'petersilie', 'rosmarin', 'salbei', 'minze', 'dill', 'schnittlauch', 'koriander', 'bohnenkraut',
  'paprikapulver', 'kümmel', 'knoblauchpulver', 'zwiebelpulver', 'curry', 'currypulver', 'chili', 'ingwer', 'kurkuma', 'zimt', 'pfeffer',
]);
/** A word that adds nothing: always (null) or only next to one of these words. */
const FILLER: Record<string, Set<string> | null> = {
  natur: null, naturell: null, edelsüss: null, frisch: null, käse: null,
  getrocknet: HERBS_AND_SPICES, braun: new Set(['champignon']),
};

const singular = (w: string): string => {
  if (w.length <= 3) return w;
  if (w.endsWith('eier')) return `${w.slice(0, -4)}ei`;
  if (w.endsWith('nüsse')) return `${w.slice(0, -5)}nuss`;
  if (w.endsWith('kerne')) return w.slice(0, -1);
  if (w.endsWith('ons')) return w.slice(0, -1);
  if (w.endsWith('en') && w.length > 4) return w.slice(0, -1);
  if (/eln$/.test(w) && w.length > 5) return w.slice(0, -1);
  return w;
};
const colour = (w: string): string => {
  const m = /^(rot|gelb|grün|weiss|schwarz|braun|orange)(e|en|er|es|em)?$/.exec(w);
  return m ? m[1]! : w;
};
const word = (raw: string): string => {
  let w = raw.replace(/[^a-zäöüß0-9]/g, '').replace(/ß/g, 'ss');
  for (const [a, b] of PARTS) w = w.replace(a, b);
  w = colour(w);
  if (COLOURS.includes(w)) return w;
  w = singular(w);
  return SYNONYMS[w] ?? w;
};

/**
 * What the coach learned on top of the rules: the canonical name (by rules) of a product, onto the canonical name of the same
 * product that other recipes spell differently. One step only, never a chain.
 */
export type Aliases = Record<string, string>;

/** The canonical name: lower case, no spelling variants, words in a fixed order; an alias, when there is one, last. */
export function canonName(name: string, aliases?: Aliases): string {
  const c = ruleName(name);
  return aliases && Object.hasOwn(aliases, c) ? aliases[c]! : c;
}

function ruleName(name: string): string {
  const joined = name.toLowerCase().replace(/(\p{L})-(\p{L})/gu, '$1$2');
  const keep = (s: string) => /[a-zäöüß0-9]/.test(s);
  let words = joined.split(/[\s,;/]+/).filter(keep).map(word).filter((w) => w !== '');
  const drop = words.filter((w) => {
    const only = FILLER[w];
    return only !== undefined && (only === null || words.some((o) => only.has(o)));
  });
  const rest = words.filter((w) => !drop.includes(w));
  words = rest.length > 0 ? rest : words;
  return [...new Set(words)].sort().join(' ');
}

/** Typical weight in g of one unit, where the unit means a known amount of this ingredient. Key: the canonical name (colours may be left out). */
const GRAMS: Record<string, Partial<Record<'Stk' | 'Bund' | 'EL' | 'TL', number>>> = {
  tomate: { Stk: 100 }, gurke: { Stk: 400 }, karotte: { Stk: 80 }, zwiebel: { Stk: 80 }, paprika: { Stk: 170 }, zucchini: { Stk: 300 },
  aubergine: { Stk: 300 }, kartoffel: { Stk: 100 }, avocado: { Stk: 150 }, apfel: { Stk: 150 }, banane: { Stk: 120 }, zitrone: { Stk: 100 },
  limette: { Stk: 70 }, brokkoli: { Stk: 400 }, süsskartoffel: { Stk: 250 },
  basilikum: { Bund: 20 }, minze: { Bund: 20 }, petersilie: { Bund: 20 }, schnittlauch: { Bund: 20 }, koriander: { Bund: 20 }, dill: { Bund: 20 },
  kürbiskern: { EL: 10 }, sonnenblumenkern: { EL: 10 }, sesam: { EL: 10 }, leinsamen: { EL: 10 }, chiasamen: { EL: 12 }, haferflocke: { EL: 8 },
  tomatenmark: { EL: 15, TL: 5 },
};

/** Grams in one `unit` of the ingredient, or undefined when no typical weight is known. */
export function gramsPer(canon: string, unit: string): number | undefined {
  if (unit === 'g') return 1;
  if (unit !== 'Stk' && unit !== 'Bund' && unit !== 'EL' && unit !== 'TL') return undefined;
  const bare = canon.split(' ').filter((w) => !COLOURS.includes(w)).join(' ');
  return GRAMS[canon]?.[unit] ?? GRAMS[bare]?.[unit];
}
