// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HEALTH_ID, type HealthBody, type HealthFinding } from '../../src/shared/health';
import type { TrackedRecord } from '../../src/shared/records';
import { STATS_ID, type StatsBody } from '../../src/shared/stats';
import { StatsScreen } from '../../src/tracking/ui/StatsScreen';
import { healthRows } from '../../src/tracking/ui/health-view';
import { fakePort } from './fake-port';

afterEach(cleanup);

const NOW = new Date(2026, 10, 4, 10).getTime();
const now = () => NOW;
const stats: StatsBody = { type: 'stats', atMs: NOW - 3_600_000, goal: 'muscle', days: [], muscles: {} };
const statsRec: TrackedRecord = { kind: 'stats', id: STATS_ID, updatedMs: 1, deleted: false, body: stats };
const f = (rule: string, text: string, tone: HealthFinding['tone']): HealthFinding => ({ rule, text, tone });
const weeks = Array.from({ length: 12 }, (_, i) => ({ week: `2026-${i < 6 ? '08' : '09'}-${String(1 + (i % 6) * 4).padStart(2, '0')}`, rhr: 55 + (i % 3), vo2: 50 + i * 0.1, steps: 8000, activeMin: 160, strengthDays: 2, sleepH: 7, hrv: 50 }));
const body = (over: Partial<HealthBody> = {}): HealthBody => ({
  type: 'health', atMs: NOW - 1000, today: { level: 'normal', reasons: [] }, findings: [f('health.steps-band', 'Letzte Woche lagst du im Schnitt bei etwa 7.400 Schritten pro Tag; ein Richtwert aus Studien sind 8.000 bis 10.000.', 'info')],
  weeks, days: Array.from({ length: 10 }, (_, i) => ({ date: `2026-10-${String(20 + i)}`, rhr: 56, steps: 7000 })), ...over,
});
const healthRec = (b: HealthBody): TrackedRecord => ({ kind: 'health', id: HEALTH_ID, updatedMs: 1, deleted: false, body: b });

async function show(seed: TrackedRecord[]) {
  const { port } = fakePort(seed);
  render(<StatsScreen port={port} now={now} />);
  await screen.findByRole('heading', { name: 'Statistik' });
  await new Promise((r) => setTimeout(r, 20));
}
const openHealth = () => { fireEvent.click(screen.getByRole('button', { name: 'Gesundheit' })); return screen.getByRole('dialog', { name: 'Gesundheit' }); };

test('the Gesundheit row exists only with a health record', async () => {
  await show([statsRec]);
  expect(screen.queryByRole('button', { name: 'Gesundheit' })).toBeNull();
  cleanup();
  await show([statsRec, healthRec(body())]);
  expect(screen.getByRole('button', { name: 'Gesundheit' })).toBeTruthy();
});

test('the sheet starts with the coach text, then rows with a sentence each, and the muted line with the sources', async () => {
  await show([statsRec, healthRec(body({ coachText: { week: '2026-11-02', text: 'Eine ruhige Woche, nichts Besonderes.' } }))]);
  const sheet = openHealth();
  expect(within(sheet).getByText('Eine ruhige Woche, nichts Besonderes.')).toBeTruthy();
  for (const t of ['Ruhepuls', 'Fitness', 'Bewegung im Alltag', 'Schlaf & HRV']) expect(within(sheet).getByRole('button', { name: t })).toBeTruthy();
  expect(within(sheet).getByText(/^Keine Diagnose\. Grundlage: WHO-Empfehlungen und Studien zu Ruhepuls, Fitness und Schritten\.$/)).toBeTruthy();
  // a sentence and the lines only when a row is opened
  expect(within(sheet).queryByRole('img', { name: 'Letzte 52 Wochen' })).toBeNull();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Ruhepuls' }));
  expect(within(sheet).getByText('Im Ruhepuls fällt gerade nichts auf.')).toBeTruthy();
  expect(within(sheet).getAllByRole('img').length).toBeGreaterThan(0);
});

test('without a coach text the first finding leads', async () => {
  await show([statsRec, healthRec(body())]);
  expect(within(openHealth()).getAllByText(/7\.400 Schritten/).length).toBeGreaterThan(0);
});

test('an arzt finding is one calm row at the top, with the wording ärztlich abklären', async () => {
  const arzt = f('health.rhr-high', 'Dein Ruhepuls lag an mehreren der letzten Tage über 100. Das lässt du am besten ärztlich abklären.', 'arzt');
  await show([statsRec, healthRec(body({ findings: [arzt, f('health.vo2-trend', 'Deine geschätzte Ausdauerfitness ist in den letzten Wochen etwas gestiegen.', 'gut')] }))]);
  const sheet = openHealth();
  expect(within(sheet).getAllByText(/ärztlich abklären/)).toHaveLength(1);
  const hint = within(sheet).getByRole('list', { name: 'Hinweis' });
  expect(hint.textContent).toContain('ärztlich abklären');
  expect(sheet.textContent).not.toMatch(/Diagnose:|Erkrankung|du hast/i);
});

test('the sources sheet lists the register sources of the health rules', async () => {
  await show([statsRec, healthRec(body())]);
  fireEvent.click(within(openHealth()).getByRole('button', { name: /^Quellen/ }));
  const sources = screen.getByRole('dialog', { name: 'Quellen' });
  for (const t of [/Buchheit 2014/, /Paluch et al\. 2022/, /Bull et al\. 2020/, /Kodama et al\. 2009/, /Zhang et al\. 2016/]) expect(within(sources).getByText(t)).toBeTruthy();
});

test('rows exist only with data, and Body Battery and stress appear nowhere', async () => {
  expect(healthRows(body({ weeks: [], days: [] }))).toEqual([]);
  expect(healthRows(body({ weeks: weeks.map(({ vo2: _v, sleepH: _s, hrv: _h, ...w }) => w) })).map((r) => r.key)).toEqual(['rhr', 'move']);
  await show([statsRec, healthRec(body({ coachText: { week: '2026-11-02', text: 'Ruhig.' } }))]);
  const sheet = openHealth();
  for (const b of within(sheet).getAllByRole('button')) fireEvent.click(b);
  expect(sheet.textContent).not.toMatch(/Body Battery|Stress|ACWR/i);
});
