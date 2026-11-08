import { useState } from 'react';
import type { BikeBody, RideBody } from '../../shared/bike';
import { dayMonthOfKey, shortDate, timeLabel } from '../../shared/dates';
import { HARDNESS_LABEL } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { bikeOf, ftpSentence, minText, phaseText, rideFacts, rideName, rideTitle, rideValue, ridesByMonth, ridesOf, type BikeRide } from './bike-view';
import { usePortRecords } from './hooks';
import { PageHead, Row, RowList, Sheet } from './kit';

const W = 300, H = 90;

/** Power in the accent colour, heart rate muted in its own scale; only the start and end time are written. */
function RideChart({ ride }: { ride: RideBody }) {
  const pts = ride.curve;
  if (pts.length < 2) return null;
  const tMax = Math.max(1, pts[pts.length - 1]!.t);
  const line = (pick: (p: (typeof pts)[number]) => number | null, zero = false): string => {
    const vals = pts.map(pick).filter((v): v is number => v !== null);
    if (vals.length < 2) return '';
    // Power starts at zero so small swings stay small; the pulse has its own scale.
    const lo = zero ? 0 : Math.min(...vals) - 10, hi = Math.max(...vals) * (zero ? 1.1 : 1), span = Math.max(1, hi - lo);
    return pts.flatMap((p) => { const v = pick(p); return v === null ? [] : [`${((p.t / tMax) * W).toFixed(1)},${(H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1)}`]; }).join(' ');
  };
  return (
    <figure className="tk-ridechart" aria-label="Verlauf der Fahrt">
      <p className="tk-chart-legend tk-small"><span className="tk-chart-key-power">Leistung</span> · <span className="tk-chart-key-hr">Puls</span></p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Leistung und Puls über die Fahrt" preserveAspectRatio="none">
        <polyline className="tk-chart-hr" points={line((p) => p.hrBpm)} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline className="tk-chart-power" points={line((p) => p.powerW, true)} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="muted tk-small"><span>{timeLabel(ride.startedAtMs)}</span><span>{timeLabel(ride.startedAtMs + ride.durationS * 1000)}</span></figcaption>
    </figure>
  );
}

export function RideSheet({ ride, onClose }: { ride: BikeRide; onClose: () => void }) {
  const r = ride.body;
  return (
    <Sheet title={rideName(r)} onClose={onClose}>
      <div className="tk-ridehead">
        <p className="muted">{shortDate(r.startedAtMs)} · {rideValue(r)}</p>
        <p className="muted tk-ridefacts">{rideFacts(r)}</p>
        {r.debrief && <p>{r.debrief}</p>}
      </div>
      <RideChart ride={r} />
    </Sheet>
  );
}

function PlanSheet({ blocks, name, onClose }: { blocks: { label: string }[]; name: string; onClose: () => void }) {
  return (
    <Sheet title={name} size="small" onClose={onClose}>
      <RowList label="Aufbau">{blocks.map((b, i) => <Row key={i} title={b.label} />)}</RowList>
    </Sheet>
  );
}

function DevelopmentSheet({ bike, onClose }: { bike: BikeBody; onClose: () => void }) {
  const phase = phaseText(bike);
  const weeks = bike.weekHours;
  const max = Math.max(1, ...weeks.map((w) => w.hours));
  return (
    <Sheet title="Entwicklung" onClose={onClose}>
      <p className="tk-week-line">{ftpSentence(bike)}</p>
      {phase && <p>{phase}</p>}
      {phase && bike.phase?.goal && <p className="muted tk-small">{bike.phase.goal}</p>}
      {weeks.length > 0 && (
        <section aria-label="Stunden pro Woche">
          <h3 className="tk-section">Stunden pro Woche</h3>
          <div className="tk-hourbars">
            {weeks.map((w) => <span key={w.week} className="tk-hourbar" role="img" aria-label={`${dayMonthOfKey(w.week)}: ${String(w.hours).replace('.', ',')} Std.`} style={{ height: `${Math.max(3, (w.hours / max) * 100)}%` }} />)}
          </div>
          <p className="muted tk-small tk-hourdates"><span>{dayMonthOfKey(weeks[0]!.week)}</span><span>{dayMonthOfKey(weeks[weeks.length - 1]!.week)}</span></p>
        </section>
      )}
    </Sheet>
  );
}

function RidesSheet({ rides, onOpen, onClose }: { rides: BikeRide[]; onOpen: (r: BikeRide) => void; onClose: () => void }) {
  return (
    <Sheet title="Fahrten" onClose={onClose}>
      {ridesByMonth(rides).map((g) => (
        <section key={g.month} aria-label={g.month}>
          <h3 className="tk-section">{g.month}</h3>
          <RowList>{g.rides.map((r) => <Row key={r.id} title={rideTitle(r.body)} value={minText(r.body.durationS / 60)} onClick={() => onOpen(r)} />)}</RowList>
        </section>
      ))}
    </Sheet>
  );
}

/** The bike on the phone: read only. What is planned next, the last ride, the development and the rides. */
export function BikeScreen({ port }: { port: TrackingPort }) {
  const bike = bikeOf(usePortRecords(port, 'bike').records);
  const rides = ridesOf(usePortRecords(port, 'ride').records);
  const [sheet, setSheet] = useState<'plan' | 'development' | 'rides' | null>(null);
  const [ride, setRide] = useState<BikeRide | null>(null);
  const next = bike?.next ?? null;
  const last = rides[0];
  return (
    <div className="tk-screen tk-bike">
      <PageHead title="Rad" />
      {next ? (
        <section className="card" aria-label="Nächste Fahrt">
          <p className="tk-today-line"><b>{next.name}</b> · {minText(next.minutes)} · {HARDNESS_LABEL[next.hardness]}</p>
          {next.reason && <p className="muted tk-clamp">{next.reason}</p>}
        </section>
      ) : <p className="muted">Noch keine Fahrt geplant.</p>}
      <RowList>
        {next && next.blocks.length > 0 && <Row title="Aufbau" onClick={() => setSheet('plan')} />}
        {bike && <Row title="Entwicklung" onClick={() => setSheet('development')} />}
        {rides.length > 0 && <Row title="Fahrten" onClick={() => setSheet('rides')} />}
      </RowList>
      {last && (
        <section aria-label="Letzte Fahrt">
          <h3 className="tk-section">Letzte Fahrt</h3>
          <RowList><Row title={rideTitle(last.body)} value={rideValue(last.body)} onClick={() => setRide(last)} /></RowList>
        </section>
      )}
      {sheet === 'plan' && next && <PlanSheet name={next.name} blocks={next.blocks} onClose={() => setSheet(null)} />}
      {sheet === 'development' && bike && <DevelopmentSheet bike={bike} onClose={() => setSheet(null)} />}
      {sheet === 'rides' && !ride && <RidesSheet rides={rides} onOpen={setRide} onClose={() => setSheet(null)} />}
      {ride && <RideSheet ride={ride} onClose={() => setRide(null)} />}
    </div>
  );
}
