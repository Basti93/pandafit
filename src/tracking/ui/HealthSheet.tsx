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
  const digits = hi < 30 ? 1 : 0;
  const num = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (
    <figure className="tk-spark">
      <figcaption className="muted tk-small">{series.label}</figcaption>
      <div className="tk-spark-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.label} preserveAspectRatio="none">
          {runs.filter((r) => r.length > 1).map((r, i) => <polyline key={i} className="tk-spark-line" points={r.join(' ')} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
        </svg>
        <span className="tk-spark-scale" aria-hidden="true"><span>{num(hi)}</span><span>{num(lo)}</span></span>
      </div>
    </figure>
  );
}

/** "Currier et al. 2023, PMID 37414459" without the identifier: who and when stays, the number goes. */
const cite = (c: string): string => c.replace(/,?\s*(DOI|PMID)\s+\S+$/, '');

function SourcesSheet({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Sheet title="Quellen" onClose={onClose} onBack={onBack}>
      <p className="muted tk-small">Diese Studien und Empfehlungen stehen hinter den Sätzen. Sie sind Orientierung, keine Diagnose.</p>
      <RowList label="Quellen">
        {healthSources().map((s) => (
          <Row key={s.id} title={<span className="tk-source-title">{s.endpoint}</span>} expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
            <p className="muted tk-small">{cite(s.citation)}. {s.limits}</p>
            <p className="tk-small tk-sources"><a href={s.url} target="_blank" rel="noopener noreferrer">Zur Quelle</a></p>
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
  if (sources) return <SourcesSheet onClose={onClose} onBack={() => setSources(false)} />;
  const doctor = doctorFinding(health);
  const rows = healthRows(health);
  const rhr = rows.find((r) => r.key === 'rhr');
  return (
    <Sheet title="Gesundheit" onClose={onClose}>
      {/* A warning stands alone: no calm overall sentence beside it. The card leads to the row it is about. */}
      {doctor ? (
        <div className="tk-note">
          <RowList label="Hinweis"><Row title={<span className="tk-health-doctor">{doctor.text}</span>} onClick={rhr ? () => setOpen('rhr') : undefined} /></RowList>
        </div>
      ) : (
        <>
          <p className="tk-health-line">{firstLine(health)}</p>
          {standLine(health) && <p className="muted tk-small">{standLine(health)}</p>}
        </>
      )}
      {rows.length > 0 && (
        <RowList>
          {rows.map((r) => (
            <Row key={r.key} title={r.title} value={r.word} expanded={open === r.key} onClick={() => setOpen(open === r.key ? null : r.key)}>
              <p>{r.sentence}</p>
              {r.facts.map((f) => <p key={f} className="muted tk-small">{f}</p>)}
              {r.series.map((s) => <Spark key={s.label} series={s} />)}
            </Row>
          ))}
        </RowList>
      )}
      <p className="muted tk-small tk-health-foot">Keine Diagnose · <button type="button" className="link" onClick={() => setSources(true)}>Quellen ›</button></p>
    </Sheet>
  );
}
