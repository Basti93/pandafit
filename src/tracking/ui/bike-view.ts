import { BIKE_ID, readBike, readRideBody, type BikeBody, type RideBody } from '../../shared/bike';
import { shortDate } from '../../shared/dates';
import type { TrackedRecord } from '../../shared/records';
import { HARDNESS_LABEL } from '../../shared/week-plan';

export type BikeRide = { id: string; body: RideBody };

/** The published plan, or null without one (or when it is not whole). */
export const bikeOf = (records: TrackedRecord[] | null): BikeBody | null => {
  const r = (records ?? []).find((x) => x.id === BIKE_ID && !x.deleted);
  return r ? readBike(r.body) : null;
};

/** The counted rides, newest first; a removed or broken one is skipped. */
export const ridesOf = (records: TrackedRecord[] | null): BikeRide[] =>
  (records ?? []).flatMap((r) => { const body = r.deleted ? null : readRideBody(r.body); return body ? [{ id: r.id, body }] : []; })
    .sort((a, b) => b.body.startedAtMs - a.body.startedAtMs);

/** The Ausdauer tab shows Rad when there is a plan to ride or at least one ride. */
export const hasBike = (bike: BikeBody | null, rides: BikeRide[]): boolean => (bike !== null && bike.next !== null) || rides.length > 0;

export const minText = (minutes: number): string => `${Math.round(minutes)} Min`;
export const rideName = (r: RideBody): string => r.sessionName ?? 'Fahrt';

/** "Di., 3. Nov. · Grundlage" */
export const rideTitle = (r: RideBody): string => `${shortDate(r.startedAtMs)} · ${rideName(r)}`;
/** "52 Min · locker" */
export const rideValue = (r: RideBody): string => `${minText(r.durationS / 60)} · ${HARDNESS_LABEL[r.hardness]}`;

/** One sentence on how it went ("Alles geschafft, ruhig gefahren"), then the power and the pulse; a missing value is left out. */
export function rideFacts(r: RideBody): string {
  const done = r.completedFraction >= 0.95 ? 'Alles geschafft' : `Zu ${Math.round(r.completedFraction * 100)} % geschafft`;
  const how = { easy: 'ruhig gefahren', moderate: 'zügig gefahren', hard: 'kräftig gefahren' }[r.hardness];
  const parts = [`${done}, ${how}`];
  if (r.avgPowerW !== null) parts.push(`Ø ${r.avgPowerW} W`);
  if (r.avgHrBpm !== null) parts.push(`Ø Puls ${r.avgHrBpm}`);
  return parts.join(' · ');
}

const monthName = (ms: number): string => new Date(ms).toLocaleDateString('de-DE', { month: 'long' });
const MIN_BACK_MS = 14 * 86_400_000;

/** "FTP (Dauerleistung) 245 W – seit Sept. 10 W mehr": against the oldest value of the history that is at least two weeks old. */
export function ftpSentence(b: BikeBody): string {
  const base = `FTP (Dauerleistung) ${Math.round(b.ftpW)} W`;
  const first = [...b.ftpHistory].sort((x, y) => x.atMs - y.atMs)[0];
  const newest = b.ftpHistory.reduce((m, h) => Math.max(m, h.atMs), 0);
  if (!first || newest - first.atMs < MIN_BACK_MS) return base;
  const d = Math.round(b.ftpW - first.ftpW);
  const since = `seit ${monthName(first.atMs)}`;
  return d === 0 ? `${base} – ${since} gleich` : `${base} – ${since} ${Math.abs(d)} W ${d > 0 ? 'mehr' : 'weniger'}`;
}

export const phaseText = (b: BikeBody): string | null => {
  if (!b.phase) return null;
  const w = b.phase.weeksLeft;
  return `Phase ${b.phase.name}${w > 0 ? ` – noch ${w} ${w === 1 ? 'Woche' : 'Wochen'} bis zur nächsten Phase` : ''}`;
};
