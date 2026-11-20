import { describe, expect, it } from 'vitest';
import { buildMealPrompt, buildSwapPrompt } from '../../../src/coach/meals/prompt';
import type { StoredRecipe } from '../../../src/coach/meals/recipe-import';
import { shortlist, type Need } from '../../../src/coach/meals/recipe-plan';
import { DEFAULT_MEAL_SETTINGS, type Ingredient } from '../../../src/shared/meals';

const eater = { id: 'max', settings: { ...DEFAULT_MEAL_SETTINGS, on: true, diet: 'alles' as const } };
const ing = (name: string): Ingredient => ({ name, amount: 100, unit: 'g', section: 'Obst und Gemüse' });
const rec = (id: string, names: string[]): StoredRecipe => ({
  id, title: `Gericht ${id}`, slots: ['mittag'], minutes: 20, keepsDays: 2, proteinG: 30, ingredients: names.map(ing), steps: ['Kochen.'],
} as unknown as StoredRecipe);
const need = (month?: number): Need => ({ slot: 'mittag', day: 0, eaters: [eater], takeAlong: false, training: false, keepDays: 0, ...(month ? { avail: { month, store: 'supermarkt' as const } } : {}) });

describe('Saison in der Rezeptauswahl und im Prompt', () => {
  const pool = [rec('a', ['Spargel']), rec('b', ['Kürbis']), rec('c', ['Kartoffeln'])];
  it('bietet kein Rezept außer Saison an, wenn Alternativen da sind', () => {
    expect(shortlist(pool, need(11), () => 0.3).map((r) => r.id).sort()).toEqual(['b', 'c']);
  });
  it('bietet sonst alles an', () => {
    expect(shortlist([pool[0]!], need(11), () => 0.3).map((r) => r.id)).toEqual(['a']);
  });
  it('ohne Angabe bleibt die Auswahl wie bisher', () => {
    expect(shortlist(pool, need(), () => 0.3)).toHaveLength(3);
  });
  it('sagt der KI den Monat und die Zutaten ohne Saison', () => {
    const slots = [{ day: 0, slot: 'mittag' as const, eaters: ['max'], takeAlong: false, reuseOf: null }];
    const p = buildMealPrompt({ members: [eater], slots, trainingDays: [], lastWeek: [], avail: { month: 11, store: 'supermarkt' } });
    expect(p).toContain('Aktueller Monat: November.');
    expect(p).toContain('Saison');
    expect(p).toMatch(/ausser-saison-nur-daten[\s\S]*Spargel/);
    expect(buildMealPrompt({ members: [eater], slots, trainingDays: [], lastWeek: [] })).not.toContain('Aktueller Monat');
    expect(buildSwapPrompt({ members: [eater], slot: slots[0]!, training: false, avoid: [], avail: { month: 11, store: 'supermarkt' } })).toContain('Aktueller Monat: November.');
  });
});

describe('Discounter in der Rezeptauswahl und im Prompt', () => {
  const dis = (month = 7): Need => ({ ...need(), avail: { month, store: 'discounter' } });
  const sup = (month = 7): Need => ({ ...need(), avail: { month, store: 'supermarkt' } });
  const pool = [rec('a', ['Shiitake', 'Reis']), rec('b', ['Champignons', 'Reis']), rec('c', ['Harissa'])];
  it('meidet beim Discounter seltene Zutaten, wenn es Alternativen gibt', () => {
    expect(shortlist(pool, dis(), () => 0.3).map((r) => r.id)).toEqual(['b']);
  });
  it('lässt sie zu, wenn nichts anderes passt', () => {
    expect(shortlist([pool[0]!, pool[2]!], dis(), () => 0.3)).toHaveLength(2);
  });
  it('beschränkt Supermarkt und Bioladen nicht', () => {
    expect(shortlist(pool, sup(), () => 0.3)).toHaveLength(3);
    expect(shortlist(pool, { ...need(), avail: { month: 7, store: 'bioladen' } }, () => 0.3)).toHaveLength(3);
  });
  it('sagt der KI beim Discounter, was es dort selten gibt', () => {
    const slots = [{ day: 0, slot: 'mittag' as const, eaters: ['max'], takeAlong: false, reuseOf: null }];
    const p = buildMealPrompt({ members: [eater], slots, trainingDays: [], lastWeek: [], avail: { month: 7, store: 'discounter' } });
    expect(p).toMatch(/nicht-beim-discounter-nur-daten[\s\S]*Shiitake/);
    expect(p).toContain('beim Discounter');
    expect(buildMealPrompt({ members: [eater], slots, trainingDays: [], lastWeek: [], avail: { month: 7, store: 'supermarkt' } })).not.toContain('Discounter');
  });
});
