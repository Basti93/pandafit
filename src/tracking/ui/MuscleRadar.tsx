import type { MuscleGroup } from '../../shared/muscle-targets';
import { chartSentence, chartSummary, type MuscleChart } from '../../shared/muscle-chart';

/** Short German axis names; the radar has little room at phone width. */
const SHORT: Record<MuscleGroup, string> = {
  chest: 'Brust', back: 'Rücken', front_delts: 'Schulter vorn', side_delts: 'Schulter seitlich', rear_delts: 'Schulter hinten',
  biceps: 'Bizeps', triceps: 'Trizeps', quads: 'Bein vorn', hamstrings: 'Bein hinten', glutes: 'Gesäß', calves: 'Waden', abs: 'Bauch', traps: 'Nacken', forearms: 'Unterarme', other: 'Sonstiges',
};

const W = 460, H = 320, CX = W / 2, CY = H / 2;
/** The upper end of the target range sits on this ring; a group may reach 1.4 times that before it sits at the rim. */
const RING = 70;
const OVER = 1.4;
const LABEL_R = RING * OVER + 14;
const num = (n: number) => Math.round(n * 10) / 10;

/**
 * The "Spinnennetz": one axis per muscle group, the person's shape filled softly, the target range as a faint band. Every
 * axis is scaled to its own target, so a group at the top of its range lies on the ring whatever its size. No numbers are
 * drawn; one calm sentence in words stands under it.
 */
export function MuscleRadar({ chart }: { chart: MuscleChart }) {
  const n = chart.axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i: number, r: number): [number, number] => [num(CX + r * Math.cos(angle(i))), num(CY + r * Math.sin(angle(i)))];
  const radius = (share: number) => (RING * Math.min(Math.max(share, 0), OVER)) / 1;
  const points = (rs: number[]) => rs.map((r, i) => at(i, r).join(',')).join(' ');
  const poly = (rs: number[]) => `M${rs.map((r, i) => at(i, r).join(',')).join('L')}Z`;
  const share = (v: number, max: number) => (max > 0 ? v / max : 0);
  const shape = chart.axes.map((a) => radius(share(a.sets, a.max)));
  const outer = chart.axes.map(() => RING);
  const inner = chart.axes.map((a) => radius(Math.min(share(a.min, a.max), 1)));
  return (
    <figure className="tk-radar">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chartSummary(chart)} focusable="false">
        <path className="tk-radar-band" d={`${poly(outer)}${poly(inner)}`} fillRule="evenodd" />
        {chart.axes.map((a, i) => <line key={a.group} className="tk-radar-spoke" x1={CX} y1={CY} x2={at(i, RING * OVER)[0]} y2={at(i, RING * OVER)[1]} />)}
        <polygon className="tk-radar-ring" points={points(outer)} />
        <polygon className="tk-radar-shape" points={points(shape)} />
        {chart.axes.map((a, i) => {
          const [x, y] = at(i, LABEL_R);
          const c = Math.cos(angle(i));
          return <text key={a.group} className="tk-radar-label" x={x} y={y} textAnchor={Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end'} dominantBaseline="central">{SHORT[a.group]}</text>;
        })}
      </svg>
      <figcaption className="tk-radar-note">{chartSentence(chart)}</figcaption>
    </figure>
  );
}
