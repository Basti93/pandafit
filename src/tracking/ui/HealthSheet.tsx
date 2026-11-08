import { useState } from 'react';
import type { HealthBody } from '../../shared/health';
import { doctorFinding, firstLine, healthRows, standLine, healthSources, type HealthSeries } from './health-view';
import { Row, RowList, Sheet } from './kit';

const W = 300, H = 48;

/** A thin line, no axes: it only shows the direction. A gap in the data breaks the line. */
function Spark({ series }: { series: HealthSeries }) {
  const vals = series.values.filter((v): v is number => v !== null);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(1e-6, hi - lo);
  const n = series.values.length;
  const runs: string[][] = [[]];
  series.values.forEach((v, i) => {
    if (v === null) { if (runs.at(-1)!.length) runs.push([]); return; }
    runs.at(-1)!.push(`${((i / Math.max(1, n - 1)) * W).toFixed(1)},${(H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1)}`);
  });
  return (
    <figure className="tk-spark">
      <figcaption className="muted tk-small">{series.label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.label} preserveAspectRatio="none">
        {runs.filter((r) => r.length > 1).map((r, i) => <polyline key={i} className="tk-spark-line" points={r.join(' ')} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
      </svg>
    </figure>
  );
}

function SourcesSheet({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Sheet title="Quellen" onClose={onClose}>
      <p className="muted tk-small">Diese Studien und Empfehlungen stehen hinter den Sätzen. Sie sind Orientierung, keine Diagnose.</p>
      <RowList label="Quellen">
        {healthSources().map((s) => (
          <Row key={s.id} title={<span className="tk-source-title">{s.citation}</span>} expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
            <p className="muted tk-small">{s.endpoint}. {s.limits}</p>
            <p className="tk-small"><a href={s.url} target="_blank" rel="noopener noreferrer">Zur Quelle</a></p>
          </Row>
        ))}
      </RowList>
    </Sheet>
  );
}

/** Health on the phone: read only. A calm line first, then up to four rows; numbers and lines sit in the opened row. It never diagnoses. */
export function HealthSheet({ health, onClose }: { health: HealthBody; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sources, setSources] = useState(false);
  if (sources) return <SourcesSheet onClose={() => setSources(false)} />;
  const doctor = doctorFinding(health);
  const rows = healthRows(health);
  return (
    <Sheet title="Gesundheit" onClose={onClose}>
      {doctor && <RowList label="Hinweis"><Row title={<span className="tk-health-doctor">{doctor.text}</span>} /></RowList>}
      <p className="tk-health-line">{firstLine(health)}</p>
      {standLine(health) && <p className="muted tk-small">{standLine(health)}</p>}
      {rows.length > 0 && (
        <RowList>
          {rows.map((r) => (
            <Row key={r.key} title={r.title} expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)}>
              <p>{r.sentence}</p>
              {r.facts.map((f) => <p key={f} className="muted tk-small">{f}</p>)}
              {r.series.map((s) => <Spark key={s.label} series={s} />)}
            </Row>
          ))}
        </RowList>
      )}
      <p className="muted tk-small">Keine Diagnose. Grundlage: WHO-Empfehlungen und Studien zu Ruhepuls, Fitness und Schritten.</p>
      <button type="button" className="link" onClick={() => setSources(true)}>Quellen ›</button>
    </Sheet>
  );
}
