// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { openIdb } from '../../src/web/idbStore';
import { createWebPort } from '../../src/web/webPort';
import type { PushEnv } from '../../src/web/push';

const rec = (id: string, updatedMs = 10): TrackedRecord => ({ kind: 'workout', id, updatedMs, deleted: false, body: { id, title: 'T', startMs: 1, endMs: null, exercises: [] } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function server() {
  const s = { status: 200, posted: [] as TrackedRecord[], refuse: [] as string[], down: false, calls: [] as { url: string; init: RequestInit }[], remote: [] as TrackedRecord[], me: 'anna' };
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    s.calls.push({ url, init });
    if (s.down) throw new TypeError('offline');
    if (s.status !== 200) return json(s.status, { error: 'x' });
    if (url === '/me') return json(200, { name: s.me });
    if (init.method === 'POST') {
      const rs = (JSON.parse(String(init.body)) as { records: TrackedRecord[] }).records;
      s.posted.push(...rs);
      return json(200, { accepted: rs.length, refused: rs.filter((r) => s.refuse.includes(r.id)).map((r) => ({ id: r.id, reason: 'bad' })) });
    }
    const since = Number(new URL(url, 'http://x').searchParams.get('since'));
    return json(200, { records: since === 0 ? s.remote : [], cursor: s.remote.length, more: false, reset: false });
  }) as unknown as typeof fetch;
  return { s, fetchFn };
}

const mk = async (fetchFn: typeof fetch) => {
  const store = await openIdb('anna', new IDBFactory());
  return { store, port: createWebPort({ store, fetchFn, account: 'anna', now: () => 1000 }) };
};

describe('webPort', () => {
  it('gleicht im Hintergrund nicht im Takt ab', async () => {
    const { s, fetchFn } = server();
    const store = await openIdb('anna', new IDBFactory());
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    try {
      const port = createWebPort({ store, fetchFn, account: 'anna', now: () => 1000, intervalMs: 1000 });
      vis.mockReturnValue('hidden');
      await vi.advanceTimersByTimeAsync(5000);
      expect(s.calls).toHaveLength(0);
      vis.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(s.calls.length).toBeGreaterThan(0));
      port.dispose();
    } finally { vis.mockRestore(); vi.useRealTimers(); }
  });

  it('run records from the server are kept and listed', async () => {
    const { s, fetchFn } = server();
    s.remote = [{ kind: 'run', id: 'settings', updatedMs: 5, deleted: false, body: { type: 'settings', on: true, weekdays: null, answers: null } }];
    const { store, port } = await mk(fetchFn);
    expect(await port.sync()).toBe('ok');
    expect((await store.list('run')).map((r) => r.id)).toEqual(['settings']);
  });

  it('sends local records with same-origin credentials and no redirects, and receives remote ones', async () => {
    const { s, fetchFn } = server();
    s.remote = [rec('remote')];
    const { port } = await mk(fetchFn);
    await port.put(rec('w1'));
    expect(await port.sync()).toBe('ok');
    expect(s.posted.map((r) => r.id)).toEqual(['w1']);
    expect((await port.list('workout')).map((r) => r.id).sort()).toEqual(['remote', 'w1']);
    for (const c of s.calls) { expect(c.init.credentials).toBe('same-origin'); expect(c.init.redirect).toBe('error'); }
    expect(port.syncState().pending).toBe(0);
    expect(port.syncState().lastOkMs).toBe(1000);
  });

  it('an expired login keeps unsent data and asks to log in again', async () => {
    const { s, fetchFn } = server();
    const { port } = await mk(fetchFn);
    await port.put(rec('w1'));
    s.status = 401;
    expect(await port.sync()).toBe('login');
    expect(port.status()).toBe('login');
    expect(port.syncState().pending).toBe(1);
    expect((await port.list('workout')).length).toBe(1);
    s.status = 200;
    expect(await port.sync()).toBe('ok');
    expect(port.status()).toBe('ok');
  });

  it('being offline is quiet and the data stays pending', async () => {
    const { s, fetchFn } = server();
    const { port } = await mk(fetchFn);
    await port.put(rec('w1'));
    s.down = true;
    expect(await port.sync()).toBe('offline');
    expect(port.syncState().pending).toBe(1);
  });

  it('sync resumes on coming back online', async () => {
    const { s, fetchFn } = server();
    const target = new EventTarget();
    const store = await openIdb('anna', new IDBFactory());
    const port = createWebPort({ store, fetchFn, account: 'anna', now: () => 1, events: target });
    await port.put(rec('w1'));
    s.down = true;
    await port.sync();
    s.down = false;
    target.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.posted.map((r) => r.id)).toEqual(['w1']);
    port.dispose();
  });

  it('refused records stay on the device and show up in syncState', async () => {
    const { s, fetchFn } = server();
    s.refuse = ['w1'];
    const { port, store } = await mk(fetchFn);
    await port.put(rec('w1'));
    await port.sync();
    expect(port.syncState().refused).toBe(1);
    expect((await port.list('workout')).length).toBe(1);
    expect(store.counts().refused).toBe(1);
  });

  it('subscribe fires for local and remote changes', async () => {
    const { s, fetchFn } = server();
    s.remote = [rec('r')];
    const { port } = await mk(fetchFn);
    let n = 0;
    port.subscribe(() => n++);
    await port.put(rec('w1'));
    const afterLocal = n;
    await port.sync();
    expect(afterLocal).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(afterLocal);
  });

  it('checks /me before each run and never syncs under another account', async () => {
    const { s, fetchFn } = server();
    const { port } = await mk(fetchFn);
    await port.put(rec('w1'));
    s.me = 'ben';
    expect(await port.sync()).toBe('login');
    expect(s.posted).toEqual([]);
    expect(s.calls.filter((c) => c.url.startsWith('/records'))).toEqual([]);
    expect(port.mismatch()).toBe(true);
    s.me = 'anna';
    expect(await port.sync()).toBe('ok');
    expect(port.mismatch()).toBe(false);
  });

  it('pause waits for a running sync and stops further ones until resume', async () => {
    const { s, fetchFn } = server();
    const { port } = await mk(fetchFn);
    await port.put(rec('w1'));
    const running = port.sync();
    await port.pause();
    await running;
    const before = s.calls.length;
    expect(await port.sync()).toBe('login');
    expect(s.calls.length).toBe(before);
    port.resume();
    expect(await port.sync()).toBe('ok');
  });

  it('markLogin shows the login without a request', async () => {
    const { s, fetchFn } = server();
    const { port } = await mk(fetchFn);
    port.markLogin();
    expect(port.status()).toBe('login');
    expect(s.calls).toEqual([]);
  });

  it('a record refused once and accepted after an edit leaves the refused count', async () => {
    const { s, fetchFn } = server();
    s.refuse = ['w1'];
    const { port } = await mk(fetchFn);
    await port.put(rec('w1'));
    await port.sync();
    expect(port.syncState().refused).toBe(1);
    s.refuse = [];
    await port.put(rec('w1', 20));
    await port.sync();
    expect(port.syncState().refused).toBe(0);
  });

  it('dispose closes the database', async () => {
    const { fetchFn } = server();
    const { port, store } = await mk(fetchFn);
    port.dispose();
    await expect(store.list('workout')).rejects.toThrow();
  });

  it('pause really waits for a run in flight, and nothing is sent after it returned', async () => {
    const { s, fetchFn } = server();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let onMe = false;
    const slow = (async (url: string, init?: RequestInit) => { if (url === '/me') { onMe = true; await gate; } return fetchFn(url, init); }) as unknown as typeof fetch;
    const { port } = await mk(slow);
    await port.put(rec('w1'));
    const running = port.sync();
    while (!onMe) await new Promise((r) => setTimeout(r, 2));
    let paused = false;
    const p = port.pause().then(() => { paused = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(paused).toBe(false); // the run is still on /me
    release();
    await p;
    await running;
    expect(paused).toBe(true);
    expect(s.posted).toEqual([]); // the run was stopped by the pause before it sent anything
  });

  it('the /me check has its own timeout and a hung answer ends the run as offline', async () => {
    const { fetchFn } = server();
    let signal: AbortSignal | undefined;
    const hang = (async (url: string, init?: RequestInit) => {
      if (url === '/me') { signal = init?.signal ?? undefined; return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('t', 'TimeoutError')))); }
      return fetchFn(url, init);
    }) as unknown as typeof fetch;
    const store = await openIdb('anna', new IDBFactory());
    const port = createWebPort({ store, fetchFn: hang, account: 'anna', now: () => 1, meTimeoutMs: 40 });
    expect(await port.sync()).toBe('offline');
    expect(signal).toBeInstanceOf(AbortSignal);
    port.dispose();
  });

  it('checks /me right before each batch and each page, so a login change in another tab stops the run', async () => {
    const { s, fetchFn } = server();
    s.remote = [rec('remote')];
    let meCalls = 0;
    const switching = (async (url: string, init?: RequestInit) => {
      if (url === '/me') { meCalls++; return json(200, { name: meCalls >= 2 ? 'ben' : 'anna' }); } // the cookie changes after the page was fetched
      return fetchFn(url, init);
    }) as unknown as typeof fetch;
    const { port } = await mk(switching);
    await port.put(rec('w1'));
    expect(await port.sync()).toBe('login');
    // Sent under the right login; the page after the change is not asked for and nothing comes in.
    expect(s.posted.map((r) => r.id)).toEqual(['w1']);
    expect((await port.list('workout')).map((r) => r.id)).toEqual(['w1']);
    expect(port.mismatch()).toBe(true);
  });

  it('idle resolves when no write is in flight', async () => {
    const { fetchFn } = server();
    const { port } = await mk(fetchFn);
    const w = port.put(rec('w1'));
    await port.idle();
    await w;
    expect((await port.list('workout')).length).toBe(1);
  });

  describe('restAlarm', () => {
    const env = (o: { permission?: NotificationPermission; endpoint?: string | null; fail?: boolean } = {}): PushEnv => ({
      support: 'ok', permission: () => o.permission ?? 'granted', requestPermission: async () => 'granted',
      current: async () => { if (o.fail) throw new Error('x'); return o.endpoint === null ? null : { endpoint: o.endpoint ?? 'https://web.push.apple.com/s1' }; },
      subscribe: async () => ({}), unsubscribe: async () => null,
    });
    const rest = async (push: PushEnv | undefined, fetchFn: typeof fetch) => {
      const store = await openIdb('anna', new IDBFactory());
      return createWebPort({ store, fetchFn, account: 'anna', now: () => 1000, push });
    };

    it('posts the endpoint and time to /push/rest with the same-origin credentials', async () => {
      const { s, fetchFn } = server();
      const port = await rest(env(), fetchFn);
      port.restAlarm!(5000);
      await new Promise((r) => setTimeout(r, 10));
      const c = s.calls.find((x) => x.url === '/push/rest')!;
      expect(c.init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error' });
      expect(JSON.parse(String(c.init.body))).toEqual({ endpoint: 'https://web.push.apple.com/s1', atMs: 5000 });
      port.restAlarm!(null);
      await new Promise((r) => setTimeout(r, 10));
      expect(JSON.parse(String(s.calls.filter((x) => x.url === '/push/rest')[1]!.init.body))).toEqual({ endpoint: 'https://web.push.apple.com/s1', atMs: null });
    });

    it('is absent without a PushEnv, and silent without permission or subscription', async () => {
      const { s, fetchFn } = server();
      expect((await rest(undefined, fetchFn)).restAlarm).toBeUndefined();
      for (const e of [env({ permission: 'denied' }), env({ permission: 'default' }), env({ endpoint: null })]) {
        (await rest(e, fetchFn)).restAlarm!(5000);
      }
      await new Promise((r) => setTimeout(r, 10));
      expect(s.calls.some((x) => x.url === '/push/rest')).toBe(false);
    });

    it('swallows every error', async () => {
      const bad = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
      const down = (async () => json(500, {})) as unknown as typeof fetch;
      for (const [e, f] of [[env(), bad], [env(), down], [env({ fail: true }), bad]] as const) {
        const unhandled: unknown[] = [];
        const h = (x: unknown) => unhandled.push(x);
        process.on('unhandledRejection', h);
        expect(() => (e && (rest(e, f) as Promise<ReturnType<typeof createWebPort>>).then((p) => p.restAlarm!(5000)))).not.toThrow();
        await new Promise((r) => setTimeout(r, 20));
        process.off('unhandledRejection', h);
        expect(unhandled).toEqual([]);
      }
    });
  });
});
