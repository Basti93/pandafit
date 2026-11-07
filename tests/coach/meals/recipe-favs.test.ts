import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MealCoach } from '../../../src/coach/meals/meal-coach';
import { RecordStore } from '../../../src/coach/tracking/store';
import { favouriteIds, favRecordId, isFavRecordId, type MealSettings } from '../../../src/shared/meals';
import type { TrackedRecord } from '../../../src/shared/records';
import { policyRule } from '../../../src/shared/training-policy';
import { taggingAi } from './fake-ai';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rfav-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const PEOPLE = [{ id: 'max', name: 'Max' }, { id: 'lena', name: 'Lena' }];
const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
const ON: MealSettings = { on: true, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'mitnehmen', abend: 'zuhause' } };
const week = '2026-11-09';
const recipe = (n: number, over: Record<string, unknown> = {}) => ({
  '@type': 'Recipe', name: `Erfundene Pfanne ${n}`, recipeYield: '2', totalTime: 'PT15M',
  recipeIngredient: [`${100 + n} g Linsen`, '1 Zwiebel', '1 EL Öl', `${n} Karotten`], recipeInstructions: ['Alles braten.'], nutrition: { proteinContent: '28 g' }, ...over,
});
const fav = (id: string, t: number, deleted = false): TrackedRecord => ({ kind: 'mealplan', id: favRecordId(id), updatedMs: t, deleted, body: { atMs: t } });

const setup = (o: { ask?: (i: { prompt: string }) => Promise<unknown>; linked?: string[] } = {}) => {
  const dir = tmp();
  let r = 0;
  const store = new RecordStore({ dir: path.join(dir, 'tracking') });
  const ask = o.ask ? vi.fn(o.ask) : undefined;
  const coach = new MealCoach({
    dir: path.join(dir, 'meals'), recipesDir: path.join(dir, 'recipes'), nowMs: () => at(7, 6), profiles: () => PEOPLE, noOpenRide: () => true, ask,
    store, linked: (id) => (o.linked ?? ['max', 'lena']).includes(id), trainingDays: () => [0, 2], random: () => ((r = (r * 9301 + 49297) % 233280) / 233280),
  });
  coach.setSettings('max', ON);
  coach.setSettings('lena', ON);
  return { coach, store, ask };
};
const fill = async (coach: MealCoach, n: number, source: 'collection' | 'link' = 'collection', owner?: string, prefix = 'Sammlung', base = 0) => {
  const s = coach.recipes()!;
  for (let i = 1; i <= n; i++) await s.add({ source, ...(owner ? { owner } : {}), url: `https://rezepte.example/${prefix}-${i}`, recipe: recipe(base + i, { name: `${prefix} Pfanne ${i}` }) });
  await s.tagWaiting(taggingAi(() => ({ mahlzeit: ['fruehstueck', 'mittag', 'abend'] })), 50);
};
const idByTitle = (coach: MealCoach, title: string) => coach.recipes()!.database().prepare('SELECT id FROM recipes WHERE title = ?').get(title) as { id: string } | undefined;

describe('browsing', () => {
  it('finds only recipes the AI confirmed, never an untagged one or one with an old, unconfirmed verdict', async () => {
    const { coach } = setup();
    await fill(coach, 3);
    await coach.recipes()!.add({ source: 'collection', url: 'https://rezepte.example/ungetaggt', recipe: recipe(90, { name: 'Sammlung Ungetaggt' }) });
    const old = idByTitle(coach, 'Sammlung Pfanne 3')!.id;
    coach.recipes()!.database().prepare("UPDATE recipes SET json = json_remove(json, '$.vegCheckedBy') WHERE id = ?").run(old);
    const titles = coach.browse('max', {}).items.map((i) => i.title).sort();
    expect(titles).toEqual(['Sammlung Pfanne 1', 'Sammlung Pfanne 2']);
    expect(coach.recipeDetail('max', old)).toBeNull();
  });

  it('keeps the household boundary: the collection and own recipes for all, a link recipe only for its person', async () => {
    const { coach } = setup();
    await fill(coach, 1);
    await fill(coach, 1, 'link', 'max', 'Maxens', 100);
    await fill(coach, 1, 'link', 'lena', 'Lenas', 200);
    await fill(coach, 1, 'link', '~own', 'Haushalt', 300);
    const titles = (p: string) => coach.browse(p, {}).items.map((i) => i.title).sort();
    expect(titles('max')).toEqual(['Haushalt Pfanne 1', 'Maxens Pfanne 1', 'Sammlung Pfanne 1']);
    expect(titles('lena')).toEqual(['Haushalt Pfanne 1', 'Lenas Pfanne 1', 'Sammlung Pfanne 1']);
    expect(titles('someone-else')).toEqual(['Haushalt Pfanne 1', 'Sammlung Pfanne 1']);
    expect(coach.browse('max', { own: true }).items.map((i) => i.title).sort()).toEqual(['Haushalt Pfanne 1', 'Maxens Pfanne 1']);
    const lenas = idByTitle(coach, 'Lenas Pfanne 1')!.id;
    expect(coach.recipeDetail('max', lenas)).toBeNull();
    expect(coach.recipeDetail('lena', lenas)?.title).toBe('Lenas Pfanne 1');
    expect(coach.recipes()!.canSee(lenas, 'max')).toBeNull();
  });

  it('pages 20 at a time with "more", and honours offset and a smaller limit', async () => {
    const { coach } = setup();
    await fill(coach, 45);
    const p1 = coach.browse('max', {});
    expect(p1.items).toHaveLength(20);
    expect(p1.more).toBe(true);
    const p2 = coach.browse('max', { offset: 20 });
    const p3 = coach.browse('max', { offset: 40 });
    expect(p3.items).toHaveLength(5);
    expect(p3.more).toBe(false);
    expect(new Set([...p1.items, ...p2.items, ...p3.items].map((i) => i.id)).size).toBe(45);
    expect(coach.browse('max', { limit: 500 }).items).toHaveLength(20);
    expect(coach.browse('max', { limit: 3 }).items).toHaveLength(3);
  });

  it('filters by text, by known tags only, and by favourites; marks favourites', async () => {
    const { coach, store } = setup();
    await fill(coach, 5);
    const one = idByTitle(coach, 'Sammlung Pfanne 1')!.id, three = idByTitle(coach, 'Sammlung Pfanne 3')!.id;
    store.putMany('max', [fav(three, 1000)], 'remote');
    expect(coach.browse('max', { q: 'Pfanne 3' }).items.map((i) => i.id)).toEqual([three]);
    expect(coach.browse('max', { tags: ['mahlzeit:abend', 'schnell'] }).items).toHaveLength(5);
    expect(coach.browse('max', { tags: ['mahlzeit:snack'] }).items).toHaveLength(0);
    // An unknown tag is dropped, not an error, and not a way into the query.
    expect(coach.browse('max', { tags: ["x' OR 1=1 --", 'gibtsnicht:ja'] }).items).toHaveLength(5);
    const favs = coach.browse('max', { fav: true });
    expect(favs.items.map((i) => [i.id, i.fav])).toEqual([[three, true]]);
    expect(coach.browse('lena', { fav: true }).items).toHaveLength(0);
    expect(coach.browse('max', {}).items.find((i) => i.id === one)!.fav).toBe(false);
    expect(coach.recipeDetail('max', three)).toMatchObject({ title: 'Sammlung Pfanne 3', fav: true, image: false, steps: ['Alles braten.'] });
  });

  it('says whether a recipe has a picture', async () => {
    const { coach } = setup();
    await fill(coach, 2);
    const id = idByTitle(coach, 'Sammlung Pfanne 1')!.id;
    coach.recipes()!.setImage(id, { bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9)]), type: 'image/jpeg' });
    const items = coach.browse('max', {}).items;
    expect(items.find((i) => i.id === id)!.image).toBe(true);
    expect(items.find((i) => i.id !== id)!.image).toBe(false);
  });
});

describe('favourites', () => {
  it('are records of the person, one per recipe, and a tombstone is no favourite', () => {
    expect(isFavRecordId('fav-c-0123456789abcd')).toBe(true);
    expect(isFavRecordId('fav-x-0123456789abcd')).toBe(false);
    expect(isFavRecordId('fav-c-0123456789abcd/../x')).toBe(false);
    const { coach, store } = setup();
    store.putMany('max', [fav('c-0123456789abcd', 1), fav('l-0123456789abcd', 1), fav('c-aaaaaaaaaaaaaa', 1, true)], 'remote');
    expect([...coach.favourites('max')].sort()).toEqual(['c-0123456789abcd', 'l-0123456789abcd']);
    expect([...coach.favourites('lena')]).toEqual([]);
    expect(favouriteIds([{ id: 'fav-c-0123456789abcd', deleted: false }, { id: 'week-2026-11-09', deleted: false }]).size).toBe(1);
  });

  it('merge by time when toggled on two devices or offline: the later toggle wins, a late older one does not', () => {
    const { coach, store } = setup();
    const id = 'c-0123456789abcd';
    store.putMany('max', [fav(id, 1000)], 'remote');
    store.putMany('max', [fav(id, 3000, true)], 'remote');
    // A toggle made offline at 2000 reaches the server last: it is older than the removal.
    store.putMany('max', [fav(id, 2000)], 'remote');
    expect(coach.favourites('max').has(id)).toBe(false);
    store.putMany('max', [fav(id, 4000)], 'remote');
    expect(coach.favourites('max').has(id)).toBe(true);
  });

  it('are kept when the coach writes the plan records, not removed as unknown', async () => {
    const { coach, store } = setup({ ask: async () => ({}) });
    await fill(coach, 2);
    const id = idByTitle(coach, 'Sammlung Pfanne 1')!.id;
    store.putMany('max', [fav(id, 1000)], 'remote');
    coach.exportAll();
    coach.exportAll();
    expect(store.all('max', 'mealplan').find((r) => r.id === favRecordId(id))).toMatchObject({ deleted: false });
  });
});

describe('planning with favourites', () => {
  const unlockAt = (n: number) => { const r = policyRule('meals.collection-unlock') as { value: number }; const was = r.value; r.value = n; return () => { r.value = was; }; };
  const planOf = (coach: MealCoach) => coach.view('max').weeks.find((w) => w.plan.week === week)!.plan;
  const chooserAi = async (i: { prompt: string }) => (i.prompt.includes('rezepte-nur-daten') ? { rezepte: [] } : { auswahl: [] });

  it('leads the shortlist with favourites of the people eating, each at most once in the week', async () => {
    const restore = unlockAt(5);
    try {
      const { coach, store } = setup({ ask: chooserAi });
      await fill(coach, 60);
      const favs = [7, 21, 40].map((n) => idByTitle(coach, `Sammlung Pfanne ${n}`)!.id);
      store.putMany('max', favs.map((f) => fav(f, 1000)), 'remote');
      store.putMany('lena', favs.slice(0, 1).map((f) => fav(f, 1000)), 'remote');
      await coach.replan('max', week);
      // A leftover meal (cook once, eat twice) is the same pot, not a second cooking.
      const ids = planOf(coach).meals.filter((m) => !m.reuseOf).map((m) => m.dish.recipeId);
      for (const f of favs) expect(ids.filter((x) => x === f)).toHaveLength(1);
    } finally { restore(); }
  });

  it('tells the AI which options are favourites', async () => {
    const restore = unlockAt(5);
    try {
      const { coach, store, ask } = setup({ ask: chooserAi });
      await fill(coach, 40);
      const f = idByTitle(coach, 'Sammlung Pfanne 12')!.id;
      store.putMany('max', [fav(f, 1000)], 'remote');
      await coach.replan('max', week);
      const prompt = ask!.mock.calls.map(([i]) => i.prompt).find((p) => p.includes('<mahlzeiten-nur-daten>') && p.includes('"rezepte":[{"id"'))!;
      expect(prompt).toContain('"favorit":true');
      expect(prompt).toContain(`"id":"${f}","titel":"Sammlung Pfanne 12"`);
    } finally { restore(); }
  });

  it('are candidates below the unlock, like own recipes, within the same cap', async () => {
    const { coach, store } = setup({ ask: async () => ({ mahlzeiten: [] }) });
    await fill(coach, 30);
    expect(coach.recipes()!.unlocked()).toBe(false);
    const f = [3, 9].map((n) => idByTitle(coach, `Sammlung Pfanne ${n}`)!.id);
    store.putMany('lena', f.map((x) => fav(x, 1000)), 'remote');
    await coach.replan('max', week);
    const real = planOf(coach).meals.filter((m) => m.dish.source === 'rezept');
    expect(real.map((m) => m.dish.recipeId).sort()).toEqual([...f].sort());
  });
});
