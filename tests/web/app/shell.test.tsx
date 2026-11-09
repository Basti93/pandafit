// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { App, ErrorBoundary, visibleTabs } from '../../../src/web/App';
import { openIdb } from '../../../src/web/idbStore';
import { mobilityToShow, shouldShowInstallHint } from '../../../src/web/logic';
import { NOW, DAY, json, plan, session, boot } from './helpers';

afterEach(cleanup);

describe('web app', () => {
  it('tabs: fixed order; a new account has Heute, Woche, Kraft; Essen and Ausdauer follow their switches', () => {
    expect(visibleTabs({ meals: false, endurance: false })).toEqual(['heute', 'coach', 'training']);
    expect(visibleTabs({ meals: true, endurance: false })).toEqual(['heute', 'coach', 'training', 'essen']);
    expect(visibleTabs({ meals: false, endurance: true })).toEqual(['heute', 'coach', 'training', 'ausdauer']);
    expect(visibleTabs({ meals: true, endurance: true })).toEqual(['heute', 'coach', 'training', 'essen', 'ausdauer']);
  });

  it('a new account shows Heute, Woche and Kraft in the tab bar', async () => {
    await boot({ account: 'anna', seed: [] });
    const nav = await screen.findByRole('navigation');
    await new Promise((r) => setTimeout(r, 30));
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Heute', 'Woche', 'Kraft']);
  });

  it('shows every tab with its icon and the profile as a panda button', async () => {
    const status = { kind: 'run', id: 'status', updatedMs: NOW - 1000, deleted: false, body: {
      type: 'status', atMs: NOW - 1000, on: true, suggest: false, needsAnswers: false, garmin: false, suggestedDays: [1, 3, 5], hrCap: 150, complaint: null,
      numbers: { easyPace: { now: null, weeks4: null, weeks12: null, trend: [] }, weeks: [], longest: { blockKm: null, lastBlockKm: null }, tests: [] }, card: null } } as TrackedRecord;
    await boot({ account: 'anna', flags: { 'pandafit.essensplan.anna': 'on' }, seed: [status] });
    const nav = await screen.findByRole('navigation', { name: 'Seiten' });
    await waitFor(() => expect(within(nav).getAllByRole('button').length).toBe(5));
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Heute', 'Woche', 'Kraft', 'Essen', 'Ausdauer']);
    expect(buttons.map((b) => b.querySelector('svg')?.getAttribute('data-icon'))).toEqual(['heute', 'woche', 'kraft', 'essen', 'ausdauer']);
    expect(screen.getByRole('button', { name: 'Profil' }).querySelector('svg[data-icon="profil"]')).not.toBeNull();
  });

  it('the login says where an account comes from', async () => {
    await boot({ me: 401 });
    expect(await screen.findByText('Ein Konto bekommst du von der Person, die Pandafit eingerichtet hat.')).toBeTruthy();
  });

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
    expect(await screen.findByText('Bitte gib deinen Namen und dein Passwort ein.')).toBeTruthy();
    expect(a.calls.some((c) => c.includes('/login'))).toBe(false);
  });

  it('Profil has the coach timing switches; the tab bar is the way out, no second back link', async () => {
    await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    fireEvent.click(await screen.findByRole('button', { name: /Wann sich der Sensai meldet/ }));
    expect(await screen.findByRole('switch', { name: /Wochengespräch/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Schließen|Zurück|×/ }));
    expect(screen.queryByRole('button', { name: /Zurück/ })).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Heute' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
  });

  it('Profil: Darstellung starts on System and switches to Hell and Dunkel on this device', async () => {
    await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    const group = await screen.findByRole('group', { name: 'Darstellung' });
    expect(within(group).getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Dunkel' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(within(group).getByRole('button', { name: 'Dunkel' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Hell' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(within(group).getByRole('button', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('Profil: the e-mail address saves and removes, the weekly switch needs an address', async () => {
    const a = await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    const sw = await screen.findByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /E-Mail\s*noch keine/ }));
    const input = await screen.findByLabelText('E-Mail-Adresse');
    expect(input.getAttribute('type')).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('email');
    fireEvent.change(input, { target: { value: 'kein-mail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Bitte gib eine gültige Adresse ein.')).toBeTruthy();
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
    expect(await screen.findByRole('button', { name: /E-Mail\s*noch keine/ })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement).disabled).toBe(true));
    expect((screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement).checked).toBe(false);
  });

  it('storage persistence is requested at login, and a refusal says nothing on Profil', async () => {
    const a = await boot({ me: 401, persist: false });
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'anna' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(a.persist).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    await screen.findByRole('region', { name: 'anna' });
    expect(screen.queryByText(/Browser kann Daten löschen/)).toBeNull();
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

  it('an open workout from an earlier day says so in its heading', async () => {
    const open: TrackedRecord = { kind: 'workout', id: 'w-old', updatedMs: NOW - 500, deleted: false, body: { id: 'w-old', title: 'Pull', startMs: NOW - 26 * 3_600_000, endMs: null, source: 'pandafit', exercises: [] } };
    await boot({ seed: [plan(NOW - 1000), open] });
    expect(await screen.findByText(/^Seit gestern \d\d:\d\d$/)).toBeTruthy();
  });

  it('an open workout shows on Heute with "Weitermachen", which leads to the workout', async () => {
    const open: TrackedRecord = { kind: 'workout', id: 'w-open', updatedMs: NOW - 500, deleted: false, body: { id: 'w-open', title: 'Pull', startMs: NOW - 600_000, endMs: null, source: 'pandafit', exercises: [] } };
    await boot({ seed: [plan(NOW - 1000), open] });
    expect(await screen.findByText(/^Seit \d\d:\d\d$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Etwas anderes heute?' })).toBeNull(); // no day card beside the open workout
    fireEvent.click(screen.getByRole('button', { name: 'Weitermachen' }));
    // one tap: the workout itself opens, not the start screen with its card
    expect(await screen.findByRole('button', { name: 'Training beenden' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Weitermachen' })).toBeNull();
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Kraft' })).toBeNull()); // the Kraft sub-navigation is gone while a workout runs
  });

  it('the tab bar and the profile button step aside while the workout is shown and come back after Verkleinern', async () => {
    await boot({ account: 'anna', seed: [plan(NOW - 1000)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Kraft' }));
    fireEvent.click(within(await screen.findByRole('region', { name: 'Nächstes Training' })).getByRole('button', { name: 'Training starten' }));
    await screen.findByRole('button', { name: 'Satz geschafft' });
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Seiten' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Profil' })).toBeNull();
    expect(screen.queryByText('Pandafit')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Verkleinern, Training läuft weiter' }));
    expect(await screen.findByRole('navigation', { name: 'Seiten' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Profil' })).toBeTruthy();
    expect(within(await screen.findByRole('region', { name: 'Läuft noch' })).getByRole('button', { name: 'Weitermachen' })).toBeTruthy();
  });

  it('an expired login keeps unsent data and asks to log in again', async () => {
    const a = await boot({ syncStatus: 401, seed: [plan(NOW - 1000)] });
    expect(await screen.findByText(/Bitte melde dich neu an/)).toBeTruthy();
    expect(screen.getByText('Beine A')).toBeTruthy();
    expect(a.storage.get('pandafit.account')).toBe('anna');
  });

  it('the plan shows its date and says calmly when it is older than a week', async () => {
    await boot({ seed: [plan(NOW - 2 * DAY)] });
    // The date, the reason and the note are in the sheet "Nächstes Training" that Heute opens in Kraft.
    fireEvent.click(await screen.findByRole('button', { name: 'Ansehen und anpassen' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nächstes Training' });
    expect(within(sheet).getByText(/^Plan vom /)).toBeTruthy();
    expect(within(sheet).getByText('Beine sind dran')).toBeTruthy();
    expect(within(sheet).getByText('Gut gemacht diese Woche')).toBeTruthy();
    expect(screen.queryByText(/Bo macht einen neuen/)).toBeNull();
    cleanup();
    await boot({ seed: [plan(NOW - 9 * DAY)] });
    expect(await screen.findByText(/Bo macht einen neuen/)).toBeTruthy();
  });

  it('Heute offers no Ansehen when every exercise of the plan is ruled out', async () => {
    const rule: TrackedRecord = { kind: 'rule', id: 'rule-x', updatedMs: 1, deleted: false, body: { kind: 'exclude', text: 'ohne', sport: 'gym', state: 'active', source: 'chat', atMs: 1, exerciseIds: ['x'] } };
    await boot({ seed: [plan(NOW - 1000), rule] });
    await screen.findByText('Beine A');
    expect(screen.queryByRole('button', { name: 'Ansehen und anpassen' })).toBeNull();
    cleanup();
    await boot({ seed: [plan(NOW - 1000)] });
    expect(await screen.findByRole('button', { name: 'Ansehen und anpassen' })).toBeTruthy();
  });

  it('the plan sheet from Heute opens once; an adjusted plan says "Angepasst" on Heute', async () => {
    await boot({ seed: [plan(NOW - 2 * DAY)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ansehen und anpassen' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nächstes Training' });
    const reps = within(sheet).getByLabelText('Wiederholungen Satz 1');
    fireEvent.focus(reps); fireEvent.change(reps, { target: { value: '6' } }); fireEvent.blur(reps);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nächstes Training' })).toBeNull());
    // Away to another Kraft page and back: the sheet does not open again by itself.
    fireEvent.click(screen.getByRole('button', { name: /Deine Routinen/ }));
    await screen.findByRole('heading', { name: 'Deine Routinen' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Kraft' }).find((b) => b.className.includes('tk-pill'))!);
    await screen.findByRole('button', { name: 'Training starten' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: 'Nächstes Training' })).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Heute' }));
    expect(await screen.findByText('Angepasst')).toBeTruthy();
  });

  it('without a plan there is a calm note and a workout can still be started', async () => {
    await boot({ seed: [] });
    expect(await screen.findByRole('button', { name: 'Woche planen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kraft' }));
    expect(await screen.findByRole('button', { name: 'Leeres Training starten' })).toBeTruthy();
    expect(screen.getByText(/Bo hat gerade kein Training für dich geplant/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Studio/ }).textContent).toContain('Studio wählen');
  });

  it('a new account sees what Pandafit can plan, with the way to Profil; it goes once something is on', async () => {
    await boot({ seed: [] });
    expect(await screen.findByRole('heading', { name: 'Dein Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Woche planen' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Im Profil auswählen' }));
    expect(await screen.findByRole('heading', { name: 'Profil' })).toBeTruthy();
    expect(screen.getByText('Rad geht mit der ersten Fahrt am Mac los.')).toBeTruthy();
    // Profil is ordered: the plan card first (with the run switch), then Nachrichten; the e-mail waits under its switch.
    const heads = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(heads.indexOf('Was Pandafit für dich plant')).toBeGreaterThanOrEqual(0);
    expect(heads.indexOf('Was Pandafit für dich plant')).toBeLessThan(heads.indexOf('Nachrichten'));
    expect(screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }).getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Trag zuerst deine E-Mail ein.')).toBeTruthy();
    cleanup();
    await boot({ seed: [plan(NOW - 1000)] });
    await screen.findByRole('button', { name: 'Training starten' });
    expect(screen.queryByRole('heading', { name: 'Dein Plan' })).toBeNull();
  });

  it('the mobility card comes from the plan and Gemacht writes the done record', async () => {
    const s = session(NOW - 3600_000);
    const a = await boot({ seed: [plan(NOW - 1000, s)] });
    expect(await screen.findByText('Beweglichkeit · 8 Min')).toBeTruthy();
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
    expect(await screen.findByRole('region', { name: 'anna' })).toBeTruthy();
    expect(screen.getByText(/gesichert|Abgleich|Senden|Verbindung/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeTruthy();
  });

  it('the tab bar steps aside while a field has focus, so the keyboard never pushes it over an input', async () => {
    await boot({ seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Woche' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Woche planen' }));
    const field = await screen.findByLabelText('Nachricht an Bo');
    const nav = screen.getByRole('navigation', { name: 'Seiten' });
    fireEvent.focusIn(field);
    expect(nav.className).toContain('web-nav-away');
    fireEvent.focusOut(field);
    expect(nav.className).not.toContain('web-nav-away');
  });

  it('Heute has no complaints box any more: complaints go through the coach chat', async () => {
    await boot({ seed: [{ kind: 'complaint', id: 'c1', updatedMs: 5, deleted: false, body: { text: 'Knie links', status: 'active', atMs: 5 } }] });
    await screen.findByRole('heading', { level: 1, name: 'Heute' });
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
    await waitFor(() => { fireEvent.click(screen.getByRole('button', { name: 'Woche' })); fireEvent.click(screen.getByRole('button', { name: /^Frag Bo/ })); expect(screen.getByText('Nur Ben')).toBeTruthy(); });
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

  it('a refused storage persistence shows no notice, on no tab', async () => {
    const again = await boot({ persist: false, seed: [] });
    await screen.findByRole('navigation');
    await waitFor(() => expect(again.persist).toHaveBeenCalled());
    expect(screen.queryByText(/Browser kann Daten löschen/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Profil' }));
    await screen.findByRole('region', { name: 'anna' });
    expect(screen.queryByText(/Browser kann Daten löschen/)).toBeNull();
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
    expect(await screen.findByRole('button', { name: 'Training starten' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Verkleinern, Training läuft weiter' })); // the profile button is back once the workout is minimized
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
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
