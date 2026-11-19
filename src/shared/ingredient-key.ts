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

/** The canonical name: lower case, no spelling variants, words in a fixed order. */
export function canonName(name: string): string {
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
