import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planFromRecipes, shortlist, type Need } from '../../../src/coach/meals/recipe-plan';
import { proteinSides, sideCandidates } from '../../../src/coach/meals/recipe-side';
import type { Slotted } from '../../../src/coach/meals/rules';
import { RecipeStore } from '../../../src/coach/meals/recipe-store';
import { DEFAULT_MEAL_SETTINGS, EMPTY_STATE, mealKey, readMealPlan, shoppingList, type MealPlan, type MealSettings } from '../../../src/shared/meals';
import { taggingAi } from './fake-ai';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'side-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const recipe = (n: number, protein: string, over: Record<string, unknown> = {}) => ({
  '@type': 'Recipe', name: `Erfundener Topf ${n}`, recipeYield: '2', totalTime: 'PT20M', recipeIngredient: [`${100 + n} g Linsen`, '1 Zwiebel', '1 EL Öl', `${n} Karotten`], recipeInstructions: ['Alles kochen.'],
  nutrition: { calories: '480 kcal', proteinContent: protein, sugarContent: '6 g', fatContent: '16 g' }, ...over,
});
const addTagged = async (s: RecipeStore, n: number, protein: string, ausgewogen: 'gut' | 'mittel' | 'wenig' = 'mittel', source: 'collection' | 'link' = 'link') => {
  const out = await s.add({ source, ...(source === 'link' ? { owner: 'max' } : {}), url: `https://rezepte.example/seite-${n}`, recipe: recipe(n, protein) });
  if (out.status === 'saved') await s.tagIds([out.recipe.id], taggingAi(() => ({ ausgewogen })));
  return out;
};
const member = (id: string, over: Partial<MealSettings> = {}) => ({ id, settings: { ...DEFAULT_MEAL_SETTINGS, on: true, ...over } });
const slot = (day: number, s: 'mittag' | 'abend' = 'mittag'): Slotted => ({ day, slot: s, eaters: ['max'], takeAlong: false, reuseOf: null });
const run = (pool: ReturnType<RecipeStore['search']>, members: ReturnType<typeof member>[], slots: Slotted[], trainingDays: number[] = []) =>
  planFromRecipes({ members, slots, trainingDays, pool, lastIds: new Set(), random: () => 0.4, lastWeek: [], aiChoice: false });
const poolOf = (s: RecipeStore) => s.search({ limit: 50 });

describe('low protein is eiweissarm, not wenig', () => {
  it('flags the three kinds of low-protein dishes and leaves the AI verdict alone', async () => {
    const s = new RecipeStore(tmp());
    await addTagged(s, 1, '10 g', 'gut');
    await addTagged(s, 2, '10 g', 'mittel', 'collection');
    await addTagged(s, 3, '13 g', 'mittel');
    await addTagged(s, 4, '28 g', 'mittel');
    const all = poolOf(s);
    expect(all).toHaveLength(4);
    for (const n of [1, 2, 3]) expect(all.find((r) => r.title.endsWith(String(n)))).toMatchObject({ eiweissarm: true });
    expect(all.find((r) => r.title.endsWith('1'))!.ausgewogen).toBe('gut');
    expect(all.find((r) => r.title.endsWith('2'))!.ausgewogen).toBe('mittel');
    expect(all.find((r) => r.title.endsWith('4'))!.eiweissarm).toBeUndefined();
    expect(all.some((r) => r.ausgewogen === 'wenig' || r.ausserhalb)).toBe(false);
    s.close();
  });

  it('keeps 10 g for the collection and removes 9 g', async () => {
    const s = new RecipeStore(tmp());
    await addTagged(s, 1, '10 g', 'mittel', 'collection');
    await addTagged(s, 2, '9 g', 'mittel', 'collection');
    expect(poolOf(s).map((r) => r.title)).toEqual(['Erfundener Topf 1']);
    expect(s.stats()).toMatchObject({ collection: 1, unhealthy: 1 });
    s.close();
  });

  it('a nutrition-based out-of-range value is a separate flag, not wenig', async () => {
    const s = new RecipeStore(tmp());
    const out = await s.add({ source: 'link', owner: 'max', url: 'https://rezepte.example/x', recipe: recipe(1, '20 g', { nutrition: { calories: '500 kcal', proteinContent: '20 g', sugarContent: '60 g' } }) });
    if (out.status === 'saved') await s.tagIds([out.recipe.id], taggingAi());
    expect(poolOf(s)[0]).toMatchObject({ ausserhalb: true, healthNote: expect.stringContaining('sugar'), ausgewogen: 'mittel' });
    s.close();
  });

  it('re-deriving clears a nutrition-based wenig and keeps the AI wenig', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir, () => 5, { deriveVersion: 2 });
    await addTagged(s, 1, '10 g', 'mittel');
    await addTagged(s, 2, '28 g', 'wenig');
    // As the old code left it: wenig only because of the nutrition.
    const db = s.database();
    const row = db.prepare("SELECT id, json FROM recipes WHERE title LIKE '%1'").get() as { id: string; json: string };
    db.prepare('UPDATE recipes SET json = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.json), ausgewogen: 'wenig', healthNote: 'energy or protein out of range', eiweissarm: undefined }), row.id);
    db.prepare('UPDATE recipes SET derive_version = 2').run();
    s.close();
    const s2 = new RecipeStore(dir, () => 5, { deriveVersion: 3 });
    expect(await s2.rederive(10)).toBe(2);
    const all = poolOf(s2);
    expect(all.find((r) => r.title.endsWith('1'))).toMatchObject({ ausgewogen: 'mittel', eiweissarm: true });
    expect(all.find((r) => r.title.endsWith('1'))!.healthNote).toBeUndefined();
    expect(all.find((r) => r.title.endsWith('2'))!.ausgewogen).toBe('wenig');
    s2.close();
  });
});

describe('the protein side', () => {
  const setup = async (protein = '10 g') => { const s = new RecipeStore(tmp()); await addTagged(s, 1, protein); const pool = poolOf(s); s.close(); return pool; };

  it('keeps a short vegetarian list in the register', () => {
    const names = proteinSides().map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Skyr', 'Hüttenkäse', 'Tofu natur', 'Edamame', 'Kichererbsen', 'Eier']));
    expect(sideCandidates(28, 'mittag', [])).toBeNull();
  });

  it('adds a side that reaches the target, shows it on the meal and puts it on the shopping list', async () => {
    const pool = await setup();
    const [meal] = await run(pool, [member('max')], [slot(1)]);
    const side = meal!.dish.side!;
    expect(side).toBeDefined();
    expect(meal!.dish.proteinG + side.proteinG).toBeGreaterThanOrEqual(20);
    const plan: MealPlan = { week: '2026-11-09', createdMs: 0, source: 'liste', people: [{ id: 'max', name: 'Max' }], meals: [meal!], trainingDays: [] };
    const names = shoppingList(plan, EMPTY_STATE).sections.flatMap((x) => x.items.map((i) => i.name));
    expect(names).toContain(side.name);
    // The side survives the record round trip.
    expect(readMealPlan(JSON.parse(JSON.stringify(plan)))!.meals[0]!.dish.side).toEqual(side);
  });

  it('gives a vegan eater a vegan side', async () => {
    const pool = await setup();
    for (const r of [0.0, 0.3, 0.6, 0.99]) {
      const [meal] = await planFromRecipes({ members: [member('max', { diet: 'vegan' })], slots: [slot(1)], trainingDays: [], pool, lastIds: new Set(), random: () => r, lastWeek: [], aiChoice: false });
      expect(['Tofu natur', 'Edamame', 'Kichererbsen']).toContain(meal!.dish.side!.name);
    }
  });

  it('respects dislikes and intolerances', async () => {
    const pool = await setup();
    const [meal] = await run(pool, [member('max', { dislikes: ['Skyr', 'Tofu'], intolerances: ['Laktose'] })], [slot(1)]);
    expect(['Edamame', 'Eier']).toContain(meal!.dish.side!.name);
    const [none] = await run(pool, [member('max', { dislikes: ['Skyr', 'Tofu', 'Edamame', 'Eier', 'Kichererbsen'], intolerances: ['Laktose'] })], [slot(1)]);
    expect(none!.dish.side).toBeUndefined();
  });

  it('with no fitting side, the dish stays off training days', async () => {
    const pool = await setup();
    const noSide = member('max', { dislikes: ['Skyr', 'Quark', 'Hüttenkäse', 'Eier', 'Tofu', 'Edamame', 'Kichererbsen'] });
    const meals = await run(pool, [noSide], [slot(0), slot(1)], [0]);
    expect(meals.map((m) => mealKey(m.day, m.slot))).toEqual(['1-mittag']);
    const need: Need = { slot: 'mittag', day: 0, eaters: [noSide], takeAlong: false, training: true, keepDays: 0 };
    expect(shortlist(pool, need, () => 0.3)).toEqual([]);
    // With a side available the same dish may be planned on a training day.
    const withSide = await run(pool, [member('max')], [slot(0)], [0]);
    expect(withSide[0]!.dish.side).toBeDefined();
  });
});

describe('treats once a week', () => {
  it('plans an AI wenig dish at most once a week, even as a favourite', async () => {
    const s = new RecipeStore(tmp());
    for (let n = 1; n <= 5; n++) await addTagged(s, n, '28 g', 'wenig');
    for (let n = 6; n <= 10; n++) await addTagged(s, n, '28 g', 'mittel');
    const pool = poolOf(s);
    s.close();
    const favourites = new Map([['max', new Set(pool.filter((r) => r.ausgewogen === 'wenig').map((r) => r.id))]]);
    const meals = await planFromRecipes({ members: [member('max')], slots: [0, 1, 2, 3, 4].map((d) => slot(d)), trainingDays: [], pool, lastIds: new Set(), random: () => 0.4, lastWeek: [], aiChoice: false, favourites });
    const byId = new Map(pool.map((r) => [r.id, r]));
    const treats = meals.filter((m) => byId.get(m.dish.recipeId!)!.ausgewogen === 'wenig');
    expect(meals).toHaveLength(5);
    expect(treats).toHaveLength(1);
    // Days already planned count toward the week.
    const more = await planFromRecipes({ members: [member('max')], slots: [slot(5), slot(6)], trainingDays: [], pool, lastIds: new Set(), random: () => 0.4, lastWeek: [], aiChoice: false, favourites, treatsInWeek: 1 });
    expect(more.every((m) => byId.get(m.dish.recipeId!)!.ausgewogen !== 'wenig')).toBe(true);
  });
});
