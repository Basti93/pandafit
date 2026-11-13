// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { SAYINGS } from '../../src/shared/day-text';
import { weekDates } from '../../src/shared/week-plan';
import { frameRecord } from '../../src/shared/frame';
import type { TrackedRecord } from '../../src/shared/records';
import { App } from '../../src/web/App';
import { openIdb } from '../../src/web/idbStore';

afterEach(cleanup);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = new Date(2026, 10, 4, 12).getTime();
const DAY = 86_400_000;

async function boot(seed: TrackedRecord[], clock: { now: number } = { now: NOW }) {
  const factory = new IDBFactory();
  const s = await openIdb('anna', factory); for (const r of seed) await s.put(r); s.close();
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    if (url === '/me') return json(200, { name: 'anna' });
    if (init.method === 'POST') return json(200, { accepted: 1, refused: [] });
    return json(200, { records: [], cursor: 0, more: false, reset: false });
  }) as unknown as typeof fetch;
  const storage = new Map<string, string>([['pandafit.account', 'anna']]);
  const mk = () => ({
    fetchFn, idbFactory: factory, now: () => clock.now, newId: () => 'id', persist: async () => true, ua: 'Mozilla/5.0 Android', standalone: false,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
  });
  const env = mk();
  const view = render(<App env={env} />);
  await screen.findByRole('heading', { level: 1, name: 'Heute' });
  return { rerender: () => view.rerender(<App env={{ ...env }} />) };
}
const rec = (kind: string, id: string, body: unknown): TrackedRecord => ({ kind: kind as TrackedRecord['kind'], id, updatedMs: NOW, deleted: false, body });
const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const weekplan = (sports: Record<string, string>) => rec('weekplan', '2026-11-02', {
  weekStart: '2026-11-02', fromMessage: 'c', acceptedMs: NOW,
  days: weekDates('2026-11-02').map((date) => ({ date, sport: sports[date] ?? 'rest', hardness: 'moderate', fixed: false })),
});
const weekplanWithGymToday = weekplan({ '2026-11-04': 'gym', '2026-11-05': 'bike', '2026-11-03': 'gym' });
const planRecord = rec('plan', 'current', {
  workout: { name: 'Oberkörper A', exercises: [{ templateId: 'pf-bench', title: 'Bankdrücken', restS: 90, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] }] },
  reason: 'x', source: 'ai', note: null, questions: [], atMs: NOW - 1000, mobility: null,
});
const yesterdayActivities = rec('activities', 'activities', { type: 'activities', atMs: NOW, items: [{ key: 'kraft-1', kind: 'kraft', title: null, sport: 'strength', startMs: NOW - DAY, minutes: 45, distanceM: null, avgHr: null, ref: null }] });
const proposal = { weekStart: '2026-11-02', days: weekDates('2026-11-02').map((date, i) => ({ date, sport: i === 4 ? 'gym' : 'rest', hardness: 'moderate', fixed: i === 4 })) };
const riderMsg = rec('chat', 'r1', { role: 'rider', text: 'Freitag Studio', atMs: NOW - 1000 });
const coachMsgWithProposal = rec('chat', 'c1', { role: 'coach', text: 'Wie wäre das?', atMs: NOW - 500, replyTo: 'r1', proposal });
const daytext = rec('daytext', 'today', { type: 'daytext', date: '2026-11-04', text: 'Schön, dass du dran bist.', atMs: NOW });

describe('Heute in the Dojo', () => {
  it('shows the week path, Bo at his place, one Jetzt dran card, then only meals and tomorrow', async () => {
    await boot([daytext, weekplanWithGymToday, planRecord]);
    const path = await screen.findByRole('list', { name: 'Wochenweg' });
    const bo = screen.getByLabelText('Satz von Bo');
    const now = screen.getByRole('region', { name: /^Heute/ });
    expect(before(path, bo) && before(bo, now)).toBe(true);
    expect(bo.querySelector('.tk-scene[data-place="dojo"]')).toBeTruthy();
    expect(screen.getAllByText('Jetzt dran')).toHaveLength(1);
    expect(within(now).getByRole('heading').textContent).toBe('Oberkörper A');
    expect(now.textContent).toContain('Krafttraining, etwa');
    expect(screen.queryByRole('region', { name: 'Dein Körper' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tag vor' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Heute' }).className).toBe('tk-sr');
  });
  describe('the line under the workout name', () => {
    const noted = rec('weekplan', '2026-11-02', {
      weekStart: '2026-11-02', fromMessage: 'c', acceptedMs: NOW,
      days: weekDates('2026-11-02').map((date) => ({ date, sport: date === '2026-11-04' ? 'gym' : 'rest', hardness: 'moderate', fixed: false, ...(date === '2026-11-04' ? { note: 'Beine und Rumpf' } : {}) })),
    });
    it('never shows a week-plan note beside the strength plan, whenever the plan was made', async () => {
      for (const atMs of [NOW - DAY, NOW - 1000]) {
        await boot([noted, rec('plan', 'current', { ...(planRecord.body as object), atMs })]);
        const card = await screen.findByRole('region', { name: /^Heute/ });
        expect(card.textContent).toContain('Krafttraining, etwa');
        expect(card.textContent).not.toContain('Beine und Rumpf');
        cleanup();
      }
    });
  });
  it('a dot of the week path opens that day', async () => {
    await boot([weekplanWithGymToday, yesterdayActivities]);
    fireEvent.click(await screen.findByRole('button', { name: /^Dienstag/ }));
    expect(await screen.findByRole('dialog', { name: /^Dienstag/ })).toBeTruthy();
  });
  const dialogOfDay = () => screen.queryByRole('dialog', { name: /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)/ });
  const TOMORROW = '2026-11-05';
  const bikeRec = rec('bike', 'bike', {
    type: 'bike', atMs: NOW - 1000, ftpW: 210, ftpHistory: [], phase: { name: 'Aufbau', weeksLeft: 3, goal: 'Ausdauer aufbauen' },
    next: { name: 'Grundlage', reason: 'x', minutes: 60, hardness: 'easy', blocks: [{ label: '60 Min locker', minutes: 60, pct: 60 }] }, alternatives: [], weekHours: [],
  });
  const runStatus = rec('run', 'status', {
    type: 'status', atMs: NOW - 1000, on: true, suggest: false, needsAnswers: false, garmin: false, suggestedDays: [1, 3, 5], hrCap: 150, complaint: null,
    numbers: { easyPace: { now: null, weeks4: null, weeks12: null, trend: [] }, weeks: [], longest: { blockKm: null, lastBlockKm: null }, tests: [] }, card: null,
  });
  it('Morgen with strength opens Nächstes Training in Kraft directly, without the day sheet', async () => {
    await boot([weekplan({ [TOMORROW]: 'gym' }), planRecord]);
    fireEvent.click(await screen.findByRole('button', { name: /^Morgen/ }));
    expect(await screen.findByRole('dialog', { name: 'Nächstes Training' })).toBeTruthy();
    expect(dialogOfDay()).toBeNull();
  });
  it('Morgen with strength but no plan workout opens the Kraft page', async () => {
    await boot([weekplan({ [TOMORROW]: 'gym' })]);
    fireEvent.click(await screen.findByRole('button', { name: /^Morgen/ }));
    expect(await screen.findByRole('region', { name: 'Kraft · diese Woche' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Morgen with a ride opens Ausdauer on Rad', async () => {
    await boot([weekplan({ [TOMORROW]: 'bike' }), bikeRec]);
    fireEvent.click(await screen.findByRole('button', { name: /^Morgen/ }));
    expect(await screen.findByRole('region', { name: 'Rad · diese Woche' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Morgen with a run opens Ausdauer on Laufen', async () => {
    await boot([weekplan({ [TOMORROW]: 'run' }), runStatus]);
    fireEvent.click(await screen.findByRole('button', { name: /^Morgen/ }));
    expect(await screen.findByRole('region', { name: 'Laufen · diese Woche' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('Morgen as a rest day still opens the day sheet; Spontan and no plan keep no card', async () => {
    await boot([weekplan({ '2026-11-04': 'gym' }), planRecord]);
    const row = await screen.findByRole('button', { name: /^Morgen/ });
    expect(row.textContent).toContain('Ruhetag'); // Rest is a plan too: the card says so.
    fireEvent.click(row);
    expect(await screen.findByRole('dialog', { name: /^Donnerstag/ })).toBeTruthy();
    cleanup();
    await boot([]);
    expect(screen.queryByRole('button', { name: /^Morgen/ })).toBeNull();
    cleanup();
    // In Spontan mode the plan rests, as on Woche: no Morgen card.
    await boot([weekplanWithGymToday, planRecord, frameRecord({ mode: 'spontaneous', minutes: null }, 1)]);
    await screen.findByRole('list', { name: 'Wochenweg' });
    expect(screen.queryByRole('button', { name: /^Morgen/ })).toBeNull();
  });
  it('an open workout takes the Jetzt dran place with Weitermachen', async () => {
    const open = rec('workout', 'w-open', { id: 'w-open', title: 'Pull', startMs: NOW - 600_000, endMs: null, source: 'pandafit', exercises: [] });
    await boot([weekplanWithGymToday, planRecord, open]);
    const go = await screen.findByRole('button', { name: 'Weitermachen' });
    expect(screen.queryByRole('button', { name: 'Training starten' })).toBeNull();
    expect(screen.queryAllByText('Jetzt dran')).toHaveLength(0);
    expect(screen.getByText('Läuft noch')).toBeTruthy();
    expect(before(screen.getByLabelText('Satz von Bo'), go)).toBe(true);
    fireEvent.click(go);
    expect(await screen.findByRole('button', { name: 'Training beenden' })).toBeTruthy();
  });
  it('Bo steht still, solange ein Training offen ist', async () => {
    await boot([weekplanWithGymToday, planRecord]);
    await screen.findByLabelText('Satz von Bo');
    await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());
    cleanup();
    const open = rec('workout', 'w-open', { id: 'w-open', title: 'Pull', startMs: NOW - 600_000, endMs: null, source: 'pandafit', exercises: [] });
    await boot([weekplanWithGymToday, planRecord, open]);
    await screen.findByRole('button', { name: 'Weitermachen' });
    expect(document.querySelector('canvas')).toBeNull();
  });
  it('a waiting proposal turns Bo’s bubble into Vorschlag ansehen, which opens the chat', async () => {
    await boot([riderMsg, coachMsgWithProposal]);
    fireEvent.click(await screen.findByRole('button', { name: 'Vorschlag ansehen' }));
    expect(await screen.findByRole('dialog', { name: 'Bo, dein Sensai' })).toBeTruthy();
  });
  it('without a plan the one card offers to plan', async () => {
    await boot([]);
    const card = await screen.findByRole('region', { name: 'Was Pandafit planen kann' });
    expect(card.textContent).toContain('Dein Plan');
    expect(within(card).getByRole('button', { name: 'Woche planen' }).className).toBe('primary');
    expect(within(card).getByRole('button', { name: 'Im Profil auswählen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Vorschlag ansehen' })).toBeNull();
  });
  it('shows no Gemeinsam: it lives on Woche', async () => {
    const weeks = [...Array(11).fill(0), 40];
    const together = {
      week: Date.UTC(2026, 10, 2), atMs: NOW - 3_600_000, you: 'anna',
      people: [{ profileId: 'anna', name: 'Anna', ridesThisWeek: 1, minutesThisWeek: 40, wordsLearned: 30, weeks }, { profileId: 'max', name: 'Max', ridesThisWeek: 2, minutesThisWeek: 75, wordsLearned: 12, weeks }],
      recent: [], metres: 2350, lastRideMetres: 400, peak: { name: 'Mont Ventoux', done: 1250, total: 1600, next: 'Stilfser Joch' }, summits: [], climbed: [], climbing: [],
    };
    await boot([daytext, weekplanWithGymToday, planRecord, rec('together', 'current', together)]);
    await screen.findByText('Schön, dass du dran bist.');
    expect(screen.queryByRole('button', { name: /Gemeinsam/ })).toBeNull();
  });
  it('"Frag Bo, deinen Sensai" on Heute opens the real coach composer', async () => {
    await boot([daytext]);
    const card = screen.getByLabelText('Satz von Bo');
    expect(card.textContent).not.toContain('Sensai ·');
    // Bo appears once the day is known.
    await waitFor(() => expect(card.querySelector('img')?.getAttribute('alt')).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Frag Bo, deinen Sensai' }));
    expect(await screen.findByLabelText('Nachricht an Bo')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Heute' })).toBeNull();
    expect(within(screen.getByRole('dialog', { name: 'Bo, dein Sensai' })).getByLabelText('Nachricht an Bo')).toBeTruthy();
  });
  it('a daytext of yesterday shows a saying', async () => {
    await boot([rec('daytext', 'today', { type: 'daytext', date: '2026-11-03', text: 'Gestriger Satz.', atMs: NOW - DAY })]);
    expect(screen.queryByText('Gestriger Satz.')).toBeNull();
    const card = screen.getByLabelText('Satz von Bo');
    expect(SAYINGS).toContain(card.querySelector('p')!.textContent);
  });

  describe('Zum Abschluss', () => {
    const workout = (endMs: number | null) => rec('workout', 'w1', { id: 'w1', title: 'Beine', startMs: NOW - 4_000_000, endMs, source: 'pandafit', exercises: [] });
    const planWithMobility = rec('plan', 'current', {
      workout: null, reason: 'x', source: 'ai', note: null, questions: [], atMs: NOW - 1000,
      mobility: { id: `mobility-bike-${NOW - 3_600_000}`, forSession: 'bike', minutes: 8, exercises: [{ id: 'm1', title: 'Hüftbeuger dehnen', howTo: 'Ruhig atmen.', area: 'hueftbeuger' }], reason: 'Tut gut.' },
    });
    it('after a finished workout the card holds the mobility row', async () => {
      await boot([workout(NOW - 600_000), planWithMobility]);
      const card = await screen.findByRole('region', { name: 'Zum Abschluss' });
      expect(card.textContent).toContain('20 Minuten lockeres Cardio');
      expect(card.contains(await screen.findByRole('button', { name: /^Beweglichkeit/ }))).toBe(true);
      expect(card.textContent).not.toContain('Ein paar Minuten dehnen');
    });
    it('without a coach session the plain stretch line shows', async () => {
      await boot([workout(NOW - 600_000)]);
      const card = await screen.findByRole('region', { name: 'Zum Abschluss' });
      expect(card.textContent).toContain('Dehn ein paar Minuten, was sich fest anfühlt.');
    });
    it('a ride today leaves only stretching', async () => {
      const items = [{ key: 'rad-1', kind: 'rad', title: null, sport: 'cycling', startMs: NOW - 300_000, minutes: 30, distanceM: null, avgHr: null, ref: null }];
      await boot([workout(NOW - 600_000), rec('activities', 'activities', { type: 'activities', atMs: NOW, items })]);
      const card = await screen.findByRole('region', { name: 'Zum Abschluss' });
      expect(card.textContent).toContain('Heute reicht Dehnen.');
      expect(card.textContent).not.toContain('20 Minuten lockeres Cardio');
    });
    it('shows nothing without a finished workout, while one is open, or after three hours; the mobility row stays', async () => {
      await boot([planWithMobility]);
      await screen.findByRole('button', { name: /^Beweglichkeit/ });
      expect(screen.queryByText('Zum Abschluss')).toBeNull();
      cleanup();
      await boot([workout(null), planWithMobility]);
      await screen.findByRole('button', { name: /^Beweglichkeit/ });
      expect(screen.queryByText('Zum Abschluss')).toBeNull();
      cleanup();
      await boot([workout(NOW - 3 * 3_600_000 - 60_000), planWithMobility]);
      await screen.findByRole('button', { name: /^Beweglichkeit/ });
      expect(screen.queryByText('Zum Abschluss')).toBeNull();
    });
  });
});

describe('Zusammenfassung auf Heute', () => {
  afterEach(() => localStorage.removeItem('pandafit-summary-pending'));
  const done = (endMs: number) => rec('workout', 'w1', { id: 'w1', title: 'Beine', startMs: endMs - 3_000_000, endMs, source: 'pandafit', exercises: [] });
  it('a recent pending summary shows with the mobility offer', async () => {
    localStorage.setItem('pandafit-summary-pending', 'w1');
    const mobility = rec('plan', 'current', {
      workout: null, reason: 'x', source: 'ai', note: null, questions: [], atMs: NOW - 1000,
      mobility: { id: `mobility-bike-${NOW - 3_600_000}`, forSession: 'bike', minutes: 8, exercises: [{ id: 'm1', title: 'Hüftbeuger dehnen', howTo: 'Ruhig atmen.', area: 'hueftbeuger' }], reason: 'Tut gut.' },
    });
    await boot([done(NOW - 600_000), mobility]);
    const card = await screen.findByRole('region', { name: 'Zusammenfassung' });
    expect(card.contains(await screen.findByRole('button', { name: /^Beweglichkeit/ }))).toBe(true);
  });
  it('a pending summary older than the window is dropped: the plan card shows and the marker is cleared', async () => {
    localStorage.setItem('pandafit-summary-pending', 'w1');
    await boot([done(NOW - 3 * 3_600_000 - 60_000), weekplanWithGymToday, planRecord]);
    await waitFor(() => expect(localStorage.getItem('pandafit-summary-pending')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Zusammenfassung' })).toBeNull();
    expect(screen.queryByText('Gespeichert')).toBeNull();
  });
});

describe('Zurück aus dem Chat von Heute', () => {
  it('closing the chat opened from Heute lands on Heute, not on Woche', async () => {
    await boot([]);
    fireEvent.click(screen.getByRole('button', { name: 'Frag Bo, deinen Sensai' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bo, dein Sensai' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Zurück|Schließen/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Heute' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Deine Woche' })).toBeNull();
  });
});
