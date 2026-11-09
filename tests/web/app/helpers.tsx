import 'fake-indexeddb/auto';
import { render } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { App } from '../../../src/web/App';
import { openIdb } from '../../../src/web/idbStore';
import type { LiveSocket } from '../../../src/web/live';

export const NOW = 1_800_000_000_000;
export const DAY = 86_400_000;
export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const plan = (atMs: number, mobility: unknown = null): TrackedRecord => ({
  kind: 'plan', id: 'current', updatedMs: atMs, deleted: false,
  body: { workout: { name: 'Beine A', exercises: [{ templateId: 'x', title: 'Kniebeuge', restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 40, reps: 8 }] }] }, reason: 'Beine sind dran', source: 'ai', note: 'Gut gemacht diese Woche', questions: [], atMs, mobility },
});
export const session = (triggerMs: number) => ({ id: `mobility-bike-${triggerMs}`, forSession: 'bike', minutes: 8, exercises: [{ id: 'm1', title: 'Hüftbeuger dehnen', howTo: 'Ausfallschritt, ruhig atmen.', area: 'hueftbeuger' }], reason: 'Nach der Radfahrt tut das gut.' });

export type Opts = { now?: number; openLive?: () => LiveSocket; startTab?: string; onOpenTab?: (f: (tab: string) => void) => () => void; logoutStatus?: number; hold?: { me: Promise<void> | null }; flaky?: { fail: boolean }; me?: number; hangMe?: boolean; noIdb?: 'null' | 'throws'; flags?: Record<string, string>; logoutFails?: boolean; loginStatus?: number; offline?: boolean; syncStatus?: number; seed?: TrackedRecord[]; account?: string; ua?: string; standalone?: boolean; persist?: boolean; recipes?: (url: string) => Response | Promise<Response> };
export async function boot(o: Opts = {}) {
  const factory = new IDBFactory();
  if (o.seed) { const s = await openIdb('anna', factory); for (const r of o.seed) await s.put(r); s.close(); }
  const storage = new Map<string, string>([...(o.account ? [['pandafit.account', o.account] as [string, string]] : []), ...Object.entries(o.flags ?? {})]);
  const calls: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    if (o.offline) throw new TypeError('offline');
    if (url.startsWith('/coach/recipes') && o.recipes) return o.recipes(url);
    if (url === '/me' && o.hangMe) return new Promise<Response>(() => {});
    if (url === '/me' && o.hold?.me) await o.hold.me;
    if (url === '/logout' && o.logoutStatus) return json(o.logoutStatus, {});
    if (url === '/logout' && o.logoutFails) throw new TypeError('offline');
    if (url === '/me') return o.me === 401 ? json(401, {}) : json(200, { name: 'anna' });
    if (url === '/login') return json(o.loginStatus ?? 200, { ok: true });
    if (url === '/logout') return json(200, { ok: true });
    if (url === '/coach/status') return json(200, { profileId: 'pa', moved: true });
    if (o.syncStatus && o.syncStatus !== 200) return json(o.syncStatus, {});
    if (init.method === 'POST') return json(200, { accepted: 1, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const persist = vi.fn(async () => o.persist ?? true);
  const onWorkoutOpen = vi.fn();
  const ui = render(<App env={{
    fetchFn, idbFactory: o.flaky ? ({ open: (n: string, v?: number) => { if (o.flaky!.fail) throw new Error('denied'); return factory.open(n, v); } } as unknown as IDBFactory) : o.noIdb === 'null' ? null : o.noIdb === 'throws' ? ({ open: () => { throw new Error('denied'); } } as unknown as IDBFactory) : factory, now: () => o.now ?? NOW, newId: () => `id-${Math.random().toString(36).slice(2)}`,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
    persist, ua: o.ua ?? 'Mozilla/5.0 Android', standalone: o.standalone ?? false, onWorkoutOpen, startTab: o.startTab, onOpenTab: o.onOpenTab, openLive: o.openLive,
  }} />);
  return { ...ui, factory, storage, calls, persist, onWorkoutOpen };
}
