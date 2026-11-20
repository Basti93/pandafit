import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../src/coach/meals/recipes';
import { pickRecipe } from '../../src/coach/meals/rules';
import { monthOf, outOfSeasonNames, preferAvailable, rareSubstitute, seasonProblem, shopHint } from '../../src/shared/availability';
import { DEFAULT_MEAL_SETTINGS } from '../../src/shared/meals';
import { policyRule } from '../../src/shared/training-policy';

describe('Saison frischer Zutaten', () => {
  it('lässt ganzjährig erhältliches Gemüse im Winter zu, nur hart saisonale Zutaten fallen weg', () => {
    for (const name of ['Tomate', 'Gurke', 'Rote Paprika', 'Zucchini', 'Brokkoli']) expect(seasonProblem(name, 'Obst und Gemüse', 11)).toBe(false);
    expect(seasonProblem('Spargel', 'Obst und Gemüse', 1)).toBe(true);
  });
  it('erkennt Zutaten außerhalb ihrer Freilandzeit über den Schlüsselnamen', () => {
    expect(seasonProblem('Spargel', 'Obst und Gemüse', 11)).toBe(true);
    expect(seasonProblem('grüner Spargel', 'Obst und Gemüse', 5)).toBe(false);
    expect(seasonProblem('Erdbeeren', 'Obst und Gemüse', 12)).toBe(true);
    expect(seasonProblem('Erdbeeren', 'Obst und Gemüse', 6)).toBe(false);
  });
  it('kennt Zeiten über den Jahreswechsel', () => {
    expect(seasonProblem('Grünkohl', 'Obst und Gemüse', 1)).toBe(false);
    expect(seasonProblem('Grünkohl', 'Obst und Gemüse', 7)).toBe(true);
    expect(seasonProblem('Kürbis', 'Obst und Gemüse', 11)).toBe(false);
    expect(seasonProblem('Kürbis', 'Obst und Gemüse', 3)).toBe(true);
  });
  it('lässt Lagerware und Importware ganzjährig zu', () => {
    for (const n of ['Kartoffeln', 'Zwiebeln', 'Karotten', 'Äpfel', 'Weißkohl', 'Bananen', 'Zitronen', 'Avocado']) {
      for (let m = 1; m <= 12; m++) expect(seasonProblem(n, 'Obst und Gemüse', m)).toBe(false);
    }
  });
  it('gilt nur für frische Ware, nicht für Dosen, Tiefkühl oder Gewürze', () => {
    expect(seasonProblem('Spargel', 'Tiefkühl', 11)).toBe(false);
    expect(seasonProblem('Kürbiskerne', 'Obst und Gemüse', 3)).toBe(false);
    expect(seasonProblem('Unbekanntes Gemüse', 'Obst und Gemüse', 3)).toBe(false);
  });
  it('listet die Namen, die im Monat keine Saison haben', () => {
    expect(outOfSeasonNames(11)).toContain('Spargel');
    expect(outOfSeasonNames(11)).not.toContain('Kürbis');
  });
  it('liest den Monat aus der Zeit', () => {
    expect(monthOf(new Date(2026, 10, 20, 12).getTime())).toBe(11);
  });
});

describe('Saison im Plan', () => {
  const av = (month: number) => ({ month, store: 'supermarkt' as const });
  const member = { id: 'max', settings: { ...DEFAULT_MEAL_SETTINGS, on: true } };
  const lines = (names: string[]) => names.map((name) => ({ name, section: 'Obst und Gemüse' as const }));

  it('hat eine allgemeine Regel mit Wert und Fundort', () => {
    const rule = policyRule('meals.season-preference');
    expect(rule.value).toBe(0);
    expect(rule.where.length).toBeGreaterThan(0);
  });
  it('nimmt Rezepte ohne Zutaten außer Saison, wenn es welche gibt', () => {
    const items = [{ id: 'a', z: ['Spargel'] }, { id: 'b', z: ['Kürbis'] }];
    expect(preferAvailable(items, (i) => lines(i.z), av(11)).map((i) => i.id)).toEqual(['b']);
  });
  it('lässt alles zu, wenn nichts passt', () => {
    const items = [{ id: 'a', z: ['Spargel'] }, { id: 'b', z: ['Erdbeeren'] }];
    expect(preferAvailable(items, (i) => lines(i.z), av(11))).toHaveLength(2);
  });
  it('ohne Angabe ändert sich nichts', () => {
    expect(preferAvailable([1, 2], () => lines(['Spargel']))).toEqual([1, 2]);
  });
  it('pickRecipe wählt kein Rezept außer Saison, solange eine Alternative passt', () => {
    const base = { slot: 'abend' as const, eaters: [member], takeAlong: false, training: false, keepDays: 0, used: new Set<string>() };
    for (const month of [1, 11]) {
      const clean = RECIPES.filter((r) => r.slots.includes('abend') && !r.ingredients.some((i) => seasonProblem(i.name, i.section, month)));
      expect(clean.length).toBeGreaterThan(0);
      for (let n = 0; n < 20; n++) {
        const r = pickRecipe({ ...base, random: () => (n * 0.137) % 1, avail: av(month) })!;
        expect(r.ingredients.some((i) => seasonProblem(i.name, i.section, month))).toBe(false);
      }
    }
  });
});

describe('Discounter-Sortiment', () => {
  it('nennt ein übliches Ersatzprodukt, nur beim Discounter', () => {
    expect(rareSubstitute('Austernpilze', 'discounter')).toBe('braune Champignons');
    expect(rareSubstitute('Rote-Linsen-Nudeln', 'discounter')).toBe('Vollkornnudeln');
    expect(rareSubstitute('rote Linsen Nudeln', 'discounter')).toBe('Vollkornnudeln');
    expect(rareSubstitute('Austernpilze', 'supermarkt')).toBeNull();
    expect(rareSubstitute('Austernpilze', 'bioladen')).toBeNull();
    expect(rareSubstitute('Champignons', 'discounter')).toBeNull();
  });
  it('hat eine allgemeine Regel mit Wert und Fundort', () => {
    const rule = policyRule('meals.discounter-range');
    expect(rule.value).toBe(0);
    expect(rule.where.length).toBeGreaterThan(0);
  });
  it('pickRecipe meidet beim Discounter seltene Zutaten', () => {
    const member = { id: 'max', settings: { ...DEFAULT_MEAL_SETTINGS, on: true } };
    const r = pickRecipe({ slot: 'abend', eaters: [member], takeAlong: false, training: false, keepDays: 0, used: new Set(), random: () => 0.4, avail: { month: 7, store: 'discounter' } })!;
    expect(r.ingredients.some((i) => rareSubstitute(i.name, 'discounter') !== null)).toBe(false);
  });
});

describe('Hinweis auf der Einkaufsliste', () => {
  const av = (store: 'discounter' | 'supermarkt', month: number) => ({ month, store });
  it('nennt beim Discounter den Ersatz', () => {
    expect(shopHint('Austernpilze', 'Obst und Gemüse', av('discounter', 7))).toBe('Gibt es beim Discounter selten. Ersatz: braune Champignons.');
  });
  it('sagt bei fehlender Saison, dass es keine hat', () => {
    expect(shopHint('Spargel', 'Obst und Gemüse', av('supermarkt', 11))).toBe('Hat gerade keine Saison.');
  });
  it('schweigt, wenn alles passt', () => {
    expect(shopHint('Kartoffeln', 'Obst und Gemüse', av('discounter', 11))).toBeNull();
    expect(shopHint('Austernpilze', 'Obst und Gemüse', av('supermarkt', 7))).toBeNull();
  });
});
