import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importRecipe } from '../../../src/coach/meals/recipe-import';
import { parseNutrition, unhealthyReason } from '../../../src/coach/meals/recipe-health';
import { shortlist, type Need } from '../../../src/coach/meals/recipe-plan';
import { RecipeStore, OWN_OWNER } from '../../../src/coach/meals/recipe-store';
import { policyRule } from '../../../src/shared/training-policy';
import { DEFAULT_MEAL_SETTINGS } from '../../../src/shared/meals';
import { taggingAi } from './fake-ai';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'healthy-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const recipe = (n: number, over: Record<string, unknown> = {}) => ({
  '@type': 'Recipe', name: `Erfundener Topf ${n}`, recipeYield: '2', recipeIngredient: [`${100 + n} g Linsen`, '1 Zwiebel', '1 EL Öl', `${n} Karotten`], recipeInstructions: ['Alles kochen.'], ...over,
});
const url = (n: number) => `https://rezepte.example/gesund-${n}`;
const tag = async (s: RecipeStore, n: number, over: Record<string, unknown>, ai = taggingAi(), source: 'collection' | 'link' = 'collection', owner?: string) => {
  const out = await s.add({ source, ...(owner ? { owner } : {}), url: url(n), recipe: recipe(n, over) });
  if (out.status === 'saved') await s.tagIds([out.recipe.id], ai);
  return out;
};
const GOOD = { calories: '520 kcal', proteinContent: '28 g', fatContent: '18 g', carbohydrateContent: '60 g', sugarContent: '8 g', fiberContent: '12 g' };
const withPromptVersion = async (f: () => Promise<void>) => {
  const was = policyRule('meals.tag-ai').values!.tagPromptVersion!;
  (policyRule('meals.tag-ai').values as Record<string, number>).tagPromptVersion = was + 1;
  try { await f(); } finally { (policyRule('meals.tag-ai').values as Record<string, number>).tagPromptVersion = was; }
};

describe('reading the nutrition per portion', () => {
  it('reads kcal, protein, fat, carbohydrates, sugar and fibre', () => {
    expect(parseNutrition(GOOD)).toEqual({ kcal: 520, proteinG: 28, fatG: 18, carbsG: 60, sugarG: 8, fiberG: 12 });
    expect(parseNutrition({ calories: '2092 kJ', proteinContent: '12,5 g' })).toEqual({ kcal: 500, proteinG: 12.5 });
    expect(parseNutrition({ calories: 410, proteinContent: 20 })).toEqual({ kcal: 410, proteinG: 20 });
  });
  it('respects the serving size: "1 Portion" is per portion, "4 Portionen" is divided, a weight is per portion', () => {
    expect(parseNutrition({ ...GOOD, servingSize: '1 Portion' })!.kcal).toBe(520);
    expect(parseNutrition({ calories: '2000 kcal', proteinContent: '80 g', servingSize: '4 Portionen' })).toEqual({ kcal: 500, proteinG: 20 });
    expect(parseNutrition({ calories: '520 kcal', servingSize: '350 g' })!.kcal).toBe(520);
  });
  it('ignores rubbish and units it cannot trust', () => {
    expect(parseNutrition('viel')).toBeNull();
    expect(parseNutrition({ calories: 'k.A.', proteinContent: '' })).toBeNull();
    expect(parseNutrition({ proteinContent: '900 mg', sugarContent: '700 g' })).toBeNull();
  });
  it('stores it with the recipe and prefers the stated protein over the estimate', async () => {
    const r = await importRecipe(recipe(1, { nutrition: { ...GOOD, proteinContent: '31 g' } }));
    expect(r.status === 'ok' && r.recipe.nutrition).toMatchObject({ kcal: 520, proteinG: 31, sugarG: 8 });
    expect(r.status === 'ok' && r.recipe.proteinG).toBe(31);
    const none = await importRecipe(recipe(2));
    expect(none.status === 'ok' && none.recipe.nutrition).toBeUndefined();
  });
});

describe('the healthy gate (rule meals.healthy-gate)', () => {
  const ok = { slots: ['mittag'] as const, ausgewogen: 'gut' as const };
  it('keeps every threshold in the register, with sources', () => {
    const rule = policyRule('meals.healthy-gate');
    expect(rule.values).toMatchObject({ mainKcalMin: 300, mainKcalMax: 850, mainProteinMin: 15, breakfastKcalMin: 200, breakfastKcalMax: 650, breakfastProteinMin: 10, sugarMaxG: 30, fatShareMax: 0.5 });
    expect(rule.class).toBe('orientation');
    expect(rule.sourceIds.length).toBeGreaterThan(0);
  });
  it('rejects no main meal slot and ausgewogen wenig', () => {
    expect(unhealthyReason({ ...ok, slots: [] })).not.toBeNull();
    expect(unhealthyReason({ ...ok, ausgewogen: 'wenig' })).not.toBeNull();
    expect(unhealthyReason({ ...ok, ausgewogen: 'mittel' })).toBeNull();
    expect(unhealthyReason({ slots: ['abend'] })).toBeNull();
  });
  it('checks main meals: 300 to 850 kcal and 15 g protein', () => {
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 520, proteinG: 28 } })).toBeNull();
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 299 } })).not.toBeNull();
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 300, proteinG: 15 } })).toBeNull();
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 851 } })).not.toBeNull();
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 600, proteinG: 14 } })).not.toBeNull();
  });
  it('checks breakfast: 200 to 650 kcal and 10 g protein; a recipe for several meals passes when one fits', () => {
    expect(unhealthyReason({ slots: ['fruehstueck'], nutrition: { kcal: 250, proteinG: 10 } })).toBeNull();
    expect(unhealthyReason({ slots: ['fruehstueck'], nutrition: { kcal: 660 } })).not.toBeNull();
    expect(unhealthyReason({ slots: ['fruehstueck'], nutrition: { kcal: 250, proteinG: 9 } })).not.toBeNull();
    expect(unhealthyReason({ slots: ['fruehstueck', 'mittag'], nutrition: { kcal: 250, proteinG: 12 } })).toBeNull();
    expect(unhealthyReason({ slots: ['fruehstueck', 'mittag'], nutrition: { kcal: 250, proteinG: 8 } })).not.toBeNull();
  });
  it('checks sugar (30 g) and the fat share of the energy (50 %), whichever slot', () => {
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 600, sugarG: 30 } })).toBeNull();
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 600, sugarG: 31 } })).not.toBeNull();
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 600, fatG: 33 } })).toBeNull(); // 297 of 600
    expect(unhealthyReason({ ...ok, nutrition: { kcal: 600, fatG: 34 } })).not.toBeNull(); // 306 of 600
    expect(unhealthyReason({ ...ok, nutrition: { fatG: 90 } })).toBeNull(); // no energy value: not checked
  });
});

describe('the collection keeps only healthy meals', () => {
  it('removes a collection recipe the AI calls wenig, counts it, and does not take it again', async () => {
    const s = new RecipeStore(tmp());
    expect((await tag(s, 1, {}, taggingAi(() => ({ ausgewogen: 'wenig' })))).status).toBe('saved');
    expect(s.stats()).toMatchObject({ collection: 0, untagged: 0, unhealthy: 1, rejected: 0 });
    expect(s.search({})).toEqual([]);
    const again = await s.add({ source: 'collection', url: url(1), recipe: recipe(1) });
    expect(again).toMatchObject({ status: 'rejected' });
    expect(s.stats().untagged).toBe(0);
    // A new prompt version judges it again.
    await withPromptVersion(async () => {
      expect((await s.add({ source: 'collection', url: url(1), recipe: recipe(1) })).status).toBe('saved');
    });
    s.close();
  });

  it('removes what is no meal: only snack, dessert, baking or a drink, even without art and protein source', async () => {
    const s = new RecipeStore(tmp());
    const cake = taggingAi(() => ({ mahlzeit: ['backen'], art: null as unknown as string, eiweiss: null as unknown as string, ausgewogen: 'wenig' }));
    await tag(s, 1, { name: 'Ganzer Kuchen' }, cake);
    await tag(s, 2, { name: 'Likör' }, taggingAi(() => ({ mahlzeit: ['getraenk'], ausgewogen: 'mittel' })));
    await tag(s, 3, { name: 'Gemüsepfanne' }, taggingAi(() => ({ ausgewogen: 'gut' })));
    expect(s.stats()).toMatchObject({ collection: 1, unhealthy: 2, untagged: 0 });
    expect(s.search({}).map((r) => r.title)).toEqual(['Gemüsepfanne']);
    s.close();
  });

  it('removes a recipe whose stated nutrition breaks the register gate, and keeps one that passes', async () => {
    const s = new RecipeStore(tmp());
    await tag(s, 1, { nutrition: GOOD });
    await tag(s, 2, { nutrition: { ...GOOD, calories: '1300 kcal' } });
    await tag(s, 3, { nutrition: { ...GOOD, proteinContent: '6 g' } });
    await tag(s, 4, { nutrition: { ...GOOD, sugarContent: '48 g' } });
    await tag(s, 5, { nutrition: { calories: '600 kcal', fatContent: '45 g', proteinContent: '20 g' } });
    await tag(s, 6, { nutrition: { calories: '230 kcal', proteinContent: '14 g' } }, taggingAi(() => ({ mahlzeit: ['fruehstueck'] })));
    await tag(s, 7, {});
    expect(s.search({}).map((r) => r.title).sort()).toEqual(['Erfundener Topf 1', 'Erfundener Topf 6', 'Erfundener Topf 7']);
    expect(s.stats()).toMatchObject({ collection: 3, unhealthy: 4 });
    expect(s.search({}).find((r) => r.title.endsWith('1'))!.nutrition).toMatchObject({ kcal: 520, fiberG: 12 });
    s.close();
  });

  it('keeps own and link recipes, only marking them', async () => {
    const s = new RecipeStore(tmp());
    const own = await tag(s, 1, { nutrition: { ...GOOD, sugarContent: '60 g' } }, taggingAi(), 'link', OWN_OWNER);
    const link = await tag(s, 2, {}, taggingAi(() => ({ ausgewogen: 'wenig' })), 'link', 'max');
    const fine = await tag(s, 3, {}, taggingAi(() => ({ ausgewogen: 'gut' })), 'link', 'max');
    expect([own.status, link.status, fine.status]).toEqual(['saved', 'saved', 'saved']);
    expect(s.stats()).toMatchObject({ links: 3, unhealthy: 0 });
    const all = s.search({ source: 'link' });
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.title.endsWith('1'))).toMatchObject({ ausgewogen: 'wenig', healthNote: expect.stringContaining('sugar') });
    expect(all.find((r) => r.title.endsWith('2'))).toMatchObject({ ausgewogen: 'wenig' });
    expect(all.find((r) => r.title.endsWith('3'))).toMatchObject({ ausgewogen: 'gut' });
    expect(all.find((r) => r.title.endsWith('3'))!.healthNote).toBeUndefined();
    // Never blocked from coming back either.
    expect((await s.add({ source: 'link', owner: 'max', url: url(2), recipe: recipe(2) })).status).toBe('duplicate');
    s.close();
  });

  it('an own recipe is not blocked by a removed collection page of the same address', async () => {
    const s = new RecipeStore(tmp());
    await tag(s, 1, {}, taggingAi(() => ({ ausgewogen: 'wenig' })));
    const out = await s.add({ source: 'link', owner: OWN_OWNER, url: url(1), recipe: recipe(1) });
    expect(out.status).toBe('saved');
    s.close();
  });

  it('leaves a recipe without the balance verdict untagged to be asked again', async () => {
    const s = new RecipeStore(tmp());
    const ai = (async (i: { prompt: string }) => ({ rezepte: [...i.prompt.matchAll(/"id":"([^"]+)"/g)].map((m) => ({ id: m[1], mahlzeit: ['mittag'], art: 'curry-eintopf', kueche: null, eiweiss: 'huelsenfruechte', eigenschaft: [], vegetarisch: true, grund: 'ok' })) }));
    await tag(s, 1, {}, ai as never);
    expect(s.stats()).toMatchObject({ collection: 0, untagged: 1, unhealthy: 0 });
    s.close();
  });

  it('checks existing collection rows again after a prompt version bump (the normal re-tag)', async () => {
    const s = new RecipeStore(tmp());
    await tag(s, 1, {}, taggingAi(() => ({ ausgewogen: 'gut' })));
    await tag(s, 2, {}, taggingAi(() => ({ ausgewogen: 'gut' })));
    expect(s.stats().collection).toBe(2);
    await withPromptVersion(async () => {
      const again = taggingAi((i) => (i.title.endsWith('2') ? { ausgewogen: 'wenig' } : { ausgewogen: 'mittel' }));
      expect(await s.tagWaiting(again, 1)).toBe(1);
      expect(s.search({}).map((r) => [r.title, r.ausgewogen])).toEqual([['Erfundener Topf 1', 'mittel']]);
      expect(s.stats()).toMatchObject({ collection: 1, unhealthy: 1 });
    });
    s.close();
  });

  it('derives the nutrition again from the stored source after a derive version bump', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir, () => 5);
    await tag(s, 1, { nutrition: GOOD });
    s.close();
    const s2 = new RecipeStore(dir, () => 5, { deriveVersion: 99 });
    const raw = JSON.parse((s2.database().prepare('SELECT raw FROM recipes').get() as { raw: string }).raw) as { recipe: { nutrition: Record<string, string> } };
    raw.recipe.nutrition.calories = '2000 kcal';
    raw.recipe.nutrition.proteinContent = '120 g';
    raw.recipe.nutrition.servingSize = '4 Portionen';
    s2.database().prepare('UPDATE recipes SET raw = ?').run(JSON.stringify(raw));
    expect(await s2.rederive(10)).toBe(1);
    expect(s2.search({})[0]!.nutrition).toMatchObject({ kcal: 500, proteinG: 30 });
    s2.close();
  });
});

describe('planning with the balance', () => {
  const eater = { id: 'max', settings: { ...DEFAULT_MEAL_SETTINGS, on: true } };
  const need: Need = { slot: 'mittag', day: 0, eaters: [eater], takeAlong: false, training: false, keepDays: 0 };
  const make = async (verdicts: ('gut' | 'mittel' | 'wenig')[]) => {
    const s = new RecipeStore(tmp());
    for (let i = 0; i < verdicts.length; i++) await tag(s, i + 1, {}, taggingAi(() => ({ ausgewogen: verdicts[i]! })), 'link', 'max');
    const pool = s.search({ limit: 50 });
    s.close();
    return pool;
  };

  it('prefers a recipe the AI calls gut (register weight)', async () => {
    const pool = await make(['mittel', 'gut', 'mittel']);
    // The same random draw for everyone: only the balance separates them.
    const list = shortlist(pool, need, () => 0.3);
    expect(list[0]!.ausgewogen).toBe('gut');
    expect(list).toHaveLength(3);
  });

  it('skips wenig unless it is a favourite of someone eating the meal', async () => {
    const pool = await make(['wenig', 'mittel']);
    const wenig = pool.find((r) => r.ausgewogen === 'wenig')!;
    expect(shortlist(pool, need, () => 0.3).map((r) => r.id)).not.toContain(wenig.id);
    const favs = new Map([['max', new Set([wenig.id])]]);
    expect(shortlist(pool, need, () => 0.3, undefined, undefined, favs)[0]!.id).toBe(wenig.id);
    expect(shortlist(pool, need, () => 0.3, undefined, undefined, new Map([['lena', new Set([wenig.id])]])).map((r) => r.id)).not.toContain(wenig.id);
  });

  it('shows the balance only implicitly: a gut recipe comes first in the search, nothing else changes', async () => {
    const s = new RecipeStore(tmp());
    await tag(s, 1, { aggregateRating: { ratingValue: 5, ratingCount: 30 } }, taggingAi(() => ({ ausgewogen: 'mittel' })));
    await tag(s, 2, { aggregateRating: { ratingValue: 3, ratingCount: 3 } }, taggingAi(() => ({ ausgewogen: 'gut' })));
    expect(s.search({}).map((r) => r.title)).toEqual(['Erfundener Topf 2', 'Erfundener Topf 1']);
    s.close();
  });
});
