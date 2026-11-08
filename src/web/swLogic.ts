/** Pure decisions of the service worker, so they can be tested without a browser. */
export const NEVER_CACHE = ['/records', '/login', '/logout', '/me', '/device-token', '/healthz', '/push'];
/** shell: the app page. precached: a file of this build. bypass: not ours, the browser decides. */
export type Route = 'bypass' | 'shell' | 'precached';
type Req = { method: string; url: string; mode: string };
type CacheLike = { match(k: string): Promise<Response | undefined> };

export const precacheName = (buildId: string): string => `pandafit-${buildId}`;

/**
 * An allowlist: only files of this build's precache are ever answered. Nothing is written at runtime, so nothing
 * can poison the cache (a PNG opened as a page, an error page, a file of another version).
 */
export function routeFor(r: Req, origin: string, allow: ReadonlySet<string>): Route {
  const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== origin) return 'bypass';
  if (NEVER_CACHE.some((p) => u.pathname === p || u.pathname.startsWith(`${p}/`))) return 'bypass';
  if (r.mode === 'navigate' && (u.pathname === '/' || u.pathname === '/index.html')) return 'shell';
  return allow.has(u.pathname) ? 'precached' : 'bypass';
}

/** Null means: not ours, let the browser do it. The cache is this build's own; a miss goes to the network and is not stored. */
export async function handleFetch(r: Req, origin: string, allow: ReadonlySet<string>, deps: { cache: CacheLike; fetch: (u: string) => Promise<Response> }): Promise<Response | null> {
  const route = routeFor(r, origin, allow);
  if (route === 'bypass') return null;
  const key = route === 'shell' ? '/index.html' : new URL(r.url).pathname;
  return (await deps.cache.match(key)) ?? deps.fetch(r.url);
}

// ---- push notifications ----

/** The only texts the worker ever shows: what the server sends is used for its type only. */
const NOTES: Record<string, { body: string; url: string; alert?: boolean }> = {
  version: { body: 'Es gibt eine neue Version von Pandafit. Beim nächsten Öffnen ist sie da.', url: '/' },
  meal: { body: 'Dein Essensplan für die Woche ist da.', url: '/?tab=essen' },
  run: { body: 'Dein Laufplan für die Woche ist da.', url: '/?tab=laufen' },
  rest: { body: 'Die Pause ist vorbei. Weiter geht es mit dem nächsten Satz.', url: '/', alert: true },
  coach: { body: 'Dein Coach hat dir geschrieben.', url: '/?tab=coach' },
};
export type Note = { title: string; options: { body: string; tag: string; icon: string; badge: string; data: { url: string }; renotify?: boolean; silent?: boolean; vibrate?: number[] } };

/** A push always shows something (Safari ends subscriptions that stay silent); unknown or broken data gets a plain notice. */
export function notificationFor(text: string | null): Note {
  let type = '';
  try { const d = JSON.parse(text ?? '') as { type?: unknown }; if (typeof d?.type === 'string') type = d.type; } catch { /* plain notice */ }
  const n = Object.hasOwn(NOTES, type) ? NOTES[type]! : null;
  return {
    title: 'Pandafit',
    options: { body: n?.body ?? 'Neues in Pandafit.', tag: n ? `pandafit-${type}` : 'pandafit', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: n?.url ?? '/' },
      ...(n?.alert ? { renotify: true, silent: false, vibrate: [200, 100, 200] } : {}) },
  };
}

/** On a click: focus an open window of the app and tell it the tab, or open the app at the notice's own path. */
export function clickTarget(data: unknown, windows: readonly { url: string }[], origin: string): { focus: number; tab: 'essen' | 'laufen' | 'coach' | null } | { open: string } {
  const raw = (data as { url?: unknown } | null | undefined)?.url;
  const url = typeof raw === 'string' && Object.values(NOTES).some((n) => n.url === raw) ? raw : '/';
  const i = windows.findIndex((w) => { try { return new URL(w.url).origin === origin; } catch { return false; } });
  if (i >= 0) return { focus: i, tab: url === '/?tab=essen' ? 'essen' : url === '/?tab=laufen' ? 'laufen' : url === '/?tab=coach' ? 'coach' : null };
  return { open: url };
}
