// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { weekDates } from '../../src/shared/week-plan';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';

// What each mounted portrait was given when it appeared (one entry per mount) and what it was given last.
const log = vi.hoisted(() => ({ mounts: [] as { greet: string | null }[], last: { dayClip: null as string | null } }));
vi.mock('../../src/tracking/ui/PandaPortrait', () => ({
  PandaPortrait: ({ gesture, dayClip }: { gesture?: { kind: string }; dayClip?: string | null }) => {
    log.last.dayClip = dayClip ?? null;
    useEffect(() => { log.mounts.push({ greet: gesture?.kind ?? null }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  },
}));

beforeEach(() => { log.mounts.length = 0; log.last.dayClip = null; });
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

describe('Panda on Heute', () => {
  it('greets once when Heute opens and offers the clip of the day; Gestern and back does not greet again', async () => {
    await boot([week('bike')]);
    await waitFor(() => expect(log.mounts).toEqual([{ greet: 'greet' }]));
    await waitFor(() => expect(log.last.dayClip).toBe('bike'));
    fireEvent.click(screen.getByRole('button', { name: 'Tag zurück' }));
    expect(screen.queryByLabelText('Satz vom Coach')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tag vor' }));
    expect(await screen.findByLabelText('Satz vom Coach')).toBeTruthy();
    expect(log.mounts).toEqual([{ greet: 'greet' }, { greet: null }]);
  });
  it('a strength day offers flex, and a day without a plan offers no clip', async () => {
    await boot([week('gym')]);
    await waitFor(() => expect(log.last.dayClip).toBe('flex'));
    cleanup();
    log.last.dayClip = 'x';
    await boot([]);
    await waitFor(() => expect(log.mounts.length).toBeGreaterThan(0));
    expect(log.last.dayClip).toBeNull();
  });
});
