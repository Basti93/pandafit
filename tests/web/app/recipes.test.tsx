// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { openIdb } from '../../../src/web/idbStore';
import { dayIndex, weekOf } from '../../../src/shared/meals';
import { NOW, json, boot, openMeal } from './helpers';

afterEach(cleanup);

describe('Rezepte on the phone', () => {
  const week = weekOf(NOW);
  const today = dayIndex(NOW);
  const RID = (n: number) => `c-${String(n).padStart(14, '0')}`;
  const dish = (title: string, recipeId?: string) => ({ title, ingredients: [{ name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }], steps: ['Verrühren.'], minutes: 5, proteinG: 27, keepsDays: 2, source: recipeId ? 'rezept' : 'liste', ...(recipeId ? { recipeId, sourceUrl: 'https://rezepte.example/x' } : {}) });
  const mealPlan: TrackedRecord = { kind: 'mealplan', id: `week-${week}`, updatedMs: NOW - 1000, deleted: false, body: {
    week, createdMs: NOW - 1000, source: 'liste', trainingDays: [], you: 'pb', people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }],
    meals: [
      { day: today, slot: 'fruehstueck', dish: dish('Skyr mit Beeren'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: today, slot: 'mittag', dish: dish('Erfundener Linsentopf', RID(1)), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: (today + 1) % 7, slot: 'abend', dish: dish('Tomatensuppe'), reuseOf: null, eaters: ['pa'], takeAlong: false },
    ] } };
  const item = (n: number, over: Record<string, unknown> = {}) => ({ id: RID(n), title: `Erfundener Topf ${n}`, minutes: 20 + n, proteinG: 25, keepsDays: 2, own: false, fav: false, image: n % 2 === 1, tags: ['Proteinreich', 'Pfannengericht'], ...over });
  const detail = (n: number) => ({ ...item(n), ingredients: [{ name: 'Linsen', amount: 100, unit: 'g', section: 'Vorrat' }, { name: 'Zwiebel', amount: 1, unit: 'Stk', section: 'Obst und Gemüse' }], steps: ['Linsen kochen.', 'Abschmecken.'], sourceUrl: 'https://rezepte.example/topf' });
  const route = (urls: string[], pages: Record<string, unknown> = {}) => (url: string): Response => {
    urls.push(url);
    if (url.includes('/search')) return json(200, pages[new URL(url, 'http://x').searchParams.get('offset') ?? '0'] ?? { items: [item(1), item(2)], more: false });
    const id = /\/coach\/recipes\/(c-\d+)$/.exec(url)?.[1];
    return id ? json(200, detail(Number(id.slice(2)))) : json(404, {});
  };
  const open = async (o: Parameters<typeof boot>[0] = {}) => {
    const a = await boot({ account: 'anna', seed: [mealPlan], ...o });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Rezepte/ }));
    return a;
  };
  const records = async (a: { factory: IDBFactory }, prefix: string) => { const s = await openIdb('anna', a.factory); const r = (await s.list('mealplan')).filter((x) => x.id.startsWith(prefix)); s.close(); return r; };

  it('lists recipes with a picture or a calm colour block, title and one muted line', async () => {
    const urls: string[] = [];
    await open({ recipes: route(urls) });
    expect(await screen.findByText('Erfundener Topf 1')).toBeTruthy();
    expect(screen.getByText('21 Min · Proteinreich')).toBeTruthy();
    const imgs = [...document.querySelectorAll('.rc-open img')] as HTMLImageElement[];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([`/coach/recipes/${RID(1)}/image`]);
    // The recipe without a picture shows its first letter instead.
    expect(document.querySelectorAll('.rc-open .rc-blank')).toHaveLength(1);
    expect(urls[0]).toContain('/coach/recipes/search?limit=20');
  });

  it('works without any pictures, and when one cannot be loaded', async () => {
    await open({ recipes: (url) => (url.includes('/search') ? json(200, { items: [item(1, { image: false }), item(3, { image: true })], more: false }) : json(404, {})) });
    await screen.findByText('Erfundener Topf 3');
    const img = document.querySelector('.rc-open img') as HTMLImageElement;
    fireEvent.error(img);
    expect(document.querySelectorAll('.rc-open img')).toHaveLength(0);
    expect(document.querySelectorAll('.rc-open .rc-blank')).toHaveLength(2);
  });

  it('searches as you type and filters with chips, one row, each chip a parameter', async () => {
    const urls: string[] = [];
    await open({ recipes: route(urls) });
    await screen.findByText('Erfundener Topf 1');
    const chips = within(screen.getByRole('group', { name: 'Filter' }));
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['Favoriten', 'Von mir', 'schnell', 'proteinreich', 'Saison']);
    fireEvent.click(chips.getByRole('button', { name: 'Favoriten' }));
    await waitFor(() => expect(urls.at(-1)).toContain('fav=1'));
    fireEvent.click(chips.getByRole('button', { name: 'Von mir' }));
    await waitFor(() => expect(urls.at(-1)).toContain('own=1'));
    fireEvent.click(chips.getByRole('button', { name: 'schnell' }));
    fireEvent.click(chips.getByRole('button', { name: 'Saison' }));
    // The season is the current one (January: winter).
    await waitFor(() => expect(decodeURIComponent(urls.at(-1)!)).toContain('tags=schnell,saison:winter'));
    fireEvent.change(screen.getByLabelText('Rezept suchen'), { target: { value: 'linsen' } });
    await waitFor(() => expect(urls.at(-1)).toContain('q=linsen'));
  });

  it('pages 20 at a time with "Mehr anzeigen"', async () => {
    const urls: string[] = [];
    const first = Array.from({ length: 20 }, (_, i) => item(i + 1));
    await open({ recipes: route(urls, { '0': { items: first, more: true }, '20': { items: [item(21), item(1)], more: false } }) });
    await screen.findByText('Erfundener Topf 20');
    fireEvent.click(screen.getByRole('button', { name: 'Mehr anzeigen' }));
    expect(await screen.findByText('Erfundener Topf 21')).toBeTruthy();
    expect(urls.at(-1)).toContain('offset=20');
    // The repeated recipe is not listed twice, and there is no more button left.
    expect(screen.getAllByText('Erfundener Topf 1')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Mehr anzeigen' })).toBeNull();
  });

  it('says calmly when the recipes cannot be reached, and tries again', async () => {
    let up = false;
    await open({ recipes: (url) => (up ? route([])(url) : json(503, {})) });
    expect(await screen.findByText(/Die Rezepte sind gerade nicht erreichbar/)).toBeTruthy();
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal' }));
    expect(await screen.findByText('Erfundener Topf 1')).toBeTruthy();
  });

  it('hearts: one tap writes a record per recipe, another tap a tombstone; the label says what it does', async () => {
    const a = await open({ recipes: route([]) });
    const heart = await screen.findByRole('button', { name: 'Erfundener Topf 1 zu den Favoriten' });
    fireEvent.click(heart);
    await waitFor(async () => expect(await records(a, 'fav-')).toHaveLength(1));
    expect((await records(a, 'fav-'))[0]).toMatchObject({ id: `fav-${RID(1)}`, deleted: false });
    const on = await screen.findByRole('button', { name: 'Erfundener Topf 1 aus den Favoriten nehmen' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(on);
    await waitFor(async () => expect((await records(a, 'fav-'))[0]!.deleted).toBe(true));
    expect(await screen.findByRole('button', { name: 'Erfundener Topf 1 zu den Favoriten' })).toBeTruthy();
  });

  it('the Favoriten chip drops a recipe at once when its heart is taken back', async () => {
    const fav: TrackedRecord = { kind: 'mealplan', id: `fav-${RID(2)}`, updatedMs: NOW - 10, deleted: false, body: { atMs: NOW - 10 } };
    await open({ seed: [mealPlan, fav], recipes: (url) => (url.includes('fav=1') ? json(200, { items: [item(2, { fav: true })], more: false }) : route([])(url)) });
    fireEvent.click(await screen.findByRole('button', { name: 'Favoriten' }));
    const heart = await screen.findByRole('button', { name: 'Erfundener Topf 2 aus den Favoriten nehmen' });
    fireEvent.click(heart);
    expect(await screen.findByText('Noch keine Favoriten. Tippe bei einem Rezept auf das Herz.')).toBeTruthy();
  });

  it('opens the recipe: picture, facts, tags, portions that scale the ingredients, steps and the original', async () => {
    await open({ recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    expect(await screen.findByText('Linsen kochen.')).toBeTruthy();
    expect(screen.getByText('21 Min · 25 g Eiweiß · hält 2 Tage')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Schlagwörter' }).textContent).toContain('Proteinreich');
    expect(document.querySelector('img.rc-hero')?.getAttribute('src')).toBe(`/coach/recipes/${RID(1)}/image`);
    expect(screen.getByText('200 g')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eine Portion mehr' }));
    expect(screen.getByText('300 g')).toBeTruthy();
    expect(screen.getByText('3 Portionen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eine Portion weniger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eine Portion weniger' }));
    expect(screen.getByText('100 g')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Eine Portion weniger' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Zum Originalrezept ↗' }).getAttribute('href')).toBe('https://rezepte.example/topf');
  });

  it('the heart in the recipe view toggles the favourite too', async () => {
    const a = await open({ recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    const hearts = await screen.findAllByRole('button', { name: 'Erfundener Topf 1 zu den Favoriten' });
    fireEvent.click(hearts.at(-1)!);
    await waitFor(async () => expect(await records(a, 'fav-')).toHaveLength(1));
    expect((await screen.findAllByRole('button', { name: 'Erfundener Topf 1 aus den Favoriten nehmen' })).length).toBe(2);
  });

  it('In den Plan: pick a day and a meal, it replaces that one and is sent as a request the coach answers', async () => {
    const a = await open({ recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'In den Plan ›' }));
    const day = within(await screen.findByRole('group', { name: 'Tag' }));
    // Days before today are not offered.
    const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    names.forEach((n, i) => expect((day.getByRole('button', { name: new RegExp(`^${n}`) }) as HTMLButtonElement).disabled).toBe(i < today));
    fireEvent.click(within(screen.getByRole('group', { name: 'Mahlzeit' })).getByRole('button', { name: 'Frühstück' }));
    expect(screen.getByText(/Tauscht Skyr mit Beeren aus/)).toBeTruthy();
    expect(screen.getByText(/isst mit: Max, Lena/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eintragen' }));
    expect(await screen.findByText('Bo trägt es gleich ein.')).toBeTruthy();
    const sent = await records(a, 'place-');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ week, meal: `${today}-fruehstueck`, recipeId: RID(1), result: null });
  });

  it('shows the coach\'s answer to a placement that does not fit', async () => {
    const answered: TrackedRecord = { kind: 'mealplan', id: 'place-answered1', updatedMs: NOW + 5, deleted: false, body: { week, meal: `${today}-abend`, recipeId: RID(1), atMs: NOW + 10, result: 'nofit', answeredMs: NOW + 20 } };
    await open({ seed: [mealPlan, answered], recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'In den Plan ›' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eintragen' }));
    expect(await screen.findByText('Das passt nicht zu den Angaben der Esser dieser Mahlzeit.')).toBeTruthy();
  });

  it('a meal of a real recipe shows its photo, falls back to the drawing when it fails, and leads to the whole recipe', async () => {
    await boot({ account: 'anna', seed: [mealPlan], recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    await openMeal('Erfundener Linsentopf');
    const head = await screen.findByRole('region', { name: 'Erfundener Linsentopf' });
    const img = head.querySelector('img.tk-meal.big') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/coach/recipes/${RID(1)}/image`);
    fireEvent.error(img);
    expect(head.querySelector('img')).toBeNull();
    expect(head.querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#mittag');
    const whole = screen.getByRole('button', { name: 'Ganzes Rezept ansehen' });
    expect(whole.className).toBe('secondary');
    fireEvent.click(whole);
    expect(await screen.findByText('Linsen kochen.')).toBeTruthy();
  });

  it('a recipe that cannot be opened says so calmly', async () => {
    await boot({ account: 'anna', seed: [mealPlan], recipes: () => json(404, {}) });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    await openMeal('Erfundener Linsentopf');
    fireEvent.click(await screen.findByRole('button', { name: 'Ganzes Rezept ansehen' }));
    expect(await screen.findByText('Dieses Rezept ist gerade nicht zu öffnen.')).toBeTruthy();
  });
});
