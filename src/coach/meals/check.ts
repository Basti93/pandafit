import type { Diet, Dish, MealSettings } from '../../shared/meals';

/**
 * Checks a dish against what the people eating it said. Deliberately simple and strict: a doubt drops the dish, and a
 * recipe from the list takes its place. These are word checks, not a guarantee, and the app says so.
 */

const norm = (s: string): string => s.toLowerCase().replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Words that qualify a dislike instead of naming the food: "keine rohen Zwiebeln", "frischer Koriander". */
const FILLER = new Set(['kein', 'keine', 'keinen', 'keiner', 'nicht', 'ohne', 'mag', 'gern', 'gerne', 'bitte', 'frisch', 'frische', 'frischer', 'frischen', 'frisches', 'und', 'oder', 'als', 'zu', 'viel']);
const RAW = new Set(['roh', 'rohe', 'roher', 'rohen', 'rohes']);

/** A word cut to its stem, so "Zwiebeln" also finds "Zwiebel" and "Frühlingszwiebel". */
const stem = (w: string): string => {
  for (const end of ['en', 'n', 'e', 's']) if (w.length > 4 && w.endsWith(end)) return w.slice(0, -end.length);
  return w;
};

type Rule = { words: string[]; rawOnly: boolean };
const ruleOf = (text: string): Rule | null => {
  const tokens = norm(text).split(' ').filter(Boolean);
  const rawOnly = tokens.some((t) => RAW.has(t));
  const words = tokens.filter((t) => !RAW.has(t) && !FILLER.has(t)).map(stem).filter((w) => w.length >= 2);
  return words.length ? { words, rawOnly } : null;
};

/** Short stems like "ei" only count as a whole word or a word start, so "Reis" never matches "Ei". */
const contains = (haystack: string, word: string): boolean => {
  // "Oliven" is not "Olivenöl": an oil made of a disliked food is left alone unless the oil itself is named.
  const words = word.endsWith('oel') ? haystack : haystack.split(' ').filter((w) => !(w.endsWith('oel') && w.startsWith(word))).join(' ');
  if (word.length >= 4) return words.includes(word);
  return new RegExp(`(^| )${word}`).test(words);
};

/** Common intolerances to the ingredients they stand for. Free text that is not listed is matched as it is. */
const INTOLERANCE_WORDS: Record<string, string[]> = {
  laktose: ['milch', 'joghurt', 'quark', 'skyr', 'kaese', 'sahne', 'butter', 'feta', 'mozzarella', 'halloumi', 'parmesan', 'schmand', 'creme fraiche', 'ricotta', 'mascarpone', 'molke'],
  milch: ['milch', 'joghurt', 'quark', 'skyr', 'kaese', 'sahne', 'butter', 'feta', 'mozzarella', 'halloumi', 'parmesan', 'schmand', 'ricotta', 'mascarpone'],
  gluten: ['weizen', 'mehl', 'brot', 'nudel', 'couscous', 'bulgur', 'dinkel', 'gerste', 'roggen', 'hafer', 'paniermehl', 'seitan', 'gnocchi', 'muesli', 'sojasosse', 'wrap'],
  nuss: ['nuss', 'nuesse', 'mandel', 'cashew', 'pistazie', 'pekan', 'macadamia', 'pesto'],
  nuesse: ['nuss', 'nuesse', 'mandel', 'cashew', 'pistazie', 'pekan', 'macadamia', 'pesto'],
  erdnuss: ['erdnuss'],
  ei: ['ei', 'eier', 'omelett', 'frittata', 'shakshuka', 'mayonnaise'],
  eier: ['ei', 'eier', 'omelett', 'frittata', 'shakshuka', 'mayonnaise'],
  soja: ['soja', 'tofu', 'tempeh', 'edamame'],
  sesam: ['sesam', 'tahin', 'hummus'],
  sellerie: ['sellerie', 'gemuesebruehe'],
  fruktose: ['apfel', 'birne', 'honig', 'mango', 'trockenobst'],
};

/** Meat and fish, as words in ingredient names or dish titles. Plant words in front ("Sojahack") clear the doubt. */
const MEAT = ['fleisch', 'hack', 'haehnchen', 'huhn', 'huehner', 'pute', 'truthahn', 'rind', 'schwein', 'kalb', 'lamm', 'ente', 'gans', 'wild', 'hirsch', 'reh',
  'speck', 'schinken', 'salami', 'wurst', 'chorizo', 'bacon', 'pancetta', 'leber', 'gelatine', 'fisch', 'lachs', 'thunfisch', 'forelle', 'kabeljau', 'seelachs',
  'hering', 'makrele', 'sardelle', 'sardine', 'garnele', 'shrimp', 'krabbe', 'muschel', 'tintenfisch', 'calamari', 'scampi', 'anchovis', 'worcester', 'fischsosse'];
const ANIMAL = ['milch', 'joghurt', 'quark', 'skyr', 'kaese', 'sahne', 'butter', 'ei', 'eier', 'honig', 'feta', 'mozzarella', 'parmesan', 'halloumi', 'schmand',
  'ricotta', 'mascarpone', 'molke', 'whey', 'creme fraiche', 'ghee', 'omelett', 'frittata'];
const PLANT_PREFIX = ['soja', 'hafer', 'mandel', 'kokos', 'erdnuss', 'cashew', 'vegan', 'pflanz', 'erbsen', 'reis', 'dinkel', 'veggie', 'tofu', 'kakao', 'nuss', 'hefe', 'sonnenblumen'];
/** Words that merely contain a listed one. */
const HARMLESS = ['gehackt', 'clementine', 'studentenfutter', 'wildkraeuter', 'wildreis', 'butterbohne', 'reiswaffel', 'eiweiss', 'zwiebel', 'eisberg', 'weizen', 'leinsamen', 'feldsalat', 'bunte', 'rindensalat'];

const hasWord = (text: string, list: string[]): boolean => {
  for (const word of norm(text).split(' ')) {
    if (!word || HARMLESS.some((h) => word.startsWith(h))) continue;
    if (PLANT_PREFIX.some((p) => word.startsWith(p) && word !== p)) continue;
    if (list.some((x) => (x.length <= 3 ? word === x : word.includes(x)))) return true;
  }
  return false;
};

/** The strictest diet among the people eating. */
export const strictest = (diets: Diet[]): Diet => (diets.includes('vegan') ? 'vegan' : diets.includes('vegetarisch') ? 'vegetarisch' : 'alles');

export function fitsDiet(dish: Pick<Dish, 'title' | 'ingredients'>, diet: Diet): boolean {
  if (diet === 'alles') return true;
  const texts = [dish.title, ...dish.ingredients.map((i) => i.name)];
  if (texts.some((t) => hasWord(t, MEAT))) return false;
  if (diet === 'vegan' && texts.some((t) => hasWord(t, ANIMAL))) return false;
  return true;
}

/** True when the dish touches nothing in `dislikes` or `intolerances`. Titles and steps count; a raw-only dislike counts for raw ingredients. */
export function fitsDislikes(dish: Pick<Dish, 'title' | 'ingredients'> & { steps?: string[] }, settings: Pick<MealSettings, 'dislikes' | 'intolerances'>): boolean {
  const title = [dish.title, ...(dish.steps ?? [])].map(norm).join(' | ');
  const ingredients = dish.ingredients.map((i) => ({ text: norm(i.name), raw: i.raw === true }));
  const rules: Rule[] = [];
  for (const d of settings.dislikes) { const r = ruleOf(d); if (r) rules.push(r); }
  for (const t of settings.intolerances) {
    const key = norm(t).split(' ').filter((w) => !FILLER.has(w)).join(' ');
    const mapped = INTOLERANCE_WORDS[key] ?? INTOLERANCE_WORDS[key.replace(/(un)?vertraeglichkeit|allergie|intoleranz/g, '').trim()];
    if (mapped) for (const w of mapped) rules.push({ words: [w], rawOnly: false });
    else { const r = ruleOf(t); if (r) rules.push(r); }
  }
  for (const r of rules) {
    for (const w of r.words) {
      if (!r.rawOnly && contains(title, w)) return false;
      if (ingredients.some((i) => (!r.rawOnly || i.raw) && contains(i.text, w))) return false;
    }
  }
  return true;
}

/** Words the app never shows with food: no calories, no weight or body talk, no promises of healing. */
const PRESSURE = /kalorie|kcal|abnehm|schlank|di(ae|ä)t|figur|detox|entgift|fettverbrenn|fatburn|heilt|heilend|heilung|gewicht verlier|bauchfett|sünde|suende|cheat/i;
export const calmText = (text: string): boolean => !PRESSURE.test(text);

export type Eater = Pick<MealSettings, 'diet' | 'dislikes' | 'intolerances'>;
/** Everything a dish must pass for the people eating it. */
export const fitsEveryone = (dish: Pick<Dish, 'title' | 'ingredients' | 'steps'> & { side?: Pick<NonNullable<Dish['side']>, 'name'> }, eaters: Eater[]): boolean => {
  // A protein side is part of the meal: it has to fit the same people.
  const whole = dish.side ? { ...dish, ingredients: [...dish.ingredients, { name: dish.side.name, amount: 0, unit: 'g' as const, section: 'Vorrat' as const }] } : dish;
  return fitsDiet(whole, strictest(eaters.map((e) => e.diet))) && eaters.every((e) => fitsDislikes(whole, e)) && [whole.title, ...whole.steps, ...whole.ingredients.map((i) => i.name)].every(calmText);
};
