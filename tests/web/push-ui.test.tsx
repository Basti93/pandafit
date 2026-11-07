// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';
import { pushSupport, type PushEnv } from '../../src/web/push';

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SUB = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'P', auth: 'A' } };

function fakePush(o: { support?: PushEnv['support']; permission?: NotificationPermission; answer?: NotificationPermission } = {}) {
  let perm: NotificationPermission = o.permission ?? 'default';
  let sub: typeof SUB | null = null;
  const p = {
    support: o.support ?? 'ok',
    permission: () => perm,
    requestPermission: vi.fn(async () => (perm = o.answer ?? 'granted')),
    current: vi.fn(async () => sub),
    subscribe: vi.fn(async (_key: string) => (sub = SUB)),
    unsubscribe: vi.fn(async () => { const e = sub?.endpoint ?? null; sub = null; return e; }),
  } satisfies PushEnv;
  return p;
}

async function boot(o: { push: PushEnv; storage?: Map<string, string>; loggedIn?: boolean }) {
  const storage = o.storage ?? new Map<string, string>();
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/me') return o.loggedIn ? json(200, { name: 'anna' }) : json(401, {});
    if (url === '/login') return json(200, { ok: true });
    if (url === '/push/key') return json(200, { key: 'VAPIDKEY' });
    if (url.startsWith('/push/')) return json(200, { ok: true });
    if (init.method === 'POST') return json(200, { accepted: 0, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const factory = new IDBFactory();
  render(<App env={{
    fetchFn, idbFactory: factory, now: () => NOW, newId: () => Math.random().toString(36).slice(2),
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: (k) => { storage.delete(k); } },
    persist: async () => true, ua: 'Mozilla/5.0 Android', standalone: true, push: o.push,
  }} />);
  return { storage, calls, factory };
}
const doLogin = async () => {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'anna' } });
  fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
  await screen.findByRole('navigation');
};
const card = () => screen.queryByRole('region', { name: 'Benachrichtigungen einschalten' });

describe('push notifications on the phone', () => {
  it('after login a calm card offers notifications; tapping it asks first, then subscribes both on', async () => {
    const push = fakePush();
    const a = await boot({ push });
    await doLogin();
    expect(card()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Einschalten' }));
    await waitFor(() => expect(a.calls.some((c) => c.url === '/push/subscribe')).toBe(true));
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    expect(push.subscribe).toHaveBeenCalledWith('VAPIDKEY');
    expect(a.calls.find((c) => c.url === '/push/subscribe')!.body).toEqual(SUB);
    await waitFor(() => expect(card()).toBeNull());
    expect(a.storage.get('pandafit.push.anna')).toBe('on');
  });

  it('dismissing the card keeps it away, also after a restart', async () => {
    const push = fakePush();
    const a = await boot({ push });
    await doLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Nicht jetzt' }));
    expect(card()).toBeNull();
    expect(push.requestPermission).not.toHaveBeenCalled();
    cleanup();
    await boot({ push, storage: a.storage, loggedIn: true });
    await screen.findByRole('navigation');
    expect(card()).toBeNull();
  });

  it('a refused permission says so calmly and does not subscribe', async () => {
    const push = fakePush({ answer: 'denied' });
    const a = await boot({ push });
    await doLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Einschalten' }));
    expect(await screen.findByText(/nicht erlaubt/)).toBeTruthy();
    expect(push.subscribe).not.toHaveBeenCalled();
    expect(a.calls.some((c) => c.url === '/push/subscribe')).toBe(false);
  });

  it('Profil turns notifications on and off', async () => {
    const push = fakePush();
    const a = await boot({ push });
    await doLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Nicht jetzt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    const sw = await screen.findByRole('switch', { name: 'Benachrichtigungen' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Benachrichtigungen' }) as HTMLInputElement).checked).toBe(true));
    expect(a.calls.filter((c) => c.url === '/push/subscribe')).toHaveLength(1);
    fireEvent.click(screen.getByRole('switch', { name: 'Benachrichtigungen' }));
    await waitFor(() => expect(a.calls.find((c) => c.url === '/push/unsubscribe')?.body).toEqual({ endpoint: SUB.endpoint }));
    expect(push.unsubscribe).toHaveBeenCalled();
    expect((screen.getByRole('switch', { name: 'Benachrichtigungen' }) as HTMLInputElement).checked).toBe(false);
    expect(a.storage.get('pandafit.push.anna')).toBe('off');
  });

  it('Profil: the new-version sub switch shows only when notifications are on and writes the contact record', async () => {
    const push = fakePush();
    const a = await boot({ push });
    await doLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Nicht jetzt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Benachrichtigungen' }));
    const sub = await screen.findByRole('switch', { name: 'Neue Version' }) as HTMLInputElement;
    expect(sub.checked).toBe(true);
    fireEvent.click(sub);
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Neue Version' }) as HTMLInputElement).checked).toBe(false));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('contact')).find((r) => r.id === 'contact');
      s.close();
      expect(rec?.body).toMatchObject({ email: null, weekly: false, updates: false });
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Benachrichtigungen' }));
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Neue Version' })).toBeNull());
  });

  it('when on, the subscription is sent again at the start, so it follows the current login', async () => {
    const push = fakePush({ permission: 'granted' });
    const storage = new Map([['pandafit.push.anna', 'on'], ['pandafit.pushCard.anna', '1']]);
    const a = await boot({ push, storage, loggedIn: true });
    await screen.findByRole('navigation');
    await waitFor(() => expect(a.calls.filter((c) => c.url === '/push/subscribe')).toHaveLength(1));
    expect(push.requestPermission).not.toHaveBeenCalled();
  });

  it('in a plain Safari tab on the iPhone the card shows the install hint instead of the button', async () => {
    const push = fakePush({ support: 'install' });
    await boot({ push });
    await doLogin();
    expect(card()).not.toBeNull();
    expect(screen.getAllByText(/Home-Bildschirm liegt \(ab iOS 16\.4\)/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Einschalten' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }));
    expect(card()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    expect(await screen.findByText(/Home-Bildschirm liegt \(ab iOS 16\.4\)/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Benachrichtigungen' })).toBeNull();
    expect(push.requestPermission).not.toHaveBeenCalled();
  });

  it('support: an iPhone browser tab needs the home screen app; elsewhere it depends on the Push API', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
    expect(pushSupport({ ua: iphone, standalone: false, hasPush: false })).toBe('install');
    expect(pushSupport({ ua: iphone, standalone: true, hasPush: true })).toBe('ok');
    expect(pushSupport({ ua: iphone, standalone: true, hasPush: false })).toBe('none');
    expect(pushSupport({ ua: 'Mozilla/5.0 Android', standalone: false, hasPush: true })).toBe('ok');
  });

  it('the settings hint names the notices in one line', async () => {
    const push = fakePush();
    await boot({ push, loggedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    expect(await screen.findByText('Essens- und Laufplan, Antworten vom Coach, neue Version.')).toBeTruthy();
  });
});
