// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { DaySheet } from '../../src/tracking/ui/DaySheet';
import { fakePort } from './fake-port';

afterEach(cleanup);

const NOW = new Date(2026, 10, 4, 12).getTime(); // Wednesday
const rec = (kind: string, id: string, body: unknown): TrackedRecord => ({ kind: kind as TrackedRecord['kind'], id, updatedMs: NOW, deleted: false, body });
const activities = (items: unknown[]) => rec('activities', 'activities', { type: 'activities', atMs: NOW, items });
const ride = { key: 'rad-1', kind: 'rad', title: null, sport: 'cycling', startMs: new Date(2026, 10, 3, 18).getTime(), minutes: 44.6, distanceM: null, avgHr: null, ref: null };
const weekplan = (sports: string[], extra: Record<string, unknown> = {}) => rec('weekplan', '2026-11-02', { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: `2026-11-0${2 + i}`, sport: sports[i] ?? 'rest', hardness: 'moderate', fixed: false, ...(i === 4 ? extra : {}) })) });

function show(seed: TrackedRecord[], date: string, spontaneous = false) {
  const f = fakePort(seed);
  render(<DaySheet port={f.port} date={date} now={() => NOW} spontaneous={spontaneous} onClose={() => {}} />);
  return screen.getByRole('dialog');
}

describe('DaySheet', () => {
  it('in Spontan mode a later day shows no plan, as on Woche', async () => {
    const sheet = show([weekplan(['gym', 'gym', 'gym', 'gym', 'bike'])], '2026-11-06', true);
    await waitFor(() => expect(sheet.textContent).toContain('Für diesen Tag ist noch nichts geplant.'));
    expect(sheet.textContent).not.toMatch(/Rad|Ausdauer/);
  });
  it('a past day lists what was done with minutes, and the exercises of an own strength workout muted', async () => {
    const start = new Date(2026, 10, 3, 17).getTime();
    const sheet = show([activities([ride]), rec('workout', 'w1', { id: 'w1', title: 'Beine', startMs: start, endMs: start + 54 * 60000, source: 'pandafit', exercises: [{ exerciseId: 'sq', title: 'Kniebeuge', supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: 40, reps: 8, durationS: null, doneMs: start }] }] })], '2026-11-03');
    expect(sheet.textContent).toContain('Dienstag, 3. November');
    await waitFor(() => expect(sheet.textContent).toContain('Rad 45 Min'));
    expect(sheet.textContent).toContain('Kraft Beine · 54 Min');
    const ex = within(sheet).getByText('Kniebeuge');
    expect(ex.className).toContain('muted');
  });
  it('a past day is a rest day only when the activities are known; unknown says there is no data', async () => {
    const known = show([activities([])], '2026-11-03');
    await waitFor(() => expect(known.textContent).toContain('Das war ein Ruhetag.'));
    cleanup();
    const unknown = show([], '2026-11-03');
    await waitFor(() => expect(unknown.textContent).toContain('Für diesen Tag sind noch keine Daten da.'));
    expect(unknown.textContent).not.toContain('Ruhetag');
  });
  it('a later day shows the plan without a start button, and a calm line without a plan', async () => {
    const plan = weekplan(['rest', 'rest', 'rest', 'rest', 'gym'], { note: 'Locker bleiben.', fixed: true });
    const sheet = show([plan, rec('plan', 'current', { workout: { name: 'Pull', exercises: [{ templateId: 'a', title: 'Latzug', restS: null, supersetId: null, notes: '', sets: [] }] }, atMs: NOW })], '2026-11-06');
    await waitFor(() => expect(sheet.textContent).toContain('Kraft, mittel'));
    expect(sheet.textContent).toContain('Locker bleiben.');
    expect(sheet.textContent).toContain('Dieser Tag ist fest eingeplant.');
    expect(sheet.textContent).toContain('Pull');
    expect(sheet.textContent).toContain('Latzug');
    expect(within(sheet).queryByRole('button', { name: /starten|Zum Krafttraining/ })).toBeNull();
    cleanup();
    const empty = show([], '2026-11-06');
    await waitFor(() => expect(empty.textContent).toContain('Für diesen Tag ist noch nichts geplant.'));
  });
});

describe('DaySheet today', () => {
  it('shows only the open parts of today, not a plan that is already done', async () => {
    const strength = { key: 'kraft-1', kind: 'kraft', title: 'Pull', sport: 'strength', startMs: new Date(2026, 10, 4, 9).getTime(), minutes: 40, distanceM: null, avgHr: null, ref: null };
    const plan = weekplan(['rest', 'rest', 'gym']);
    const sheet = show([plan, activities([strength]), rec('plan', 'current', { workout: { name: 'Pull', exercises: [{ templateId: 'a', title: 'Latzug', restS: null, supersetId: null, notes: '', sets: [] }] }, atMs: NOW })], '2026-11-04');
    await waitFor(() => expect(sheet.textContent).toContain('Kraft Pull'));
    expect(sheet.textContent).not.toContain('Kraft, mittel');
    expect(sheet.textContent).not.toContain('Latzug');
  });
});
