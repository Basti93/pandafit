// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { openIdb } from '../../../src/web/idbStore';
import { dayIndex, weekOf } from '../../../src/shared/meals';
import { EatersButton } from '../../../src/web/essen/RecipeParts';
import type { Week } from '../../../src/web/essen/meals-view';
import type { Meal } from '../../../src/shared/meals';
import { NOW, json, boot, openMeal, pill } from './helpers';

afterEach(cleanup);

describe('the meal page', () => {
  const week = weekOf(NOW);
  const today = dayIndex(NOW);
  const RID = 'c-00000000000001';
  const dish = (title: string, recipeId?: string) => ({ title, ingredients: [{ name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }], steps: ['Verrühren.'], minutes: 5, proteinG: 27, keepsDays: 2, source: recipeId ? 'rezept' : 'liste', ...(recipeId ? { recipeId, sourceUrl: 'https://rezepte.example/x' } : {}) });
  const planWith = (meals: unknown[]): TrackedRecord => ({ kind: 'mealplan', id: `week-${week}`, updatedMs: NOW - 1000, deleted: false, body: {
    week, createdMs: NOW - 1000, source: 'liste', trainingDays: [], you: 'pb', people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }], meals } });
  const mealPlan = planWith([
    { day: today, slot: 'fruehstueck', dish: dish('Skyr mit Beeren'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
    { day: today, slot: 'mittag', dish: dish('Linsen-Bolognese', RID), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: true },
    { day: (today + 1) % 7, slot: 'abend', dish: dish('Tomatensuppe'), reuseOf: null, eaters: ['pa'], takeAlong: false },
  ]);
  const recipes = (url: string) => json(200, url.includes('/search') ? { items: [], more: false } : { id: RID, title: 'Linsen-Bolognese', minutes: 5, proteinG: 25, keepsDays: 2, own: false, fav: false, image: true, tags: [], ingredients: [], steps: ['Linsen kochen.'], sourceUrl: '' });
  const goEssen = async () => fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));

  it('a meal opens as its page: picture, kicker, title, sentence, who eats, ingredients and steps; Essen comes back', async () => {
    await boot({ account: 'anna', seed: [mealPlan], recipes });
    await goEssen();
    await openMeal('Skyr mit Beeren');
    const head = await screen.findByRole('region', { name: 'Skyr mit Beeren' });
    expect(head.querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#fruehstueck');
    expect(head.textContent).toContain('Frühstück · heute um 8 Uhr');
    expect(within(head).getByRole('button', { name: /Max und Lena essen mit/ }).className).toContain('secondary');
    expect(screen.getByRole('region', { name: 'Zutaten' }).textContent).toContain('Skyr');
    expect(screen.getByRole('region', { name: "So geht's" }).textContent).toContain('Verrühren.');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(pill('Essen'));
    expect(await screen.findByRole('button', { name: /Skyr mit Beeren/ })).toBeTruthy();
  });

  it('a meal with a recipe shows its photo, falls back to the drawing when it fails, and leads to the whole recipe', async () => {
    await boot({ account: 'anna', seed: [mealPlan], recipes });
    await goEssen();
    await openMeal('Linsen-Bolognese');
    const head = await screen.findByRole('region', { name: 'Linsen-Bolognese' });
    const img = head.querySelector('img.tk-meal.big') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/coach/recipes/${RID}/image`);
    fireEvent.error(img);
    expect(head.querySelector('img')).toBeNull();
    expect(head.querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#mittag');
    const whole = screen.getByRole('button', { name: 'Ganzes Rezept ansehen' });
    expect(whole.className).toBe('secondary');
    fireEvent.click(whole);
    expect(await screen.findByText('Linsen kochen.')).toBeTruthy();
  });

  it('two quick changes in Wer isst mit both land in the state record', async () => {
    const a = await boot({ account: 'anna', seed: [mealPlan] });
    await goEssen();
    await openMeal('Skyr mit Beeren');
    fireEvent.click(await screen.findByRole('button', { name: /Max und Lena essen mit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lena isst mit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Max isst mit' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('mealplan')).find((r) => r.id === `state-${week}`);
      s.close();
      const eaters = (rec?.body as { eaters?: Record<string, Record<string, { on: boolean }>> } | undefined)?.eaters?.[`${today}-fruehstueck`];
      expect(eaters?.pb?.on).toBe(false);
      expect(eaters?.pa?.on).toBe(false);
    });
  });

  it('the reader comes first in Wer isst mit, whatever the case', async () => {
    const first = async (people: string[]) => {
      const plan = planWith([{ day: today, slot: 'fruehstueck', dish: dish('Skyr mit Beeren'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false }]);
      await boot({ account: 'anna', seed: [{ ...plan, body: { ...(plan.body as object), people: [{ id: 'pa', name: people[0] }, { id: 'pb', name: people[1] }] } }] });
      await goEssen();
      await openMeal('Skyr mit Beeren');
      fireEvent.click(await screen.findByRole('button', { name: /essen mit/ }));
      const names = within(screen.getByRole('group', { name: 'Wer isst mit' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      cleanup();
      return names;
    };
    expect(await first(['Max', 'Anna'])).toEqual(['Anna isst mit', 'Max isst mit']);
    expect(await first(['Max', 'Lena'])).toEqual(['Max isst mit', 'Lena isst mit']);
  });

  it('a rest has no ingredients, only the note to pack it; a wished meal says who wished it', async () => {
    const yesterday = (today + 6) % 7;
    const plan = planWith([
      { day: today, slot: 'mittag', dish: dish('Chili'), reuseOf: `${yesterday}-abend`, eaters: ['pa'], takeAlong: false },
      { day: today, slot: 'abend', dish: dish('Nudeln'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false, askedBy: 'pb' },
    ]);
    await boot({ account: 'anna', seed: [plan] });
    await goEssen();
    await openMeal('Chili');
    expect(await screen.findByText('Das ist schon gekocht. Pack es einfach ein.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Zutaten' })).toBeNull();
    fireEvent.click(pill('Essen'));
    await openMeal('Nudeln');
    expect((await screen.findByRole('region', { name: 'Nudeln' })).textContent).toContain('Auf Wunsch von Lena.');
  });

  it('a meal nobody eats says so in the ingredients card', async () => {
    const plan = planWith([
      { day: today, slot: 'abend', dish: dish('Nudeln'), reuseOf: null, eaters: [], takeAlong: false },
    ]);
    await boot({ account: 'anna', seed: [plan] });
    await goEssen();
    await openMeal('Nudeln');
    const card = await screen.findByRole('region', { name: 'Zutaten' });
    expect(card.textContent).toContain('Diesmal isst niemand mit.');
    expect(screen.getByRole('region', { name: "So geht's" })).toBeTruthy();
  });

  it('a day that is over shows who ate as a sentence, not a button', () => {
    const meal = { day: 0, slot: 'abend', dish: dish('X'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false } as unknown as Meal;
    const w = { plan: { ...(planWith([]).body as object), meals: [meal] }, state: { items: {}, eaters: {} } } as unknown as Week;
    const r = render(<EatersButton week={w} meal={meal} past onEater={() => {}} />);
    expect(r.container.textContent).toBe('Max und Lena essen mit');
    expect(r.queryByRole('button')).toBeNull();
  });

  it('from Heute a meal opens the Essen page, and its back pill leads to Heute', async () => {
    await boot({ account: 'anna', seed: [mealPlan] });
    const list = await screen.findByRole('list', { name: 'Essen heute' });
    fireEvent.click(within(list).getByRole('button', { name: /Linsen-Bolognese/ }));
    expect(await screen.findByRole('region', { name: 'Linsen-Bolognese' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Seiten' }).querySelector('[aria-current="page"]')!.textContent).toContain('Essen');
    fireEvent.click(pill('Heute'));
    expect(await screen.findByRole('list', { name: 'Essen heute' })).toBeTruthy();
  });

  it('the browser Back leaves the meal page', async () => {
    await boot({ account: 'anna', seed: [mealPlan] });
    await goEssen();
    await openMeal('Skyr mit Beeren');
    await screen.findByRole('region', { name: 'Zutaten' });
    window.history.back();
    expect(await screen.findByRole('button', { name: /Skyr mit Beeren/ })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Zutaten' })).toBeNull();
  });
});
