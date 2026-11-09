// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { openIdb } from '../../../src/web/idbStore';
import { weekOf } from '../../../src/shared/meals';
import { runFp } from '../../../src/shared/run';
import { NOW, boot } from './helpers';

afterEach(cleanup);

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

  it('Ausdauer for running appears once "Laufen planen" is on or the run coach says on or suggest', async () => {
    const settings = (on: boolean) => run('settings', { type: 'settings', on, weekdays: null, answers: null });
    await boot({ account: 'anna', seed: [] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [status({ on: false, suggest: false }), settings(false)] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [status()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    expect(await screen.findByRole('button', { name: 'Lauf eintragen' })).toBeTruthy();
    cleanup();
    await boot({ account: 'anna', seed: [status({ on: false, suggest: true })] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    expect(await screen.findByRole('button', { name: 'Laufen einschalten' })).toBeTruthy();
    cleanup();
    // The switch is on, the coach has not answered yet: the tab is there and says what comes.
    await boot({ account: 'anna', seed: [settings(true)] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    expect(await screen.findByText('Laufen ist an. Dein Laufplan erscheint hier, sobald Bo ihn angelegt hat.')).toBeTruthy();
  });

  it('switching "Laufen planen" on in Profil shows Ausdauer at once', async () => {
    await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
    const sw = await screen.findByRole('switch', { name: 'Laufen planen' });
    await waitFor(() => expect((sw as HTMLInputElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
    fireEvent.click(sw);
    expect(await screen.findByRole('button', { name: 'Ausdauer' })).toBeTruthy();
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Ausdauer' })).toBeNull();
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
    fireEvent.click(await screen.findByRole('button', { name: /^Ältere Wochen/ }));
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
