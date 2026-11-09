import { useState } from 'react';
import type { HealthBody } from '../../shared/health';
import { cardText, doctorFinding, firstLine, healthRows, healthSources, SLEEP_HINT, standLine, type HealthRow, type HealthRowKey, type HealthSeries } from './health-view';
import { Card, Icon, Kicker, PageHead, Row, RowList, Sheet, WordTile } from './kit';

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

function SourcesSheet({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Sheet title="Quellen" onClose={onClose} onBack={onClose}>
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

/** The health card of Woche: one sentence, the areas as words, a way to the page. A doctor hint always leads. No numbers here. */
export function HealthCard({ health, onOpen }: { health: HealthBody; onOpen: () => void }) {
  const { doctor, line } = cardText(health);
  const tiles = healthRows(health).filter((r) => r.key === 'rhr' || r.key === 'vo2' || r.key === 'move');
  return (
    <Card label="Gesundheit">
      <Kicker>Gesundheit</Kicker>
      {doctor ? <p className="tk-note">{doctor}</p> : <p className="tk-health-line">{line}</p>}
      {tiles.length > 0 && (
        <div className="tk-wordtiles">
          {tiles.map((r) => <WordTile key={r.key} icon={r.icon} label={r.short} word={r.word} tone={r.tone} />)}
        </div>
      )}
      <div className="tk-mainactions"><button type="button" className="secondary" onClick={onOpen}>Gesundheit ansehen ›</button></div>
    </Card>
  );
}

function AreaCard({ row, doctorText, onOpen }: { row: HealthRow; doctorText?: string; onOpen: () => void }) {
  return (
    <Card label={row.title}>
      <div className="tk-health-area">
        <span className="tk-rowcard-tile" aria-hidden="true"><Icon name={row.icon} size={24} /></span>
        <div className="tk-health-area-text">
          <Kicker>{row.title}</Kicker>
          <p className={`tk-wordtile-word tk-health-word ${row.tone}`}>{row.word}</p>
        </div>
      </div>
      {doctorText && <p className="tk-note">{doctorText}</p>}
      <p>{row.sentence}</p>
      <div className="tk-mainactions"><button type="button" className="secondary" onClick={onOpen}>Verlauf</button></div>
    </Card>
  );
}

/** Health as its own page under Woche: read only, one card per area, never a diagnosis. */
export function HealthPage({ health, onBack }: { health: HealthBody; onBack: () => void }) {
  const [open, setOpen] = useState<HealthRowKey | null>(null);
  const [sources, setSources] = useState(false);
  const doctor = doctorFinding(health);
  const rows = healthRows(health);
  const hasRhr = rows.some((r) => r.key === 'rhr');
  const opened = rows.find((r) => r.key === open);
  return (
    <div className="tk-screen tk-health">
      <PageHead title="Gesundheit" back={{ label: 'Woche', onClick: onBack }} />
      <Card>
        <Kicker>{standLine(health)}</Kicker>
        {/* A warning stands alone: no calm overall sentence beside it. */}
        {doctor ? hasRhr && <p className="tk-health-line">Hier siehst du, wie es in den einzelnen Bereichen aussieht.</p> : <p className="tk-health-line">{firstLine(health)}</p>}
        {doctor && !hasRhr && <p className="tk-note">{doctor.text}</p>}
      </Card>
      {rows.map((r) => <AreaCard key={r.key} row={r} doctorText={r.key === 'rhr' ? doctor?.text : undefined} onOpen={() => setOpen(r.key)} />)}
      {!rows.some((r) => r.key === 'sleep') && (
        <Card label="Schlaf & HRV">
          <div className="tk-health-area">
            <span className="tk-rowcard-tile" aria-hidden="true"><Icon name="mond" size={24} /></span>
            <div className="tk-health-area-text"><Kicker>Schlaf & HRV</Kicker></div>
          </div>
          <p>{SLEEP_HINT}</p>
        </Card>
      )}
      <Card soft label="Gut zu wissen">
        <Kicker>Gut zu wissen</Kicker>
        <p>Diese Seite ist Orientierung und keine Diagnose. Liegt dein Ruhepuls länger deutlich über deinem üblichen Wert, sagt Pandafit es dir hier und rät dir, das ärztlich abklären zu lassen.</p>
        <div className="tk-mainactions"><button type="button" className="secondary" onClick={() => setSources(true)}>Quellen ansehen</button></div>
      </Card>
      {opened && (
        <Sheet title={opened.title} size="small" onClose={() => setOpen(null)}>
          {opened.facts.map((f) => <p key={f} className="muted tk-small">{f}</p>)}
          {opened.series.map((s) => <Spark key={s.label} series={s} />)}
        </Sheet>
      )}
      {sources && <SourcesSheet onClose={() => setSources(false)} />}
    </div>
  );
}
