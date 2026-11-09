// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { openIdb } from '../../../src/web/idbStore';
import { addWeeks, dayIndex, weekOf } from '../../../src/shared/meals';
import { json, boot, pill } from './helpers';

afterEach(cleanup);

describe('A recipe as a page', () => {
  // A Wednesday in January 2027 at 18:00 (dinner not over), and a Sunday at 21:30 (dinner over).
  const WED = new Date(2027, 0, 6, 18, 0).getTime();
  const SUN = new Date(2027, 0, 10, 21, 30).getTime();
  const RID = (n: number) => `c-${String(n).padStart(14, '0')}`;
  const dish = (title: string, recipeId?: string) => ({ title, ingredients: [{ name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }], steps: ['Verrühren.'], minutes: 5, proteinG: 27, keepsDays: 2, source: recipeId ? 'rezept' : 'liste', ...(recipeId ? { recipeId, sourceUrl: 'https://rezepte.example/x' } : {}) });
  const plan = (now: number, meals: unknown[], weekKey = weekOf(now)): TrackedRecord => ({ kind: 'mealplan', id: `week-${weekKey}`, updatedMs: now - 1000, deleted: false, body: {
    week: weekKey, createdMs: now - 1000, source: 'liste', trainingDays: [], you: 'pb', people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }], meals } });
  const meal = (day: number, slot: string, title: string, recipeId?: string) => ({ day, slot, dish: dish(title, recipeId), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false });
  const item = (n: number, over: Record<string, unknown> = {}) => ({ id: RID(n), title: `Erfundener Topf ${n}`, minutes: 20 + n, proteinG: 25, keepsDays: 2, own: false, fav: false, image: n % 2 === 1, tags: ['Proteinreich', 'Pfannengericht'], ...over });
  const detail = (n: number, over: Record<string, unknown> = {}) => ({ ...item(n, over), ingredients: [{ name: 'Linsen', amount: 100, unit: 'g', section: 'Vorrat' }], steps: ['Linsen kochen.'], sourceUrl: 'https://rezepte.example/topf' });
  const recipes = (over: Record<string, unknown> = {}) => (url: string): Response => {
    if (url.includes('/search')) return json(200, { items: [item(1, over), item(2)], more: false });
    const id = /\/coach\/recipes\/(c-\d+)$/.exec(url)?.[1];
    return id ? json(200, detail(Number(id.slice(2)), over)) : json(404, {});
  };
  const openRecipe = async (title: string, o: Parameters<typeof boot>[0]) => {
    const a = await boot({ account: 'anna', ...o });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Rezepte/ }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}\\s?\\d+ Min`) }));
    return a;
  };
  const wedPlan = () => plan(WED, [meal(2, 'fruehstueck', 'Skyr mit Beeren'), meal(2, 'abend', 'Tomatensuppe')]);
  const records = async (a: { factory: IDBFactory }, prefix: string) => { const s = await openIdb('anna', a.factory); const r = (await s.list('mealplan')).filter((x) => x.id.startsWith(prefix)); s.close(); return r; };

  it('is a page: picture, sentence, heart, ingredients with portions, steps, In den Plan and Mehr', async () => {
    await openRecipe('Erfundener Topf 1', { seed: [wedPlan()], now: WED, recipes: recipes() });
    const head = await screen.findByRole('region', { name: 'Erfundener Topf 1' });
    expect(head.textContent).toContain('In 21 Minuten fertig');
    expect(within(head).getByRole('button', { name: 'Erfundener Topf 1 zu den Favoriten' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(head).getByRole('list', { name: 'Schlagwörter' }).textContent).toContain('Proteinreich');
    fireEvent.click(screen.getByRole('button', { name: 'Eine Portion mehr' }));
    expect(screen.getByRole('region', { name: 'Zutaten' }).textContent).toContain('3 Portionen');
    expect(screen.getByText('Linsen kochen.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'In den Plan' })).getByRole('button', { name: /eintragen$/ }).className).toBe('primary');
    expect(within(screen.getByRole('region', { name: 'Mehr zu diesem Rezept' })).getByRole('link', { name: 'Originalrezept öffnen' }).getAttribute('href')).toBe('https://rezepte.example/topf');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('without a photo the page shows the drawn pan', async () => {
    await openRecipe('Erfundener Topf 2', { seed: [wedPlan()], now: WED, recipes: recipes({ image: false }) });
    const head = await screen.findByRole('region', { name: 'Erfundener Topf 2' });
    expect(head.querySelector('img')).toBeNull();
    expect(head.querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#abend');
  });

  it('In den Plan preselects a day and a meal; Eintragen sends the request and waits for the answer', async () => {
    const a = await openRecipe('Erfundener Topf 1', { seed: [wedPlan()], now: WED, recipes: recipes() });
    const card = within(await screen.findByRole('region', { name: 'In den Plan' }));
    expect(card.getByRole('button', { name: 'Heute zum Abendessen eintragen' })).toBeTruthy();
    expect(card.getByText('Max und Lena essen mit.', { exact: false })).toBeTruthy();
    expect(card.getByText('Tauscht Tomatensuppe aus.')).toBeTruthy();
    const days = within(card.getByRole('group', { name: 'Tag' }));
    expect(days.getAllByRole('button').map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, true, false, false, false, false, false]);
    fireEvent.click(within(card.getByRole('group', { name: 'Mahlzeit' })).getByRole('button', { name: 'Frühstück' }));
    expect(card.getByText('Tauscht Skyr mit Beeren aus.')).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Heute zum Frühstück eintragen' }));
    expect(await card.findByRole('status')).toHaveProperty('textContent', 'Bo trägt es gleich ein.');
    expect((card.getByRole('button', { name: /eintragen$/ }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(async () => expect(await records(a, 'place-')).toHaveLength(1));
    expect((await records(a, 'place-'))[0]!.body).toMatchObject({ week: weekOf(WED), meal: `${dayIndex(WED)}-fruehstueck`, recipeId: RID(1), result: null });
  });

  it('after dinner time tomorrow is preselected, across the week end', async () => {
    const next = addWeeks(weekOf(SUN), 1);
    await openRecipe('Erfundener Topf 1', { seed: [plan(SUN, [meal(6, 'abend', 'Tomatensuppe')]), plan(SUN, [meal(0, 'abend', 'Nudeln')], next)], now: SUN, recipes: recipes() });
    const card = within(await screen.findByRole('region', { name: 'In den Plan' }));
    expect(card.getByRole('button', { name: 'Am Montag zum Abendessen eintragen' })).toBeTruthy();
    expect(card.getByRole('button', { name: 'Nächste Woche' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('without a plan the card says so and has no main button', async () => {
    await openRecipe('Erfundener Topf 1', { seed: [], flags: { 'pandafit.essensplan.anna': 'on' }, now: WED, recipes: recipes() });
    const card = within(await screen.findByRole('region', { name: 'In den Plan' }));
    expect(card.getByText('Es gibt noch keinen Essensplan, in den das Rezept passt.')).toBeTruthy();
    expect(card.queryByRole('button', { name: /eintragen$/ })).toBeNull();
  });

  it('a recipe already in the plan says where in the head card', async () => {
    await openRecipe('Erfundener Topf 1', { seed: [plan(WED, [meal(2, 'mittag', 'Linsentopf', RID(1))])], now: WED, recipes: recipes() });
    const head = await screen.findByRole('region', { name: 'Erfundener Topf 1' });
    expect(head.textContent).toContain('Steht schon im Plan: heute, Mittwoch, zum Mittagessen.');
  });

  it('a page starts at the top and the list gets its scroll position back', async () => {
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await boot({ account: 'anna', seed: [wedPlan()], now: WED, recipes: recipes() });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Rezepte/ }));
    // The person scrolls the list: the page follows by scroll events.
    Object.defineProperty(window, 'scrollY', { value: 340, configurable: true });
    fireEvent.scroll(window);
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?\d+ Min/ }));
    await screen.findByRole('region', { name: 'Erfundener Topf 1' });
    expect(spy).toHaveBeenLastCalledWith(0, 0);
    // The browser shortens the document under the hidden list and clamps the scroll: that must not be remembered.
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    fireEvent.scroll(window);
    fireEvent.click(pill('Rezepte'));
    await screen.findByRole('searchbox');
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(0, 340));
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    spy.mockRestore();
  });

  it('Back from a recipe returns to the list with its search; Back again to Essen', async () => {
    await boot({ account: 'anna', seed: [wedPlan()], now: WED, recipes: recipes() });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Rezepte/ }));
    fireEvent.change(await screen.findByLabelText('Rezept suchen'), { target: { value: 'Topf' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?\d+ Min/ }));
    await screen.findByRole('region', { name: 'Erfundener Topf 1' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(pill('Rezepte'));
    expect((await screen.findByLabelText('Rezept suchen') as HTMLInputElement).value).toBe('Topf');
    expect(screen.getByRole('list', { name: 'Rezepte' })).toBeTruthy();
    // The browser's Back does the same from a recipe page.
    const row = screen.getByRole('button', { name: /^Erfundener Topf 1\s?\d+ Min/ });
    row.focus(); // a real tap focuses the button; fireEvent does not
    fireEvent.click(row);
    await screen.findByRole('region', { name: 'Erfundener Topf 1' });
    window.history.back();
    await waitFor(() => expect(screen.getByRole('searchbox')).toBeTruthy());
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Topf');
    // The row that opened the recipe has the focus again.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Erfundener Topf 1\s?\d+ Min/ }));
    // Back again, also with the browser's Back, leaves to Essen.
    window.history.back();
    expect(await screen.findByRole('region', { name: 'Essen' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });
});
