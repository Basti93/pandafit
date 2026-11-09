// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { openIdb } from '../../../src/web/idbStore';
import { addWeeks, dayIndex, itemKey, weekOf } from '../../../src/shared/meals';
import { MealDetail, type Week } from '../../../src/web/MealsScreen';
import type { LiveSocket } from '../../../src/web/live';
import { NOW, DAY, json, boot } from './helpers';

afterEach(cleanup);

describe('Essen on the phone', () => {
  const week = weekOf(NOW);
  const dish = (title: string) => ({ title, ingredients: [{ name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }], steps: ['Verrühren.'], minutes: 5, proteinG: 27, keepsDays: 2, source: 'liste' });
  const today = dayIndex(NOW);
  const mealPlan: TrackedRecord = { kind: 'mealplan', id: `week-${week}`, updatedMs: NOW - 1000, deleted: false, body: {
    week, createdMs: NOW - 1000, source: 'liste', trainingDays: [], you: 'pb', people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }],
    meals: [
      { day: today, slot: 'fruehstueck', dish: dish('Skyr mit Beeren'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: today, slot: 'mittag', dish: dish('Linsen-Bolognese'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: true },
      { day: (today + 1) % 7, slot: 'abend', dish: dish('Tomatensuppe'), reuseOf: null, eaters: ['pa'], takeAlong: false },
    ] } };

  it('no Essen tab without a plan: the meal plan is off by default', async () => {
    await boot({ account: 'anna', seed: [] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Essen' })).toBeNull();
  });

  type FakeSocket = { s: LiveSocket; sent: string[]; closed: boolean };
  const fakeSockets = () => {
    const sockets: FakeSocket[] = [];
    const openLive = (): LiveSocket => {
      const entry: FakeSocket = { sent: [], closed: false, s: null as unknown as LiveSocket };
      entry.s = { send: (d: string) => { entry.sent.push(d); }, close: () => { entry.closed = true; }, onopen: null, onmessage: null, onclose: null, onerror: null };
      sockets.push(entry);
      return entry.s;
    };
    return { sockets, openLive };
  };
  const coachState = (on: boolean) => JSON.stringify({ type: 'coach-state', state: {}, hevy: { state: 'idle' }, garmin: { state: 'idle' }, gym: null,
    meals: { settings: { on, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'zuhause', abend: 'zuhause' } } } });
  /** The coach link's socket: the one that subscribed once opened. */
  const subscribed = async (sockets: FakeSocket[]): Promise<FakeSocket> => {
    let link!: FakeSocket;
    await waitFor(() => { act(() => { for (const x of sockets) if (!x.sent.length) x.s.onopen?.(); }); link = sockets.find((x) => !x.closed && x.sent.some((d) => d.includes('subscribe')))!; expect(link).toBeTruthy(); });
    return link;
  };

  it('a new device with empty storage: the switch on and no plan shows Essen after the coach answers, without a Profil visit; then the link closes', async () => {
    const { sockets, openLive } = fakeSockets();
    const a = await boot({ account: 'anna', seed: [], openLive });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Essen' })).toBeNull();
    const link = await subscribed(sockets);
    act(() => link.s.onmessage?.({ data: coachState(true) }));
    expect(await screen.findByRole('button', { name: 'Essen' })).toBeTruthy();
    expect(a.storage.get('pandafit.essensplan.anna')).toBe('on');
    expect(link.closed).toBe(true); // asked once, nothing keeps running
  });

  it('Essen follows the "Essensplan" switch: it shows at once, says when the first plan comes, and is remembered', async () => {
    const { sockets, openLive } = fakeSockets();
    const a = await boot({ account: 'anna', seed: [], openLive });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    // The coach's socket subscribes; its state says the meal plan is on.
    const link = await subscribed(sockets);
    expect(screen.queryByRole('button', { name: 'Essen' })).toBeNull();
    act(() => link.s.onmessage?.({ data: coachState(true) }));
    expect(await screen.findByRole('button', { name: 'Essen' })).toBeTruthy();
    expect(a.storage.get('pandafit.essensplan.anna')).toBe('on');
    // Switched off again: the tab goes.
    act(() => link.s.onmessage?.({ data: coachState(false) }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Essen' })).toBeNull());
    expect(a.storage.get('pandafit.essensplan.anna')).toBe('off');
    cleanup();
    // The last value seen counts from the start, before the coach is asked again; the page says when the first plan comes.
    await boot({ account: 'anna', seed: [], flags: { 'pandafit.essensplan.anna': 'on' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    expect(await screen.findByText('Noch kein Essensplan. Er kommt am Samstagmorgen für die nächste Woche.')).toBeTruthy();
  });

  describe('on Heute', () => {
    const withPlan = (meals: unknown[]): TrackedRecord => ({ ...mealPlan, body: { ...(mealPlan.body as object), meals } });
    it('is hidden without a plan, and when the plan has nothing for today', async () => {
      await boot({ account: 'anna', seed: [] });
      await screen.findByRole('navigation');
      expect(screen.queryByText('Essen heute')).toBeNull();
      cleanup();
      await boot({ account: 'anna', seed: [withPlan([{ day: (today + 1) % 7, slot: 'abend', dish: dish('Tomatensuppe'), reuseOf: null, eaters: ['pa'], takeAlong: false }])] });
      await screen.findByRole('button', { name: 'Essen' });
      expect(screen.queryByText('Essen heute')).toBeNull();
    });

    it('one row per slot of today in order, tapping opens the meal', async () => {
      await boot({ account: 'anna', seed: [mealPlan] });
      const list = await screen.findByRole('list', { name: 'Essen heute' });
      const rows = within(list).getAllByRole('listitem').map((r) => r.textContent ?? '');
      expect(rows[0]).toContain('Frühstück · Skyr mit Beeren');
      expect(rows[1]).toContain('Mittagessen · Linsen-Bolognese');
      expect(rows[0]).not.toContain('Min'); // how long it takes is for the plan, not for Heute
      expect(rows.some((r) => r.includes('Tomatensuppe'))).toBe(false);
      expect(screen.queryByText(/Heute vorkochen/)).toBeNull();
      fireEvent.click(within(list).getByRole('button', { name: /Linsen-Bolognese/ }));
      expect(await screen.findByRole('dialog')).toBeTruthy();
      expect(screen.getByText('Verrühren.')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(within(list).queryByRole('button', { name: /Essensplan/ })).toBeNull(); // the Essen tab is the way in, no second one
    });

    it('says rest and cook-ahead in words', async () => {
      const yesterday = (today + 6) % 7;
      await boot({ account: 'anna', seed: [withPlan([
        { day: today, slot: 'mittag', dish: dish('Linsen-Bolognese'), reuseOf: `${yesterday}-abend`, eaters: ['pa'], takeAlong: false },
        { day: today, slot: 'abend', dish: dish('Chili'), reuseOf: null, eaters: ['pa'], takeAlong: false },
        { day: (today + 1) % 7, slot: 'mittag', dish: dish('Chili'), reuseOf: `${today}-abend`, eaters: ['pa'], takeAlong: false },
      ])] });
      const list = await screen.findByRole('list', { name: 'Essen heute' });
      expect(within(list).getByRole('button', { name: /Linsen-Bolognese/ }).textContent).toContain('Rest von gestern');
      expect(await screen.findByText('Heute vorkochen: Chili')).toBeTruthy();
    });
  });

  it('today first with its meals, and a tick or a person off goes into the state record', async () => {
    const a = await boot({ account: 'anna', seed: [mealPlan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    expect(await screen.findByRole('heading', { name: 'Heute' })).toBeTruthy();
    // A meal is one row; the people and the recipe show when it is opened, one row at a time.
    const row = screen.getByRole('button', { name: /Skyr mit Beeren/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Lena isst mit' })).toBeNull();
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: /Linsen-Bolognese/ }));
    expect(screen.getByRole('button', { name: /Skyr mit Beeren/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Skyr mit Beeren/ }));
    expect(screen.getByText('Verrühren.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lena isst mit' }));
    // Only a deviation shows on the closed row.
    fireEvent.click(screen.getByRole('button', { name: /Skyr mit Beeren/ }));
    expect(await screen.findByText('Lena isst nicht mit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Einkauf/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Skyr gekauft' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('mealplan')).find((r) => r.id === `state-${week}`);
      s.close();
      const body = rec?.body as { items?: Record<string, { state: string }>; eaters?: Record<string, Record<string, { on: boolean }>> } | undefined;
      expect(body?.items?.[itemKey('Skyr', 'g')]?.state).toBe('gekauft');
      expect(body?.eaters?.[`${today}-fruehstueck`]?.pb?.on).toBe(false);
    });
  });

  it('own shopping items: added under "Eigenes", ticked, and removed after a confirm; all in the state record', async () => {
    const a = await boot({ account: 'anna', seed: [mealPlan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Einkauf/ }));
    fireEvent.change(await screen.findByLabelText('Etwas dazuschreiben'), { target: { value: 'Kaffee' } });
    fireEvent.change(screen.getByLabelText('Menge (optional)'), { target: { value: '2 Pakete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByRole('heading', { name: 'Eigenes' })).toBeTruthy();
    expect(screen.getByText('2 Pakete')).toBeTruthy();
    expect((screen.getByLabelText('Etwas dazuschreiben') as HTMLInputElement).value).toBe('');
    const stateOf = async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('mealplan')).find((r) => r.id === `state-${week}`);
      s.close();
      return (rec?.body as { own?: Record<string, { name: string; state: string; removed: boolean }> } | undefined)?.own ?? {};
    };
    await waitFor(async () => expect(Object.values(await stateOf()).map((o) => o.name)).toEqual(['Kaffee']));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kaffee gekauft' }));
    await waitFor(async () => expect(Object.values(await stateOf())[0]!.state).toBe('gekauft'));
    // The plan's own items keep "Haben wir"; an own item offers only a confirmed removal.
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(screen.getByText('Wirklich entfernen?')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(Object.values(await stateOf())[0]!.removed).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
    await waitFor(async () => expect(Object.values(await stateOf())[0]!.removed).toBe(true));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Eigenes' })).toBeNull());
  });

  it('"Haben wir" sits at the right of each open row, and the item moves to "Schon da"', async () => {
    await boot({ account: 'anna', seed: [mealPlan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Einkauf/ }));
    expect(screen.queryByText(/von \d+ noch offen/)).toBeNull();
    const skyr = (await screen.findByText('Skyr')).closest('li')!;
    fireEvent.click(within(skyr).getByRole('button', { name: 'Haben wir' }));
    expect(await screen.findByRole('heading', { name: 'Schon da' })).toBeTruthy();
    // Under "Schon da" there is no box, only the way back.
    expect(screen.queryByRole('checkbox', { name: 'Skyr gekauft' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Doch kaufen' })).toBeTruthy();
  });

  it('from Saturday the shopping list opens on next week when its plan is there, and the switch back works', async () => {
    const next = addWeeks(week, 1);
    const nextPlan: TrackedRecord = { ...mealPlan, id: `week-${next}`, body: { ...(mealPlan.body as object), week: next, meals: [{ day: 0, slot: 'abend', dish: { ...dish('Nudeln'), ingredients: [{ name: 'Nudeln', amount: 100, unit: 'g', section: 'Vorrat' }] }, reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false }] } };
    await boot({ account: 'anna', seed: [mealPlan, nextPlan], now: NOW + ((5 - today + 7) % 7) * DAY });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Einkauf/ }));
    expect(screen.getByRole('button', { name: 'Nächste Woche' }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText('Nudeln')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Diese Woche' }));
    expect(await screen.findByText('Skyr')).toBeTruthy();
    expect(screen.queryByText('Nudeln')).toBeNull();
  });

  it('the reader\'s own chip comes first, whatever the case; no match leaves the order', () => {
    const w = { plan: { ...(mealPlan.body as object), people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }], meals: [{ day: 0, slot: 'mittag', dish: dish('X'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false }], trainingDays: [] }, state: { items: {}, eaters: {} } } as unknown as Week;
    const meal = (w.plan as { meals: Week['plan']['meals'] }).meals[0]!;
    const order = (me?: string) => { const r = render(<MealDetail week={w} meal={meal} onEater={() => {}} onView={() => {}} me={me} />); const names = [...r.container.querySelectorAll('.pm-person')].map((b) => b.textContent!.replace(/[^A-Za-z]/g, '').replace(/^[ML]/, '')); r.unmount(); return names; };
    expect(order('lena')).toEqual(['Lena', 'Max']);
    expect(order(' Lena ')).toEqual(['Lena', 'Max']);
    expect(order('nobody')).toEqual(['Max', 'Lena']);
    expect(order(undefined)).toEqual(['Max', 'Lena']);
  });

  it('the shopping list says for when and for whom, counts what is open, and keeps own items below the plan\'s', async () => {
    await boot({ account: 'anna', seed: [mealPlan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Einkauf · \d+ offen$/ }));
    expect(screen.getByText(/für Mo–So, 2 Personen/)).toBeTruthy();
    // The field to add comes first; "Menge (optional)" says it may stay empty.
    const add = screen.getByLabelText('Etwas dazuschreiben');
    expect(screen.getByPlaceholderText('Menge (optional)')).toBeTruthy();
    fireEvent.change(add, { target: { value: 'Kaffee' } });
    fireEvent.submit(add.closest('form')!);
    const own = await screen.findByRole('heading', { name: 'Eigenes' });
    const plan = screen.getByText('Skyr');
    expect(plan.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows one source link for a dish taken from the web, no labels, nothing for the list', async () => {
    const real = { ...dish('Linsen-Bolognese'), source: 'rezept', sourceUrl: 'https://rezepte.example/linsen' };
    const plan = { ...mealPlan, body: { ...(mealPlan.body as object), meals: [
      { day: today, slot: 'fruehstueck', dish: { ...dish('Skyr mit Beeren'), source: 'coach' }, reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: today, slot: 'mittag', dish: real, reuseOf: null, eaters: ['pa', 'pb'], takeAlong: true },
      { day: today, slot: 'abend', dish: { ...dish('Tomatensuppe'), source: 'rezept', sourceUrl: 'javascript:alert(1)' }, reuseOf: null, eaters: ['pa'], takeAlong: false },
    ] } };
    await boot({ account: 'anna', seed: [plan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Skyr mit Beeren/ }));
    expect(screen.queryByText('vom Coach')).toBeNull();
    expect(screen.queryByText(/nach Rezept/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Linsen-Bolognese/ }));
    const link = screen.getByRole('link', { name: 'Originalrezept ↗' });
    expect(link.getAttribute('href')).toBe('https://rezepte.example/linsen');
    expect(link.getAttribute('rel')).toContain('noopener');
    // A link that is not https is never shown; the dish falls back to the list.
    fireEvent.click(screen.getByRole('button', { name: /Tomatensuppe/ }));
    expect(screen.queryAllByRole('link', { name: 'Originalrezept ↗' })).toHaveLength(0);
  });

  it('adds a recipe by link as a record, shows the coach\'s answer, lists own recipes and deletes one', async () => {
    const own = (id: string, title: string): TrackedRecord => ({ kind: 'mealplan', id, updatedMs: NOW - 500, deleted: false, body: { title, sourceUrl: 'https://rezepte.example/x', minutes: 20 } });
    const a = await boot({ account: 'anna', seed: [mealPlan, own('recipe-l-aaaa1111', 'Erfundenes Curry')], recipes: (url) => (url.includes('/search') ? json(200, { items: [{ id: 'l-aaaa1111', title: 'Erfundenes Curry', minutes: 20, proteinG: null, keepsDays: 0, own: true, fav: false, image: false, tags: [] }], more: false })
      : json(200, { id: 'l-aaaa1111', title: 'Erfundenes Curry', minutes: 20, proteinG: null, keepsDays: 0, own: true, fav: false, image: false, tags: [], ingredients: [], steps: ['Kochen.'], sourceUrl: '' })) });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Rezepte/ }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Rezept per Link' }));
    const field = await screen.findByLabelText('Link zum Rezept');
    // Only https links can be sent.
    fireEvent.change(field, { target: { value: 'http://rezepte.example/a' } });
    expect((screen.getByRole('button', { name: 'Hinzufügen' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'https://rezepte.example/a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByText('Der Coach schaut sich die Seite gleich an.')).toBeTruthy();
    const phone = await openIdb('anna', a.factory);
    const sent = (await phone.list('mealplan')).filter((r) => r.id.startsWith('link-'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ url: 'https://rezepte.example/a', result: null });
    // The coach answers by writing the record again; the phone shows it when the sheet is opened afterwards.
    const answered = { ...sent[0]!, updatedMs: sent[0]!.updatedMs + 5, body: { ...(sent[0]!.body as object), atMs: Date.now() - 1000, result: { state: 'veg' }, answeredMs: Date.now() } };
    phone.close();
    cleanup();
    const again = await boot({ account: 'anna', seed: [mealPlan, own('recipe-l-aaaa1111', 'Erfundenes Curry'), answered], recipes: (url) => (url.includes('/search') ? json(200, { items: [{ id: 'l-aaaa1111', title: 'Erfundenes Curry', minutes: 20, proteinG: null, keepsDays: 0, own: true, fav: false, image: false, tags: [] }], more: false })
      : json(200, { id: 'l-aaaa1111', title: 'Erfundenes Curry', minutes: 20, proteinG: null, keepsDays: 0, own: true, fav: false, image: false, tags: [], ingredients: [], steps: ['Kochen.'], sourceUrl: '' })) });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Rezepte/ }));
    fireEvent.click(await screen.findByRole('button', { name: '+ Rezept per Link' }));
    expect(await screen.findByText('Das Rezept ist nicht vegetarisch. Darum ist es nicht gespeichert.')).toBeTruthy();
    expect(screen.getByText(/erscheint unter „Von mir“/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
    // An own recipe is listed as "von dir" and deleted in its own view, after a question.
    expect(await screen.findByText('20 Min · von dir')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Erfundenes Curry\s?20 Min/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rezept löschen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(screen.queryByText('Erfundenes Curry')).toBeNull());
    const store = await openIdb('anna', again.factory);
    expect((await store.list('mealplan')).find((r) => r.id === 'recipe-l-aaaa1111')?.deleted).toBe(true);
    store.close();
  });

  it('without a plan there is no Essen and so no chat: nothing is sent', async () => {
    const a = await boot({ account: 'anna', seed: [] });
    await screen.findByRole('navigation');
    expect(screen.queryByLabelText('Nachricht an den Coach')).toBeNull();
    const s = await openIdb('anna', a.factory);
    expect((await s.list('mealplan')).length).toBe(0);
    s.close();
  });
});
