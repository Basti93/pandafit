// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { openIdb } from '../../../src/web/idbStore';
import { addWeeks, dayIndex, weekOf } from '../../../src/shared/meals';
import { boot } from './helpers';

afterEach(cleanup);

describe('Essen start page', () => {
  const RID = 'c-00000000000001';
  // A Wednesday, a Saturday and a Sunday in January 2027.
  const at = (date: number, h: number, m = 0) => new Date(2027, 0, date, h, m).getTime();
  const dish = (title: string, recipeId?: string) => ({ title, ingredients: [{ name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }], steps: ['Verrühren.'], minutes: 5, proteinG: 27, keepsDays: 2, source: recipeId ? 'rezept' : 'liste', ...(recipeId ? { recipeId } : {}) });
  const meal = (day: number, slot: string, title: string, recipeId?: string) => ({ day, slot, dish: dish(title, recipeId), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false });
  const planFor = (ms: number, meals: unknown[]): TrackedRecord => {
    const week = weekOf(ms);
    return { kind: 'mealplan', id: `week-${week}`, updatedMs: ms - 1000, deleted: false, body: { week, createdMs: ms - 1000, source: 'liste', trainingDays: [], you: 'pb', people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }], meals } };
  };
  const wed = at(13, 11);
  const wedDay = dayIndex(wed);
  const weekWith3MealsToday = planFor(wed, [
    meal(wedDay, 'fruehstueck', 'Skyr mit Beeren'),
    meal(wedDay, 'mittag', 'Linsen-Bolognese', RID),
    meal(wedDay, 'abend', 'Tomatensuppe'),
    meal(wedDay + 1, 'fruehstueck', 'Haferbrei'),
    meal(wedDay + 1, 'mittag', 'Kichererbsen-Curry'),
    meal(wedDay + 1, 'abend', 'Gemüsepfanne'),
  ]);
  const goEssen = async () => fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));

  it('Essen: head card, the next meal large with its picture, the rest of today small, the week calm, two tiles and Bo', async () => {
    await boot({ account: 'anna', seed: [weekWith3MealsToday], now: wed });
    await goEssen();
    const head = await screen.findByRole('region', { name: 'Essen' });
    expect(within(head).getByRole('heading', { level: 1 }).textContent).toBe('Essen');
    expect(head.textContent).toContain('Das Frühstück liegt hinter dir. Als Nächstes gibt es um 13 Uhr');
    const main = screen.getByRole('region', { name: 'Nächste Mahlzeit' });
    expect(main.querySelector('svg.tk-meal.big, img.tk-meal.big')).toBeTruthy();
    expect(within(main).getByRole('button', { name: 'Rezept ansehen' }).className).toBe('primary');
    expect(screen.getByRole('button', { name: /Frühstück · 8 Uhr/ }).textContent).toContain('War heute früh dran.');
    expect(screen.getByRole('region', { name: 'Der Rest der Woche' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Rezepte/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Einkauf/ }).textContent).toMatch(/Dinge? offen|Alles ist erledigt/);
    expect(document.querySelector('.tk-bo')!.textContent).toContain('Schmeckt dir etwas nicht');
    expect(screen.queryByRole('group', { name: 'Ansicht' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Tag' })).toBeNull();
    expect(document.querySelectorAll('.tk-screen button:not([class])')).toHaveLength(0);
  });

  it('a meal with a recipe shows the photo on the main card; one without shows the drawing in its row', async () => {
    await boot({ account: 'anna', seed: [weekWith3MealsToday], now: wed });
    await goEssen();
    const main = await screen.findByRole('region', { name: 'Nächste Mahlzeit' });
    expect(main.querySelector<HTMLImageElement>('img.tk-meal.big')!.src).toMatch(new RegExp(`/coach/recipes/${RID}/image$`));
    expect(screen.getByRole('button', { name: /Frühstück · 8 Uhr/ }).querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#fruehstueck');
  });

  it('late in the evening the main card is tomorrow’s breakfast; without one there is no main card', async () => {
    await boot({ account: 'anna', seed: [weekWith3MealsToday], now: at(13, 21, 30) });
    await goEssen();
    expect((await screen.findByRole('region', { name: 'Nächste Mahlzeit' })).textContent).toContain('Morgen · Frühstück um 8 Uhr');
    cleanup();
    const sun = at(17, 22);
    await boot({ account: 'anna', seed: [planFor(sun, [meal(dayIndex(sun), 'abend', 'Tomatensuppe')])], now: sun });
    await goEssen();
    const head = await screen.findByRole('region', { name: 'Essen' });
    expect(screen.queryByRole('region', { name: 'Nächste Mahlzeit' })).toBeNull();
    expect(head.textContent).toContain('Für heute steht nichts mehr an. Der nächste Plan kommt am Samstagmorgen.');
  });

  it('a day of the week opens its three meals; a meal there opens its page', async () => {
    await boot({ account: 'anna', seed: [weekWith3MealsToday], now: wed });
    await goEssen();
    fireEvent.click(await screen.findByRole('button', { name: /^Do 14\./ }));
    const dialog = await screen.findByRole('dialog', { name: /Donnerstag/ });
    expect(within(dialog).getAllByRole('button').filter((b) => /Haferbrei|Kichererbsen-Curry|Gemüsepfanne/.test(b.textContent ?? ''))).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole('button', { name: /Kichererbsen-Curry/ }));
    expect(await screen.findByRole('region', { name: 'Kichererbsen-Curry' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with only next week’s plan there is no rest of the week, but Nächste Woche', async () => {
    const sat = at(16, 10);
    await boot({ account: 'anna', seed: [planFor(at(18, 10), [meal(0, 'abend', 'Tomatensuppe')])], now: sat });
    await goEssen();
    const next = await screen.findByRole('region', { name: 'Nächste Woche' });
    expect(screen.queryByRole('region', { name: 'Der Rest der Woche' })).toBeNull();
    expect(next.querySelectorAll('.tk-rowcard')).toHaveLength(7);
    expect(next.textContent).toContain('Nichts geplant');
    expect(screen.getByRole('region', { name: 'Essen' }).textContent).toContain('Am Montag gibt es um 19 Uhr Tomatensuppe.');
    expect(screen.getByRole('region', { name: 'Nächste Mahlzeit' }).textContent).toContain('Tomatensuppe');
  });

  it('a day with a plan but no meals today points to the next day with a meal', async () => {
    const tue = at(12, 11);
    await boot({ account: 'anna', seed: [planFor(tue, [meal(dayIndex(tue) + 2, 'mittag', 'Kichererbsen-Curry')])], now: tue });
    await goEssen();
    const head = await screen.findByRole('region', { name: 'Essen' });
    expect(head.textContent).toContain('Heute ist nichts geplant. Am Donnerstag gibt es um 13 Uhr Kichererbsen-Curry.');
    expect(screen.getByRole('region', { name: 'Nächste Mahlzeit' }).textContent).toContain('Donnerstag · Mittagessen um 13 Uhr');
  });

  it('Plan ändern opens the message sheet and writes for the week Einkauf shows first', async () => {
    const sat = at(16, 10);
    const nextWeek = addWeeks(weekOf(sat), 1);
    const a = await boot({ account: 'anna', seed: [planFor(sat, [meal(dayIndex(sat), 'abend', 'Tomatensuppe')]), planFor(at(18, 10), [meal(0, 'abend', 'Haferbrei')])], now: sat });
    await goEssen();
    fireEvent.click(await screen.findByRole('button', { name: 'Plan ändern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan ändern' });
    expect(within(dialog).getByRole('button', { name: 'Senden' }).className).toBe('primary');
    fireEvent.change(within(dialog).getByLabelText('Nachricht an Bo'), { target: { value: 'Mittwoch lieber Nudeln' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('mealplan')).find((r) => r.id.startsWith('chat-'));
      s.close();
      expect((rec?.body as { week: string }).week).toBe(nextWeek);
    });
  });

  it('Plan ändern on a Wednesday writes for the current week', async () => {
    const a = await boot({ account: 'anna', seed: [weekWith3MealsToday, planFor(at(20, 10), [meal(0, 'abend', 'Haferbrei')])], now: wed });
    await goEssen();
    fireEvent.click(await screen.findByRole('button', { name: 'Plan ändern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plan ändern' });
    fireEvent.change(within(dialog).getByLabelText('Nachricht an Bo'), { target: { value: 'Donnerstag lieber Nudeln' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Senden' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('mealplan')).find((r) => r.id.startsWith('chat-'));
      s.close();
      expect((rec?.body as { week: string }).week).toBe(weekOf(wed));
    });
  });
});
