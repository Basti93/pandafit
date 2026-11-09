// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';

afterEach(cleanup);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = new Date(2026, 10, 4, 12).getTime(); // a Wednesday, 2026-11-04
const rec = (kind: string, id: string, body: unknown): TrackedRecord => ({ kind: kind as TrackedRecord['kind'], id, updatedMs: NOW, deleted: false, body });
const week = (sport: string) => rec('weekplan', '2026-11-02', {
  weekStart: '2026-11-02', fromMessage: 'c', acceptedMs: NOW,
  days: weekDates('2026-11-02').map((date) => ({ date, sport: date === '2026-11-04' ? sport : 'rest', hardness: 'moderate', fixed: false })),
});

async function boot(seed: TrackedRecord[]) {
  const factory = new IDBFactory();
  const s = await openIdb('anna', factory); for (const r of seed) await s.put(r); s.close();
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    if (url === '/me') return json(200, { name: 'anna' });
    if (init.method === 'POST') return json(200, { accepted: 1, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const storage = new Map<string, string>([['pandafit.account', 'anna']]);
  const env = {
    fetchFn, idbFactory: factory, now: () => NOW, newId: () => 'id', persist: async () => true, ua: 'Mozilla/5.0 Android', standalone: false,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
  };
  render(<App env={env} />);
  await screen.findByRole('heading', { level: 1, name: 'Heute' });
}

describe('Heute with reduced motion', () => {
  it('shows Bo at his place as the still of his pose', async () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
    await boot([week('rest')]);
    await waitFor(() => expect(document.querySelector('.tk-scene[data-place="buecher"] img[src="/brand/bo-pose-read.svg"]')).toBeTruthy());
    expect(document.querySelector('.tk-scene canvas')).toBeNull();
  });
});
