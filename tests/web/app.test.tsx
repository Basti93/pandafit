// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { App, ErrorBoundary } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';
import { mobilityToShow, shouldShowInstallHint } from '../../src/web/logic';
import { dayIndex, itemKey, weekOf } from '../../src/shared/meals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MealCoach } from '../../src/coach/meals/meal-coach';
import { MEAL_SYSTEM_PROMPT } from '../../src/coach/meals/prompt';
import { RecordStore } from '../../src/coach/tracking/store';
import { runFp } from '../../src/shared/run';

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const plan = (atMs: number, mobility: unknown = null): TrackedRecord => ({
  kind: 'plan', id: 'current', updatedMs: atMs, deleted: false,
  body: { workout: { name: 'Beine A', exercises: [{ templateId: 'x', title: 'Kniebeuge', restS: 90, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 40, reps: 8 }] }] }, reason: 'Beine sind dran', source: 'ai', note: 'Gut gemacht diese Woche', questions: [], atMs, mobility },
});
const session = (triggerMs: number) => ({ id: `mobility-bike-${triggerMs}`, forSession: 'bike', minutes: 8, exercises: [{ id: 'm1', title: 'Hüftbeuger dehnen', howTo: 'Ausfallschritt, ruhig atmen.', area: 'hueftbeuger' }], reason: 'Nach der Radfahrt tut das gut.' });

type Opts = { startTab?: string; onOpenTab?: (f: (tab: string) => void) => () => void; logoutStatus?: number; hold?: { me: Promise<void> | null }; flaky?: { fail: boolean }; me?: number; hangMe?: boolean; noIdb?: 'null' | 'throws'; flags?: Record<string, string>; logoutFails?: boolean; loginStatus?: number; offline?: boolean; syncStatus?: number; seed?: TrackedRecord[]; account?: string; ua?: string; standalone?: boolean; persist?: boolean; recipes?: (url: string) => Response | Promise<Response> };
async function boot(o: Opts = {}) {
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
    if (o.syncStatus && o.syncStatus !== 200) return json(o.syncStatus, {});
    if (init.method === 'POST') return json(200, { accepted: 1, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const persist = vi.fn(async () => o.persist ?? true);
  const onWorkoutOpen = vi.fn();
  const ui = render(<App env={{
    fetchFn, idbFactory: o.flaky ? ({ open: (n: string, v?: number) => { if (o.flaky!.fail) throw new Error('denied'); return factory.open(n, v); } } as unknown as IDBFactory) : o.noIdb === 'null' ? null : o.noIdb === 'throws' ? ({ open: () => { throw new Error('denied'); } } as unknown as IDBFactory) : factory, now: () => NOW, newId: () => `id-${Math.random().toString(36).slice(2)}`,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
    persist, ua: o.ua ?? 'Mozilla/5.0 Android', standalone: o.standalone ?? false, onWorkoutOpen, startTab: o.startTab, onOpenTab: o.onOpenTab,
  }} />);
  return { ...ui, factory, storage, calls, persist, onWorkoutOpen };
}

describe('web app', () => {
  it('login failure shows a calm message', async () => {
    await boot({ me: 401, loginStatus: 401 });
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'falsch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    expect(await screen.findByText('Name oder Passwort stimmt nicht. Versuch es gern nochmal.')).toBeTruthy();
  });

  it('login: the button is always enabled; empty fields say what is missing instead of sending', async () => {
    const a = await boot({ me: 401 });
    const btn = await screen.findByRole('button', { name: 'Anmelden' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(await screen.findByText('Bitte Name und Passwort eingeben')).toBeTruthy();
    expect(a.calls.some((c) => c.includes('/login'))).toBe(false);
  });

  it('Profil has a way back and the coach timing switches', async () => {
    await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    expect(await screen.findByRole('switch', { name: /Wochengespräch/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
    expect(await screen.findByRole('heading', { level: 1, name: /^\p{L}+, \d+\. \p{L}+$/u })).toBeTruthy();
  });

  it('Profil: the e-mail address saves and removes, the weekly switch needs an address', async () => {
    const a = await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    const sw = await screen.findByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /E-Mail\s*keine/ }));
    const input = await screen.findByLabelText('E-Mail-Adresse');
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('email');
    fireEvent.change(input, { target: { value: 'kein-mail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Bitte eine gültige Adresse')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Entfernen' })).toBeNull();
    fireEvent.change(input, { target: { value: 'a@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('button', { name: /E-Mail\s*a@example\.org/ })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }));
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement).checked).toBe(true));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('contact')).find((r) => r.id === 'contact');
      s.close();
      expect(rec?.body).toMatchObject({ email: 'a@example.org', weekly: true });
    });
    fireEvent.click(screen.getByRole('button', { name: /E-Mail\s*a@example\.org/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    expect(await screen.findByRole('button', { name: /E-Mail\s*keine/ })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement).checked).toBe(false);
  });

  it('storage persistence is requested at login, and a refusal gets a single calm line', async () => {
    const a = await boot({ me: 401, persist: false });
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(a.persist).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    expect((await screen.findAllByText(/Browser kann Daten löschen/)).length).toBe(1);
  });

  it('says nothing about storage when persistence is granted', async () => {
    const a = await boot({ seed: [], persist: true });
    await screen.findByRole('navigation');
    await waitFor(() => expect(a.persist).toHaveBeenCalled());
    expect(screen.queryByText(/Browser kann Daten löschen/)).toBeNull();
  });

  it('offline after the first load the app and an open workout work', async () => {
    const a = await boot({ offline: true, account: 'anna', seed: [plan(NOW - 1000)] });
    expect(await screen.findByText('Beine A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kraft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Anderes Training' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leeres Training starten' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      expect((await s.list('workout')).length).toBe(1);
      s.close();
    });
    await waitFor(() => expect(a.onWorkoutOpen).toHaveBeenCalledWith('open'));
  });

  it('an open workout shows on Heute with "Weitermachen", which leads to the workout', async () => {
    const open: TrackedRecord = { kind: 'workout', id: 'w-open', updatedMs: NOW - 500, deleted: false, body: { id: 'w-open', title: 'Pull', startMs: NOW - 600_000, endMs: null, source: 'pandafit', exercises: [] } };
    await boot({ seed: [plan(NOW - 1000), open] });
    expect(await screen.findByRole('heading', { name: /^Pull läuft noch – seit \d\d:\d\d$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Weitermachen' }));
    // one tap: the workout itself opens, not the start screen with its card
    expect(await screen.findByRole('button', { name: 'Training beenden' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Weitermachen' })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Kraft' })).toBeNull()); // the Kraft sub-navigation is gone while a workout runs
  });

  it('an expired login keeps unsent data and asks to log in again', async () => {
    const a = await boot({ syncStatus: 401, seed: [plan(NOW - 1000)] });
    expect(await screen.findByText(/Bitte melde dich neu an/)).toBeTruthy();
    expect(screen.getByText('Beine A')).toBeTruthy();
    expect(a.storage.get('pandafit.account')).toBe('anna');
  });

  it('the plan shows its date and says calmly when it is older than a week', async () => {
    await boot({ seed: [plan(NOW - 2 * DAY)] });
    expect(await screen.findByText(/^Plan vom /)).toBeTruthy();
    expect(screen.queryByText(/Coach macht einen neuen/)).toBeNull();
    cleanup();
    await boot({ seed: [plan(NOW - 9 * DAY)] });
    expect(await screen.findByText(/Coach macht einen neuen/)).toBeTruthy();
  });

  it('without a plan there is a calm note and a workout can still be started', async () => {
    await boot({ seed: [] });
    expect(await screen.findByText(/Noch kein Krafttraining geplant/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kraft' }));
    expect(await screen.findByRole('button', { name: 'Leeres Training starten' })).toBeTruthy();
  });

  it('the mobility card comes from the plan and Gemacht writes the done record', async () => {
    const s = session(NOW - 3600_000);
    const a = await boot({ seed: [plan(NOW - 1000, s)] });
    expect(await screen.findByText('8 Min')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Beweglichkeit/ }));
    expect(await screen.findByText('Hüftbeuger dehnen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gemacht' }));
    await waitFor(async () => {
      const st = await openIdb('anna', a.factory);
      const m = (await st.list('mobility')).find((r) => r.id === s.id);
      expect(m?.body).toEqual({ doneMs: NOW, forSession: 'bike' });
      st.close();
    });
    await waitFor(() => expect(screen.queryByText('Hüftbeuger dehnen')).toBeNull());
  });

  it('the plan comes first, mobility below it as one row; "Heute nicht" hides it for today only, without writing anything', async () => {
    const s = session(NOW - 3600_000);
    const a = await boot({ seed: [plan(NOW - 1000, s)] });
    const mob = await screen.findByRole('button', { name: /^Beweglichkeit/ });
    expect(screen.getByText('Beine A').compareDocumentPosition(mob) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Hüftbeuger dehnen')).toBeNull();
    fireEvent.click(mob);
    fireEvent.click(screen.getByRole('button', { name: 'Heute nicht' }));
    expect(screen.queryByRole('button', { name: /^Beweglichkeit/ })).toBeNull();
    expect([...a.storage.keys()].some((k) => k.startsWith('pandafit.mobility.notToday'))).toBe(true);
    const st = await openIdb('anna', a.factory);
    expect(await st.list('mobility')).toEqual([]);
    st.close();
  });

  it('the tab bar has Heute, Woche and Kraft; the profile button shows the account and the sync state', async () => {
    await boot({ seed: [plan(NOW - 1000)] });
    await screen.findByText('Beine A');
    const nav = screen.getByRole('navigation', { name: 'Seiten' });
    expect([...nav.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Heute', 'Woche', 'Kraft']);
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    expect(await screen.findByText('Angemeldet als anna')).toBeTruthy();
    expect(screen.getByText(/gesichert|Abgleich|Senden|Verbindung/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeTruthy();
  });

  it('the tab bar steps aside while a field has focus, so the keyboard never pushes it over an input', async () => {
    await boot({ seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Woche' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Coach/ }));
    const field = await screen.findByLabelText('Nachricht an den Coach');
    const nav = screen.getByRole('navigation', { name: 'Seiten' });
    fireEvent.focusIn(field);
    expect(nav.className).toContain('web-nav-away');
    fireEvent.focusOut(field);
    expect(nav.className).not.toContain('web-nav-away');
  });

  it('Heute has no complaints box any more: complaints go through the coach chat', async () => {
    await boot({ seed: [{ kind: 'complaint', id: 'c1', updatedMs: 5, deleted: false, body: { text: 'Knie links', status: 'active', atMs: 5 } }] });
    await screen.findByRole('heading', { level: 1, name: /^\p{L}+, \d+\. \p{L}+$/u });
    expect(screen.queryByText('Knie links')).toBeNull();
    expect(screen.queryByLabelText('Neue Beschwerde')).toBeNull();
  });

  it('logging out asks when unsent records exist and keeps local data', async () => {
    const a = await boot({ offline: true, account: 'anna', seed: [plan(NOW - 1000)] });
    await screen.findByText('Beine A');
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
    expect(await screen.findByText(/noch nicht gesendet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trotzdem abmelden' }));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    const st = await openIdb('anna', a.factory);
    expect((await st.list('plan')).length).toBe(1);
    st.close();
  });

  it('the install hint shows once on iPhone in the browser and never when installed', async () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18 Mobile Safari/604';
    const a = await boot({ seed: [], ua: iphone });
    expect(await screen.findByText(/Zum Home-Bildschirm/)).toBeTruthy();
    expect(a.storage.get('pandafit.installHint')).toBe('1');
    cleanup();
    expect(shouldShowInstallHint({ ua: iphone, standalone: false, seen: true })).toBe(false);
    expect(shouldShowInstallHint({ ua: iphone, standalone: true, seen: false })).toBe(false);
    expect(shouldShowInstallHint({ ua: 'Mozilla/5.0 Android', standalone: false, seen: false })).toBe(false);
    expect(shouldShowInstallHint({ ua: iphone, standalone: false, seen: false })).toBe(true);
  });

  it('mobility is hidden when done or older than 24 hours', () => {
    const p = plan(NOW, session(NOW - 3600_000));
    expect(mobilityToShow(p, [], NOW)).not.toBeNull();
    expect(mobilityToShow(plan(NOW, session(NOW - 25 * 3600_000)), [], NOW)).toBeNull();
    const done: TrackedRecord = { kind: 'mobility', id: session(NOW - 3600_000).id, updatedMs: 1, deleted: false, body: { doneMs: NOW - 10, forSession: 'bike' } };
    expect(mobilityToShow(p, [done], NOW)).toBeNull();
    expect(mobilityToShow(plan(NOW, null), [], NOW)).toBeNull();
  });

  it('Hevy, Garmin and ride pages are not part of the web build', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+'(\.[^']+)'|^\s*import\s+'(\.[^']+)'/gm)) {
        const spec = m[1] ?? m[2]!;
        const base = resolve(dirname(file), spec);
        const next = ['.ts', '.tsx', '/index.ts', ''].map((e) => base + e).find((p) => existsSync(p) && /\.(tsx?)$/.test(p));
        if (/\/src\/(service|main|ui|coach)\//.test(base)) bad.push(`${file} -> ${spec}`);
        if (next) walk(next);
      }
    };
    walk(resolve('src/web/main.tsx'));
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(5);
  });

  it('opens the last account at once; a 401 from /me keeps the app open with a login prompt and the open workout reachable', async () => {
    const open: TrackedRecord = { kind: 'workout', id: 'w-open', updatedMs: NOW - 60_000, deleted: false, body: { id: 'w-open', title: 'Offenes Training', startMs: NOW - 120_000, endMs: null, source: 'pandafit', exercises: [] } };
    await boot({ me: 401, account: 'anna', seed: [open], syncStatus: 401 });
    expect(await screen.findByText(/Bitte melde dich neu an/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kraft' }));
    expect(await screen.findByText(/Weitermachen/)).toBeTruthy();
  });

  it('a hanging /me never blocks the UI', async () => {
    await boot({ hangMe: true, account: 'anna', seed: [plan(NOW - 1000)] });
    expect(await screen.findByText('Beine A')).toBeTruthy();
  });

  it('B logging in inside A\'s shell never lets A\'s records go out under B, nor B\'s into A\'s database', async () => {
    const factory = new IDBFactory();
    const sa = await openIdb('anna', factory);
    await sa.put({ kind: 'chat', id: 'a-only', updatedMs: 5, deleted: false, body: { role: 'rider', text: 'Nur Anna', atMs: 5 } });
    sa.close();
    let user: string | null = null; // whose cookie the "browser" currently holds
    const posts: { user: string | null; ids: string[] }[] = [];
    const fetchFn = (async (url: string, init: RequestInit = {}) => {
      if (url === '/login') { user = (JSON.parse(String(init.body)) as { name: string }).name; return json(200, { ok: true }); }
      if (url === '/me') return user ? json(200, { name: user }) : json(401, {});
      if (init.method === 'POST' && url === '/records') { posts.push({ user, ids: (JSON.parse(String(init.body)) as { records: { id: string }[] }).records.map((r) => r.id) }); return json(200, { accepted: 1, refused: [] }); }
      if (!user) return json(401, {});
      return json(200, { records: user === 'ben' ? [{ kind: 'chat', id: 'b-only', updatedMs: 6, deleted: false, body: { role: 'rider', text: 'Nur Ben', atMs: 6 } }] : [], cursor: 1, more: false, reset: false });
    }) as unknown as typeof fetch;
    const storage = new Map<string, string>([['pandafit.account', 'anna']]);
    render(<App env={{ fetchFn, idbFactory: factory, now: () => NOW, newId: () => 'x', storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); }, removeItem: (k) => { storage.delete(k); } }, persist: async () => true, ua: '', standalone: false }} />);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'ben' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(storage.get('pandafit.account')).toBe('ben'));
    // The shell rebuilds after the login: open the chat until Ben's record shows there.
    await waitFor(() => { fireEvent.click(screen.getByRole('button', { name: 'Woche' })); fireEvent.click(screen.getByRole('button', { name: /^Coach/ })); expect(screen.getByText('Nur Ben')).toBeTruthy(); });
    expect(posts.filter((p) => p.user === 'ben' && p.ids.includes('a-only'))).toEqual([]);
    const a = await openIdb('anna', factory);
    expect((await a.list('chat')).map((r) => r.id)).toEqual(['a-only']);
    a.close();
  });

  it('logging out clears the last account; offline it leaves a flag that blocks entry and retries /logout at the next start', async () => {
    const a = await boot({ account: 'anna', seed: [plan(NOW - 1000)], logoutFails: true });
    await screen.findByText('Beine A');
    await waitFor(() => expect(a.calls).toContain('GET /me'));
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
    if (screen.queryByRole('button', { name: 'Trotzdem abmelden' })) fireEvent.click(screen.getByRole('button', { name: 'Trotzdem abmelden' }));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    expect(a.storage.get('pandafit.account')).toBeUndefined();
    await waitFor(() => expect(a.storage.get('pandafit.loggedOut')).toBe('1'));
    cleanup();
    const b = await boot({ flags: { 'pandafit.loggedOut': '1' }, seed: [plan(NOW - 1000)] });
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    expect(screen.queryByText('Beine A')).toBeNull();
    await waitFor(() => expect(b.calls).toContain('POST /logout'));
    await waitFor(() => expect(b.storage.get('pandafit.loggedOut')).toBeUndefined());
  });

  it('IndexedDB unavailable says so plainly, at startup and after login, and offers no workout screen', async () => {
    await boot({ noIdb: 'null', account: 'anna' });
    expect(await screen.findByText(/nicht gespeichert werden/)).toBeTruthy();
    expect(screen.queryByText(/Keine Verbindung/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kraft' })).toBeNull();
    cleanup();
    expect(screen.queryByText(/privat/i)).toBeNull(); // private mode is never claimed
  });

  it('the persistence notice sits on Profil only, not over the other tabs', async () => {
    const again = await boot({ persist: false, seed: [] });
    await screen.findByRole('navigation');
    await waitFor(() => expect(again.persist).toHaveBeenCalled());
    expect(screen.queryByText(/Browser kann Daten löschen/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    expect(await screen.findByText(/Browser kann Daten löschen/)).toBeTruthy();
  });

  it('the workout state is unknown until read, open for a fresh open workout, and none for a stale one', async () => {
    const mk = (age: number): TrackedRecord => ({ kind: 'workout', id: 'w', updatedMs: NOW - age, deleted: false, body: { id: 'w', title: 'T', startMs: NOW - age, endMs: null, source: 'pandafit', exercises: [] } });
    const fresh = await boot({ seed: [mk(60_000)] });
    await waitFor(() => expect(fresh.onWorkoutOpen).toHaveBeenCalledWith('open'));
    expect(fresh.onWorkoutOpen).not.toHaveBeenCalledWith('none');
    cleanup();
    const stale = await boot({ seed: [mk(13 * 3600_000)] });
    await waitFor(() => expect(stale.onWorkoutOpen).toHaveBeenCalledWith('none'));
    expect(stale.onWorkoutOpen).not.toHaveBeenCalledWith('open');
  });

  it('a malformed plan record does not white-screen the page', async () => {
    await boot({ seed: [{ kind: 'plan', id: 'current', updatedMs: 1, deleted: false, body: { workout: { name: 'X', exercises: [{ title: 'Ohne Sätze' }] } } }, { kind: 'complaint', id: 'c', updatedMs: 1, deleted: false, body: null }] });
    expect(await screen.findByText(/Noch kein Krafttraining geplant/)).toBeTruthy();
  });

  it('an error boundary shows a calm message and still offers the workout page', () => {
    const Boom = () => { throw new Error('boom'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let went = 0;
    render(<ErrorBoundary onTraining={() => { went++; }}><Boom /></ErrorBoundary>);
    expect(screen.getByText(/lässt sich gerade nicht anzeigen/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Zum Training' }));
    expect(went).toBe(1);
    spy.mockRestore();
  });

  it('a logout answered with an error status keeps the flag and blocks entry; only 2xx or 401 count as done', async () => {
    const a = await boot({ account: 'anna', seed: [plan(NOW - 1000)], logoutStatus: 502 });
    await screen.findByText('Beine A');
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
    if (screen.queryByRole('button', { name: 'Trotzdem abmelden' })) fireEvent.click(screen.getByRole('button', { name: 'Trotzdem abmelden' }));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    await waitFor(() => expect(a.storage.get('pandafit.loggedOut')).toBe('1'));
    cleanup();
    const b = await boot({ flags: { 'pandafit.loggedOut': '1' }, logoutStatus: 500 });
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    await waitFor(() => expect(b.calls).toContain('POST /logout'));
    await new Promise((r) => setTimeout(r, 30));
    expect(b.storage.get('pandafit.loggedOut')).toBe('1');
    cleanup();
    const c = await boot({ flags: { 'pandafit.loggedOut': '1' }, logoutStatus: 401 });
    await screen.findByLabelText('Name');
    await waitFor(() => expect(c.storage.get('pandafit.loggedOut')).toBeUndefined());
  });

  it('a transient IndexedDB failure says entries are not lost and a button retries without a restart', async () => {
    const flaky = { fail: true };
    await boot({ account: 'anna', seed: [plan(NOW - 1000)], flaky });
    expect(await screen.findByText(/nicht verloren/)).toBeTruthy();
    expect(screen.queryByText(/privat/i)).toBeNull();
    flaky.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal versuchen' }));
    expect(await screen.findByText('Beine A')).toBeTruthy();
  });

  const knee = { id: 'w-open', title: 'Beine', startMs: NOW - 120_000, endMs: null, source: 'pandafit', exercises: [{ exerciseId: 'e1', title: 'Kniebeuge', supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 40, reps: 8, durationS: null, doneMs: null }] }] };
  const openRec = (ageMs: number): TrackedRecord => ({ kind: 'workout', id: 'w-open', updatedMs: NOW - ageMs, deleted: false, body: knee });

  it('a note typed in the last 400 ms survives logging out (the real store and port are flushed before the port stops)', async () => {
    const a = await boot({ account: 'anna', seed: [openRec(60_000)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    fireEvent.click(await screen.findByRole('button', { name: /Weitermachen/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mehr zu Kniebeuge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notiz hinzufügen Kniebeuge' }));
    const note = await screen.findByLabelText('Notiz zu Kniebeuge');
    fireEvent.focus(note);
    fireEvent.change(note, { target: { value: 'Rechtes Knie ziept' } });
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abmelden' }));
    const confirm = screen.queryByRole('button', { name: 'Trotzdem abmelden' });
    if (confirm) fireEvent.click(confirm);
    await screen.findByLabelText('Name');
    await waitFor(async () => {
      const st = await openIdb('anna', a.factory);
      const w = (await st.list('workout')).find((r) => r.id === 'w-open')!;
      st.close();
      expect((w.body as typeof knee).exercises[0]!.notes).toBe('Rechtes Knie ziept');
    });
  });

  it('the login form waits for a running sync before it posts the login (pause is wired)', async () => {
    let release!: () => void;
    const hold = { me: null as Promise<void> | null };
    const a = await boot({ account: 'anna', seed: [plan(NOW - 1000)], me: 401, syncStatus: 401, hold });
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw' } });
    hold.me = new Promise<void>((r) => { release = r; });
    window.dispatchEvent(new Event('online')); // a sync starts and hangs on /me
    await waitFor(() => expect(a.calls.filter((c) => c === 'GET /me').length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await new Promise((r) => setTimeout(r, 80));
    expect(a.calls).not.toContain('POST /login');
    hold.me = null; release();
    await waitFor(() => expect(a.calls).toContain('POST /login'));
  });

  it('a resumed workout older than 12 hours still counts as open while its screen is open', async () => {
    const a = await boot({ account: 'anna', seed: [openRec(13 * 3600_000)] });
    await waitFor(() => expect(a.onWorkoutOpen).toHaveBeenCalledWith('none'));
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    fireEvent.click(await screen.findByRole('button', { name: /Weitermachen/ }));
    await waitFor(() => expect(a.onWorkoutOpen).toHaveBeenLastCalledWith('open'));
  });
});

describe('Essen on the phone', () => {
  const week = weekOf(NOW);
  const dish = (title: string) => ({ title, ingredients: [{ name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }], steps: ['Verrühren.'], minutes: 5, proteinG: 27, keepsDays: 2, source: 'liste' });
  const today = dayIndex(NOW);
  const mealPlan: TrackedRecord = { kind: 'mealplan', id: `week-${week}`, updatedMs: NOW - 1000, deleted: false, body: {
    week, createdMs: NOW - 1000, source: 'liste', trainingDays: [], you: 'pb', people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }],
    meals: [
      { day: today, slot: 'fruehstueck', dish: dish('Skyr mit Beeren'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: today, slot: 'mittag', dish: dish('Linsen-Bolognese'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: true },
      { day: (today + 1) % 7, slot: 'abend', dish: dish('Tomatensuppe'), reuseOf: null, eaters: ['pa'], takeAlong: false },
    ] } };

  it('no Essen tab without a plan: the meal plan is off by default', async () => {
    await boot({ account: 'anna', seed: [] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Essen' })).toBeNull();
  });

  it('today first with its meals, and a tick or a person off goes into the state record', async () => {
    const a = await boot({ account: 'anna', seed: [mealPlan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    expect(await screen.findByRole('heading', { name: 'Heute' })).toBeTruthy();
    // A meal is one row; the people and the recipe show when it is opened, one row at a time.
    const row = screen.getByRole('button', { name: /Skyr mit Beeren/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Lena isst mit' })).toBeNull();
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: /Linsen-Bolognese/ }));
    expect(screen.getByRole('button', { name: /Skyr mit Beeren/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Skyr mit Beeren/ }));
    expect(screen.getByText('Verrühren.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lena isst mit' }));
    // Only a deviation shows on the closed row.
    fireEvent.click(screen.getByRole('button', { name: /Skyr mit Beeren/ }));
    expect(await screen.findByText('Lena isst nicht mit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Einkauf/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Skyr gekauft' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('mealplan')).find((r) => r.id === `state-${week}`);
      s.close();
      const body = rec?.body as { items?: Record<string, { state: string }>; eaters?: Record<string, Record<string, { on: boolean }>> } | undefined;
      expect(body?.items?.[itemKey('Skyr', 'g')]?.state).toBe('gekauft');
      expect(body?.eaters?.[`${today}-fruehstueck`]?.pb?.on).toBe(false);
    });
  });

  it('own shopping items: added under "Eigenes", ticked, and removed after a confirm; all in the state record', async () => {
    const a = await boot({ account: 'anna', seed: [mealPlan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Einkauf/ }));
    fireEvent.change(await screen.findByLabelText('Etwas dazuschreiben'), { target: { value: 'Kaffee' } });
    fireEvent.change(screen.getByLabelText('Menge (optional)'), { target: { value: '2 Pakete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByRole('heading', { name: 'Eigenes' })).toBeTruthy();
    expect(screen.getByText('2 Pakete')).toBeTruthy();
    expect((screen.getByLabelText('Etwas dazuschreiben') as HTMLInputElement).value).toBe('');
    const stateOf = async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('mealplan')).find((r) => r.id === `state-${week}`);
      s.close();
      return (rec?.body as { own?: Record<string, { name: string; state: string; removed: boolean }> } | undefined)?.own ?? {};
    };
    await waitFor(async () => expect(Object.values(await stateOf()).map((o) => o.name)).toEqual(['Kaffee']));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kaffee gekauft' }));
    await waitFor(async () => expect(Object.values(await stateOf())[0]!.state).toBe('gekauft'));
    // The plan's own items keep "Haben wir"; an own item offers only a confirmed removal.
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(screen.getByText('Wirklich entfernen?')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(Object.values(await stateOf())[0]!.removed).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
    await waitFor(async () => expect(Object.values(await stateOf())[0]!.removed).toBe(true));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Eigenes' })).toBeNull());
  });

  it('"Haben wir" sits at the right of each open row, and the item moves to "Schon da"', async () => {
    await boot({ account: 'anna', seed: [mealPlan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Einkauf/ }));
    expect(screen.queryByText(/von \d+ noch offen/)).toBeNull();
    const skyr = (await screen.findByText('Skyr')).closest('li')!;
    fireEvent.click(within(skyr).getByRole('button', { name: 'Haben wir' }));
    expect(await screen.findByRole('heading', { name: 'Schon da' })).toBeTruthy();
  });

  it('a message to the coach: written as a record, waiting until the Mac answers, then the reply and the change for both', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-chat-'));
    const store = new RecordStore({ dir: path.join(dir, 'tracking') });
    const ON = { on: true, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'mitnehmen', abend: 'zuhause' } };
    const mac = new MealCoach({
      dir: path.join(dir, 'meals'), nowMs: () => NOW + 60_000, profiles: () => [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }], noOpenRide: () => true, random: () => 0.5,
      store, linked: () => true,
      ask: async (i) => {
        if (i.systemPrompt === MEAL_SYSTEM_PROMPT) throw new Error('rules only');
        return { antwort: 'Heute Abend gibt es Nudeln.', abneigungenMerken: [], aenderungen: [{ art: 'gericht', tag: today, slot: 'abend', zutatAlt: null, zutatNeu: null, schritte: null, titel: null,
          gericht: { titel: 'Nudeln mit Tomatensoße und Linsen', minuten: 20, eiweissG: 24, haltbarTage: 1, schritte: ['Nudeln kochen.', 'Soße erhitzen.'], zutaten: [{ name: 'Vollkornnudeln', menge: 90, einheit: 'g', abteilung: 'Vorrat', roh: false }] } }] };
      },
    });
    mac.setSettings('pa', ON);
    mac.setSettings('pb', ON);
    await mac.replan('pa', week);
    const a = await boot({ account: 'anna', seed: store.all('pb') });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Änderung wünschen' }));
    fireEvent.change(await screen.findByLabelText('Nachricht an den Coach'), { target: { value: 'Heute Abend lieber was mit Nudeln' } });
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Der Coach antwortet gleich. Ist der Mac aus, dauert es, bis er wieder an ist.')).toBeTruthy();
    expect(screen.getByText(/Heute Abend lieber was mit Nudeln/)).toBeTruthy();
    // Through the account to the Mac, which answers at its next tick.
    const phone = await openIdb('anna', a.factory);
    const sent = (await phone.list('mealplan')).filter((r) => r.id.startsWith('chat-'));
    phone.close();
    expect(sent).toHaveLength(1);
    store.putMany('pb', sent, 'remote');
    await mac.tick();
    expect(mac.view('pb').chat[0]).toMatchObject({ text: 'Heute Abend lieber was mit Nudeln', reply: 'Heute Abend gibt es Nudeln.' });
    // And back to the phone with the plan: Lena sees the reply, Max's copy shows the change and who asked.
    cleanup();
    await boot({ account: 'anna', seed: store.all('pb') });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Änderung wünschen' }));
    expect(await screen.findByText('Heute Abend gibt es Nudeln.')).toBeTruthy();
    expect(screen.queryByText('Der Coach antwortet gleich. Ist der Mac aus, dauert es, bis er wieder an ist.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.click(screen.getByRole('button', { name: /Nudeln mit Tomatensoße und Linsen/ }));
    expect(screen.getByText('auf Wunsch von Lena')).toBeTruthy();
    expect(store.all('pa').some((r) => r.id.startsWith('chat-'))).toBe(false);
  });

  it('shows where a dish comes from: a recipe link for a real recipe, "vom Coach" for an invented dish, nothing for the list', async () => {
    const real = { ...dish('Linsen-Bolognese'), source: 'rezept', sourceUrl: 'https://rezepte.example/linsen' };
    const plan = { ...mealPlan, body: { ...(mealPlan.body as object), meals: [
      { day: today, slot: 'fruehstueck', dish: { ...dish('Skyr mit Beeren'), source: 'coach' }, reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: today, slot: 'mittag', dish: real, reuseOf: null, eaters: ['pa', 'pb'], takeAlong: true },
      { day: today, slot: 'abend', dish: { ...dish('Tomatensuppe'), source: 'rezept', sourceUrl: 'javascript:alert(1)' }, reuseOf: null, eaters: ['pa'], takeAlong: false },
    ] } };
    await boot({ account: 'anna', seed: [plan] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Skyr mit Beeren/ }));
    expect(screen.getByText('vom Coach')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Linsen-Bolognese/ }));
    const link = screen.getByRole('link', { name: 'Rezept ›' });
    expect(link.getAttribute('href')).toBe('https://rezepte.example/linsen');
    expect(link.getAttribute('rel')).toContain('noopener');
    // A link that is not https is never shown; the dish falls back to the list.
    fireEvent.click(screen.getByRole('button', { name: /Tomatensuppe/ }));
    expect(screen.queryAllByRole('link', { name: 'Rezept ›' })).toHaveLength(0);
  });

  it('adds a recipe by link as a record, shows the coach\'s answer, lists own recipes and deletes one', async () => {
    const own = (id: string, title: string): TrackedRecord => ({ kind: 'mealplan', id, updatedMs: NOW - 500, deleted: false, body: { title, sourceUrl: 'https://rezepte.example/x', minutes: 20 } });
    const a = await boot({ account: 'anna', seed: [mealPlan, own('recipe-l-aaaa1111', 'Erfundenes Curry')] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rezept hinzufügen' }));
    const field = await screen.findByLabelText('Link zum Rezept');
    // Only https links can be sent.
    fireEvent.change(field, { target: { value: 'http://rezepte.example/a' } });
    expect((screen.getByRole('button', { name: 'Hinzufügen' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'https://rezepte.example/a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByText('Der Coach schaut sich die Seite gleich an.')).toBeTruthy();
    const phone = await openIdb('anna', a.factory);
    const sent = (await phone.list('mealplan')).filter((r) => r.id.startsWith('link-'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ url: 'https://rezepte.example/a', result: null });
    // The coach answers by writing the record again; the phone shows it when the sheet is opened afterwards.
    const answered = { ...sent[0]!, updatedMs: sent[0]!.updatedMs + 5, body: { ...(sent[0]!.body as object), atMs: Date.now() - 1000, result: { state: 'veg' }, answeredMs: Date.now() } };
    phone.close();
    cleanup();
    const again = await boot({ account: 'anna', seed: [mealPlan, own('recipe-l-aaaa1111', 'Erfundenes Curry'), answered] });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rezept hinzufügen' }));
    expect(await screen.findByText('Nicht vegetarisch – nicht gespeichert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.click(screen.getByRole('button', { name: /^Eigene Rezepte/ }));
    expect(await screen.findByText('Erfundenes Curry')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ja' }));
    expect(await screen.findByText('Noch keine eigenen Rezepte.')).toBeTruthy();
    const store = await openIdb('anna', again.factory);
    expect((await store.list('mealplan')).find((r) => r.id === 'recipe-l-aaaa1111')?.deleted).toBe(true);
    store.close();
  });

  it('without a plan there is no Essen and so no chat: nothing is sent', async () => {
    const a = await boot({ account: 'anna', seed: [] });
    await screen.findByRole('navigation');
    expect(screen.queryByLabelText('Nachricht an den Coach')).toBeNull();
    const s = await openIdb('anna', a.factory);
    expect((await s.list('mealplan')).length).toBe(0);
    s.close();
  });
});

describe('Rezepte on the phone', () => {
  const week = weekOf(NOW);
  const today = dayIndex(NOW);
  const RID = (n: number) => `c-${String(n).padStart(14, '0')}`;
  const dish = (title: string, recipeId?: string) => ({ title, ingredients: [{ name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }], steps: ['Verrühren.'], minutes: 5, proteinG: 27, keepsDays: 2, source: recipeId ? 'rezept' : 'liste', ...(recipeId ? { recipeId, sourceUrl: 'https://rezepte.example/x' } : {}) });
  const mealPlan: TrackedRecord = { kind: 'mealplan', id: `week-${week}`, updatedMs: NOW - 1000, deleted: false, body: {
    week, createdMs: NOW - 1000, source: 'liste', trainingDays: [], you: 'pb', people: [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }],
    meals: [
      { day: today, slot: 'fruehstueck', dish: dish('Skyr mit Beeren'), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: today, slot: 'mittag', dish: dish('Erfundener Linsentopf', RID(1)), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false },
      { day: (today + 1) % 7, slot: 'abend', dish: dish('Tomatensuppe'), reuseOf: null, eaters: ['pa'], takeAlong: false },
    ] } };
  const item = (n: number, over: Record<string, unknown> = {}) => ({ id: RID(n), title: `Erfundener Topf ${n}`, minutes: 20 + n, proteinG: 25, keepsDays: 2, own: false, fav: false, image: n % 2 === 1, tags: ['Proteinreich', 'Pfannengericht'], ...over });
  const detail = (n: number) => ({ ...item(n), ingredients: [{ name: 'Linsen', amount: 100, unit: 'g', section: 'Vorrat' }, { name: 'Zwiebel', amount: 1, unit: 'Stk', section: 'Obst und Gemüse' }], steps: ['Linsen kochen.', 'Abschmecken.'], sourceUrl: 'https://rezepte.example/topf' });
  const route = (urls: string[], pages: Record<string, unknown> = {}) => (url: string): Response => {
    urls.push(url);
    if (url.includes('/search')) return json(200, pages[new URL(url, 'http://x').searchParams.get('offset') ?? '0'] ?? { items: [item(1), item(2)], more: false });
    const id = /\/coach\/recipes\/(c-\d+)$/.exec(url)?.[1];
    return id ? json(200, detail(Number(id.slice(2)))) : json(404, {});
  };
  const open = async (o: Parameters<typeof boot>[0] = {}) => {
    const a = await boot({ account: 'anna', seed: [mealPlan], ...o });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Rezepte/ }));
    return a;
  };
  const records = async (a: { factory: IDBFactory }, prefix: string) => { const s = await openIdb('anna', a.factory); const r = (await s.list('mealplan')).filter((x) => x.id.startsWith(prefix)); s.close(); return r; };

  it('lists recipes with a picture or a calm colour block, title and one muted line', async () => {
    const urls: string[] = [];
    await open({ recipes: route(urls) });
    expect(await screen.findByText('Erfundener Topf 1')).toBeTruthy();
    expect(screen.getByText('21 Min · proteinreich')).toBeTruthy();
    const imgs = [...document.querySelectorAll('.rc-open img')] as HTMLImageElement[];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([`/coach/recipes/${RID(1)}/image`]);
    // The recipe without a picture shows its first letter instead.
    expect(document.querySelectorAll('.rc-open .rc-blank')).toHaveLength(1);
    expect(urls[0]).toContain('/coach/recipes/search?limit=20');
  });

  it('works without any pictures, and when one cannot be loaded', async () => {
    await open({ recipes: (url) => (url.includes('/search') ? json(200, { items: [item(1, { image: false }), item(3, { image: true })], more: false }) : json(404, {})) });
    await screen.findByText('Erfundener Topf 3');
    const img = document.querySelector('.rc-open img') as HTMLImageElement;
    fireEvent.error(img);
    expect(document.querySelectorAll('.rc-open img')).toHaveLength(0);
    expect(document.querySelectorAll('.rc-open .rc-blank')).toHaveLength(2);
  });

  it('searches as you type and filters with chips, one row, each chip a parameter', async () => {
    const urls: string[] = [];
    await open({ recipes: route(urls) });
    await screen.findByText('Erfundener Topf 1');
    const chips = within(screen.getByRole('group', { name: 'Filter' }));
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['Favoriten', 'Eigene', 'Frühstück', 'Mittag', 'Abend', 'schnell', 'proteinreich', 'Saison']);
    fireEvent.click(chips.getByRole('button', { name: 'Favoriten' }));
    await waitFor(() => expect(urls.at(-1)).toContain('fav=1'));
    fireEvent.click(chips.getByRole('button', { name: 'Eigene' }));
    await waitFor(() => expect(urls.at(-1)).toContain('own=1'));
    fireEvent.click(chips.getByRole('button', { name: 'Frühstück' }));
    fireEvent.click(chips.getByRole('button', { name: 'Abend' }));
    fireEvent.click(chips.getByRole('button', { name: 'schnell' }));
    fireEvent.click(chips.getByRole('button', { name: 'Saison' }));
    // One meal chip at a time; the season is the current one (January: winter).
    await waitFor(() => expect(decodeURIComponent(urls.at(-1)!)).toContain('tags=mahlzeit:abend,schnell,saison:winter'));
    expect(chips.getByRole('button', { name: 'Frühstück' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(screen.getByLabelText('Rezept suchen'), { target: { value: 'linsen' } });
    await waitFor(() => expect(urls.at(-1)).toContain('q=linsen'));
  });

  it('pages 20 at a time with "Mehr anzeigen"', async () => {
    const urls: string[] = [];
    const first = Array.from({ length: 20 }, (_, i) => item(i + 1));
    await open({ recipes: route(urls, { '0': { items: first, more: true }, '20': { items: [item(21), item(1)], more: false } }) });
    await screen.findByText('Erfundener Topf 20');
    fireEvent.click(screen.getByRole('button', { name: 'Mehr anzeigen' }));
    expect(await screen.findByText('Erfundener Topf 21')).toBeTruthy();
    expect(urls.at(-1)).toContain('offset=20');
    // The repeated recipe is not listed twice, and there is no more button left.
    expect(screen.getAllByText('Erfundener Topf 1')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Mehr anzeigen' })).toBeNull();
  });

  it('says calmly when the recipes cannot be reached, and tries again', async () => {
    let up = false;
    await open({ recipes: (url) => (up ? route([])(url) : json(503, {})) });
    expect(await screen.findByText(/Die Rezepte sind gerade nicht erreichbar/)).toBeTruthy();
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Nochmal' }));
    expect(await screen.findByText('Erfundener Topf 1')).toBeTruthy();
  });

  it('hearts: one tap writes a record per recipe, another tap a tombstone; the label says what it does', async () => {
    const a = await open({ recipes: route([]) });
    const heart = await screen.findByRole('button', { name: 'Erfundener Topf 1 zu den Favoriten' });
    fireEvent.click(heart);
    await waitFor(async () => expect(await records(a, 'fav-')).toHaveLength(1));
    expect((await records(a, 'fav-'))[0]).toMatchObject({ id: `fav-${RID(1)}`, deleted: false });
    const on = await screen.findByRole('button', { name: 'Erfundener Topf 1 aus den Favoriten nehmen' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(on);
    await waitFor(async () => expect((await records(a, 'fav-'))[0]!.deleted).toBe(true));
    expect(await screen.findByRole('button', { name: 'Erfundener Topf 1 zu den Favoriten' })).toBeTruthy();
  });

  it('the Favoriten chip drops a recipe at once when its heart is taken back', async () => {
    const fav: TrackedRecord = { kind: 'mealplan', id: `fav-${RID(2)}`, updatedMs: NOW - 10, deleted: false, body: { atMs: NOW - 10 } };
    await open({ seed: [mealPlan, fav], recipes: (url) => (url.includes('fav=1') ? json(200, { items: [item(2, { fav: true })], more: false }) : route([])(url)) });
    fireEvent.click(await screen.findByRole('button', { name: 'Favoriten' }));
    const heart = await screen.findByRole('button', { name: 'Erfundener Topf 2 aus den Favoriten nehmen' });
    fireEvent.click(heart);
    expect(await screen.findByText('Noch keine Favoriten. Tippe bei einem Rezept auf das Herz.')).toBeTruthy();
  });

  it('opens the recipe: picture, facts, tags, portions that scale the ingredients, steps and the original', async () => {
    await open({ recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    expect(await screen.findByText('Linsen kochen.')).toBeTruthy();
    expect(screen.getByText('21 Min · 25 g Eiweiß · hält 2 Tage')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Schlagwörter' }).textContent).toContain('Proteinreich');
    expect(document.querySelector('img.rc-hero')?.getAttribute('src')).toBe(`/coach/recipes/${RID(1)}/image`);
    expect(screen.getByText('200 g')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eine Portion mehr' }));
    expect(screen.getByText('300 g')).toBeTruthy();
    expect(screen.getByText('3 Portionen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eine Portion weniger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eine Portion weniger' }));
    expect(screen.getByText('100 g')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Eine Portion weniger' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Zum Originalrezept ›' }).getAttribute('href')).toBe('https://rezepte.example/topf');
  });

  it('the heart in the recipe view toggles the favourite too', async () => {
    const a = await open({ recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    fireEvent.click(await screen.findByRole('button', { name: '♡ Zu Favoriten' }));
    await waitFor(async () => expect(await records(a, 'fav-')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: '♥ Favorit' })).toBeTruthy();
  });

  it('In den Plan: pick a day and a meal, it replaces that one and is sent as a request the coach answers', async () => {
    const a = await open({ recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'In den Plan ›' }));
    const day = within(await screen.findByRole('group', { name: 'Tag' }));
    // Days before today are not offered.
    const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    names.forEach((n, i) => expect((day.getByRole('button', { name: new RegExp(`^${n}`) }) as HTMLButtonElement).disabled).toBe(i < today));
    fireEvent.click(within(screen.getByRole('group', { name: 'Mahlzeit' })).getByRole('button', { name: 'Frühstück' }));
    expect(screen.getByText(/Ersetzt: Skyr mit Beeren/)).toBeTruthy();
    expect(screen.getByText(/isst mit: Max, Lena/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Eintragen' }));
    expect(await screen.findByText('Der Coach trägt es gleich ein.')).toBeTruthy();
    const sent = await records(a, 'place-');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ week, meal: `${today}-fruehstueck`, recipeId: RID(1), result: null });
  });

  it('shows the coach\'s answer to a placement that does not fit', async () => {
    const answered: TrackedRecord = { kind: 'mealplan', id: 'place-answered1', updatedMs: NOW + 5, deleted: false, body: { week, meal: `${today}-abend`, recipeId: RID(1), atMs: NOW + 10, result: 'nofit', answeredMs: NOW + 20 } };
    await open({ seed: [mealPlan, answered], recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: /^Erfundener Topf 1\s?21 Min/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'In den Plan ›' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eintragen' }));
    expect(await screen.findByText('Das passt nicht zu den Angaben der Esser dieser Mahlzeit.')).toBeTruthy();
  });

  it('a meal of a real recipe has a small picture and opens the recipe from its row', async () => {
    await boot({ account: 'anna', seed: [mealPlan], recipes: route([]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    await screen.findByRole('heading', { name: 'Heute' });
    const thumbs = [...document.querySelectorAll('img.pm-thumb')] as HTMLImageElement[];
    expect(thumbs.map((t) => t.getAttribute('src'))).toEqual([`/coach/recipes/${RID(1)}/image`]);
    fireEvent.error(thumbs[0]!);
    expect(document.querySelectorAll('img.pm-thumb')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Erfundener Linsentopf/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Erfundener Linsentopf ansehen ›' }));
    expect(await screen.findByText('Linsen kochen.')).toBeTruthy();
    // A dish without a recipe has neither picture nor link.
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    fireEvent.click(screen.getByRole('button', { name: /Skyr mit Beeren/ }));
    expect(screen.queryByRole('button', { name: /Skyr mit Beeren ansehen/ })).toBeNull();
  });

  it('a recipe that cannot be opened says so calmly', async () => {
    await boot({ account: 'anna', seed: [mealPlan], recipes: () => json(404, {}) });
    fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
    fireEvent.click(await screen.findByRole('button', { name: /Erfundener Linsentopf/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Erfundener Linsentopf ansehen ›' }));
    expect(await screen.findByText('Dieses Rezept ist gerade nicht zu öffnen.')).toBeTruthy();
  });
});

describe('Laufen on the phone', () => {
  const week = weekOf(NOW);
  const planned = { date: week, kind: 'easy' as const, minutes: 30, hrCap: 150, counts: 'Heute zählt die Zeit.', note: null };
  const run = (id: string, body: object): TrackedRecord => ({ kind: 'run', id, updatedMs: NOW - 1000, deleted: false, body });
  const status = (over: object = {}) => run('status', {
    type: 'status', atMs: NOW - 1000, on: true, suggest: false, needsAnswers: false, garmin: false, suggestedDays: [1, 3, 5], hrCap: 150, complaint: null,
    numbers: { easyPace: { now: null, weeks4: null, weeks12: null, trend: [] }, weeks: [], longest: { blockKm: null, lastBlockKm: null }, tests: [] }, card: null, ...over,
  });
  const review = run(`review-${week}`, { type: 'review', week, atMs: NOW - 500, km: 12.5, minutes: 90, plannedMinutes: 90, runs: 3, longestKm: 6, easyPace: null, testM: null, focus: 'Ruhig weiter.' });
  const planWeek = run(`week-${week}`, { type: 'week', week, announce: true, atMs: NOW - 900, phase: 1, source: 'rules', reason: 'r', note: null, runs: [{ ...planned, fp: runFp(planned), done: null }], garmin: null });

  it('the Laufen tab appears only with a run status that is on or suggest', async () => {
    await boot({ account: 'anna', seed: [] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [status({ on: false, suggest: false })] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [status()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    expect(await screen.findByRole('heading', { name: 'Laufen' })).toBeTruthy();
    cleanup();
    await boot({ account: 'anna', seed: [status({ on: false, suggest: true })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    expect(await screen.findByRole('button', { name: 'Laufen einschalten' })).toBeTruthy();
  });

  it('a record whose body type does not match its id is ignored', async () => {
    await boot({ account: 'anna', seed: [run('status', { ...(status().body as object), type: 'review' })] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
  });

  it('a notification with tab laufen opens it, at start and while open', async () => {
    await boot({ account: 'anna', seed: [status(), planWeek], startTab: 'laufen' });
    expect(await screen.findByRole('region', { name: 'Läufe dieser Woche' })).toBeTruthy();
    cleanup();
    let open!: (t: string) => void;
    await boot({ account: 'anna', seed: [status(), planWeek], onOpenTab: (f) => { open = f; return () => {}; } });
    await screen.findByRole('navigation');
    await waitFor(() => expect(open).toBeTypeOf('function'));
    act(() => open('laufen'));
    expect(await screen.findByRole('region', { name: 'Läufe dieser Woche' })).toBeTruthy();
  });

  it('a notification for Laufen without a run status stays on Heute', async () => {
    await boot({ account: 'anna', seed: [], startTab: 'laufen' });
    await screen.findByRole('navigation');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Laufen' })).toBeNull());
  });

  it('Verlauf is part of Kraft', async () => {
    await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Verlauf' }));
    expect(await screen.findByRole('heading', { name: 'Verlauf' })).toBeTruthy();
  });

  it('Laufen shows the run look back only when a review exists', async () => {
    await boot({ account: 'anna', seed: [status()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    await screen.findByRole('button', { name: 'Lauf eintragen' });
    expect(screen.queryByRole('button', { name: /^Entwicklung/ })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [status(), review] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    expect(screen.queryByRole('heading', { name: 'Wochenrückblick' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /^Entwicklung/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Mehr/ }));
    expect(await screen.findByRole('heading', { name: 'Wochenrückblick' })).toBeTruthy();
    expect(screen.getByText(/12,5 km/)).toBeTruthy();
  });

  it('Profil shows the Laufen switch, even with no run records', async () => {
    const a = await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    const sw = await screen.findByRole('switch', { name: 'Laufen planen' });
    await waitFor(() => expect((sw as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(sw);
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const rec = (await s.list('run')).find((r) => r.id === 'settings');
      s.close();
      expect(rec?.body).toMatchObject({ type: 'settings', on: true });
    });
  });

});

describe('Statistik on the phone', () => {
  const statsRec: TrackedRecord = { kind: 'stats', id: 'stats', updatedMs: NOW - 1000, deleted: false, body: { type: 'stats', atMs: NOW - 1000, goal: null, days: [], muscles: {} } };
  const done: TrackedRecord = { kind: 'workout', id: 'w1', updatedMs: NOW - 1000, deleted: false, body: { id: 'w1', title: 'Training', startMs: NOW - 2 * DAY, endMs: NOW - 2 * DAY + 3_600_000, source: 'pandafit', exercises: [] } };

  it('the Statistik tab appears with a stats record or a finished workout, and not without', async () => {
    await boot({ account: 'anna', seed: [] });
    await screen.findByRole('navigation');
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Statistik' })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [statsRec] });
    fireEvent.click(await screen.findByRole('button', { name: 'Statistik' }));
    expect(await screen.findByRole('heading', { name: 'Statistik' })).toBeTruthy();
    cleanup();
    await boot({ account: 'anna', seed: [done] });
    expect(await screen.findByRole('button', { name: 'Statistik' })).toBeTruthy();
  });
});

describe('Rad on the phone', () => {
  const bikeRec = (over: object = {}): TrackedRecord => ({ kind: 'bike', id: 'bike', updatedMs: NOW - 1000, deleted: false, body: {
    type: 'bike', atMs: NOW - 1000, ftpW: 210, ftpHistory: [{ atMs: NOW - 120 * DAY, ftpW: 200, source: 'manual' }, { atMs: NOW - DAY, ftpW: 210, source: 'coach' }],
    phase: { name: 'Aufbau', weeksLeft: 3, goal: 'Ausdauer aufbauen' },
    next: { name: 'Schwellen-Intervalle', reason: 'Die letzten Tage waren locker.', minutes: 60, hardness: 'hard', blocks: [{ label: '10 Min locker', minutes: 10, pct: 50 }, { label: '3 × 8 Min bei 95 %, dazwischen 4 Min locker', minutes: 32, pct: 95 }] },
    alternatives: [], weekHours: [{ week: '2027-01-04', hours: 2 }, { week: '2027-01-11', hours: 3.5 }], ...over,
  } });
  const rideRec = (id: string, ago: number, name = 'Grundlage'): TrackedRecord => ({ kind: 'ride', id, updatedMs: NOW - ago, deleted: false, body: {
    type: 'ride', startedAtMs: NOW - ago, sessionName: name, durationS: 3120, hardness: 'easy', avgPowerW: 150, normalizedPowerW: 160, avgHrBpm: 130, maxHrBpm: 150, tss: 40, completedFraction: 1,
    debrief: 'Ruhig und gleichmäßig gefahren.', curve: Array.from({ length: 20 }, (_, i) => ({ t: i * 150, powerW: 140 + (i % 5) * 5, hrBpm: 120 + i })),
  } });
  const runStatus = (): TrackedRecord => ({ kind: 'run', id: 'status', updatedMs: NOW - 1000, deleted: false, body: {
    type: 'status', atMs: NOW - 1000, on: true, suggest: false, needsAnswers: false, garmin: false, suggestedDays: [1, 3, 5], hrCap: 150, complaint: null,
    numbers: { easyPace: { now: null, weeks4: null, weeks12: null, trend: [] }, weeks: [], longest: { blockKm: null, lastBlockKm: null }, tests: [] }, card: null } });

  it('Ausdauer appears with a plan to ride or a ride, and not without either', async () => {
    await boot({ account: 'anna', seed: [bikeRec({ next: null })] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [bikeRec({ next: null }), rideRec('r1', 3 * DAY)] });
    expect(await screen.findByRole('button', { name: 'Ausdauer' })).toBeTruthy();
    cleanup();
    await boot({ account: 'anna', seed: [bikeRec()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    expect(await screen.findByRole('heading', { name: 'Rad' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Ausdauer' })).toBeNull(); // no switch with Rad alone
  });

  it('a removed ride is not shown', async () => {
    await boot({ account: 'anna', seed: [bikeRec({ next: null }), { ...rideRec('r1', 3 * DAY), deleted: true }] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
  });

  it('the next card names the session and Aufbau opens one row per block', async () => {
    await boot({ account: 'anna', seed: [bikeRec()], startTab: 'rad' });
    const card = await screen.findByRole('region', { name: 'Nächste Fahrt' });
    expect(card.textContent).toContain('Schwellen-Intervalle · 60 Min · hart');
    expect(card.textContent).toContain('Die letzten Tage waren locker.');
    fireEvent.click(screen.getByRole('button', { name: /^Aufbau/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('10 Min locker')).toBeTruthy();
    expect(within(sheet).getByText('3 × 8 Min bei 95 %, dazwischen 4 Min locker')).toBeTruthy();
  });

  it('the last ride opens the ride sheet with the facts, the sentence and the chart', async () => {
    await boot({ account: 'anna', seed: [bikeRec(), rideRec('r1', 3 * DAY), rideRec('r0', 60 * DAY, 'Locker')], startTab: 'rad' });
    fireEvent.click(await screen.findByRole('button', { name: /Grundlage/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Ø 150 W · Ø Puls 130 · Belastung 40 · geschafft 100 %/)).toBeTruthy();
    expect(within(sheet).getByText('Ruhig und gleichmäßig gefahren.')).toBeTruthy();
    expect(within(sheet).getByRole('img', { name: /Leistung und Puls/ }).querySelectorAll('polyline').length).toBe(2);
  });

  it('Fahrten groups the rides by month and a tap opens the ride', async () => {
    await boot({ account: 'anna', seed: [bikeRec(), rideRec('r1', 3 * DAY), rideRec('r0', 60 * DAY, 'Locker')], startTab: 'rad' });
    fireEvent.click(await screen.findByRole('button', { name: /^Fahrten/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getAllByRole('region').length).toBe(2); // two months
    fireEvent.click(within(sheet).getByRole('button', { name: /Locker/ }));
    expect(await screen.findByText('Ruhig und gleichmäßig gefahren.')).toBeTruthy();
  });

  it('Entwicklung tells the FTP, the phase and the hours per week', async () => {
    await boot({ account: 'anna', seed: [bikeRec()], startTab: 'rad' });
    fireEvent.click(await screen.findByRole('button', { name: /^Entwicklung/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/^FTP 210 W – seit .* 10 W mehr$/)).toBeTruthy();
    expect(within(sheet).getByText('Aufbau – noch 3 Wochen')).toBeTruthy();
    expect(within(sheet).getAllByRole('img').length).toBe(2);
  });

  it('with Rad and Laufen a switch shows, remembers the choice and the old tab name still works', async () => {
    const a = await boot({ account: 'anna', seed: [bikeRec(), runStatus()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    await screen.findByRole('heading', { name: 'Rad' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Ausdauer' })).getByRole('button', { name: 'Laufen' }));
    expect(await screen.findByRole('heading', { name: 'Laufen' })).toBeTruthy();
    expect(a.storage.get('pandafit.ausdauer.anna')).toBe('laufen');
    cleanup();
    await boot({ account: 'anna', seed: [bikeRec(), runStatus()], startTab: 'laufen' });
    expect(await screen.findByRole('heading', { name: 'Laufen' })).toBeTruthy();
    cleanup();
    await boot({ account: 'anna', seed: [bikeRec(), runStatus()], flags: { 'pandafit.ausdauer.anna': 'laufen' }, startTab: 'ausdauer' });
    expect(await screen.findByRole('heading', { name: 'Laufen' })).toBeTruthy();
  });

  const bikeWeek = async (): Promise<TrackedRecord> => {
    const { mondayOf, weekDates } = await import('../../src/shared/week-plan');
    const { dateKey } = await import('../../src/shared/day-rating');
    const monday = mondayOf(dateKey(NOW));
    return { kind: 'weekplan', id: monday, updatedMs: 1, deleted: false, body: { weekStart: monday, fromMessage: 'm', acceptedMs: 1, days: weekDates(monday).map((date) => ({ date, sport: 'bike', hardness: 'moderate', fixed: false })) } };
  };

  it('Heute on a bike day names the session, says it starts on the Mac, and Ansehen opens Rad', async () => {
    await boot({ account: 'anna', seed: [bikeRec(), await bikeWeek()] });
    await waitFor(() => expect(screen.getByRole('region', { name: /^Heute/ }).textContent).toContain('Schwellen-Intervalle · 60 Min'));
    const card = screen.getByRole('region', { name: /^Heute/ });
    expect(card.textContent).toContain('am Mac');
    fireEvent.click(within(card).getByRole('button', { name: 'Ansehen' }));
    expect(await screen.findByRole('heading', { name: 'Rad' })).toBeTruthy();
  });

  it('Heute on a bike day without a published plan keeps the note about the Mac', async () => {
    await boot({ account: 'anna', seed: [await bikeWeek()] });
    await waitFor(() => expect(screen.getByRole('region', { name: /^Heute/ }).textContent).toContain('am Mac'));
    const card = screen.getByRole('region', { name: /^Heute/ });
    expect(within(card).queryByRole('button', { name: 'Ansehen' })).toBeNull();
  });

  it('Woche marks the days with a ride as gefahren', async () => {
    const rode = rideRec('r1', 0);
    await boot({ account: 'anna', seed: [bikeRec(), await bikeWeek(), rode] });
    fireEvent.click(await screen.findByRole('button', { name: 'Woche' }));
    const week = await screen.findByRole('list', { name: 'Wochenplan diese Woche' });
    const rows = within(week).getAllByRole('listitem').filter((li) => li.textContent?.includes('gefahren'));
    expect(rows.length).toBe(1);
  });
});
