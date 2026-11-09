// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { NOW, DAY, boot } from './helpers';

afterEach(cleanup);

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
    expect(await screen.findByRole('region', { name: 'Nächste Fahrt' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Ausdauer' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Ausdauer' })).toBeNull(); // no switch with Rad alone
  });

  it('a removed ride is not shown', async () => {
    await boot({ account: 'anna', seed: [bikeRec({ next: null }), { ...rideRec('r1', 3 * DAY), deleted: true }] });
    await screen.findByRole('navigation');
    expect(screen.queryByRole('button', { name: 'Ausdauer' })).toBeNull();
  });

  it('the next card names the session and the card opens the Ablauf with one row per block', async () => {
    await boot({ account: 'anna', seed: [bikeRec()], startTab: 'rad' });
    const card = await screen.findByRole('region', { name: 'Nächste Fahrt' });
    expect(card.textContent).toContain('Schwellen-Intervalle · 60 Min · hart');
    expect(card.textContent).toContain('Die letzten Tage waren locker.');
    fireEvent.click(screen.getByRole('button', { name: /Schwellen-Intervalle/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('10 Min locker')).toBeTruthy();
    expect(within(sheet).getByText('3 × 8 Min bei 95 % (200 W), dazwischen 4 Min locker')).toBeTruthy();
  });

  it('the last ride opens the ride sheet with the facts, the sentence and the chart', async () => {
    await boot({ account: 'anna', seed: [bikeRec(), rideRec('r1', 3 * DAY), rideRec('r0', 60 * DAY, 'Locker')], startTab: 'rad' });
    fireEvent.click(await screen.findByRole('button', { name: /Grundlage/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Alles geschafft, ruhig gefahren · Ø 150 W · Ø Puls 130/)).toBeTruthy();
    expect(within(sheet).getByText('Ruhig und gleichmäßig gefahren.')).toBeTruthy();
    expect(within(sheet).getByRole('img', { name: /Leistung und Puls/ }).querySelectorAll('polyline').length).toBe(2);
  });

  it('Entwicklung tells the FTP, the phase and the hours per week', async () => {
    await boot({ account: 'anna', seed: [bikeRec()], startTab: 'rad' });
    fireEvent.click(await screen.findByRole('button', { name: /^Entwicklung/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/^FTP \(Dauerleistung\) 210 W, seit .* 10 W mehr$/)).toBeTruthy();
    expect(within(sheet).getByText('Phase Aufbau, noch 3 Wochen bis zur nächsten Phase')).toBeTruthy();
    expect(within(sheet).getAllByRole('img').length).toBe(2);
  });

  it('with Rad and Laufen a switch shows, remembers the choice and the old tab name still works', async () => {
    const a = await boot({ account: 'anna', seed: [bikeRec(), runStatus()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ausdauer' }));
    await screen.findByRole('region', { name: 'Nächste Fahrt' });
    // One page head: the title, the switch below it, no second title for the chosen half.
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Ausdauer']);
    fireEvent.click(within(screen.getByRole('group', { name: 'Ausdauer' })).getByRole('button', { name: 'Laufen' }));
    expect(await screen.findByRole('button', { name: 'Lauf eintragen' })).toBeTruthy();
    expect(a.storage.get('pandafit.ausdauer.anna')).toBe('laufen');
    cleanup();
    await boot({ account: 'anna', seed: [bikeRec(), runStatus()], startTab: 'laufen' });
    expect(await screen.findByRole('button', { name: 'Lauf eintragen' })).toBeTruthy();
    cleanup();
    await boot({ account: 'anna', seed: [bikeRec(), runStatus()], flags: { 'pandafit.ausdauer.anna': 'laufen' }, startTab: 'ausdauer' });
    expect(await screen.findByRole('button', { name: 'Lauf eintragen' })).toBeTruthy();
  });

  const bikeWeek = async (): Promise<TrackedRecord> => {
    const { mondayOf, weekDates } = await import('../../../src/shared/week-plan');
    const { dateKey } = await import('../../../src/shared/day-rating');
    const monday = mondayOf(dateKey(NOW));
    return { kind: 'weekplan', id: monday, updatedMs: 1, deleted: false, body: { weekStart: monday, fromMessage: 'm', acceptedMs: 1, days: weekDates(monday).map((date) => ({ date, sport: 'bike', hardness: 'moderate', fixed: false })) } };
  };

  it('Heute on a bike day names the session, says it starts on the Mac, and Ansehen opens Rad', async () => {
    await boot({ account: 'anna', seed: [bikeRec(), await bikeWeek()] });
    await waitFor(() => expect(screen.getByRole('region', { name: /^Heute/ }).textContent).toContain('Schwellen-Intervalle · 60 Min'));
    const card = screen.getByRole('region', { name: /^Heute/ });
    expect(card.textContent).toContain('am Mac');
    fireEvent.click(within(card).getByRole('button', { name: 'Ansehen' }));
    expect(await screen.findByRole('region', { name: 'Nächste Fahrt' })).toBeTruthy();
  });

  it('Heute on a bike day without a published plan keeps the note about the Mac', async () => {
    await boot({ account: 'anna', seed: [await bikeWeek()] });
    await waitFor(() => expect(screen.getByRole('region', { name: /^Heute/ }).textContent).toContain('am Mac'));
    const card = screen.getByRole('region', { name: /^Heute/ });
    expect(within(card).queryByRole('button', { name: 'Ansehen' })).toBeNull();
  });
});
