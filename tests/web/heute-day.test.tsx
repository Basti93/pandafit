// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { SAYINGS } from '../../src/shared/day-text';
import type { TrackedRecord } from '../../src/shared/records';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';

afterEach(cleanup);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = new Date(2026, 10, 4, 12).getTime();
const DAY = 86_400_000;

async function boot(seed: TrackedRecord[], clock: { now: number } = { now: NOW }) {
  const factory = new IDBFactory();
  const s = await openIdb('anna', factory); for (const r of seed) await s.put(r); s.close();
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    if (url === '/me') return json(200, { name: 'anna' });
    if (init.method === 'POST') return json(200, { accepted: 1, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const storage = new Map<string, string>([['pandafit.account', 'anna']]);
  const mk = () => ({
    fetchFn, idbFactory: factory, now: () => clock.now, newId: () => 'id', persist: async () => true, ua: 'Mozilla/5.0 Android', standalone: false,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
  });
  const env = mk();
  const view = render(<App env={env} />);
  await screen.findByRole('heading', { level: 1, name: 'Heute' });
  return { rerender: () => view.rerender(<App env={{ ...env }} />) };
}
const rec = (kind: string, id: string, body: unknown): TrackedRecord => ({ kind: kind as TrackedRecord['kind'], id, updatedMs: NOW, deleted: false, body });
const health = (rows = true) => rec('health', 'health', {
  type: 'health', atMs: NOW, today: { level: 'normal', reasons: [] },
  findings: [{ rule: 'health.rhr-raised', text: 'Dein Ruhepuls liegt bei 58 und ist etwas höher als sonst.', tone: 'achtung' }],
  weeks: rows ? [{ week: '2026-10-26', rhr: 58 }] : [], days: rows ? [{ date: '2026-11-03', rhr: 58 }] : [],
});
const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('Heute as a day page', () => {
  it('shows the coach line before the training card, Gemeinsam last', async () => {
    const weeks = [...Array(11).fill(0), 40];
    const together = {
      week: Date.UTC(2026, 10, 2), atMs: NOW - 3_600_000, you: 'anna',
      people: [{ profileId: 'anna', name: 'Anna', ridesThisWeek: 1, minutesThisWeek: 40, wordsLearned: 30, weeks }, { profileId: 'max', name: 'Max', ridesThisWeek: 2, minutesThisWeek: 75, wordsLearned: 12, weeks }],
      recent: [], metres: 2350, lastRideMetres: 400, peak: { name: 'Mont Ventoux', done: 1250, total: 1600, next: 'Stilfser Joch' }, summits: [], climbed: [], climbing: [],
    };
    await boot([rec('daytext', 'today', { type: 'daytext', date: '2026-11-04', text: 'Schön, dass du dran bist.', atMs: NOW }), rec('together', 'current', together)]);
    const coach = await screen.findByText('Schön, dass du dran bist.');
    const train = await screen.findByRole('button', { name: 'Zum Krafttraining' });
    const tg = await screen.findByRole('button', { name: /Gemeinsam/ });
    expect(before(coach, train)).toBe(true);
    expect(before(coach, tg)).toBe(true);
    const page = coach.closest('.tk-daypage')!;
    expect(page.lastElementChild!.contains(tg)).toBe(true);
  });
  it("a daytext of yesterday shows a saying", async () => {
    await boot([rec('daytext', 'today', { type: 'daytext', date: '2026-11-03', text: 'Gestriger Satz.', atMs: NOW - DAY })]);
    expect(screen.queryByText('Gestriger Satz.')).toBeNull();
    const card = screen.getByLabelText('Satz vom Coach');
    expect(SAYINGS).toContain(card.querySelector('p')!.textContent);
  });
  it('the arrows go to Morgen and Gestern and are disabled at the ends', async () => {
    await boot([]);
    fireEvent.click(screen.getByRole('button', { name: 'Tag vor' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Morgen' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Tag vor' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tag zurück' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tag zurück' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Gestern' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Tag zurück' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('a swipe to the left goes on one day, and does nothing from inside a field', async () => {
    await boot([]);
    const root = screen.getByLabelText('Satz vom Coach').parentElement!;
    fireEvent.pointerDown(root, { clientX: 200, clientY: 100, isPrimary: true, pointerType: 'touch' });
    fireEvent.pointerUp(root, { clientX: 100, clientY: 105, isPrimary: true, pointerType: 'touch' });
    expect(screen.getByRole('heading', { level: 1, name: 'Morgen' })).toBeTruthy();
  });
  it('a swipe from inside a field or a dialog does not change the day', async () => {
    await boot([]);
    const page = screen.getByLabelText('Satz vom Coach').parentElement!;
    const input = document.createElement('input'); page.appendChild(input);
    fireEvent.pointerDown(input, { clientX: 200, clientY: 100, isPrimary: true, pointerType: 'touch' });
    fireEvent.pointerUp(input, { clientX: 100, clientY: 100, isPrimary: true, pointerType: 'touch' });
    const dlg = document.createElement('div'); dlg.setAttribute('role', 'dialog'); const inner = document.createElement('p'); dlg.appendChild(inner); page.appendChild(dlg);
    fireEvent.pointerDown(inner, { clientX: 200, clientY: 100, isPrimary: true, pointerType: 'touch' });
    fireEvent.pointerUp(inner, { clientX: 100, clientY: 100, isPrimary: true, pointerType: 'touch' });
    expect(screen.getByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
  });
  it('a mouse drag does not change the day', async () => {
    await boot([]);
    const page = screen.getByLabelText('Satz vom Coach').parentElement!;
    fireEvent.pointerDown(page, { clientX: 200, clientY: 100, isPrimary: true, pointerType: 'mouse' });
    fireEvent.pointerUp(page, { clientX: 100, clientY: 100, isPrimary: true, pointerType: 'mouse' });
    expect(screen.getByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
  });
  it('a short swipe does not change the day', async () => {
    await boot([]);
    const page = screen.getByLabelText('Satz vom Coach').parentElement!;
    fireEvent.pointerDown(page, { clientX: 200, clientY: 100, isPrimary: true, pointerType: 'touch' });
    fireEvent.pointerUp(page, { clientX: 160, clientY: 100, isPrimary: true, pointerType: 'touch' });
    expect(screen.getByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
  });
  it('a doctor finding is the first line of Dein Körper', async () => {
    const h = health().body as { findings: unknown[] };
    h.findings.push({ rule: 'health.rhr-high', text: 'Das lässt du bitte ärztlich anschauen.', tone: 'arzt' });
    await boot([rec('health', 'health', h)]);
    const card = await screen.findByRole('region', { name: 'Dein Körper' });
    expect(card.querySelector('p')!.textContent).toBe('Das lässt du bitte ärztlich anschauen.');
    expect(card.querySelector('p')!.compareDocumentPosition(card.querySelector('ul')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('a new calendar day starts at Heute again', async () => {
    const clock = { now: NOW };
    const b = await boot([], clock);
    fireEvent.click(screen.getByRole('button', { name: 'Tag vor' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Morgen' })).toBeTruthy();
    clock.now = NOW + DAY;
    b.rerender();
    expect(await screen.findByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
  });
  it('Dein Körper shows words and no digits, and the outline button leads on', async () => {
    await boot([health()]);
    const card = await screen.findByRole('region', { name: 'Dein Körper' });
    expect(card.textContent).toContain('Ruhepuls · beachten');
    expect(card.textContent).not.toMatch(/\d/);
    const toCoach = screen.getByRole('button', { name: 'Mit dem Coach reden' });
    expect(toCoach.className).toBe('secondary'); // a jump is an outline button, not a text link
    fireEvent.click(toCoach);
    // Straight into the chat, not only onto the week page.
    expect(await screen.findByRole('dialog', { name: 'Coach' })).toBeTruthy();
  });
  it('without a health record there is no Dein Körper', async () => {
    await boot([]);
    expect(screen.queryByText('Dein Körper')).toBeNull();
  });

  describe('Zum Abschluss', () => {
    const workout = (endMs: number | null) => rec('workout', 'w1', { id: 'w1', title: 'Beine', startMs: NOW - 4_000_000, endMs, source: 'pandafit', exercises: [] });
    const planWithMobility = rec('plan', 'current', {
      workout: null, reason: 'x', source: 'ai', note: null, questions: [], atMs: NOW - 1000,
      mobility: { id: `mobility-bike-${NOW - 3_600_000}`, forSession: 'bike', minutes: 8, exercises: [{ id: 'm1', title: 'Hüftbeuger dehnen', howTo: 'Ruhig atmen.', area: 'hueftbeuger' }], reason: 'Tut gut.' },
    });
    it('after a finished workout the card holds the mobility row', async () => {
      await boot([workout(NOW - 600_000), planWithMobility]);
      const card = await screen.findByRole('region', { name: 'Zum Abschluss' });
      expect(card.textContent).toContain('20 Min lockeres Cardio');
      expect(card.contains(await screen.findByRole('button', { name: /^Beweglichkeit/ }))).toBe(true);
      expect(card.textContent).not.toContain('Ein paar Minuten dehnen');
    });
    it('without a coach session the plain stretch line shows', async () => {
      await boot([workout(NOW - 600_000)]);
      const card = await screen.findByRole('region', { name: 'Zum Abschluss' });
      expect(card.textContent).toContain('Dehn ein paar Minuten, was sich fest anfühlt.');
    });
    it('a ride today leaves only stretching', async () => {
      const items = [{ key: 'rad-1', kind: 'rad', title: null, sport: 'cycling', startMs: NOW - 300_000, minutes: 30, distanceM: null, avgHr: null, ref: null }];
      await boot([workout(NOW - 600_000), rec('activities', 'activities', { type: 'activities', atMs: NOW, items })]);
      const card = await screen.findByRole('region', { name: 'Zum Abschluss' });
      expect(card.textContent).toContain('Heute reicht Dehnen.');
      expect(card.textContent).not.toContain('20 Min lockeres Cardio');
    });
    it('shows nothing without a finished workout, while one is open, or after three hours; the mobility row stays', async () => {
      await boot([planWithMobility]);
      await screen.findByRole('button', { name: /^Beweglichkeit/ });
      expect(screen.queryByText('Zum Abschluss')).toBeNull();
      cleanup();
      await boot([workout(null), planWithMobility]);
      await screen.findByRole('button', { name: /^Beweglichkeit/ });
      expect(screen.queryByText('Zum Abschluss')).toBeNull();
      cleanup();
      await boot([workout(NOW - 3 * 3_600_000 - 60_000), planWithMobility]);
      await screen.findByRole('button', { name: /^Beweglichkeit/ });
      expect(screen.queryByText('Zum Abschluss')).toBeNull();
    });
  });
});
