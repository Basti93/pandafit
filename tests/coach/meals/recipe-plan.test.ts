import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MealCoach } from '../../../src/coach/meals/meal-coach';
import type { Page } from '../../../src/coach/meals/recipe-link';
import { RecordStore } from '../../../src/coach/tracking/store';
import { readLinkRequest, type MealSettings } from '../../../src/shared/meals';
import { policyRule } from '../../../src/shared/training-policy';
import type { TrackedRecord } from '../../../src/shared/records';
import { taggingAi } from './fake-ai';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rplan-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const PEOPLE = [{ id: 'max', name: 'Max' }, { id: 'lena', name: 'Lena' }];
const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime(); // 7 Nov 2026 is a Saturday
const ON = (over: Partial<MealSettings> = {}): MealSettings => ({ on: true, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'mitnehmen', abend: 'zuhause' }, ...over });
const week = '2026-11-09';

const recipe = (n: number, over: Record<string, unknown> = {}) => ({
  '@type': 'Recipe', name: `Erfundene Pfanne ${n}`, recipeYield: '2', totalTime: 'PT15M',
  recipeIngredient: [`${100 + n} g Linsen`, '1 Zwiebel', '1 EL Öl', `${n} Karotten`], recipeInstructions: ['Alles braten.'], nutrition: { proteinContent: '28 g' }, ...over,
});

const setup = (o: { ask?: (i: { prompt: string }) => Promise<unknown>; fetchPage?: (url: string) => Promise<Page>; linked?: string[]; now?: () => number; noRecipes?: boolean } = {}) => {
  const dir = tmp();
  let r = 0;
  const store = new RecordStore({ dir: path.join(dir, 'tracking') });
  const ask = o.ask ? vi.fn(o.ask) : undefined;
  const clock = { now: at(7, 6) };
  const coach = new MealCoach({
    dir: path.join(dir, 'meals'), ...(o.noRecipes ? {} : { recipesDir: path.join(dir, 'recipes') }), nowMs: o.now ?? (() => clock.now), profiles: () => PEOPLE, noOpenRide: () => true, ask,
    ...(o.fetchPage ? { fetchPage: o.fetchPage } : {}), store, linked: (id) => (o.linked ?? []).includes(id), trainingDays: () => [0, 2], random: () => ((r = (r * 9301 + 49297) % 233280) / 233280),
  });
  coach.setSettings('max', ON());
  coach.setSettings('lena', ON());
  return { coach, store, ask, dir, clock };
};

/** Tagged recipes in the collection and as link recipes, built with a fake classifier. */
const fill = async (coach: MealCoach, n: number, source: 'collection' | 'link' = 'collection', over: (i: number) => Record<string, unknown> = () => ({})) => {
  const s = coach.recipes()!;
  const ai = taggingAi(() => ({ mahlzeit: ['fruehstueck', 'mittag', 'abend'] }));
  for (let i = 1; i <= n; i++) await s.add({ source, ...(source === 'link' ? { owner: 'max' } : {}), url: `https://rezepte.example/${source}-${i}`, recipe: recipe(i + (source === 'link' ? 500 : 0), { ...over(i), name: `${source === 'link' ? 'Eigene' : 'Sammlung'} Pfanne ${i}` }) });
  await s.tagWaiting(ai, 50);
};

const AI_PLAN = (title = 'Erfundener Tofu') => ({
  mahlzeiten: Array.from({ length: 7 }, (_, day) => (['fruehstueck', 'mittag', 'abend'] as const).map((slot) => ({
    tag: day, slot, restVon: null, titel: `${title} ${day} ${slot}`, minuten: 15, eiweissG: 25, haltbarTage: 3, schritte: ['Zubereiten.'],
    zutaten: [{ name: 'Tofu natur', menge: 100, einheit: 'g' as const, abteilung: 'Kühlregal' as const, roh: false }],
  }))).flat(),
});
const isMealPrompt = (p: string) => p.includes('Plane für jede Mahlzeit');

describe('planning with real recipes', () => {
  it('below the unlock ignores the collection but uses the household\'s link recipes, for at most a third of the meals', async () => {
    const { coach, ask } = setup({ ask: async (i) => (isMealPrompt(i.prompt) ? AI_PLAN() : { rezepte: [] }) });
    await fill(coach, 20, 'collection');
    await fill(coach, 3, 'link');
    expect(coach.recipes()!.unlocked()).toBe(false);
    await coach.replan('max', week);
    const meals = coach.view('max').weeks.find((w) => w.plan.week === week)!.plan.meals;
    const real = meals.filter((m) => m.dish.source === 'rezept');
    expect(real.length).toBeGreaterThan(0);
    expect(real.length).toBeLessThanOrEqual(7);
    expect(real.every((m) => m.dish.title.startsWith('Eigene') && m.dish.sourceUrl?.startsWith('https://rezepte.example/link-'))).toBe(true);
    expect(meals.some((m) => m.dish.title.startsWith('Sammlung'))).toBe(false);
    // Each link recipe once at most; the rest is what the AI invented, as before.
    expect(new Set(real.map((m) => m.dish.recipeId)).size).toBe(real.length);
    expect(meals.filter((m) => m.dish.source === 'coach').length).toBeGreaterThan(0);
    expect(ask!.mock.calls.filter(([i]) => isMealPrompt(i.prompt))).toHaveLength(1);
  });

  it('with no link recipe the plan is exactly the one of before, collection or not', async () => {
    const plain = setup({ ask: async () => AI_PLAN(), noRecipes: true });
    await plain.coach.replan('max', week);
    const withStore = setup({ ask: async () => AI_PLAN() });
    await fill(withStore.coach, 20, 'collection');
    await withStore.coach.replan('max', week);
    const titles = (c: MealCoach) => c.view('max').weeks.find((w) => w.plan.week === week)!.plan.meals.map((m) => `${m.day}-${m.slot}-${m.dish.title}`);
    expect(titles(withStore.coach)).toEqual(titles(plain.coach));
  });

  describe('from the unlock', () => {
    const unlockAt = (n: number) => { const r = policyRule('meals.collection-unlock') as { value: number }; const was = r.value; r.value = n; return () => { r.value = was; }; };

    it('picks every meal from the shortlist, the AI only choosing among its recipes, and invents nothing', async () => {
      const restore = unlockAt(5);
      try {
        const { coach, ask } = setup({ ask: async (i) => (i.prompt.includes('rezepte-nur-daten') ? { rezepte: [] } : { auswahl: [] }) });
        await fill(coach, 40, 'collection');
        expect(coach.recipes()!.unlocked()).toBe(true);
        await coach.replan('max', week);
        const plan = coach.view('max').weeks.find((w) => w.plan.week === week)!.plan;
        const real = plan.meals.filter((m) => m.dish.source === 'rezept');
        expect(real.length).toBe(plan.meals.length);
        expect(plan.meals.every((m) => m.dish.title.startsWith('Sammlung') && m.dish.sourceUrl)).toBe(true);
        // The AI was asked to choose from shortlists of 30 at most.
        const chooser = ask!.mock.calls.find(([i]) => i.prompt.includes('<mahlzeiten-nur-daten>') && i.prompt.includes('"rezepte":[{"id"'));
        expect(chooser).toBeDefined();
        expect(ask!.mock.calls.some(([i]) => isMealPrompt(i.prompt))).toBe(false);
      } finally { restore(); }
    });

    it('takes the AI\'s choice from the shortlist and ignores one that is not on it', async () => {
      const restore = unlockAt(5);
      try {
        let picked: string | null = null;
        const { coach } = setup({ ask: async (i) => {
          const block = /<mahlzeiten-nur-daten>\n([\s\S]*?)\n<\/mahlzeiten-nur-daten>/.exec(i.prompt);
          if (block && i.prompt.includes('"rezepte":[{"id"')) {
            const entries = JSON.parse(block[1]!) as { schluessel: string; rezepte: { id: string }[] }[];
            const list = entries.find((e) => e.schluessel === '1-abend')!.rezepte;
            expect(list.length).toBeLessThanOrEqual(30);
            picked = list[list.length - 1]!.id;
            return { auswahl: [{ schluessel: '1-abend', rezept: picked }, { schluessel: '2-abend', rezept: 'c-gibt-es-nicht' }] };
          }
          return { rezepte: [] };
        } });
        await fill(coach, 40, 'collection');
        await coach.replan('max', week);
        const meals = coach.view('max').weeks.find((w) => w.plan.week === week)!.plan.meals;
        expect(picked).not.toBeNull();
        expect(meals.find((m) => m.day === 1 && m.slot === 'abend')!.dish.recipeId).toBe(picked);
        expect(meals.find((m) => m.day === 2 && m.slot === 'abend')!.dish.recipeId).not.toBe('c-gibt-es-nicht');
        expect(meals.find((m) => m.day === 2 && m.slot === 'abend')!.dish.source).toBe('rezept');
      } finally { restore(); }
    });

    it('invents only what the shortlist cannot fill, marked as the coach\'s', async () => {
      const restore = unlockAt(5);
      try {
        // Breakfast has no recipe in the collection: the coach invents those.
        const { coach } = setup({ ask: async (i) => (isMealPrompt(i.prompt) ? AI_PLAN() : { auswahl: [] }) });
        const s = coach.recipes()!;
        for (let i = 1; i <= 12; i++) await s.add({ source: 'collection', url: `https://rezepte.example/m${i}`, recipe: recipe(i, { name: `Sammlung Pfanne ${i}` }) });
        await s.tagWaiting(taggingAi(() => ({ mahlzeit: ['mittag', 'abend'] })), 5);
        await coach.replan('max', week);
        const meals = coach.view('max').weeks.find((w) => w.plan.week === week)!.plan.meals;
        expect(meals.filter((m) => m.slot === 'fruehstueck').every((m) => m.dish.source === 'coach')).toBe(true);
        expect(meals.filter((m) => m.slot !== 'fruehstueck').every((m) => m.dish.source === 'rezept')).toBe(true);
      } finally { restore(); }
    });

    it('respects diet and dislikes, and never plans an untagged or flagged recipe', async () => {
      const restore = unlockAt(3);
      try {
        const { coach } = setup({ ask: async (i) => (isMealPrompt(i.prompt) ? AI_PLAN() : { auswahl: [] }) });
        coach.setSettings('lena', ON({ diet: 'vegan', dislikes: ['Karotten'] }));
        await fill(coach, 6, 'collection', (i) => (i === 1 ? { recipeIngredient: ['100 g Käse', '1 Zwiebel'] } : {}));
        await coach.recipes()!.add({ source: 'collection', url: 'https://rezepte.example/untagged', recipe: recipe(99, { name: 'Sammlung Ungetaggt' }) });
        await coach.replan('max', week);
        const meals = coach.view('max').weeks.find((w) => w.plan.week === week)!.plan.meals;
        // Every recipe has carrots, and Lena dislikes them: nothing from the collection fits a meal she eats; the rest is invented.
        expect(meals.every((m) => !m.dish.title.includes('Ungetaggt'))).toBe(true);
        expect(meals.filter((m) => m.dish.source === 'rezept').every((m) => !m.eaters.includes('lena'))).toBe(true);
      } finally { restore(); }
    });

    it('keeps training days for recipes with known, enough protein, and prefers the better rated within a bucket', async () => {
      const restore = unlockAt(5);
      try {
        const { coach } = setup({ ask: async (i) => (isMealPrompt(i.prompt) ? AI_PLAN() : { auswahl: [] }) });
        await fill(coach, 10, 'collection', (i) => (i <= 5 ? { nutrition: { proteinContent: '5 g' } } : i === 6 ? { nutrition: undefined, recipeIngredient: ['300 g Quittenmus', '200 g Hanfschrot'] } : {}));
        await coach.replan('max', week);
        const plan = coach.view('max').weeks.find((w) => w.plan.week === week)!.plan;
        // Monday and Wednesday are training days: only recipes with 28 g are chosen there.
        for (const m of plan.meals.filter((x) => plan.trainingDays.includes(x.day) && x.dish.source === 'rezept')) expect(m.dish.proteinG).toBeGreaterThanOrEqual(20);
      } finally { restore(); }
    });
  });
});

describe('adding a recipe by link', () => {
  const html = (r: object) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, r] })}</script></html>`;
  const request = (id: string, url: string, atMs = at(7, 6)): TrackedRecord => ({ kind: 'mealplan', id, updatedMs: atMs, deleted: false, body: { url, atMs, result: null, answeredMs: null } });
  const result = (store: RecordStore, id: string) => readLinkRequest(id, store.all('max', 'mealplan').find((r) => r.id === id)?.body)?.result;
  const answer = async (i: { prompt: string }) => (i.prompt.includes('rezepte-nur-daten') ? taggingAi()(i as never) : { zutaten: [] });

  it('fetches, imports and answers in the person\'s record, and lists it as an own recipe', async () => {
    const pages = vi.fn(async (url: string): Promise<Page> => ({ ok: true, html: html(recipe(1, { name: 'Erfundener Linsentopf' })), url }));
    const { coach, store } = setup({ ask: answer, fetchPage: pages, linked: ['max'] });
    store.putMany('max', [request('link-aaaa0001', 'https://rezepte.example/linsentopf')], 'remote');
    await coach.tick();
    expect(pages).toHaveBeenCalledWith('https://rezepte.example/linsentopf');
    expect(result(store, 'link-aaaa0001')).toEqual({ state: 'saved', title: 'Erfundener Linsentopf' });
    expect(coach.recipes()!.mine('max')).toHaveLength(1);
    expect(coach.recipes()!.mine('max')[0]!.tags).not.toBeNull();
    const rec = store.all('max', 'mealplan').find((r) => r.id.startsWith('recipe-'))!;
    expect(rec.body).toMatchObject({ title: 'Erfundener Linsentopf', sourceUrl: 'https://rezepte.example/linsentopf' });
    // Asked once: a second tick does not fetch again.
    await coach.tick();
    expect(pages).toHaveBeenCalledTimes(1);
  });

  it('answers a recipe with meat as not vegetarian and stores nothing', async () => {
    const { coach, store } = setup({ ask: answer, fetchPage: async (url) => ({ ok: true, html: html(recipe(1, { recipeIngredient: ['200 g Hähnchenbrust'] })), url }), linked: ['max'] });
    store.putMany('max', [request('link-aaaa0002', 'https://rezepte.example/huhn')], 'remote');
    await coach.tick();
    expect(result(store, 'link-aaaa0002')).toEqual({ state: 'veg' });
    expect(coach.recipes()!.mine('max')).toHaveLength(0);
    expect(store.all('max', 'mealplan').some((r) => r.id.startsWith('recipe-') && !r.deleted)).toBe(false);
  });

  it('answers when the page has no recipe, cannot be reached, or the address is refused', async () => {
    const pages: Record<string, Page> = {
      'https://rezepte.example/leer': { ok: true, html: '<html>nichts</html>', url: '' }, 'https://rezepte.example/weg': { ok: false, reason: 'error' },
      'https://rezepte.example/intern': { ok: false, reason: 'private' }, 'https://rezepte.example/pdf': { ok: false, reason: 'type' },
    };
    const { coach, store } = setup({ ask: answer, fetchPage: async (url) => pages[url]!, linked: ['max'] });
    store.putMany('max', [request('link-aaaa0003', 'https://rezepte.example/leer'), request('link-aaaa0004', 'https://rezepte.example/weg'), request('link-aaaa0005', 'https://rezepte.example/intern'), request('link-aaaa0006', 'https://rezepte.example/pdf'), request('link-aaaa0007', 'http://rezepte.example/klar')], 'remote');
    await coach.tick();
    expect(['link-aaaa0003', 'link-aaaa0004', 'link-aaaa0005', 'link-aaaa0006', 'link-aaaa0007'].map((id) => result(store, id)?.state)).toEqual(['none', 'fetch', 'bad', 'none', 'bad']);
  });

  it('lets a household add at most 20 links a day, however they turn out', async () => {
    let day = 7;
    const { coach, store } = setup({ ask: answer, fetchPage: async () => ({ ok: false, reason: 'error' }), linked: ['max'], now: () => at(day, 12) });
    const ids = Array.from({ length: 22 }, (_, i) => `link-${String(i).padStart(4, 'b')}`);
    for (let i = 0; i < ids.length; i += 5) { store.putMany('max', ids.slice(i, i + 5).map((id) => request(id, `https://rezepte.example/${id}`)), 'remote'); await coach.tick(); }
    const states = ids.map((id) => result(store, id)?.state);
    expect(states.filter((s) => s === 'fetch')).toHaveLength(20);
    expect(states.filter((s) => s === 'limit')).toHaveLength(2);
    day = 8;
    store.putMany('max', [request('link-next', 'https://rezepte.example/n')], 'remote');
    await coach.tick();
    expect(result(store, 'link-next')?.state).toBe('fetch');
  });

  it('deletes the recipe when the person deletes its record, and not for a person who does not own it', async () => {
    const { coach, store } = setup({ ask: answer, fetchPage: async (url) => ({ ok: true, html: html(recipe(1, { name: 'Erfundener Linsentopf' })), url }), linked: ['max', 'lena'] });
    store.putMany('max', [request('link-aaaa0010', 'https://rezepte.example/a')], 'remote');
    await coach.tick();
    const rec = store.all('max', 'mealplan').find((r) => r.id.startsWith('recipe-'))!;
    // Lena tombstones a record with the same id in her own account: nothing happens to Max's recipe.
    store.putMany('lena', [{ ...rec, deleted: true, updatedMs: rec.updatedMs + 1 }], 'remote');
    await coach.tick();
    expect(coach.recipes()!.mine('max')).toHaveLength(1);
    store.putMany('max', [{ ...rec, deleted: true, updatedMs: rec.updatedMs + 1 }], 'remote');
    await coach.tick();
    expect(coach.recipes()!.mine('max')).toHaveLength(0);
    expect(store.all('max', 'mealplan').find((r) => r.id === rec.id)?.deleted).toBe(true);
  });

  it('does nothing for a person without a linked account', async () => {
    const pages = vi.fn(async (url: string): Promise<Page> => ({ ok: false, reason: 'error' }));
    const { coach, store } = setup({ ask: answer, fetchPage: pages, linked: [] });
    store.putMany('max', [request('link-aaaa0020', 'https://rezepte.example/a')], 'remote');
    await coach.tick();
    expect(pages).not.toHaveBeenCalled();
  });
});

describe('the collection size in the view', () => {
  it('shows the tagged collection against the unlock, only with the plan on, and null without a collection', async () => {
    const { coach } = setup({ ask: async () => ({ rezepte: [] }) });
    await fill(coach, 4, 'collection');
    await fill(coach, 2, 'link');
    expect(coach.view('max').recipes).toEqual({ collection: 4, unlock: 1000 });
    coach.setSettings('lena', ON({ on: false }));
    expect(coach.view('lena').recipes).toBeNull();
    expect(setup({ noRecipes: true }).coach.view('max').recipes).toBeNull();
  });
});
