import { useState } from 'react';
import type { RideDetail } from '../../coach/protocol';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** One chart per measure: two scales in one would suggest false correlations. */
const LineChart = ({ title, unit, points }: { title: string; unit: string; points: { t: number; v: number | null }[] }) => {
  const [hover, setHover] = useState<number | null>(null);
  const known = points.flatMap((p) => (p.v === null ? [] : [p.v]));
  if (!known.length) return <p className="muted">{title}: keine Daten</p>;
  const max = Math.max(...known) * 1.05;
  const end = points.at(-1)!.t || 1;
  const x = (t: number) => (t / end) * 1000;
  const y = (v: number) => 100 - (v / max) * 96;
  let d = '', pen = false;
  for (const p of points) {
    if (p.v === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`;
    pen = true;
  }
  const avg = Math.round(known.reduce((a, b) => a + b, 0) / known.length);
  const shown = hover === null ? null : points[hover];
  return (
    <div className="line-chart">
      <p className="chart-readout">{title}: {shown ? <><b>{shown.v ?? '–'} {unit}</b> bei {mmss(shown.t)}</> : <><b>{avg} {unit}</b> im Schnitt</>}</p>
      <div
        className="line-plot" role="img" aria-label={`${title}, im Schnitt ${avg} ${unit}`}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1))))); }}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none"><path d={d} /></svg>
        {shown && <div className="crosshair" style={{ left: `${x(shown.t) / 10}%` }} />}
      </div>
    </div>
  );
};

export const RideCharts = ({ detail }: { detail: RideDetail }) => (
  <>
    <LineChart title="Leistung" unit="W" points={detail.points.map((p) => ({ t: p.t, v: p.powerW }))} />
    <LineChart title="Puls" unit="bpm" points={detail.points.map((p) => ({ t: p.t, v: p.hrBpm }))} />
    <LineChart title="Trittfrequenz" unit="U/min" points={detail.points.map((p) => ({ t: p.t, v: p.cadenceRpm }))} />
  </>
);
