// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HEALTH_ID, type HealthBody, type HealthFinding } from '../../src/shared/health';
import type { TrackedRecord } from '../../src/shared/records';
import { STATS_ID, type StatsBody } from '../../src/shared/stats';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { healthRows, SLEEP_HINT } from '../../src/tracking/ui/health-view';
import { findingsOf } from '../../src/coach/health/findings';
import { fakePort } from './fake-port';

afterEach(cleanup);

const NOW = new Date(2026, 10, 4, 10).getTime();
const stats: StatsBody = { type: 'stats', atMs: NOW - 3_600_000, goal: 'muscle', days: [], muscles: {} };
const statsRec: TrackedRecord = { kind: 'stats', id: STATS_ID, updatedMs: 1, deleted: false, body: stats };
const f = (rule: string, text: string, tone: HealthFinding['tone']): HealthFinding => ({ rule, text, tone });
const arzt = f('health.rhr-high', 'Dein Ruhepuls lag an mehreren der letzten Tage über 100. Das lässt du am besten ärztlich abklären.', 'arzt');
const weeks = Array.from({ length: 12 }, (_, i) => ({ week: `2026-${i < 6 ? '08' : '09'}-${String(1 + (i % 6) * 4).padStart(2, '0')}`, rhr: 55 + (i % 3), vo2: 50 + i * 0.1, steps: 8000, activeMin: 160, strengthDays: 2, sleepH: 7, hrv: 50 }));
const body = (over: Partial<HealthBody> = {}): HealthBody => ({
  type: 'health', atMs: NOW - 1000, today: { level: 'normal', reasons: [] }, findings: [f('health.vo2-trend', 'Deine geschätzte Ausdauerfitness hat sich noch nicht klar verändert.', 'gut')],
  weeks, days: Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(20 + i)}`, rhr: 56, steps: 7000 })), ...over,
});
const healthRec = (b: HealthBody): TrackedRecord => ({ kind: 'health', id: HEALTH_ID, updatedMs: 1, deleted: false, body: b });

async function showWeek(seed: TrackedRecord[]) {
  const { port } = fakePort(seed);
  render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
  await screen.findByRole('heading', { level: 1, name: 'Woche' });
  await new Promise((r) => setTimeout(r, 20));
}

it('Woche shows a health card with one sentence and the areas as words, no digits', async () => {
  await showWeek([healthRec(body())]);
  const card = await screen.findByRole('region', { name: 'Gesundheit' });
  expect(card.textContent).toContain('Ruhepuls');
  expect(card.textContent).not.toMatch(/\d/);
  expect(card.querySelectorAll('.tk-wordtile')).toHaveLength(3);
});

it('a doctor finding leads the card and the page, never hidden behind the calm sentence', async () => {
  await showWeek([healthRec(body({ findings: [arzt] }))]);
  const card = await screen.findByRole('region', { name: 'Gesundheit' });
  expect(card.querySelector('.tk-note')!.textContent).toContain('ärztlich abklären');
  fireEvent.click(within(card).getByRole('button', { name: /Gesundheit ansehen/ }));
  const page = await screen.findByRole('heading', { level: 1, name: 'Gesundheit' });
  expect(page).toBeTruthy();
  expect(document.querySelector('.tk-note')!.textContent).toContain('ärztlich abklären');
  expect(document.body.textContent).not.toMatch(/ruhige Woche/);
});

it('only present areas get tiles; without sleep data the page shows the calm hint', async () => {
  await showWeek([healthRec(body({ weeks: weeks.map(({ vo2: _v, steps: _s, activeMin: _a, sleepH: _h, hrv: _r, ...w }) => w) }))]);
  expect((await screen.findByRole('region', { name: 'Gesundheit' })).querySelectorAll('.tk-wordtile')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Gesundheit ansehen/ }));
  expect(await screen.findByText(SLEEP_HINT)).toBeTruthy();
});

it('without a health record there is no card at all, and Rückblick has no health row', async () => {
  await showWeek([statsRec]);
  expect(screen.queryByRole('region', { name: 'Gesundheit' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Gesundheit\s*(ruhig|Hinweis)/ })).toBeNull();
  cleanup();
  await showWeek([statsRec, healthRec(body())]);
  expect(screen.getByRole('region', { name: 'Gesundheit' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Gesundheit\s*(ruhig|Hinweis)/ })).toBeNull();
});

it('Verlauf opens the lines of one area; Quellen and Zurück work; Woche brings the week back', async () => {
  await showWeek([statsRec, healthRec(body({ coachText: { week: '2026-11-02', text: 'Ruhig.', atMs: new Date(2026, 10, 3, 12).getTime() } }))]);
  fireEvent.click(await screen.findByRole('button', { name: /Gesundheit ansehen/ }));
  expect(screen.getByText('Diese Woche, Stand Dienstag, 3. November')).toBeTruthy();
  const area = screen.getByRole('region', { name: 'Ruhepuls' });
  expect(within(area).getByText('Im Ruhepuls fällt gerade nichts auf.')).toBeTruthy();
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  fireEvent.click(within(area).getByRole('button', { name: 'Verlauf' }));
  const sheet = screen.getByRole('dialog', { name: 'Ruhepuls' });
  expect(within(sheet).getAllByRole('img').length).toBeGreaterThan(0);
  fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Quellen ansehen' }));
  const sources = screen.getByRole('dialog', { name: 'Quellen' });
  fireEvent.click(within(sources).getByRole('button', { name: '‹ Zurück' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Woche/ }));
  expect(await screen.findByRole('region', { name: 'Gesundheit' })).toBeTruthy();
});

it('without data the page has no sleep card but a calm hint, and with data it has the Verlauf card', async () => {
  await showWeek([healthRec(body())]);
  fireEvent.click(await screen.findByRole('button', { name: /Gesundheit ansehen/ }));
  expect(screen.queryByText(SLEEP_HINT)).toBeNull();
  expect(within(screen.getByRole('region', { name: 'Schlaf & HRV' })).getByRole('button', { name: 'Verlauf' })).toBeTruthy();
});

it('rows exist only with data, and Body Battery and stress appear nowhere', async () => {
  expect(healthRows(body({ weeks: [], days: [] }))).toEqual([]);
  expect(healthRows(body({ weeks: weeks.map(({ vo2: _v, sleepH: _s, hrv: _h, ...w }) => w) })).map((r) => r.key)).toEqual(['rhr', 'move']);
  await showWeek([healthRec(body())]);
  fireEvent.click(await screen.findByRole('button', { name: /Gesundheit ansehen/ }));
  expect(document.body.textContent).not.toMatch(/Body Battery|Stress|ACWR/i);
});

it('the card never prints a digit, even with the real finding texts; the page keeps the numbers', async () => {
  const w = { week: '2026-10-26', steps: 5300, activeMin: 90, strengthDays: 1 };
  // the real builder gives an arzt finding and digit texts for the steps and minutes
  const days = Array.from({ length: 5 }, (_, i) => ({ date: `2026-11-0${4 - i}`, restingHrBpm: 112 }));
  const found = findingsOf(days as never, [w] as never, { birthDate: '1990-01-01' }, NOW);
  expect(found.some((x) => x.tone === 'arzt')).toBe(true);
  const real = found.filter((x) => x.tone !== 'arzt');
  expect(real.some((x) => /\d/.test(x.text))).toBe(true);
  await showWeek([healthRec(body({ findings: found, coachText: { week: '2026-11-02', text: 'Du hast 3 Einheiten geschafft.' } }))]);
  const card = await screen.findByRole('region', { name: 'Gesundheit' });
  expect(card.textContent).not.toMatch(/\d/);
  expect(card.querySelector('.tk-note')!.textContent).toBe('Dein Wert für Ruhepuls fällt gerade auf. Lass das am besten ärztlich abklären.');
  fireEvent.click(within(card).getByRole('button', { name: /Gesundheit ansehen/ }));
  expect(document.body.textContent).toMatch(/über 100/);
});
