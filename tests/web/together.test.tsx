// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';

afterEach(cleanup);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 4, 12); // a Wednesday
const MONDAY = Date.UTC(2026, 10, 2);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const weeks = (last: number) => [...Array(11).fill(0), last];
const body = (over: Record<string, unknown> = {}) => ({
  week: MONDAY, atMs: NOW - 2 * 3_600_000, you: 'lena',
  people: [
    { profileId: 'max', name: 'Max', ridesThisWeek: 2, minutesThisWeek: 75, wordsLearned: 12, weeks: weeks(75) },
    { profileId: 'lena', name: 'Lena', ridesThisWeek: 1, minutesThisWeek: 40, wordsLearned: 30, weeks: weeks(40) },
  ],
  recent: [
    { name: 'Lena', startedAtMs: NOW - 3 * 3_600_000, sessionName: 'Grundlage locker', minutes: 40 },
    { name: 'Max', startedAtMs: NOW - DAY, sessionName: 'Sweet Spot', minutes: 45 },
    { name: 'Max', startedAtMs: NOW - 2 * DAY, minutes: 30 },
  ],
  metres: 2350, lastRideMetres: 400, peak: { name: 'Mont Ventoux', done: 1250, total: 1600, next: 'Stilfser Joch' },
  summits: [{ name: 'Alpe d’Huez', atMs: NOW - 10 * DAY }],
  climbed: [{ who: 'Lena', name: 'Col du Galibier', atMs: NOW - 5 * DAY }],
  climbing: [{ who: 'Max', name: 'Alpe d’Huez', pct: 40 }],
  ...over,
});
const rec = (b: unknown): TrackedRecord => ({ kind: 'together', id: 'current', updatedMs: NOW - 1000, deleted: false, body: b });

async function boot(seed: TrackedRecord[]) {
  const factory = new IDBFactory();
  const s = await openIdb('anna', factory); for (const r of seed) await s.put(r); s.close();
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    if (url === '/me') return json(200, { name: 'anna' });
    if (init.method === 'POST') return json(200, { accepted: 1, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const storage = new Map<string, string>([['pandafit.account', 'anna']]);
  render(<App env={{
    fetchFn, idbFactory: factory, now: () => NOW, newId: () => 'id', persist: async () => true, ua: 'Mozilla/5.0 Android', standalone: false,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
  }} />);
  await screen.findByRole('heading', { level: 1, name: 'Heute' });
}

const NO_RANKING = /legt .*vor|Gleichstand|freut sich|Serie|Streak|vorne|mehr als|weniger als|Platz|schon wieder|endlich|noch nicht/i;

describe('Gemeinsam on the phone', () => {
  it('Heute shows a compact card from the record: this week for both, the latest rides, the mountain, the data date', async () => {
    await boot([rec(body())]);
    const card = await screen.findByRole('button', { name: /Gemeinsam/ });
    const c = within(card);
    expect(c.getByText('Diese Woche')).toBeTruthy();
    // The own person first, then the other; no order by numbers.
    expect(card.textContent).toMatch(/Lena.*1 Fahrt.*40 Min.*Max.*2 Fahrten.*75 Min/s);
    expect(c.getByText(/Grundlage locker/)).toBeTruthy();
    expect(c.getByText(/Mont Ventoux/)).toBeTruthy();
    expect(c.getByText(/Stand: Mittwoch, 4\. November/)).toBeTruthy();
    expect(card.textContent).not.toMatch(NO_RANKING);
    // Gemeinsam sits last on Heute, after the plan.
    expect(card.compareDocumentPosition(screen.getAllByRole("button", { name: "Zum Krafttraining" })[0]!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByRole('navigation').querySelectorAll('button')).toHaveLength(3); // Heute, Woche, Kraft: Essen only with a meal plan; never a tab for this
  });

  it('tapping opens the full page with the Mac page sections, and Zurück returns to Heute', async () => {
    await boot([rec(body())]);
    fireEvent.click(await screen.findByRole('button', { name: /Gemeinsam/ }));
    expect(await screen.findByRole('heading', { name: 'Gemeinsam' })).toBeTruthy();
    for (const h of ['Euer Berg', 'Unterwegs am Berg', 'Bezwungene Berge', 'Euer Gipfelbuch', 'Die letzten 12 Wochen', 'Zuletzt gefahren']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    expect(screen.getByText(/1250 von 1600 Höhenmetern/)).toBeTruthy();
    expect(screen.getByText('Col du Galibier')).toBeTruthy();
    expect(screen.getByText(/gemeinsam erreicht am/)).toBeTruthy();
    expect(screen.getByText(/Max, 40 %/)).toBeTruthy();
    expect(screen.getByText(/Stand: Mittwoch, 4\. November/)).toBeTruthy();
    const page = screen.getByRole('heading', { name: 'Gemeinsam' }).closest('.tk-screen')!;
    expect(page.textContent).not.toMatch(NO_RANKING);
    expect(page.textContent).not.toMatch(/Watt|FTP|Puls/);
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
  });

  it('an old snapshot says so: last week is not shown as this week', async () => {
    await boot([rec(body({ week: MONDAY - 7 * DAY, atMs: NOW - 8 * DAY }))]);
    const card = await screen.findByRole('button', { name: /Gemeinsam/ });
    expect(within(card).queryByText('Diese Woche')).toBeNull();
    expect(within(card).getByText(/Woche vom 26\. Okt/)).toBeTruthy();
    expect(within(card).getByText(/Stand: Dienstag, 27\. Oktober/)).toBeTruthy();
  });

  it('an account without a household partner still sees its own part', async () => {
    const own = body({ people: [body().people[1]], recent: [body().recent[0]], climbing: [], climbed: [], summits: [] });
    await boot([rec(own)]);
    const card = await screen.findByRole('button', { name: /Gemeinsam/ });
    expect(card.textContent).toMatch(/Lena.*1 Fahrt.*40 Min/s);
    expect(card.textContent).not.toMatch(/Max/);
    fireEvent.click(card);
    expect(await screen.findByRole('heading', { name: 'Zuletzt gefahren' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Euer Gipfelbuch' })).toBeNull();
  });

  it('no record, a deleted one or a broken one: Heute is as before', async () => {
    await boot([{ ...rec(body()), body: { people: 'kaputt' } }]);
    await screen.findAllByRole('button', { name: 'Zum Krafttraining' });
    expect(screen.queryByRole('button', { name: /Gemeinsam/ })).toBeNull();
    cleanup();
    await boot([]);
    await screen.findAllByRole('button', { name: 'Zum Krafttraining' });
    expect(screen.queryByRole('button', { name: /Gemeinsam/ })).toBeNull();
  });
});
