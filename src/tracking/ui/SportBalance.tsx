import type { SportKey } from '../../shared/personal';
import { actualShares, hasTarget, sportChartSentence, sportChartSummary, SPORT_NAME, type SportChart } from '../../shared/sport-chart';

/** The sport classes of the statistics page: strength, bike, run. */
const CLASS: Record<SportKey, string> = { gym: 'tk-sport-strength', bike: 'tk-sport-bike', run: 'tk-sport-run' };

const Bar = ({ label, shares, parts, thin }: { label: string; shares: Record<SportKey, number>; parts: SportChart['parts']; thin?: boolean }) => (
  <div className={`tk-sportbar${thin ? ' thin' : ''}`}>
    <span className="tk-sportbar-label">{label}</span>
    <span className="tk-sportbar-track">
      {parts.filter((p) => shares[p.sport] > 0).map((p) => <span key={p.sport} className={`tk-sportbar-seg ${CLASS[p.sport]}`} style={{ width: `${shares[p.sport] * 100}%` }} />)}
    </span>
  </div>
);

/**
 * "Ausdauer und Kraft": the share of training time per sport as a calm stacked bar ("So war es") next to a thinner one with
 * the share the goal asks for ("Dein Ziel"). No numbers are drawn; the legend names the sports and one sentence in words
 * stands under it.
 */
export function SportBalance({ chart }: { chart: SportChart }) {
  const actual = actualShares(chart);
  const goal = Object.fromEntries(chart.parts.map((p) => [p.sport, p.target])) as Record<SportKey, number>;
  return (
    <figure className="tk-sportbalance">
      <div role="img" aria-label={sportChartSummary(chart)} className="tk-sportbars">
        <Bar label="So war es" shares={actual} parts={chart.parts} />
        {hasTarget(chart) && <Bar label="Dein Ziel" shares={goal} parts={chart.parts} thin />}
      </div>
      <ul className="tk-sportlegend" aria-hidden="true">
        {chart.parts.map((p) => <li key={p.sport}><span className={`tk-sportlegend-dot ${CLASS[p.sport]}`} />{SPORT_NAME[p.sport]}</li>)}
      </ul>
      <figcaption className="tk-radar-note">{sportChartSentence(chart)}</figcaption>
    </figure>
  );
}
