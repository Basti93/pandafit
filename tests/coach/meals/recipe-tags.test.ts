import { describe, expect, it } from 'vitest';
import { canonicalIngredient, facetOf, hardTags, labelOf, mergeTags, readTagAnswer, saisonOf, slotsFrom, tagInputHash, vocabIds } from '../../../src/coach/meals/recipe-tags';
import { ftsQuery } from '../../../src/coach/meals/recipe-search';

const ing = (name: string, amount = 100, unit: 'g' | 'Stk' = 'g') => ({ name, amount, unit, section: 'Vorrat' as const });

describe('the vocabulary', () => {
  it('has the agreed facets with stable ids and German labels', () => {
    expect(vocabIds('mahlzeit')).toEqual(['fruehstueck', 'mittag', 'abend', 'snack', 'dessert', 'backen', 'getraenk']);
    expect(vocabIds('art')).toHaveLength(13);
    expect(vocabIds('kueche')).toEqual(['deutsch', 'italienisch', 'mediterran', 'orientalisch', 'indisch', 'asiatisch', 'mexikanisch', 'international']);
    expect(vocabIds('eiweiss')).toEqual(['huelsenfruechte', 'tofu-tempeh', 'seitan', 'ei', 'milchprodukte-kaese', 'nuesse-samen', 'wenig']);
    expect(vocabIds('ernaehrung')).toEqual(['vegetarisch', 'vegan']);
    expect(vocabIds('saison')).toEqual(['fruehling', 'sommer', 'herbst', 'winter', 'ganzjaehrig']);
    expect(labelOf('art', 'ofen-auflauf')).toBe('Ofen und Auflauf');
    expect(facetOf('vegan')).toBe('ernaehrung');
    expect(facetOf('sonstiges')).toBe('art');
  });
});

describe('rules for the hard facts', () => {
  it('derives the numeric properties and the diet', () => {
    const h = hardTags({ minutes: 15, proteinG: 31, keepsDays: 2, vegan: false, ingredients: [ing('Reis')] });
    expect(h).toMatchObject({ ernaehrung: ['vegetarisch'], eigenschaft: ['proteinreich', 'schnell', 'meal-prep'], saison: ['ganzjaehrig'] });
    expect(hardTags({ minutes: 40, proteinG: null, keepsDays: 0, vegan: true, ingredients: [] })).toMatchObject({ ernaehrung: ['vegetarisch', 'vegan'], eigenschaft: [] });
    expect(hardTags({ minutes: 20, proteinG: 24, keepsDays: 1, vegan: true, ingredients: [] }).eigenschaft).toEqual(['schnell']);
  });
  it('derives the season from the ingredients: none or many is all year', () => {
    expect(saisonOf([ing('Spargel'), ing('Kartoffeln')])).toEqual(['fruehling']);
    expect(saisonOf([ing('Kürbis'), ing('Grünkohl')])).toEqual(['herbst', 'winter']);
    expect(saisonOf([ing('Spargel'), ing('Zucchini'), ing('Kürbis')])).toEqual(['ganzjaehrig']);
    expect(saisonOf([ing('Paprikapulver'), ing('Reis')])).toEqual(['ganzjaehrig']);
  });
  it('lets the rules win over the AI in the merge', () => {
    const t = mergeTags({ mahlzeit: ['mittag'], art: 'pasta', kueche: null, eiweiss: 'ei', soft: ['schnell', 'vegan', 'eine-pfanne'] }, hardTags({ minutes: 50, proteinG: 5, keepsDays: 0, vegan: false, ingredients: [] }));
    expect(t.eigenschaft).toEqual(['eine-pfanne']);
    expect(t.ernaehrung).toEqual(['vegetarisch']);
  });
  it('maps meals to planning slots', () => {
    expect(slotsFrom(['abend', 'snack', 'mittag'])).toEqual(['abend', 'mittag']);
    expect(slotsFrom(['dessert'])).toEqual([]);
  });
});

describe('canonical ingredient names', () => {
  it.each([
    ['Paradeiser', 'tomate'], ['Tomaten', 'tomate'], ['Kichererbsen (Dose)', 'kichererbse'], ['rote Linsen', 'linse'], ['Zwiebeln', 'zwiebel'],
    ['Kartoffeln', 'kartoffel'], ['Eier', 'ei'], ['Möhren', 'karotte'], ['Lauchzwiebeln', 'fruehlingszwiebel'], ['Champignons', 'pilz'], ['frischer Spinat', 'spinat'],
    ['Zucchinis', 'zucchini'], ['Nudeln', 'nudel'], ['Schlagsahne', 'sahne'], ['Haferflocken', 'haferflocke'], ['Mandelmus', 'mandelmus'],
  ])('%s -> %s', (a, b) => { expect(canonicalIngredient(a)).toBe(b); });
});

describe('reading the AI answer', () => {
  const ok = { id: 'a', mahlzeit: ['mittag'], art: 'pasta', kueche: 'italienisch', eiweiss: 'ei', eigenschaft: ['eine-pfanne'] };
  it('keeps a complete valid classification', () => {
    expect(readTagAnswer({ rezepte: [ok] }, ['a']).get('a')).toEqual({ mahlzeit: ['mittag'], art: 'pasta', kueche: 'italienisch', eiweiss: 'ei', soft: ['eine-pfanne'] });
  });
  it('drops unknown ids, ids that were not asked, and soft ids that are rule ids', () => {
    const got = readTagAnswer({ rezepte: [{ ...ok, kueche: 'mars', eigenschaft: ['eine-pfanne', 'schnell', 'x'], mahlzeit: ['mittag', 'x'] }, { ...ok, id: 'zzz' }] }, ['a']);
    expect(got.size).toBe(1);
    expect(got.get('a')).toMatchObject({ kueche: null, soft: ['eine-pfanne'], mahlzeit: ['mittag'] });
  });
  it('leaves out a recipe missing a required facet, and rubbish', () => {
    expect(readTagAnswer({ rezepte: [{ ...ok, art: null }] }, ['a']).size).toBe(0);
    expect(readTagAnswer({ rezepte: [{ ...ok, eiweiss: 'x' }] }, ['a']).size).toBe(0);
    expect(readTagAnswer({ rezepte: [{ ...ok, mahlzeit: [] }] }, ['a']).size).toBe(0);
    expect(readTagAnswer('nein', ['a']).size).toBe(0);
  });
  it('hashes the input, so the same input is the same key', () => {
    const i = { id: 'a', title: 't', ingredients: ['x 1 g'], steps: [], category: [], keywords: [] };
    expect(tagInputHash(i)).toBe(tagInputHash({ ...i }));
    expect(tagInputHash(i)).not.toBe(tagInputHash({ ...i, title: 'u' }));
  });
});

describe('the search query', () => {
  it('turns free text into prefix alternatives of the word and its ingredient name', () => {
    expect(ftsQuery('hab Kichererbsen und Spinat')).toBe('("kichererbsen"* OR "kichererbse"*) AND ("spinat"*)');
    expect(ftsQuery('und mit')).toBeNull();
  });
});
