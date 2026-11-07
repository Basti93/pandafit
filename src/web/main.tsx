import { createRoot } from 'react-dom/client';
import { App, type Env } from './App';
import type { LiveSocket } from './live';
import { browserPush, closeRestNotices } from './push';
import { setupServiceWorker, type OpenState } from './register';
import './web.css';

let workoutOpen: OpenState = 'unknown'; // blocks an update until the app has looked at its data
let sw: { check(): void } | null = null;
// Until the first tap or key, nothing is held in memory: an update may reload even with a workout open.
let fresh = true;
for (const t of ['pointerdown', 'keydown'] as const) addEventListener(t, () => { fresh = false; }, { capture: true, once: true });

// A notification opens the app at /?tab=essen or /?tab=laufen; the address goes back to / at once.
const startTab = new URLSearchParams(location.search).get('tab');
if (startTab) history.replaceState(null, '', '/');
const ua = navigator.userAgent;
const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
const hasWorker = import.meta.env.PROD && 'serviceWorker' in navigator;

const env: Env = {
  fetchFn: (...a) => fetch(...a),
  now: Date.now,
  newId: () => crypto.randomUUID(),
  storage: localStorage,
  persist: async () => (await navigator.storage?.persist?.()) ?? false,
  ua,
  standalone,
  onWorkoutOpen: (state) => { workoutOpen = state; sw?.check(); },
  push: hasWorker ? browserPush({ ua, standalone }) : undefined,
  startTab,
  openLive: () => new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/coach`) as unknown as LiveSocket,
  onOpenTab: (f) => {
    if (!('serviceWorker' in navigator)) return () => {};
    const on = (e: MessageEvent) => { const d = e.data as { type?: unknown; tab?: unknown } | null; if (d?.type === 'OPEN_TAB' && typeof d.tab === 'string') f(d.tab); };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  },
};

createRoot(document.getElementById('root')!).render(<App env={env} />);

// A rest notice still on the lock screen is pointless once the app is open.
if (hasWorker) {
  const clearRest = () => { void navigator.serviceWorker.ready.then((r) => closeRestNotices(r)).catch(() => {}); };
  clearRest();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') clearRest(); });
}

// Registered from the module bundle (the server's CSP allows no inline scripts). Not in dev.
if (hasWorker) {
  void setupServiceWorker({ container: navigator.serviceWorker as never, isWorkoutOpen: () => workoutOpen, isFresh: () => fresh, reload: () => location.reload() })
    .then((s) => {
      sw = s;
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { void s.update(); s.check(); } });
    }).catch(() => { /* works without it */ });
}
