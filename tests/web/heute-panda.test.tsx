// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useEffect } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';

// How often a portrait appeared, and the pose it was given last.
const log = vi.hoisted(() => ({ mounts: 0, last: { pose: null as string | null } }));
vi.mock('../../src/tracking/ui/PandaPortrait', () => ({
  PandaPortrait: ({ pose }: { pose?: string | null }) => {
    log.last.pose = pose ?? null;
    useEffect(() => { log.mounts++; }, []);
    return null;
  },
}));

beforeEach(() => { log.mounts = 0; log.last.pose = null; });
afterEach(cleanup);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = new Date(2026, 10, 4, 12).getTime(); // a Wednesday, 2026-11-04
const rec = (kind: string, id: string, body: unknown): TrackedRecord => ({ kind: kind as TrackedRecord['kind'], id, updatedMs: NOW, deleted: false, body });
const week = (sport: string, today = '2026-11-04') => rec('weekplan', '2026-11-02', {
  weekStart: '2026-11-02', fromMessage: 'c', acceptedMs: NOW,
  days: weekDates('2026-11-02').map((date) => ({ date, sport: date === today ? sport : 'rest', hardness: 'moderate', fixed: false })),
});

async function boot(seed: TrackedRecord[], now = NOW) {
  const factory = new IDBFactory();
  const s = await openIdb('anna', factory); for (const r of seed) await s.put(r); s.close();
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    if (url === '/me') return json(200, { name: 'anna' });
    if (init.method === 'POST') return json(200, { accepted: 1, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const storage = new Map<string, string>([['pandafit.account', 'anna']]);
  const env = {
    fetchFn, idbFactory: factory, now: () => now, newId: () => 'id', persist: async () => true, ua: 'Mozilla/5.0 Android', standalone: false,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
  };
  render(<App env={env} />);
  await screen.findByRole('heading', { level: 1, name: 'Heute' }, { timeout: 4000 });
}

describe('Bo on Heute', () => {
  it('takes the pose of the day once, if it fits the nest', async () => {
    await boot([week('gym')]);
    await waitFor(() => expect(log.last.pose).toBe('flex'), { timeout: 4000 });
    expect(log.mounts).toBe(1);
  });
  it('on a bike day Bo rides on the hills', async () => {
    await boot([week('bike')]);
    await waitFor(() => expect(log.last.pose).toBe('bike'), { timeout: 4000 });
    expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('huegel');
  });
  it('each kind of day has its place', async () => {
    for (const [sport, place] of [['gym', 'dojo'], ['run', 'wald'], ['mobility', 'matte']] as const) {
      await boot([week(sport)]);
      await waitFor(() => expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe(place), { timeout: 4000 });
      cleanup();
    }
  });
  it('a strength day gives flex, and a day without a plan gives the greeting pose', async () => {
    await boot([week('gym')]);
    await waitFor(() => expect(log.last.pose).toBe('flex'), { timeout: 4000 });
    cleanup();
    log.last.pose = 'x';
    await boot([]);
    await waitFor(() => expect(log.last.pose).toBe('greet'), { timeout: 4000 });
    expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('nest');
  });
  it('a rest day with an odd date gives knitting at the cushion', async () => {
    await boot([week('rest', '2026-11-05')], new Date(2026, 10, 5, 12).getTime());
    await waitFor(() => expect(log.last.pose).toBe('knit'), { timeout: 4000 });
    expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('kissen');
  });
});
