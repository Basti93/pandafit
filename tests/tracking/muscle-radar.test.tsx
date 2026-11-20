// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { MuscleRadar } from '../../src/tracking/ui/MuscleRadar';
import { chartSentence, chartSummary, type MuscleChart } from '../../src/shared/muscle-chart';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';
import { openChat } from './open-chat';

afterEach(cleanup);

const GROUPS = ['chest', 'back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'] as const;
const chart: MuscleChart = {
  kind: 'muskeln', fromMs: 0, toMs: 28 * 86_400_000,
  axes: GROUPS.map((group) => ({ group, sets: group === 'back' ? 4 : 40, min: 32, max: 48 })),
};

describe('MuscleRadar', () => {
  it('ist ein Bild mit Zusammenfassung in Worten', () => {
    render(<MuscleRadar chart={chart} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe(chartSummary(chart));
    expect(img.getAttribute('aria-label')).toMatch(/Spinnennetz/);
  });
  it('hat eine Achse je Muskelgruppe mit kurzem deutschen Namen und ohne Zahlen', () => {
    const { container } = render(<MuscleRadar chart={chart} />);
    const svg = container.querySelector('svg')!;
    for (const name of ['Brust', 'Rücken', 'Bizeps', 'Trizeps', 'Waden', 'Bauch']) expect(within(svg as unknown as HTMLElement).getByText(name)).toBeTruthy();
    expect(svg.querySelectorAll('.tk-radar-spoke')).toHaveLength(GROUPS.length);
    expect(svg.textContent).not.toMatch(/\d/);
  });
  it('zeichnet Zielband und die Form der Person', () => {
    const { container } = render(<MuscleRadar chart={chart} />);
    expect(container.querySelector('.tk-radar-band')).not.toBeNull();
    const shape = container.querySelector('.tk-radar-shape')!;
    expect(shape.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(GROUPS.length);
  });
  it('legt eine untrainierte Gruppe in die Mitte und eine sehr starke an den Rand', () => {
    const c: MuscleChart = { ...chart, axes: chart.axes.map((a) => (a.group === 'back' ? { ...a, sets: 0 } : a.group === 'chest' ? { ...a, sets: 9999 } : a)) };
    const { container } = render(<MuscleRadar chart={c} />);
    const pts = container.querySelector('.tk-radar-shape')!.getAttribute('points')!.trim().split(/\s+/).map((p) => p.split(',').map(Number) as [number, number]);
    const [cx, cy] = [180, 155];
    const dist = (p: [number, number]) => Math.hypot(p[0] - cx, p[1] - cy);
    expect(dist(pts[1]!)).toBeCloseTo(0, 1);
    const target = Math.max(...pts.map(dist));
    expect(dist(pts[0]!)).toBeCloseTo(target, 1);
    expect(target).toBeLessThanOrEqual(111);
  });
  it('schreibt einen ruhigen Satz darunter', () => {
    render(<MuscleRadar chart={chart} />);
    expect(screen.getByText(chartSentence(chart))).toBeTruthy();
  });
});

describe('im Chat', () => {
  const NOW = new Date(2026, 10, 29, 12).getTime();
  const rec = (id: string, body: object): TrackedRecord => ({ kind: 'chat', id, updatedMs: 1, deleted: false, body });
  it('zeigt das Diagramm unter Bos Nachricht', async () => {
    const { port } = fakePort([rec('m1', { role: 'coach', text: 'So sah dein Monat aus.', atMs: NOW - 5000, chart })]);
    render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
    const dlg = await openChat();
    expect(await within(dlg).findByRole('img', { name: /Spinnennetz/ })).toBeTruthy();
    expect(within(dlg).getByText(chartSentence(chart))).toBeTruthy();
  });
  it('liest eine unbekannte Art ohne Diagramm, die Nachricht bleibt', async () => {
    const { port } = fakePort([rec('m1', { role: 'coach', text: 'Hallo da.', atMs: NOW - 5000, chart: { kind: 'herz' } })]);
    render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
    const dlg = await openChat();
    expect(await within(dlg).findByText('Hallo da.')).toBeTruthy();
    expect(within(dlg).queryByRole('img', { name: /Spinnennetz/ })).toBeNull();
  });
});
