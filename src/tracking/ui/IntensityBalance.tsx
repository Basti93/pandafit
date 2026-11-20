import { intensityChartSentence, intensityChartSummary, ROW_KEYS, ROW_NAME, type IntensityChart, type IntensityRow } from '../../shared/intensity-chart';

/** The track holds 1.4 times the upper edge of the band, or more when the week average is higher. */
const scaleOf = (r: IntensityRow): number => Math.max(r.max * 1.4, r.perWeek * 1.05, r.min * 1.4, 1);
const pct = (v: number, scale: number): string => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;

/**
 * "Training und Intensität": three rows (Kraft, Ausdauer, Intensiv). Each shows the weekly average as a bar against a faint
 * band for the goal's target. No numbers are drawn; one sentence in words stands under the rows.
 */
export function IntensityBalance({ chart }: { chart: IntensityChart }) {
  return (
    <figure className="tk-intensity">
      <div role="img" aria-label={intensityChartSummary(chart)} className="tk-intensity-rows">
        {ROW_KEYS.map((k) => {
          const r = chart[k], scale = scaleOf(r);
          return (
            <div key={k} className="tk-intensity-row">
              <span className="tk-intensity-label">{ROW_NAME[k]}</span>
              <span className="tk-intensity-track">
                <span className="tk-intensity-band" style={{ left: pct(r.min, scale), width: r.floorOnly ? `calc(100% - ${pct(r.min, scale)})` : `calc(${pct(r.max, scale)} - ${pct(r.min, scale)})` }} />
                <span className="tk-intensity-bar" style={{ width: pct(r.perWeek, scale) }} />
              </span>
            </div>
          );
        })}
      </div>
      <figcaption className="tk-radar-note">{intensityChartSentence(chart)}</figcaption>
    </figure>
  );
}
