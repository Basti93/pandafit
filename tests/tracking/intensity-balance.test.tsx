// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { CoachScreen } from '../../src/tracking/ui/CoachScreen';
import { IntensityBalance } from '../../src/tracking/ui/IntensityBalance';
import { intensityChartSentence, intensityChartSummary, type IntensityChart } from '../../src/shared/intensity-chart';
import type { MuscleChart } from '../../src/shared/muscle-chart';
import type { TrackedRecord } from '../../src/shared/records';
import { fakePort } from './fake-port';
import { openChat } from './open-chat';

afterEach(cleanup);

const chart: IntensityChart = {
  kind: 'intensity', fromMs: 0, toMs: 28 * 86_400_000, weeks: 4,
  strength: { perWeek: 1.5, min: 2, max: 3 }, endurance: { perWeek: 200, min: 150, max: 300 }, hard: { perWeek: 2, min: 1, max: 1 },
};

describe('IntensityBalance', () => {
  it('ist ein Bild mit Zusammenfassung in Worten', () => {
    render(<IntensityBalance chart={chart} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe(intensityChartSummary(chart));
    expect(img.getAttribute('aria-label')).toMatch(/Training und Intensität/);
  });
  it('zeigt drei Zeilen mit Balken vor einem Zielbereich', () => {
    const { container } = render(<IntensityBalance chart={chart} />);
    const rows = container.querySelectorAll('.tk-intensity-row');
    expect(rows).toHaveLength(3);
    for (const n of ['Kraft', 'Ausdauer', 'Intensiv']) expect(screen.getByText(n)).toBeTruthy();
    for (const r of rows) {
      expect(r.querySelectorAll('.tk-intensity-band')).toHaveLength(1);
      const bar = r.querySelector('.tk-intensity-bar') as HTMLElement;
      expect(parseFloat(bar.style.width)).toBeGreaterThan(0);
      expect(parseFloat(bar.style.width)).toBeLessThanOrEqual(100);
    }
  });
  it('zeichnet einen Balken über dem Zielbereich weiter rechts als dessen Ende', () => {
    const { container } = render(<IntensityBalance chart={chart} />);
    const hard = container.querySelectorAll('.tk-intensity-row')[2]!;
    const band = hard.querySelector('.tk-intensity-band') as HTMLElement, bar = hard.querySelector('.tk-intensity-bar') as HTMLElement;
    expect(parseFloat(bar.style.width)).toBeGreaterThan(parseFloat(band.style.left));
  });
  it('streut keine Zahlen auf die Balken', () => {
    const { container } = render(<IntensityBalance chart={chart} />);
    expect(container.textContent).not.toMatch(/\d/);
  });
  it('schreibt einen ruhigen Satz darunter', () => {
    render(<IntensityBalance chart={chart} />);
    expect(screen.getByText(intensityChartSentence(chart))).toBeTruthy();
  });
});

describe('im Chat', () => {
  const NOW = new Date(2026, 10, 29, 12).getTime();
  const rec = (id: string, body: object): TrackedRecord => ({ kind: 'chat', id, updatedMs: 1, deleted: false, body });
  const muscles: MuscleChart = { kind: 'muskeln', fromMs: 0, toMs: 1, axes: ['chest', 'back', 'abs'].map((group) => ({ group: group as 'chest', sets: 3, min: 1, max: 4 })) };
  it('zeigt das Intensitäts-Diagramm unter Bos Nachricht', async () => {
    const { port } = fakePort([rec('m1', { role: 'coach', text: 'So war dein Monat.', atMs: NOW - 5000, chart })]);
    render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
    const dlg = await openChat();
    expect(await within(dlg).findByRole('img', { name: /Training und Intensität/ })).toBeTruthy();
    expect(within(dlg).getByText(intensityChartSentence(chart))).toBeTruthy();
  });
  it('zeigt mehrere Diagramme einer Nachricht nacheinander', async () => {
    const { port } = fakePort([rec('m1', { role: 'coach', text: 'Dein Monat.', atMs: NOW - 5000, chart: muscles, charts: [muscles, chart] })]);
    render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
    const dlg = await openChat();
    expect(await within(dlg).findByRole('img', { name: /Spinnennetz/ })).toBeTruthy();
    expect(within(dlg).getByRole('img', { name: /Training und Intensität/ })).toBeTruthy();
  });
  it('liest eine alte Karte der Art sport ohne Fehler und lässt sie weg', async () => {
    const old = { kind: 'sport', fromMs: 0, toMs: 1, parts: [{ sport: 'gym', minutes: 60, target: 0.5 }, { sport: 'bike', minutes: 60, target: 0.5 }] };
    const { port } = fakePort([rec('m1', { role: 'coach', text: 'Dein alter Monat.', atMs: NOW - 5000, chart: old })]);
    render(<CoachScreen port={port} now={() => NOW} newId={() => 'x'} />);
    const dlg = await openChat();
    expect(await within(dlg).findByText('Dein alter Monat.')).toBeTruthy();
    expect(within(dlg).queryByRole('img')).toBeNull();
  });
});
