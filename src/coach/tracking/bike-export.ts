import { BIKE_ID, MAX_CURVE_POINTS, mergeBlocks, plannedIntensity, sessionMinutes, thinSamples, type BikeAlternative, type BikeBody, type RideBody } from '../../shared/bike';
import { dateKey, rateIntensity } from '../../shared/day-rating';
import type { TrackedRecord } from '../../shared/records';
import type { RideDebrief } from '../debrief';
import type { RideSummary } from '../metrics';
import type { CoachState } from '../state';
import type { RecordStore } from './store';
import type { Sample } from '../../shared/sample';
import { HARDNESS_LABEL } from '../../shared/week-plan';

const DAY_MS = 86_400_000;
const WEEKS = 12;
const FTP_MONTHS_MS = 366 * DAY_MS;
/** New or changed ride records written per scan: the curve of each needs its ride file, so a long history catches up over a few scans. */
const RIDES_PER_SCAN = 20;
const SENTENCE_MAX = 300;

type Deps = {
  store: Pick<RecordStore, 'all' | 'put'>;
  profileIds: string[];
  /** Only the side that coaches a profile writes. */
  coachHere: (profileId: string) => boolean;
  noOpenRide: () => boolean;
  nowMs: number;
  state: (profileId: string) => CoachState | null;
  /** The cleaned samples of a ride, read only when its record is written. */
  samples: (rideId: string) => Sample[];
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const oneSentence = (d: RideDebrief | undefined): string | undefined => {
  const t = d?.summary?.trim();
  if (!t) return undefined;
  const first = /^.*?[.!?](?=\s|$)/s.exec(t)?.[0] ?? t;
  return first.length <= SENTENCE_MAX ? first : `${first.slice(0, SENTENCE_MAX - 1)}…`;
};

const mondayKey = (ms: number): string => { const d = new Date(ms); return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime()); };

/** The plan part of the bike record, without its time stamp. */
export function bikeContent(s: CoachState, nowMs: number): Omit<BikeBody, 'atMs'> {
  const intensity = plannedIntensity(s.next.session.steps);
  const alternatives: BikeAlternative[] = (s.alternatives ?? []).slice(0, 3).map((a) => ({ name: a.session.name, minutes: sessionMinutes(a.session), why: a.why }));
  const hours = new Map<string, number>();
  for (let i = 0; i < WEEKS; i++) hours.set(mondayKey(nowMs - i * 7 * DAY_MS), 0);
  for (const r of s.summaries) { const k = mondayKey(r.startedAtMs); if (hours.has(k)) hours.set(k, hours.get(k)! + r.durationS / 3600); }
  return {
    type: 'bike', ftpW: s.ftpW,
    ftpHistory: s.ftpHistory.filter((h) => nowMs - h.atMs <= FTP_MONTHS_MS).slice(-12).map((h) => ({ atMs: h.atMs, ftpW: h.ftpW, source: h.source })),
    phase: s.phase ? { name: s.phase.name, weeksLeft: s.phase.weeksLeft, goal: s.phase.goal } : null,
    next: { name: s.next.session.name, reason: s.next.reason, minutes: sessionMinutes(s.next.session), hardness: rateIntensity(intensity), blocks: mergeBlocks(s.next.session.steps) },
    alternatives,
    weekHours: [...hours].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, h]) => ({ week, hours: Math.round(h * 10) / 10 })),
  };
}

/** A ride's record without its curve. */
export function rideContent(r: RideSummary, s: CoachState): Omit<RideBody, 'curve'> {
  const debrief = oneSentence(s.debriefs?.[r.rideId]);
  const feedback = s.feedback[r.rideId];
  return {
    type: 'ride', startedAtMs: r.startedAtMs, ...(r.sessionName ? { sessionName: r.sessionName } : {}), durationS: r.durationS,
    hardness: rateIntensity(r.intensityFactor), avgPowerW: r.avgPowerW, normalizedPowerW: r.normalizedPowerW, avgHrBpm: r.avgHrBpm, maxHrBpm: r.maxHrBpm,
    tss: Math.round(r.tss), completedFraction: Math.round(r.completedFraction * 100) / 100,
    ...(typeof feedback === 'string' ? { feedback } : {}), ...(debrief ? { debrief } : {}),
  };
}

const bodyWithout = (b: unknown, keys: string[]): string => {
  if (!isObj(b)) return '';
  const rest = { ...b };
  for (const k of keys) delete rest[k];
  return JSON.stringify(rest);
};

const put = (d: Deps, id: string, kind: 'bike' | 'ride', rid: string, have: TrackedRecord | undefined, body: unknown, deleted: boolean): void => {
  d.store.put(id, { kind, id: rid, updatedMs: Math.max(d.nowMs, (have?.updatedMs ?? 0) + 1), deleted, body });
};

/**
 * Publishes the plan and the counted rides to every profile coached here, written only on change (like the stats). A ride that
 * is gone from the coach's list becomes a tombstone. Never with a ride open. Returns the profiles it wrote to.
 */
export function exportBike(d: Deps): string[] {
  try {
    if (!d.noOpenRide()) return [];
    const out: string[] = [];
    for (const id of d.profileIds) {
      try {
        if (!d.coachHere(id)) continue;
        const s = d.state(id);
        if (!s) continue;
        let wrote = false;
        const bikeHave = d.store.all(id, 'bike').find((r) => r.id === BIKE_ID);
        const plan = bikeContent(s, d.nowMs);
        if (!bikeHave || bikeHave.deleted || bodyWithout(bikeHave.body, ['atMs']) !== JSON.stringify(plan)) {
          put(d, id, 'bike', BIKE_ID, bikeHave, { ...plan, atMs: d.nowMs }, false);
          wrote = true;
        }
        const have = new Map(d.store.all(id, 'ride').map((r) => [r.id, r]));
        let budget = RIDES_PER_SCAN;
        for (const r of s.summaries) {
          const h = have.get(r.rideId);
          const content = rideContent(r, s);
          if (h && !h.deleted && bodyWithout(h.body, ['curve']) === JSON.stringify(content)) continue;
          if (budget-- <= 0) break;
          // The curve is read only now; a ride file that cannot be read leaves this ride for the next scan.
          let curve: RideBody['curve'];
          try { curve = thinSamples(d.samples(r.rideId), MAX_CURVE_POINTS).map(({ t, powerW, hrBpm }) => ({ t, powerW, hrBpm })); } catch { continue; }
          put(d, id, 'ride', r.rideId, h, { ...content, curve }, false);
          wrote = true;
        }
        const counted = new Set(s.summaries.map((r) => r.rideId));
        for (const [rid, h] of have) if (!h.deleted && !counted.has(rid)) { put(d, id, 'ride', rid, h, h.body, true); wrote = true; }
        if (wrote) out.push(id);
      } catch { /* this profile tries again on the next scan */ }
    }
    return out;
  } catch { return []; }
}

/** What the week chat sees of the bike: the plan, FTP and phase, and the last rides in a few words. */
export function radForChat(s: CoachState): { rad: { geplant: true; name: string; minuten: number; begruendung: string; ftp: number; phase: string }; radFahrten: { datum: string; name: string; minuten: number; haerte: string }[] } {
  const radFahrten = [...s.summaries].sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, 5)
    .map((r) => ({ datum: dateKey(r.startedAtMs), name: r.sessionName ?? 'Fahrt', minuten: Math.round(r.durationS / 60), haerte: HARDNESS_LABEL[rateIntensity(r.intensityFactor)] }));
  return { rad: { geplant: true, name: s.next.session.name, minuten: sessionMinutes(s.next.session), begruendung: s.next.reason, ftp: Math.round(s.ftpW), phase: s.phase.name }, radFahrten };
}
