// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { openIdb } from '../../../src/web/idbStore';
import type { LiveSocket } from '../../../src/web/live';
import type { TrackedRecord } from '../../../src/shared/records';
import { boot, NOW } from './helpers';

afterEach(cleanup);

type FakeSocket = { s: LiveSocket; sent: string[]; closed: boolean };
const fakeSockets = () => {
  const sockets: FakeSocket[] = [];
  const openLive = (): LiveSocket => {
    const entry: FakeSocket = { sent: [], closed: false, s: null as unknown as LiveSocket };
    entry.s = { send: (d: string) => { entry.sent.push(d); }, close: () => { entry.closed = true; }, onopen: null, onmessage: null, onclose: null, onerror: null };
    sockets.push(entry);
    return entry.s;
  };
  return { sockets, openLive };
};
const coachState = () => JSON.stringify({ type: 'coach-state', state: {}, hevy: { state: 'idle' }, garmin: { state: 'idle' }, gym: null,
  meals: { settings: { on: false, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'zuhause', abend: 'zuhause' } } } });
/** Answers the coach state on the newest open socket, once it has subscribed. */
const answer = async (sockets: FakeSocket[]) => {
  await waitFor(() => { act(() => { for (const x of sockets) if (!x.closed && !x.sent.length) x.s.onopen?.(); }); expect(sockets.some((x) => !x.closed && x.sent.some((d) => d.includes('subscribe')))).toBe(true); });
  act(() => { for (const x of sockets) if (!x.closed) x.s.onmessage?.({ data: coachState() }); });
};
const openProfil = async () => fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));

describe('Profil', () => {
  it('head card with the name and the save sentence, then four cards with h2 names, no Gesundheit, Abmelden at the bottom', async () => {
    const { sockets, openLive } = fakeSockets();
    await boot({ account: 'anna', seed: [], openLive });
    await openProfil();
    expect((await screen.findByRole('heading', { level: 1, name: 'Profil' })).className).toBe('tk-sr');
    const head = await screen.findByRole('region', { name: 'anna' });
    expect(head.textContent).toMatch(/Alles ist gesichert\.|Der erste Abgleich folgt gleich\./);
    await answer(sockets);
    for (const g of ['Was Pandafit für dich plant', 'Verbindungen', 'Nachrichten', 'Darstellung']) {
      expect(within(await screen.findByRole('region', { name: g })).getByRole('heading', { level: 2, name: g })).toBeTruthy();
    }
    expect(document.body.textContent).not.toContain('Gesundheit');
    expect(screen.getByRole('button', { name: 'Abmelden' }).className).toContain('secondary');
    // The Hell/Dunkel/System buttons (.tk-seg) are kit buttons styled by their group, so they carry no class of their own.
    expect([...document.querySelectorAll('.tk-screen button:not([class])')].filter((b) => !b.closest('.tk-seg')).map((b) => b.textContent)).toEqual([]);
  });

  it('without a coach on the server there is no Verbindungen card; Laufen and Darstellung still work', async () => {
    const a = await boot({ account: 'anna', seed: [] });
    await openProfil();
    await screen.findByRole('region', { name: 'Was Pandafit für dich plant' });
    expect(screen.queryByRole('region', { name: 'Verbindungen' })).toBeNull();
    expect(screen.getByText('Rad geht mit der ersten Fahrt am Mac los.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('switch', { name: 'Laufen planen' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const run = (await s.list('run')).find((r) => r.id === 'settings');
      s.close();
      expect((run?.body as { on?: boolean } | undefined)?.on).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hell' }));
    expect(screen.getByRole('button', { name: 'Hell' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('with a ride the bike sentence says Rad fährst du am Mac.', async () => {
    const ride = { kind: 'ride', id: 'r1', updatedMs: NOW - 1000, deleted: false, body: { type: 'ride', startedAtMs: NOW - 1000, sessionName: 'Grundlage', durationS: 3000, hardness: 'easy', avgPowerW: 150, normalizedPowerW: 160, avgHrBpm: 130, maxHrBpm: 150, tss: 40, completedFraction: 1, debrief: 'Ruhig gefahren.', curve: [] } } as TrackedRecord;
    await boot({ account: 'anna', seed: [ride] });
    await openProfil();
    expect(await screen.findByText('Rad fährst du am Mac.')).toBeTruthy();
    expect(screen.queryByText('Rad geht mit der ersten Fahrt am Mac los.')).toBeNull();
  });

  it('Wann sich der Sensai meldet is a row that opens the timing in a sheet', async () => {
    const a = await boot({ account: 'anna', seed: [] });
    await openProfil();
    fireEvent.click(await screen.findByRole('button', { name: /Wann sich der Sensai meldet/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Wann sich der Sensai meldet' });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Wochengespräch' }));
    await waitFor(async () => {
      const s = await openIdb('anna', a.factory);
      const prefs = (await s.list('coachprefs'))[0];
      s.close();
      expect((prefs?.body as { week: { on: boolean } } | undefined)?.week.on).toBe(true);
    });
  });

  it('the e-mail row says noch keine, and the weekly switch waits for an address', async () => {
    await boot({ account: 'anna', seed: [] });
    await openProfil();
    expect((await screen.findByRole('button', { name: /E-Mail/ })).textContent).toContain('noch keine');
    expect((screen.getByRole('switch', { name: 'Wochenübersicht per E-Mail' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Trag zuerst deine E-Mail ein.')).toBeTruthy();
  });
});
