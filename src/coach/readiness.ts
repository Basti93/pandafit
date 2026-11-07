import type { GarminActivity, GarminBody, GarminDay, GarminReadiness } from '../shared/garmin';
import { ruleNumber, ruleValues } from '../shared/training-policy';
import type { RideSummary } from './metrics';

const DAY_MS = 86_400_000;
// The thresholds live in the policy register (health.*), with their sources.
const RAISED_HR_BPM = ruleNumber('health.rhr-raised');
const MIN_HR_DAYS = ruleValues('health.rhr-raised').minDays!;
const BASELINE_DAYS = ruleValues('health.rhr-raised').baselineDays!;
const LOAD_FACTOR = ruleNumber('health.load-spike');
const LOAD_WINDOW_DAYS = ruleValues('health.load-spike').windowDays!;
const MIN_LOAD_FOR_ALARM = ruleValues('health.load-spike').minLoad!;
const SHORT_SLEEP_S = ruleNumber('health.sleep') * 3600;
const EXTERNAL_WINDOW_DAYS = 42;
const MATCH_START_MS = 10 * 60_000;
const MATCH_DURATION = 0.2;
const CYCLING = /cycling|biking|ride|bike/i;
const MONTHS_IN_DETAIL = 18;
const PROMPT_DAYS = 14;

export type ExternalLoad = { sport: string; startMs: number; durationS: number; trainingLoad: number | null; name?: string | null; avgHr?: number | null };
export type GarminCoachData = { days: GarminDay[]; activities: GarminActivity[]; body: GarminBody | null };
export type HistoryRow = { zeitraum: string; sport: string; anzahl: number; stunden: number; belastung: number | null };

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Other sports of the last few weeks. Rides that Pandafit knows itself do not count twice. */
export const externalLoad = (activities: GarminActivity[], rides: RideSummary[], nowMs: number): ExternalLoad[] =>
  activities
    .filter((a) => nowMs - a.startMs < EXTERNAL_WINDOW_DAYS * DAY_MS && !a.fromBikeCoach)
    .filter((a) => !(CYCLING.test(a.sport) && rides.some((r) =>
      Math.abs(r.startedAtMs - a.startMs) <= MATCH_START_MS && Math.abs(r.durationS - a.durationS) <= r.durationS * MATCH_DURATION)))
    .map((a) => ({ sport: a.sport, startMs: a.startMs, durationS: a.durationS, trainingLoad: a.trainingLoad, name: a.name, avgHr: a.avgHr }));

const pulseReason = (days: GarminDay[]): string | null => {
  const withHr = days.filter((d): d is GarminDay & { restingHrBpm: number } => d.restingHrBpm !== null);
  if (withHr.length < MIN_HR_DAYS + 2) return null;
  const [before, last] = [withHr.at(-2)!, withHr.at(-1)!];
  const baseline = median(withHr.slice(-(BASELINE_DAYS + 2), -2).map((d) => d.restingHrBpm));
  return before.restingHrBpm >= baseline + RAISED_HR_BPM && last.restingHrBpm >= baseline + RAISED_HR_BPM
    ? `Ruhepuls seit 2 Tagen erhöht (${last.restingHrBpm} statt um ${Math.round(baseline)} bpm)` : null;
};

/** Whether the resting pulse has been raised for two days. */
export const restingHrRaised = (days: GarminDay[]): boolean => pulseReason(days) !== null;

const loadReason = (external: ExternalLoad[], today: string): string | null => {
  const end = Date.parse(`${today}T23:59:59Z`);
  const sumBetween = (fromDaysBack: number, toDaysBack: number): number => external
    .filter((a) => a.startMs <= end - toDaysBack * DAY_MS && a.startMs > end - fromDaysBack * DAY_MS)
    .reduce((sum, a) => sum + (a.trainingLoad ?? 0), 0);
  const recent = sumBetween(LOAD_WINDOW_DAYS, 0);
  const usual = (sumBetween(BASELINE_DAYS + LOAD_WINDOW_DAYS, LOAD_WINDOW_DAYS) / BASELINE_DAYS) * LOAD_WINDOW_DAYS;
  return recent >= MIN_LOAD_FOR_ALARM && recent > usual * LOAD_FACTOR ? 'Hohe Belastung durch andere Sportarten in den letzten 3 Tagen' : null;
};

const sleepReason = (days: GarminDay[], today: string): string | null => {
  const sleep = days.find((d) => d.date === today)?.sleepS;
  return sleep !== null && sleep !== undefined && sleep < SHORT_SLEEP_S ? `Nur ${(sleep / 3600).toFixed(1).replace('.', ',')} Stunden Schlaf` : null;
};

export const assessReadiness = (days: GarminDay[], external: ExternalLoad[], today: string): GarminReadiness => {
  const reasons = [pulseReason(days), loadReason(external, today), sleepReason(days, today)].filter((r): r is string => r !== null);
  if (reasons.length) return { level: 'careful', reasons };
  const enough = days.filter((d) => d.restingHrBpm !== null).length >= MIN_HR_DAYS;
  return { level: enough ? 'normal' : 'unknown', reasons: [] };
};

/** Entire history, short enough for the coach: older years per year, the latest months individually. */
export const historySummary = (activities: GarminActivity[], nowMs: number): HistoryRow[] => {
  const cutoff = new Date(nowMs);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - MONTHS_IN_DETAIL, 1);
  const rows = new Map<string, HistoryRow>();
  for (const a of activities) {
    const iso = new Date(a.startMs).toISOString();
    const zeitraum = a.startMs >= cutoff.getTime() ? iso.slice(0, 7) : iso.slice(0, 4);
    const key = `${zeitraum}|${a.sport}`;
    const row = rows.get(key) ?? { zeitraum, sport: a.sport, anzahl: 0, stunden: 0, belastung: null };
    row.anzahl += 1;
    row.stunden += a.durationS / 3600;
    if (a.trainingLoad !== null) row.belastung = (row.belastung ?? 0) + a.trainingLoad;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, stunden: Math.round(r.stunden * 10) / 10, belastung: r.belastung === null ? null : Math.round(r.belastung) }))
    .sort((a, b) => a.zeitraum.localeCompare(b.zeitraum) || b.stunden - a.stunden);
};

export const readinessFrom = (data: GarminCoachData, rides: RideSummary[], nowMs: number): GarminReadiness =>
  assessReadiness(data.days, externalLoad(data.activities, rides, nowMs), new Date(nowMs).toISOString().slice(0, 10));

export const garminPromptData = (data: GarminCoachData, rides: RideSummary[], nowMs: number): object => {
  const external = externalLoad(data.activities, rides, nowMs);
  const { body } = data;
  return {
    tage: data.days.slice(-PROMPT_DAYS),
    erholung: assessReadiness(data.days, external, new Date(nowMs).toISOString().slice(0, 10)),
    andereSportarten: external.map(({ startMs, ...a }) => ({ ...a, tag: new Date(startMs).toISOString().slice(0, 10) })),
    verlauf: historySummary(data.activities, nowMs),
    ...(body ? {
      koerper: {
        geburtsdatum: body.birthDate, geschlecht: body.sex, groesseCm: body.heightCm, gewichtKg: body.weightKg,
        garminFtpW: body.ftpW, garminFtpVeraltet: body.ftpStale, hoechsterGemessenerPuls: body.maxHrSeen,
      },
    } : {}),
  };
};
