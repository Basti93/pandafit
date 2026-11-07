import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MealCoach } from '../../../src/coach/meals/meal-coach';
import { RecipeStore } from '../../../src/coach/meals/recipe-store';
import { policyRule } from '../../../src/shared/training-policy';

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

describe('the recipe store', () => {
  it('keeps a recipe once, by link and by title with the same ingredients', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    const a = await s.add({ source: 'collection', url: 'https://rezepte.example/a?utm_source=x#top', recipe: recipe(1) });
    expect(a.status).toBe('saved');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/a', recipe: recipe(1) })).status).toBe('duplicate');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/b', recipe: recipe(1) })).status).toBe('duplicate');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/c', recipe: recipe(1, { name: 'erfundener TOPF 1' }) })).status).toBe('duplicate');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/d', recipe: recipe(2) })).status).toBe('saved');
    expect(s.stats()).toMatchObject({ collection: 2, duplicates: 3 });
    s.close();
  });

  it('counts rejected and failed, and stores neither', async () => {
    const s = new RecipeStore(tmp());
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/m', recipe: recipe(1, { recipeIngredient: ['200 g Speckwürfel'] }) })).status).toBe('rejected');
    expect((await s.add({ source: 'collection', url: 'https://rezepte.example/n', recipe: { name: 'Leer' } })).status).toBe('failed');
    expect((await s.add({ source: 'collection', url: 'ftp://nope', recipe: recipe(2) })).status).toBe('failed');
    expect(s.stats()).toMatchObject({ collection: 0, rejected: 1, failed: 2 });
    s.close();
  });

  it('keeps link recipes apart per person and from the count, and lets the owner delete only their own', async () => {
    const s = new RecipeStore(tmp());
    const mine = await s.add({ source: 'link', owner: 'max', url: 'https://rezepte.example/x', recipe: recipe(1) });
    const hers = await s.add({ source: 'link', owner: 'lena', url: 'https://rezepte.example/x', recipe: recipe(1) });
    expect([mine.status, hers.status]).toEqual(['saved', 'saved']);
    expect(s.mine('max')).toHaveLength(1);
    expect(s.links()).toHaveLength(2);
    expect(s.collectionCount()).toBe(0);
    const id = s.mine('max')[0]!.id;
    expect(s.remove('lena', id)).toBe(false);
    expect(s.remove('max', id)).toBe(true);
    expect(s.mine('max')).toHaveLength(0);
    expect(s.mine('lena')).toHaveLength(1);
    s.close();
  });

  it('does not count recipes without a meal slot, and unlocks at the register value', async () => {
    const s = new RecipeStore(tmp());
    await s.add({ source: 'collection', url: 'https://rezepte.example/k', recipe: recipe(1, { recipeCategory: 'Dessert' }) });
    expect(s.collectionCount()).toBe(0);
    expect(policyRule('meals.collection-unlock').value).toBe(1000);
    expect(s.unlocked()).toBe(false);
    s.close();
  });

  it('orders collection recipes of a slot by rating, then by number of ratings', async () => {
    const s = new RecipeStore(tmp());
    await s.add({ source: 'collection', url: 'https://rezepte.example/1', recipe: recipe(1) });
    await s.add({ source: 'collection', url: 'https://rezepte.example/2', recipe: recipe(2, { aggregateRating: { ratingValue: 4.2, ratingCount: 10 } }) });
    await s.add({ source: 'collection', url: 'https://rezepte.example/3', recipe: recipe(3, { aggregateRating: { ratingValue: 4.8, ratingCount: 3 } }) });
    await s.add({ source: 'collection', url: 'https://rezepte.example/4', recipe: recipe(4, { aggregateRating: { ratingValue: 4.8, ratingCount: 30 } }) });
    expect(s.collectionFor('mittag').map((r) => r.title)).toEqual(['Erfundener Topf 4', 'Erfundener Topf 3', 'Erfundener Topf 2', 'Erfundener Topf 1']);
    expect(s.collectionFor('fruehstueck')).toEqual([]);
    s.close();
  });
});

describe('the inbox', () => {
  it('imports a file once and moves it with a result', async () => {
    const dir = tmp();
    put(dir, 'tag-1.jsonl', jsonl([recipe(1), recipe(2)]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ files: 1, imported: 2 });
    expect(fs.existsSync(path.join(dir, 'inbox', 'tag-1.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'inbox', 'done', 'tag-1.jsonl'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'inbox', 'done', 'tag-1.jsonl.result.json'), 'utf8'))).toMatchObject({ imported: 2 });
    // The same file name again (a re-delivery) imports nothing new.
    put(dir, 'tag-1.jsonl', jsonl([recipe(1), recipe(2)]));
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 0, duplicates: 2 });
    expect(s.collectionCount()).toBe(2);
    s.close();
  });

  it('lets a bad line fail without stopping the rest', async () => {
    const dir = tmp();
    put(dir, 'x.jsonl', jsonl([recipe(1), '{kaputt', { name: 'ohne Adresse' }, recipe(2, { recipeIngredient: ['1 Schinken'] }), recipe(3)]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 2, failed: 2, rejected: 1 });
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
    expect(s.collectionCount()).toBe(250);
    expect(fs.existsSync(path.join(dir, 'inbox', 'done', 'big.jsonl'))).toBe(true);
    s.close();
  });

  it('never imports while a ride is open', async () => {
    const dir = tmp();
    put(dir, 'r.jsonl', jsonl([recipe(1)]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: () => false })).toMatchObject({ files: 0, imported: 0 });
    expect(fs.existsSync(path.join(dir, 'inbox', 'r.jsonl'))).toBe(true);
    expect(s.collectionCount()).toBe(0);
    s.close();
  });

  it('keeps recipes with unclear lines as pending and finishes them once an AI answers', async () => {
    const dir = tmp();
    const unclear = recipe(1, { recipeIngredient: ['Eine Schüssel voll Linsen', 'ein paar Kräuter', 'nach Lust Gemüse', '200 g Nudeln'] });
    put(dir, 'u.jsonl', jsonl([unclear]));
    const s = new RecipeStore(dir);
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ pending: 1, imported: 0 });
    expect(s.stats()).toMatchObject({ pending: 1, collection: 0 });
    const ask = vi.fn(async () => ({ zutaten: ['Linsen', 'Kräuter', 'Gemüse', 'Nudeln'].map((name) => ({ name, menge: 100, einheit: 'g', abteilung: 'Vorrat', roh: false })) }));
    put(dir, 'v.jsonl', jsonl([recipe(9)]));
    await s.scanInbox({ noOpenRide: open, ask });
    expect(s.stats()).toMatchObject({ pending: 0, collection: 2 });
    s.close();
  });

  it('is run by the meal coach at its tick, even with no one planning, and not during a ride', async () => {
    const dir = tmp();
    let ride = true;
    const coach = new MealCoach({ dir: path.join(dir, 'meals'), recipesDir: path.join(dir, 'recipes'), nowMs: () => Date.now(), profiles: () => [], noOpenRide: () => !ride });
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
