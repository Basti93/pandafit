import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MealCoach } from '../../../src/coach/meals/meal-coach';
import { RecipeStore } from '../../../src/coach/meals/recipe-store';
import { policyRule } from '../../../src/shared/training-policy';
import { taggingAi } from './fake-ai';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const recipe = (n: number, over: Record<string, unknown> = {}) => ({
  '@type': 'Recipe', name: `Erfundener Topf ${n}`, recipeYield: '2', url: `https://rezepte.example/topf-${n}`,
  recipeIngredient: [`${100 + n} g Linsen`, '1 Zwiebel', '1 EL Öl', `${n} Karotten`], recipeInstructions: ['Alles kochen.'], ...over,
});
const jsonl = (items: unknown[]) => items.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n';
const put = (store: string, name: string, text: string) => { fs.mkdirSync(path.join(store, 'inbox'), { recursive: true }); fs.writeFileSync(path.join(store, 'inbox', name), text); };
const open = () => true;
const addTagged = async (s: RecipeStore, n: number, over: Record<string, unknown> = {}, source: 'collection' | 'link' = 'collection', owner?: string) => {
  const out = await s.add({ source, ...(owner ? { owner } : {}), url: `https://rezepte.example/r${n}`, recipe: recipe(n, over) });
  if (out.status === 'saved') await s.tagIds([out.recipe.id], taggingAi());
  return out;
};

describe('the recipe store', () => {
  it('keeps a recipe once, by link and by title with the same ingredients', async () => {
    const s = new RecipeStore(tmp());
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/a?utm_source=x#top', recipe: recipe(1) })).status).toBe('saved');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: recipe(1) })).status).toBe('duplicate');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/b', recipe: recipe(1) })).status).toBe('duplicate');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/c', recipe: recipe(1, { name: 'erfundener TOPF 1' }) })).status).toBe('duplicate');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/d', recipe: recipe(2) })).status).toBe('saved');
    expect(s.stats()).toMatchObject({ untagged: 2, duplicates: 3 });
    s.close();
  });

  it('counts rejected and failed, and stores neither', async () => {
    const s = new RecipeStore(tmp());
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/m', recipe: recipe(1, { recipeIngredient: ['200 g Speckwürfel'] }) })).status).toBe('rejected');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/n', recipe: { name: 'Leer' } })).status).toBe('failed');
    expect((await s.add({ source: 'collection', url: 'ftp://nope', recipe: recipe(2) })).status).toBe('failed');
    expect(s.stats()).toMatchObject({ collection: 0, untagged: 0, rejected: 1, failed: 2 });
    s.close();
  });

  it('keeps the original source of every recipe', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir, () => 1234);
    await s.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: recipe(1, { custom: 'bleibt' }) });
    const raw = JSON.parse((s.database().prepare('SELECT raw FROM recipes').get() as { raw: string }).raw) as { url: string; fetchedAtMs: number; recipe: { custom: string } };
    expect(raw).toMatchObject({ url: 'https://rezepte.example/a', fetchedAtMs: 1234, recipe: { custom: 'bleibt' } });
    s.close();
  });

  it('keeps link recipes apart per person and from the count, and lets the owner delete only their own', async () => {
    const s = new RecipeStore(tmp());
    const mine = await s.add({ source: 'link', owner: 'max', url: 'https://rezepte.example/x', recipe: recipe(1) });
    const hers = await s.add({ source: 'link', owner: 'lena', url: 'https://rezepte.example/x', recipe: recipe(1) });
    expect([mine.status, hers.status]).toEqual(['saved', 'saved']);
    expect(s.mine('max')).toHaveLength(1);
    expect(s.collectionCount()).toBe(0);
    const id = s.mine('max')[0]!.id;
    expect(s.remove('lena', id)).toBe(false);
    expect(s.remove('max', id)).toBe(true);
    expect(s.mine('max')).toHaveLength(0);
    expect(s.mine('lena')).toHaveLength(1);
    s.close();
  });

  it('unlocks at the register value, counting only tagged collection recipes', async () => {
    const s = new RecipeStore(tmp());
    await addTagged(s, 1);
    await s.add({ source: 'collection', url: 'https://rezepte.example/u', recipe: recipe(2) });
    expect(s.collectionCount()).toBe(1);
    expect(policyRule('meals.collection-unlock').value).toBe(1000);
    expect(s.unlocked()).toBe(false);
    s.close();
  });
});

describe('the AI classification', () => {
  it('tags a batch with vocabulary ids and merges the rules on top', async () => {
    const s = new RecipeStore(tmp());
    for (let n = 1; n <= 12; n++) await s.add({ source: 'collection', url: `https://rezepte.example/r${n}`, recipe: recipe(n) });
    const ai = taggingAi((i) => ({ kueche: 'indisch', eigenschaft: ['eine-pfanne', 'proteinreich'], mahlzeit: i.title.endsWith('1') ? ['fruehstueck'] : ['mittag', 'abend'] }));
    expect(await s.tagWaiting(ai, 3)).toBe(12);
    expect(ai.batches).toEqual([10, 2]);
    const one = s.search({ limit: 50 }).find((r) => r.title === 'Erfundener Topf 3')!;
    expect(one.tags).toMatchObject({ mahlzeit: ['mittag', 'abend'], art: 'curry-eintopf', kueche: 'indisch', eiweiss: 'huelsenfruechte', ernaehrung: ['vegetarisch', 'vegan'] });
    expect(one.slots).toEqual(['mittag', 'abend']);
    // proteinreich is the rule's alone (here the estimated protein decides), the soft id stays.
    expect(one.tags!.eigenschaft).toContain('eine-pfanne');
    expect(s.stats()).toMatchObject({ collection: 12, untagged: 0 });
    s.close();
  });

  it('drops unknown ids and leaves a recipe without a required facet untagged, trying again later with a wait', async () => {
    let now = 1_000_000;
    const s = new RecipeStore(tmp(), () => now);
    await s.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: recipe(1) });
    await s.add({ source: 'collection', url: 'https://rezepte.example/b', recipe: recipe(2) });
    const ai = taggingAi((i) => (i.title.endsWith('1')
      ? { art: 'erfundene-art', eigenschaft: ['gibt-es-nicht'] }
      : { kueche: 'marsianisch', eigenschaft: ['gibt-es-nicht', 'ohne-kochen'], mahlzeit: ['mittag', 'gibt-es-nicht'] }));
    expect(await s.tagWaiting(ai, 3)).toBe(1);
    expect(s.stats()).toMatchObject({ collection: 1, untagged: 1 });
    expect(s.search({})[0]!.tags).toMatchObject({ mahlzeit: ['mittag'], kueche: null });
    expect(s.search({})[0]!.tags!.eigenschaft).toContain('ohne-kochen');
    expect(s.search({})[0]!.tags!.eigenschaft).not.toContain('gibt-es-nicht');
    // The failed one waits before it is asked again.
    expect(await s.tagWaiting(ai, 3)).toBe(0);
    expect(ai.calls).toBe(1);
    now += 6 * 3_600_000;
    expect(await s.tagWaiting(ai, 3)).toBe(0);
    expect(ai.calls).toBe(2);
    s.close();
  });

  it('is left untagged without an AI, everything else imported', async () => {
    const dir = tmp();
    put(dir, 'a.jsonl', jsonl([recipe(1)]));
    const s = new RecipeStore(dir);
    await s.scanInbox({ noOpenRide: open });
    expect(s.stats()).toMatchObject({ collection: 0, untagged: 1 });
    expect(s.search({ text: 'linsen' })).toEqual([]);
    s.close();
  });

  it('lets the rules win: the AI cannot make a recipe with an animal product vegan, and cannot claim a rule tag', async () => {
    const s = new RecipeStore(tmp());
    await s.add({ source: 'collection', url: 'https://rezepte.example/k', recipe: recipe(1, { name: 'Käse-Topf', recipeIngredient: ['100 g Käse', '200 g Linsen'] }) });
    const ai = taggingAi(() => ({ eigenschaft: ['vegan', 'schnell', 'meal-prep', 'proteinreich', 'kalt-essbar'] }));
    await s.tagWaiting(ai, 1);
    const r = s.search({})[0]!;
    expect(r.vegan).toBe(false);
    expect(r.tags!.ernaehrung).toEqual(['vegetarisch']);
    expect(r.tags!.eigenschaft).not.toContain('vegan');
    // schnell / meal-prep / proteinreich come from the numbers: 30 minutes by default and 2 days keeping, so only meal-prep.
    expect(r.tags!.eigenschaft).toContain('meal-prep');
    expect(r.tags!.eigenschaft).not.toContain('schnell');
    expect(r.tags!.eigenschaft).toContain('kalt-essbar');
    s.close();
  });

  it('asks again only when the prompt version or the input changed: a cache hit costs no call', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    await s.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: recipe(1) });
    const ai = taggingAi();
    await s.tagWaiting(ai, 1);
    expect(ai.calls).toBe(1);
    // Same input, same version: nothing is asked.
    expect(await s.tagWaiting(ai, 1)).toBe(0);
    expect(ai.calls).toBe(1);
    // A new prompt version: the recipe keeps its tags and is classified again in the background.
    const was = policyRule('meals.tag-ai').values!.tagPromptVersion!;
    (policyRule('meals.tag-ai').values as Record<string, number>).tagPromptVersion = was + 1;
    try {
      expect(s.search({})).toHaveLength(1);
      const again = taggingAi(() => ({ art: 'suppe' }));
      expect(await s.tagWaiting(again, 1)).toBe(1);
      expect(again.calls).toBe(1);
      expect(s.search({})[0]!.tags!.art).toBe('suppe');
      expect(await s.tagWaiting(again, 1)).toBe(0);
    } finally { (policyRule('meals.tag-ai').values as Record<string, number>).tagPromptVersion = was; }
    s.close();
  });

  it('tags a link recipe at once when an AI is there', async () => {
    const s = new RecipeStore(tmp());
    const ai = taggingAi();
    const out = await s.add({ source: 'link', owner: 'max', url: 'https://rezepte.example/x', recipe: recipe(1), tagAsk: ai });
    expect(out.status === 'saved' && out.recipe.tags?.art).toBe('curry-eintopf');
    expect(s.links()).toHaveLength(1);
    s.close();
  });
});

describe('deriving again', () => {
  it('derives every recipe again from its source after a version bump, keeping the tags', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir, () => 5);
    await s.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: recipe(1) });
    await s.tagWaiting(taggingAi(), 1);
    s.close();
    // The source changes under us only in the sense that the code derives differently: simulate by editing the stored raw.
    const s2 = new RecipeStore(dir, () => 5, { deriveVersion: 2 });
    const db = s2.database();
    const row = db.prepare('SELECT raw FROM recipes').get() as { raw: string };
    const raw = JSON.parse(row.raw) as { recipe: { recipeYield: string } };
    raw.recipe.recipeYield = '4';
    db.prepare('UPDATE recipes SET raw = ?').run(JSON.stringify(raw));
    expect(await s2.rederive(100)).toBe(1);
    const r = s2.search({})[0]!;
    expect(r.deriveVersion).toBe(2);
    expect(r.ingredients.find((i) => i.name === 'Linsen')!.amount).toBe(25.25);
    expect(r.tags!.art).toBe('curry-eintopf');
    expect(await s2.rederive(100)).toBe(0);
    s2.close();
  });

  it('removes a recipe the stricter rules now reject', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    await s.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: recipe(1) });
    const db = s.database();
    const raw = JSON.parse((db.prepare('SELECT raw FROM recipes').get() as { raw: string }).raw) as { recipe: { recipeIngredient: string[] } };
    raw.recipe.recipeIngredient.push('50 g Speck');
    db.prepare('UPDATE recipes SET raw = ?, derive_version = 0').run(JSON.stringify(raw));
    await s.rederive(10);
    expect(s.stats()).toMatchObject({ untagged: 0, collection: 0, rejected: 1 });
    s.close();
  });
});

describe('searching', () => {
  const fill = async (s: RecipeStore) => {
    const mk = (n: number, name: string, ing: string[], over: Record<string, unknown> = {}) => addTagged(s, n, { name, recipeIngredient: ing, ...over });
    await mk(1, 'Kichererbsen-Spinat-Curry', ['200 g Kichererbsen', '300 g Spinat', '1 Zwiebel'], { totalTime: 'PT25M', aggregateRating: { ratingValue: 4.5, ratingCount: 20 } });
    await mk(2, 'Spinat-Lasagne', ['200 g Spinat', '250 g Lasagneplatten', '200 g Ricotta'], { totalTime: 'PT60M', aggregateRating: { ratingValue: 4.9, ratingCount: 50 }, nutrition: { proteinContent: '30 g' } });
    await mk(3, 'Tomatensuppe', ['500 g Paradeiser', '1 Zwiebel'], { totalTime: 'PT20M', nutrition: { proteinContent: '6 g' } });
    await mk(4, 'Käse-Linsen', ['100 g Käse', '200 g Linsen'], { totalTime: 'PT30M' });
  };
  it('finds by free text in title, canonical ingredients and tag labels', async () => {
    const s = new RecipeStore(tmp());
    await fill(s);
    expect(s.search({ text: 'hab Kichererbsen und Spinat' }).map((r) => r.title)).toEqual(['Kichererbsen-Spinat-Curry']);
    expect(s.search({ text: 'spinat' }).map((r) => r.title).sort()).toEqual(['Kichererbsen-Spinat-Curry', 'Spinat-Lasagne']);
    expect(s.search({ text: 'tomaten' }).map((r) => r.title)).toEqual(['Tomatensuppe']);
    expect(s.search({ text: 'Curry und Eintopf' }).length).toBe(4);
    expect(s.search({ text: 'nichtsdavon' })).toEqual([]);
    s.close();
  });
  it('filters by facets, minutes, protein, vegan and ingredients, best rated first', async () => {
    const s = new RecipeStore(tmp());
    await fill(s);
    const t = (q: Parameters<RecipeStore['search']>[0]) => s.search(q).map((r) => r.title);
    expect(t({}).slice(0, 2)).toEqual(['Spinat-Lasagne', 'Kichererbsen-Spinat-Curry']);
    expect(t({ maxMinutes: 25 })).toEqual(['Kichererbsen-Spinat-Curry', 'Tomatensuppe']);
    expect(t({ minProteinG: 20 })).toContain('Spinat-Lasagne');
    expect(t({ minProteinG: 20 })).not.toContain('Tomatensuppe');
    expect(t({ vegan: true })).not.toContain('Käse-Linsen');
    expect(t({ tags: ['vegan', 'mahlzeit:abend'] })).toHaveLength(2);
    expect(t({ tags: ['art:suppe'] })).toEqual([]);
    expect(t({ includeIngredients: ['Spinat'], excludeIngredients: ['Zwiebeln'] })).toEqual(['Spinat-Lasagne']);
    expect(t({ includeIngredients: ['Paradeiser'] })).toEqual(['Tomatensuppe']);
    expect(t({ limit: 2 })).toHaveLength(2);
    expect(t({ source: 'link' })).toEqual([]);
    s.close();
  });
  it('never finds a recipe that is not tagged or has too unclear ingredient lines', async () => {
    const s = new RecipeStore(tmp());
    await fill(s);
    await s.add({ source: 'collection', url: 'https://rezepte.example/untagged', recipe: recipe(9, { name: 'Ungetaggte Pfanne' }) });
    s.database().prepare("UPDATE recipes SET flagged = 1 WHERE title = 'Tomatensuppe'").run();
    expect(s.search({ text: 'pfanne' })).toEqual([]);
    expect(s.search({ text: 'tomatensuppe' })).toEqual([]);
    s.close();
  });
  it('gives a varied but repeatable order for the planner', async () => {
    const s = new RecipeStore(tmp());
    await fill(s);
    const a = s.search({ order: 'sample', seed: 1 }).map((r) => r.id);
    expect(s.search({ order: 'sample', seed: 1 }).map((r) => r.id)).toEqual(a);
    expect(s.collectionFor('mittag', 10, 3)).toHaveLength(4);
    s.close();
  });
});

describe('the inbox', () => {
  it('imports a file once and moves it with a result, tagging in batches', async () => {
    const dir = tmp();
    put(dir, 'tag-1.jsonl', jsonl([recipe(1), recipe(2)]));
    const s = new RecipeStore(dir);
    const ai = taggingAi();
    expect(await s.scanInbox({ noOpenRide: open, ask: ai })).toMatchObject({ files: 1, imported: 2, tagged: 2 });
    expect(ai.batches).toEqual([2]);
    expect(fs.existsSync(path.join(dir, 'inbox', 'tag-1.jsonl'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'inbox', 'done', 'tag-1.jsonl.result.json'), 'utf8'))).toMatchObject({ imported: 2 });
    put(dir, 'tag-1.jsonl', jsonl([recipe(1), recipe(2)]));
    expect(await s.scanInbox({ noOpenRide: open, ask: ai })).toMatchObject({ imported: 0, duplicates: 2 });
    expect(s.collectionCount()).toBe(2);
    s.close();
  });

  it('lets a bad line fail without stopping the rest', async () => {
    const dir = tmp();
    put(dir, 'x.jsonl', jsonl([recipe(1), '{kaputt', { name: 'ohne Adresse' }, recipe(2, { recipeIngredient: ['1 Schinken'] }), recipe(3)]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: open, ask: taggingAi() })).toMatchObject({ imported: 2, failed: 2, rejected: 1 });
    expect(s.stats()).toMatchObject({ collection: 2, failed: 2, rejected: 1 });
    s.close();
  });

  it('moves a file with no usable line to failed with a reason', async () => {
    const dir = tmp();
    put(dir, 'bad.jsonl', 'nur Text\nnoch Text\n');
    const s = new RecipeStore(dir);
    await s.scanInbox({ noOpenRide: open });
    expect(fs.readFileSync(path.join(dir, 'inbox', 'failed', 'bad.jsonl.reason.txt'), 'utf8')).toContain('no usable line');
    s.close();
  });

  it('ignores files that are not complete jsonl files', async () => {
    const dir = tmp();
    put(dir, 'later.jsonl.tmp', jsonl([recipe(1)]));
    put(dir, '.hidden.jsonl', jsonl([recipe(2)]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ files: 0, imported: 0 });
    s.close();
  });

  it('takes at most 200 recipes per scan and finishes the file on the next', async () => {
    const dir = tmp();
    put(dir, 'big.jsonl', jsonl(Array.from({ length: 250 }, (_, i) => recipe(i + 1))));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 200, files: 0 });
    expect(fs.existsSync(path.join(dir, 'inbox', 'big.jsonl'))).toBe(true);
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 50, files: 1 });
    expect(s.stats().untagged).toBe(250);
    expect(fs.existsSync(path.join(dir, 'inbox', 'done', 'big.jsonl'))).toBe(true);
    s.close();
  });

  it('never imports while a ride is open', async () => {
    const dir = tmp();
    put(dir, 'r.jsonl', jsonl([recipe(1)]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: () => false })).toMatchObject({ files: 0, imported: 0 });
    expect(fs.existsSync(path.join(dir, 'inbox', 'r.jsonl'))).toBe(true);
    s.close();
  });

  it('keeps recipes with unclear lines as pending and finishes them once an AI answers', async () => {
    const dir = tmp();
    const unclear = recipe(1, { recipeIngredient: ['Eine Schüssel voll Linsen', 'ein paar Kräuter', 'nach Lust Gemüse', '200 g Nudeln'] });
    put(dir, 'u.jsonl', jsonl([unclear]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ pending: 1, imported: 0 });
    expect(s.stats()).toMatchObject({ pending: 1, collection: 0 });
    const tag = taggingAi();
    const ask = vi.fn(async (i: { prompt: string; systemPrompt: string; schema: object }) => (i.prompt.includes('rezepte-nur-daten') ? tag(i) : { zutaten: ['Linsen', 'Kräuter', 'Gemüse', 'Nudeln'].map((name) => ({ name, menge: 100, einheit: 'g', abteilung: 'Vorrat', roh: false })) }));
    put(dir, 'v.jsonl', jsonl([recipe(9)]));
    await s.scanInbox({ noOpenRide: open, ask: ask as never });
    await s.scanInbox({ noOpenRide: open, ask: ask as never });
    expect(s.stats()).toMatchObject({ pending: 0, collection: 2 });
    s.close();
  });

  it('is run by the meal coach at its tick, even with no one planning, and not during a ride', async () => {
    const dir = tmp();
    let ride = true;
    const coach = new MealCoach({ dir: path.join(dir, 'meals'), recipesDir: path.join(dir, 'recipes'), nowMs: () => Date.now(), profiles: () => [], noOpenRide: () => !ride, ask: taggingAi() });
    put(path.join(dir, 'recipes'), 't.jsonl', jsonl([recipe(1)]));
    await coach.tick();
    expect(fs.existsSync(path.join(dir, 'recipes', 'inbox', 't.jsonl'))).toBe(true);
    ride = false;
    await coach.tick();
    expect(coach.recipes()!.collectionCount()).toBe(1);
    expect(fs.existsSync(path.join(dir, 'recipes', 'inbox', 'done', 't.jsonl'))).toBe(true);
    coach.recipes()!.close();
  });
});
