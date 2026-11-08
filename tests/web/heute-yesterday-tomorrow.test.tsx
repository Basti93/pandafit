// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
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
const dish = (title: string) => ({ title, ingredients: [], steps: ['Kochen.'], minutes: 20, proteinG: 20, keepsDays: 1, source: 'liste' });
const meals = (days: number[]) => rec('mealplan', 'week-2026-11-02', { week: '2026-11-02', createdMs: 1, source: 'liste', trainingDays: [], people: [{ id: 'a', name: 'Anna' }, { id: 'm', name: 'Max' }],
  meals: days.map((day) => ({ day, slot: 'mittag', dish: dish(day === 1 ? 'Linsensuppe' : 'Nudeln'), reuseOf: null, eaters: ['a', 'm'] })) });
const weekplan = (sports: string[]) => rec('weekplan', '2026-11-02', { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: `2026-11-0${2 + i}`, sport: sports[i] ?? 'rest', hardness: 'moderate', fixed: false })) });
const activities = (items: unknown[]) => rec('activities', 'activities', { type: 'activities', atMs: NOW, items });
const ride = { key: 'rad-1', kind: 'rad', title: null, sport: 'cycling', startMs: new Date(2026, 10, 3, 18).getTime(), minutes: 44.6, distanceM: null, avgHr: null, ref: null };
const go = (name: 'Tag zurück' | 'Tag vor') => fireEvent.click(screen.getByRole('button', { name }));

describe('Gestern', () => {
  it('lists what was trained, with minutes, and nothing else of Heute', async () => {
    await boot([activities([ride])]);
    go('Tag zurück');
    const card = screen.getByRole('region', { name: 'Training gestern' });
    await waitFor(() => expect(card.textContent).toContain('Rad 45 Min'));
    expect(card.textContent).not.toContain('Min · ');
    expect(card.textContent!.match(/45 Min/g)).toHaveLength(1);
    expect(screen.queryByLabelText('Satz vom Coach')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Panda fragen' })).toBeNull();
    expect(screen.queryByText('Dein Körper')).toBeNull();
    expect(screen.queryByRole('button', { name: /Gemeinsam/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zum Krafttraining' })).toBeNull();
  });
  it('known and empty is a rest day, unknown has no data', async () => {
    await boot([activities([])]);
    go('Tag zurück');
    expect(await screen.findByText('Gestern war ein Ruhetag.')).toBeTruthy();
    cleanup();
    await boot([]);
    go('Tag zurück');
    expect(screen.getByText('Für gestern sind noch keine Daten da.')).toBeTruthy();
    expect(screen.queryByText(/Ruhetag/)).toBeNull();
  });
  it('shows the exercises of a local strength workout muted', async () => {
    const start = new Date(2026, 10, 3, 17).getTime();
    await boot([rec('workout', 'w1', { id: 'w1', title: 'Beine', startMs: start, endMs: start + 54 * 60000, source: 'pandafit', exercises: [{ exerciseId: 'sq', title: 'Kniebeuge', supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 40, reps: 8, durationS: null, doneMs: start }] }] })]);
    go('Tag zurück');
    const card = () => screen.getByRole('region', { name: 'Training gestern' });
    await waitFor(() => expect(card().textContent).toContain('Kraft Beine · 54 Min'));
    expect(card().textContent).toContain('Kniebeuge');
  });
  it('shows yesterday meals with a read-only sheet', async () => {
    await boot([meals([1, 3])]);
    go('Tag zurück');
    expect(await screen.findByRole('region', { name: 'Essen gestern' })).toBeTruthy();
    fireEvent.click(screen.getByText(/Linsensuppe/));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Wer isst mit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /isst mit/ })).toBeNull();
  });
  it('has no meal card without a plan for that day', async () => {
    await boot([meals([3])]);
    go('Tag zurück');
    expect(screen.queryByRole('region', { name: 'Essen gestern' })).toBeNull();
  });
});

describe('Gestern without a local workout', () => {
  it('shows no exercise line for a strength item from the server', async () => {
    await boot([activities([{ ...ride, key: 'kraft-x', kind: 'kraft', title: 'Beine', sport: 'strength', minutes: 54, ref: 'x' }])]);
    go('Tag zurück');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Training gestern' }).textContent).toContain('Kraft Beine · 54 Min'));
    expect(screen.getByRole('region', { name: 'Training gestern' }).querySelector('.muted')).toBeNull();
  });
});

describe('Morgen', () => {
  it('shows the planned training without a start button', async () => {
    await boot([weekplan(['rest', 'rest', 'rest', 'bike'])]);
    go('Tag vor');
    const card = await screen.findByRole('region', { name: 'Training morgen' });
    expect(card.textContent).toContain('Rad');
    expect(screen.queryByRole('button', { name: /starten|Weitermachen|Zum Krafttraining/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Etwas anderes heute?' })).toBeNull();
    expect(screen.queryByLabelText('Satz vom Coach')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Panda fragen' })).toBeNull();
  });
  it('says calmly that nothing is planned yet without a plan', async () => {
    await boot([]);
    go('Tag vor');
    const card = await screen.findByRole('region', { name: 'Training morgen' });
    expect(card.textContent).toContain('Für morgen ist noch kein Training geplant.');
  });
  it('says so when there is no meal plan for tomorrow, and shows it when there is', async () => {
    await boot([meals([1])]);
    go('Tag vor');
    expect(await screen.findByText('Für morgen gibt es noch keinen Essensplan.')).toBeTruthy();
    cleanup();
    await boot([meals([3])]);
    go('Tag vor');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Essen morgen' }).textContent).toContain('Nudeln'));
    expect(screen.queryByText(/vorkochen/)).toBeNull();
  });
});
