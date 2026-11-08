import { describe, expect, it } from 'vitest';
import { clickTarget, handleFetch, NEVER_CACHE, notificationFor, precacheName, routeFor } from '../../src/web/swLogic';
import { setupServiceWorker, shouldActivateNow, type OpenState } from '../../src/web/register';

const ORIGIN = 'https://pf.example';
const ALLOW = new Set(['/index.html', '/assets/index-a.js', '/assets/index-a.css', '/icons/icon-192.png', '/manifest.webmanifest']);
const req = (path: string, over: Partial<{ method: string; mode: string; origin: string }> = {}) => ({ method: over.method ?? 'GET', url: `${over.origin ?? ORIGIN}${path}`, mode: over.mode ?? 'no-cors' });

/** A per-build cache; `puts` shows whether anything was ever written at runtime. */
function build(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const puts: string[] = [];
  return { puts, store, cache: { match: async (k: string) => (store.has(k) ? new Response(store.get(k)) : undefined) } };
}
const noNetwork = async () => { throw new TypeError('offline'); };

describe('service worker routing', () => {
  it('never touches API paths, not even as a navigation', () => {
    for (const p of NEVER_CACHE) {
      expect(routeFor(req(p), ORIGIN, ALLOW)).toBe('bypass');
      expect(routeFor(req(p, { mode: 'navigate' }), ORIGIN, ALLOW)).toBe('bypass');
    }
    expect(routeFor(req('/records?since=3'), ORIGIN, ALLOW)).toBe('bypass');
    expect(NEVER_CACHE).toEqual(['/records', '/login', '/logout', '/me', '/device-token', '/healthz', '/push']);
    expect(routeFor(req('/push/key'), ORIGIN, ALLOW)).toBe('bypass');
  });
  it('only precached files are served; everything else is the browser\'s business', () => {
    expect(routeFor(req('/assets/index-a.js'), ORIGIN, ALLOW)).toBe('precached');
    expect(routeFor(req('/assets/other.js'), ORIGIN, ALLOW)).toBe('bypass');
    expect(routeFor(req('/sw.js'), ORIGIN, ALLOW)).toBe('bypass');
    expect(routeFor(req('/assets/index-a.js', { method: 'POST' }), ORIGIN, ALLOW)).toBe('bypass');
    expect(routeFor(req('/assets/index-a.js', { origin: 'https://evil.example' }), ORIGIN, ALLOW)).toBe('bypass');
  });
  it('navigations to the app are the cached shell', () => {
    expect(routeFor(req('/', { mode: 'navigate' }), ORIGIN, ALLOW)).toBe('shell');
    expect(routeFor(req('/index.html', { mode: 'navigate' }), ORIGIN, ALLOW)).toBe('shell');
    expect(routeFor(req('/anything', { mode: 'navigate' }), ORIGIN, ALLOW)).toBe('bypass');
  });

  it('offline start: the shell comes from the precache without touching the network', async () => {
    const b = build({ '/index.html': '<html>shell</html>' });
    const res = await handleFetch(req('/', { mode: 'navigate' }), ORIGIN, ALLOW, { cache: b.cache, fetch: noNetwork });
    expect(await res!.text()).toBe('<html>shell</html>');
  });

  it('opening a PNG as a page never poisons the shell', async () => {
    const b = build({ '/index.html': 'shell', '/icons/icon-192.png': 'PNGDATA' });
    const res = await handleFetch(req('/icons/icon-192.png', { mode: 'navigate' }), ORIGIN, ALLOW, { cache: b.cache, fetch: async () => new Response('network png') });
    expect(await res!.text()).toBe('PNGDATA');
    expect(await (await handleFetch(req('/', { mode: 'navigate' }), ORIGIN, ALLOW, { cache: b.cache, fetch: noNetwork }))!.text()).toBe('shell');
    expect(b.store.get('/index.html')).toBe('shell');
  });

  it('nothing is written at runtime: a precache miss goes to the network and is not stored', async () => {
    const b = build({});
    const cache = { ...b.cache, put: async (k: string) => { b.puts.push(k); } };
    const res = await handleFetch(req('/assets/index-a.js'), ORIGIN, ALLOW, { cache, fetch: async () => new Response('net') });
    expect(await res!.text()).toBe('net');
    expect(b.puts).toEqual([]);
  });

  it('versions are never mixed: a worker answers only from its own build\'s cache', async () => {
    const v1 = build({ '/index.html': 'shell v1', '/assets/index-a.js': 'js v1' });
    const v2 = build({ '/index.html': 'shell v2' }); // its precache lacks the script: it must not borrow v1's
    const shell = await handleFetch(req('/', { mode: 'navigate' }), ORIGIN, ALLOW, { cache: v2.cache, fetch: noNetwork });
    expect(await shell!.text()).toBe('shell v2');
    await expect(handleFetch(req('/assets/index-a.js'), ORIGIN, ALLOW, { cache: v2.cache, fetch: noNetwork })).rejects.toThrow();
    expect(precacheName('1')).not.toBe(precacheName('2'));
    expect(v1.store.size).toBe(2);
  });

  it('returns null for what is not ours', async () => {
    const b = build({});
    expect(await handleFetch(req('/records'), ORIGIN, ALLOW, { cache: b.cache, fetch: async () => new Response('x') })).toBeNull();
  });
});

describe('update decisions', () => {
  it('a waiting worker activates only when we know that no workout is open', () => {
    const w = (workout: OpenState, waiting = true) => shouldActivateNow({ waiting, workout });
    expect(w('open')).toBe(false);
    expect(w('unknown')).toBe(false);
    expect(w('none')).toBe(true);
    expect(w('none', false)).toBe(false);
  });

  it('right after a cold start, before any tap, an open workout does not hold back an update', () => {
    expect(shouldActivateNow({ waiting: true, workout: 'open', fresh: true })).toBe(true);
    expect(shouldActivateNow({ waiting: true, workout: 'open', fresh: false })).toBe(false);
    expect(shouldActivateNow({ waiting: true, workout: 'unknown', fresh: true })).toBe(false);
  });

  function harness(open: OpenState) {
    const posted: unknown[] = [];
    const listeners: Record<string, () => void> = {};
    const installing = { state: 'installing', listeners: {} as Record<string, () => void>, addEventListener(t: string, f: () => void) { this.listeners[t] = f; } };
    const regListeners: Record<string, () => void> = {};
    const reg = {
      waiting: { postMessage: (m: unknown) => posted.push(m) } as { postMessage(m: unknown): void } | null,
      installing: null as typeof installing | null,
      addEventListener: (t: string, f: () => void) => { regListeners[t] = f; }, update: async () => {},
    };
    const container = { controller: {} as object | null, register: async () => reg, addEventListener: (t: string, f: () => void) => { listeners[t] = f; } };
    let reloads = 0;
    const state = { open, fresh: false };
    return { container, posted, listeners, regListeners, reg, installing, state, reloads: () => reloads, start: () => setupServiceWorker({ container: container as never, isWorkoutOpen: () => state.open, isFresh: () => state.fresh, reload: () => { reloads++; }, url: '/sw.js' }) };
  }

  it('a cold start with an open workout updates and reloads before the first tap', async () => {
    const h = harness('open');
    h.state.fresh = true;
    await h.start();
    expect(h.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    h.listeners.controllerchange?.();
    expect(h.reloads()).toBe(1);
  });

  it('once the person has tapped, the reload waits even if the update was already asked for', async () => {
    const h = harness('open');
    h.state.fresh = true;
    await h.start();
    h.state.fresh = false;
    h.listeners.controllerchange?.();
    expect(h.reloads()).toBe(0);
  });

  it('a new service worker waits while a workout is open and activates afterwards', async () => {
    const h = harness('open');
    const sw = await h.start();
    expect(h.posted).toEqual([]);
    h.listeners.controllerchange?.();
    expect(h.reloads()).toBe(0);
    h.state.open = 'none';
    sw.check(); // also called when a workout is finished
    expect(h.posted).toEqual([{ type: 'SKIP_WAITING' }]);
    h.listeners.controllerchange?.();
    expect(h.reloads()).toBe(1);
  });

  it('a waiting worker with the tab reopened during an open workout does not activate before the first read', async () => {
    const h = harness('unknown'); // the page has not looked at its data yet
    const sw = await h.start();
    sw.check();
    expect(h.posted).toEqual([]);
    h.state.open = 'open';
    sw.check();
    expect(h.posted).toEqual([]);
    h.state.open = 'none';
    sw.check();
    expect(h.posted.length).toBe(1);
  });

  it('the very first install is not an update: it activates by itself and never reloads the page', async () => {
    const h = harness('none');
    h.container.controller = null; // no worker controlled this page before
    const sw = await h.start();
    sw.check();
    expect(h.posted).toEqual([]);
    h.listeners.controllerchange?.();
    expect(h.reloads()).toBe(0);
  });

  it('a controller change we did not ask for (first install) does not reload', async () => {
    const h = harness('none');
    h.reg.waiting = null;
    await h.start();
    h.listeners.controllerchange?.();
    expect(h.reloads()).toBe(0);
  });

  it('a controller change we asked for does not reload while a workout has been opened since', async () => {
    const h = harness('none');
    await h.start();
    h.state.open = 'open';
    h.listeners.controllerchange?.();
    expect(h.reloads()).toBe(0);
  });

  it('a new worker is checked when it reaches the installed state, not after a fixed wait', async () => {
    const h = harness('none');
    h.reg.waiting = null;
    await h.start();
    h.reg.installing = h.installing;
    h.regListeners.updatefound?.();
    h.reg.waiting = { postMessage: (m) => h.posted.push(m) };
    h.installing.state = 'installed';
    h.installing.listeners.statechange?.();
    expect(h.posted).toEqual([{ type: 'SKIP_WAITING' }]);
  });
});

describe('push notifications', () => {
  it('shows the version notice with the app icon and a tag per type, so a repeat replaces it', () => {
    const n = notificationFor(JSON.stringify({ type: 'version', title: 'Pandafit', body: 'x' }))!;
    expect(n.title).toBe('Pandafit');
    expect(n.options).toMatchObject({ body: 'Es gibt eine neue Version von Pandafit. Beim nächsten Öffnen ist sie da.', tag: 'pandafit-version', icon: '/icons/icon-192.png', data: { url: '/' } });
    const m = notificationFor(JSON.stringify({ type: 'meal' }))!;
    expect(m.options).toMatchObject({ body: 'Dein Essensplan für die Woche ist da.', tag: 'pandafit-meal', data: { url: '/?tab=essen' } });
  });

  it('never shows text it did not expect; a broken or unknown message still shows a plain notice (iOS requires one)', () => {
    for (const bad of [null, '', 'not json', JSON.stringify({ type: 'workout', body: 'Trainier jetzt!' }), JSON.stringify([1])]) {
      const n = notificationFor(bad)!;
      expect(n.options.tag).toBe('pandafit');
      expect(n.options.body).not.toContain('Trainier');
      expect(n.options.data.url).toBe('/');
    }
  });

  it('a click focuses an open app window and tells it the tab, or opens the app', () => {
    const win = (url: string) => ({ url });
    expect(clickTarget({ url: '/?tab=essen' }, [win('https://other.example/'), win(`${ORIGIN}/`)], ORIGIN)).toEqual({ focus: 1, tab: 'essen' });
    expect(clickTarget({ url: '/' }, [win(`${ORIGIN}/`)], ORIGIN)).toEqual({ focus: 0, tab: null });
    expect(clickTarget({ url: '/?tab=essen' }, [], ORIGIN)).toEqual({ open: '/?tab=essen' });
    expect(clickTarget({ url: 'https://evil.example/' }, [], ORIGIN)).toEqual({ open: '/' });
    expect(clickTarget(undefined, [], ORIGIN)).toEqual({ open: '/' });
  });

  it('the rest notice renotifies with sound and vibration; other notices do not', () => {
    const r = notificationFor(JSON.stringify({ type: 'rest' }))!;
    expect(r.options).toMatchObject({ body: 'Die Pause ist vorbei. Weiter geht es mit dem nächsten Satz.', tag: 'pandafit-rest', renotify: true, silent: false, vibrate: [200, 100, 200], data: { url: '/' } });
    for (const t of ['version', 'meal', 'run', 'nope']) {
      const o = notificationFor(JSON.stringify({ type: t }))!.options;
      expect(o).not.toHaveProperty('renotify');
      expect(o).not.toHaveProperty('vibrate');
    }
  });

  it('a run notice opens /?tab=laufen and an open window gets tab laufen', () => {
    const r = notificationFor(JSON.stringify({ type: 'run' }))!;
    expect(r.options).toMatchObject({ body: 'Dein Laufplan für die Woche ist da.', tag: 'pandafit-run', data: { url: '/?tab=laufen' } });
    expect(clickTarget({ url: '/?tab=laufen' }, [{ url: `${ORIGIN}/` }], ORIGIN)).toEqual({ focus: 0, tab: 'laufen' });
    expect(clickTarget({ url: '/?tab=laufen' }, [], ORIGIN)).toEqual({ open: '/?tab=laufen' });
  });
});
