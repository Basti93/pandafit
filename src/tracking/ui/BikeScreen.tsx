import { useState } from 'react';
import type { BikeBlock, BikeBody, RideBody } from '../../shared/bike';
import { dayMonthLongOfKey, dayMonthOfKey, shortDate, timeLabel, weekdayOfKey } from '../../shared/dates';
import { HARDNESS_LABEL, nextPlanDate } from '../../shared/week-plan';
import { dateKeyOf } from './run-view';
import type { TrackingPort } from '../ports';
import { bikeOf, bikeTrendSentence, blockBand, blockWatts, ftpSentence, phaseText, rideFacts, rideName, rideValue, ridesOf, type BikeRide } from './bike-view';
import { usePortRecords } from './hooks';
import { useSportWeek } from './sport-week';
import { Band, BoBubble, MainCard, Row, RowCard, RowList, Sheet, StandCard } from './kit';

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
  const powers = pts.map((p) => p.powerW).filter((v): v is number => v !== null);
  const hrs = pts.map((p) => p.hrBpm).filter((v): v is number => v !== null);
  const num = (v: number) => Math.round(v).toLocaleString('de-DE');
  return (
    <figure className="tk-ridechart" aria-label="Verlauf der Fahrt">
      <p className="tk-chart-legend tk-small"><span className="tk-chart-key-power">Leistung</span> · <span className="tk-chart-key-hr">Puls{hrs.length > 1 ? ` ${num(Math.min(...hrs))}–${num(Math.max(...hrs))}` : ''}</span></p>
      <div className="tk-spark-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Leistung und Puls über die Fahrt" preserveAspectRatio="none">
        <polyline className="tk-chart-hr" points={line((p) => p.hrBpm)} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline className="tk-chart-power" points={line((p) => p.powerW, true)} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {powers.length > 1 && <span className="tk-spark-scale" aria-hidden="true"><span>{num(Math.max(...powers))} W</span><span>0</span></span>}
      </div>
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

function PlanSheet({ blocks, name, ftpW, onClose }: { blocks: BikeBlock[]; name: string; ftpW: number | null; onClose: () => void }) {
  return (
    <Sheet title={name} size="small" onClose={onClose}>
      <RowList label="Ablauf">{blocks.map((b, i) => <Row key={i} title={b.label} value={blockWatts(b, ftpW) ?? undefined} />)}</RowList>
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
          <p className="muted tk-small tk-hourdates"><span>{dayMonthOfKey(weeks[0]!.week)}</span><span>{dayMonthOfKey(weeks[weeks.length - 1]!.week)}: {String(weeks[weeks.length - 1]!.hours).replace('.', ',')} Std.</span></p>
        </section>
      )}
    </Sheet>
  );
}

/** The bike on the phone: read only. The week stand, what is planned next, the development, the last ride. */
export function BikeScreen({ port, now }: { port: TrackingPort; now?: () => number }) {
  const bike = bikeOf(usePortRecords(port, 'bike').records);
  const rides = ridesOf(usePortRecords(port, 'ride').records);
  const [sheet, setSheet] = useState<'plan' | 'development' | null>(null);
  const [ride, setRide] = useState<BikeRide | null>(null);
  const weekplans = usePortRecords(port, 'weekplan').records;
  const nowMs = now ? now() : Date.now();
  const week = useSportWeek(port, nowMs, 'rad');
  const next = bike?.next ?? null;
  // The main card names its day: "Heute" or the weekday and date of the next bike day in the week plan.
  const todayKey = dateKeyOf(nowMs);
  const bikeDate = weekplans ? nextPlanDate(weekplans, todayKey, 'bike') : null;
  const day = bikeDate === null ? null : bikeDate === todayKey ? 'Heute' : `${weekdayOfKey(bikeDate)}, ${dayMonthLongOfKey(bikeDate)}`;
  const last = rides[0];
  const hasBlocks = !!next && next.blocks.length > 0;
  return (
    <div className="tk-screen">
      {week.loaded && <StandCard kicker="Rad · diese Woche" text={week.text} marks={week.marks} marksLabel={week.label} />}
      {next && (
        <MainCard kicker={day ?? 'Nächste Fahrt'} title={next.name} label="Nächste Fahrt"
          text={`${Math.round(next.minutes)} Minuten, ${HARDNESS_LABEL[next.hardness]}. Du fährst sie in der Mac-App.`}
          more={hasBlocks ? <Band label={`Ablauf: ${next.blocks.map((b) => b.label).join(', ')}`} parts={blockBand(next.blocks)} /> : undefined}
          primary={hasBlocks ? { label: 'Ablauf ansehen', onClick: () => setSheet('plan') } : undefined} />
      )}
      {next?.reason && <BoBubble portrait="mini">{next.reason}</BoBubble>}
      {bike && <RowCard icon="entwicklung" kicker="Deine Entwicklung" title={bikeTrendSentence(bike) ?? 'Entwicklung ansehen'} onClick={() => setSheet('development')} />}
      {last && <RowCard icon="ausdauer" kicker={`Letzte Fahrt · ${weekdayOfKey(dateKeyOf(last.body.startedAtMs))}`} title={`${rideName(last.body)}, ${Math.round(last.body.durationS / 60)} Minuten`} onClick={() => setRide(last)} />}
      {sheet === 'plan' && next && <PlanSheet name={next.name} blocks={next.blocks} ftpW={bike?.ftpW ?? null} onClose={() => setSheet(null)} />}
      {sheet === 'development' && bike && <DevelopmentSheet bike={bike} onClose={() => setSheet(null)} />}
      {ride && <RideSheet ride={ride} onClose={() => setRide(null)} />}
    </div>
  );
}
