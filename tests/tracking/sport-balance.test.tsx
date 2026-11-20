// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { SportBalance } from '../../src/tracking/ui/SportBalance';
import { sportChartSentence, sportChartSummary, type SportChart } from '../../src/shared/sport-chart';
import type { MuscleChart } from '../../src/shared/muscle-chart';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';
import { openChat } from './open-chat';

afterEach(cleanup);

const chart: SportChart = { kind: 'sport', fromMs: 0, toMs: 28 * 86_400_000, parts: [{ sport: 'gym', minutes: 300, target: 0.4 }, { sport: 'bike', minutes: 500, target: 0.4 }, { sport: 'run', minutes: 20, target: 0.2 }] };

describe('SportBalance', () => {
  it('ist ein Bild mit Zusammenfassung in Worten', () => {
    render(<SportBalance chart={chart} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe(sportChartSummary(chart));
    expect(img.getAttribute('aria-label')).toMatch(/Ausdauer und Kraft/);
  });
  it('zeigt „So war es“ und „Dein Ziel“ als Balken mit je einem Segment je Sportart in Sportfarben', () => {
    const { container } = render(<SportBalance chart={chart} />);
    const rows = container.querySelectorAll('.tk-sportbar');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('So war es')).toBeTruthy();
    expect(screen.getByText('Dein Ziel')).toBeTruthy();
    const actual = rows[0]!.querySelectorAll('.tk-sportbar-seg');
    expect(actual).toHaveLength(3);
    expect([...actual].map((s) => s.className)).toEqual(expect.arrayContaining([expect.stringContaining('tk-sport-strength'), expect.stringContaining('tk-sport-bike'), expect.stringContaining('tk-sport-run')]));
    const widths = [...actual].map((s) => parseFloat((s as HTMLElement).style.width));
    expect(widths[0]).toBeCloseTo((300 / 820) * 100, 0);
    const goal = [...rows[1]!.querySelectorAll('.tk-sportbar-seg')].map((s) => parseFloat((s as HTMLElement).style.width));
    expect(goal).toEqual([40, 40, 20]);
  });
  it('hat eine Legende mit den Sportnamen und streut keine Zahlen', () => {
    const { container } = render(<SportBalance chart={chart} />);
    const legend = container.querySelector('.tk-sportlegend')!;
    for (const n of ['Kraft', 'Rad', 'Laufen']) expect(within(legend as HTMLElement).getByText(n)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d/);
  });
  it('zeigt eine Sportart mit Zeit ohne Ziel in der Legende, ohne Zielsegment', () => {
    const c: SportChart = { ...chart, parts: [{ sport: 'gym', minutes: 40, target: 0 }, { sport: 'bike', minutes: 60, target: 1 }] };
    const { container } = render(<SportBalance chart={c} />);
    expect(container.querySelectorAll('.tk-sportbar')[1]!.querySelectorAll('.tk-sportbar-seg')).toHaveLength(1);
    expect(screen.getByText('Kraft')).toBeTruthy();
  });
  it('lässt ohne Ziel den Zielbalken weg', () => {
    const c: SportChart = { ...chart, parts: chart.parts.map((p) => ({ ...p, target: 0 })) };
    const { container } = render(<SportBalance chart={c} />);
    expect(container.querySelectorAll('.tk-sportbar')).toHaveLength(1);
    expect(screen.queryByText('Dein Ziel')).toBeNull();
  });
  it('schreibt einen ruhigen Satz darunter', () => {
    render(<SportBalance chart={chart} />);
    expect(screen.getByText(sportChartSentence(chart))).toBeTruthy();
  });
});

describe('im Chat', () => {
  const NOW = new Date(2026, 10, 29, 12).getTime();
  const rec = (id: string, body: object): TrackedRecord => ({ kind: 'chat', id, updatedMs: 1, deleted: false, body });
  const muscles: MuscleChart = { kind: 'muskeln', fromMs: 0, toMs: 1, axes: ['chest', 'back', 'abs'].map((group) => ({ group: group as 'chest', sets: 3, min: 1, max: 4 })) };
  it('zeigt das Sport-Diagramm unter Bos Nachricht', async () => {
    const { port } = fakePort([rec('m1', { role: 'coach', text: 'So war dein Monat.', atMs: NOW - 5000, chart })]);
    render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
    const dlg = await openChat();
    expect(await within(dlg).findByRole('img', { name: /Ausdauer und Kraft/ })).toBeTruthy();
    expect(within(dlg).getByText(sportChartSentence(chart))).toBeTruthy();
  });
  it('zeigt mehrere Diagramme einer Nachricht nacheinander', async () => {
    const { port } = fakePort([rec('m1', { role: 'coach', text: 'Dein Monat.', atMs: NOW - 5000, chart: muscles, charts: [muscles, chart] })]);
    render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
    const dlg = await openChat();
    expect(await within(dlg).findByRole('img', { name: /Spinnennetz/ })).toBeTruthy();
    expect(within(dlg).getByRole('img', { name: /Ausdauer und Kraft/ })).toBeTruthy();
  });
});
