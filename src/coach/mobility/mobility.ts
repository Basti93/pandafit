import { createHmac } from 'node:crypto';
import { EXERCISES } from '../../shared/exercises';
import { LEG_COMPLAINT } from '../gym/gym-coach';
import type { StrengthWorkout } from '../hevy';
import type { RideSummary } from '../metrics';
import type { Complaint } from '../motivation';
import { MIN_COUNTED_S } from '../state';
import type { RecordStore } from '../tracking/store';
import { MOBILITY_EXERCISES, type MobilityArea } from './exercises';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OFFER_WINDOW_MS = 24 * HOUR;
const PAUSE_MS = 2 * DAY;
/** A tap on an offer that has just run out still counts. */
const TAP_GRACE_MS = HOUR;
const FEEL_EVERY_MS = 42 * DAY;
const FEEL_MIN_SESSIONS = 3;
const PROMPT_WINDOW_MS = 28 * DAY;
const MIN_EXERCISES = 3;
const MAX_EXERCISES = 5;
const FEEL_MAX = 300;

export type MobilitySession = {
  id: string; forSession: MobilityFor; minutes: number;
  exercises: { id: string; title: string; howTo: string; area: string }[]; reason: string;
};
export type MobilityFor = 'bike' | 'strength' | 'run';
export type MobilityView = { session: MobilitySession | null; askFeel: boolean };
export type MobilityPromptData = { zuletzt: { tageHer: number; fuer: MobilityFor }[]; feel: string | null };

const RIDE_FOCUS: MobilityArea[] = ['hueftbeuger', 'oberschenkel-hinten', 'waden', 'brust'];
/** After a run: calves, hip flexors and the back of the thigh. */
const RUN_FOCUS: MobilityArea[] = ['waden', 'hueftbeuger', 'oberschenkel-hinten'];
const FALLBACK: MobilityArea[] = [...RIDE_FOCUS, 'gesaess', 'ruecken', 'oberschenkel-vorn', 'schultern', 'nacken'];

/** Hevy's muscle names to the areas worth a calm stretch afterwards. */
const MUSCLE_AREAS: Record<string, MobilityArea[]> = {
  quadriceps: ['oberschenkel-vorn', 'hueftbeuger'], hamstrings: ['oberschenkel-hinten'], glutes: ['gesaess', 'hueftbeuger'], calves: ['waden'],
  abductors: ['gesaess', 'hueftbeuger'], adductors: ['hueftbeuger', 'gesaess'], chest: ['brust'], shoulders: ['schultern', 'brust'], front_delts: ['schultern', 'brust'], side_delts: ['schultern'], rear_delts: ['schultern', 'ruecken'],
  triceps: ['schultern'], biceps: ['brust', 'schultern'], lats: ['ruecken', 'schultern'], upper_back: ['ruecken', 'schultern'],
  lower_back: ['ruecken', 'gesaess'], traps: ['nacken', 'schultern'], neck: ['nacken'], abdominals: ['hueftbeuger', 'ruecken'],
};

/** An open complaint takes the matching areas out. The text is only matched, never repeated or judged. */
const COMPLAINT_AREAS: { pattern: RegExp; areas: MobilityArea[] }[] = [
  { pattern: /knie/i, areas: ['oberschenkel-vorn', 'oberschenkel-hinten', 'waden'] },
  { pattern: /hüfte|huefte|leiste/i, areas: ['hueftbeuger', 'gesaess'] },
  { pattern: /wade|knöchel|knoechel|fuß|fuss|achilles/i, areas: ['waden'] },
  { pattern: /rücken|ruecken|\blws\b|kreuz/i, areas: ['ruecken', 'gesaess'] },
  { pattern: /schulter|nacken|\barme?n?\b|ellbogen|handgelenk|brust/i, areas: ['schultern', 'nacken', 'brust'] },
  { pattern: LEG_COMPLAINT, areas: ['oberschenkel-vorn', 'oberschenkel-hinten', 'waden', 'hueftbeuger', 'gesaess'] },
];

/** A knee or any other leg complaint: everything that loads the knee goes, whatever its area. */
const kneeLoadBlocked = (complaints: Complaint[]): boolean =>
  complaints.some((c) => c.status !== 'over' && (/knie/i.test(c.text) || LEG_COMPLAINT.test(c.text)));

const excludedAreas = (complaints: Complaint[]): Set<MobilityArea> => {
  const out = new Set<MobilityArea>();
  for (const c of complaints) {
    if (c.status === 'over') continue;
    for (const rule of COMPLAINT_AREAS) if (rule.pattern.test(c.text)) rule.areas.forEach((a) => out.add(a));
  }
  return out;
};

export type MobilityInput = {
  nowMs: number; lastRideMs: number | null; lastStrengthMs: number | null; lastMobilityMs: number | null;
  complaints: Complaint[]; usedMuscles: string[];
  /** When the last run ended; only with the run coach on. */
  lastRunMs?: number | null;
};

/**
 * Rules only. `lastRideMs`, `lastStrengthMs` and `lastRunMs` are the times the sessions ended. A session is offered if one ended within
 * 24 hours and no mobility was done within 2 days. Its id depends on the triggering session alone, so it stays the same until
 * a new session ends. `rideKey` turns a ride's or run's end into what the id shows.
 */
export function suggestMobility(input: MobilityInput, rideKey: (endMs: number) => string = String): MobilitySession | null {
  const { nowMs } = input;
  const recent = (ms: number | null): ms is number => ms !== null && ms <= nowMs && nowMs - ms <= OFFER_WINDOW_MS;
  const bike = recent(input.lastRideMs) ? input.lastRideMs : null;
  const strength = recent(input.lastStrengthMs) ? input.lastStrengthMs : null;
  const run = recent(input.lastRunMs ?? null) ? input.lastRunMs! : null;
  // The newest session decides.
  const candidates = ([['bike', bike], ['strength', strength], ['run', run]] as const).filter((c): c is readonly [MobilityFor, number] => c[1] !== null);
  if (candidates.length === 0) return null;
  if (input.lastMobilityMs !== null && nowMs - input.lastMobilityMs < PAUSE_MS) return null;
  const [forSession, triggerMs] = candidates.reduce((a, c) => (c[1] > a[1] ? c : a));

  const excluded = excludedAreas(input.complaints);
  const list = kneeLoadBlocked(input.complaints) ? MOBILITY_EXERCISES.filter((x) => !x.kneeLoad) : MOBILITY_EXERCISES;
  const fromMuscles = forSession === 'strength' ? [...new Set(input.usedMuscles.flatMap((m) => MUSCLE_AREAS[m] ?? []))] : [];
  const own = forSession === 'bike' ? RIDE_FOCUS : forSession === 'run' ? RUN_FOCUS : fromMuscles;
  const focus = [...own, ...FALLBACK].filter((a, i, all) => all.indexOf(a) === i && !excluded.has(a));
  const wanted = own.filter((a) => !excluded.has(a));

  // One per wanted area first, then a second one, then the rest only to reach the minimum.
  const picked: typeof list = [];
  const take = (areas: MobilityArea[], perArea: number, limit: number): void => {
    for (let round = 0; round < perArea; round++) {
      for (const a of areas) {
        const e = list.filter((x) => x.area === a)[round];
        if (e && picked.length < limit && !picked.includes(e)) picked.push(e);
      }
    }
  };
  take(wanted, 2, MAX_EXERCISES);
  if (picked.length < MIN_EXERCISES) take(focus, 1, MIN_EXERCISES);
  if (picked.length < MIN_EXERCISES) return null;

  const left = excluded.size > 0 || list !== MOBILITY_EXERCISES ? ' Bereiche, die dich gerade stören, habe ich weggelassen.' : '';
  const reason = forSession === 'bike'
    ? `Nach dem Radfahren gibt es eine kurze, ruhige Beweglichkeitseinheit, nur wenn du magst.${left}`
    : forSession === 'run'
    ? `Nach dem Laufen gibt es eine kurze, ruhige Beweglichkeitseinheit für Waden, Hüftbeuger und Oberschenkelrückseite, nur wenn du magst.${left}`
    : `Nach dem Krafttraining gibt es eine kurze, ruhige Beweglichkeitseinheit für die Muskeln, die du genutzt hast, nur wenn du magst.${left}`;
  return {
    id: `mobility-${forSession}-${forSession === 'strength' ? triggerMs : rideKey(triggerMs)}`, forSession,
    minutes: Math.max(6, Math.min(10, picked.length * 2)),
    exercises: picked.map(({ id, title, howTo, area }) => ({ id, title, howTo, area })), reason,
  };
}

/** Hevy's muscle for an exercise, from the own list by id and otherwise by a guess on the title. */
const GUESSES: [RegExp, string][] = [
  [/squat|kniebeuge|lunge|ausfall|leg press|beinpresse|extension|strecker/i, 'quadriceps'], [/curl.*leg|leg.*curl|beinbeuger|deadlift|kreuzheben/i, 'hamstrings'],
  [/hip thrust|glute|gesäß/i, 'glutes'], [/calf|wade/i, 'calves'], [/bench|chest|fly|brust|drücken/i, 'chest'], [/row|pull|lat|rudern|klimm/i, 'lats'],
  [/shoulder|press|schulter|lateral/i, 'shoulders'], [/tricep|dip/i, 'triceps'], [/bicep|curl/i, 'biceps'],
];
const defaultMuscleOf = (templateId: string, title: string): string | null =>
  EXERCISES.find((e) => e.id === templateId)?.primaryMuscle ?? GUESSES.find(([p]) => p.test(title))?.[1] ?? null;
export { defaultMuscleOf as muscleOf };

type Deps = {
  store: RecordStore; nowMs: () => number;
  rides: (id: string) => RideSummary[];
  /** The merged history of the strength coach. */
  strength: (id: string) => StrengthWorkout[];
  complaints: (id: string) => Complaint[];
  /** Runs of the run coach, only while it is on. Without it nothing is offered after a run. */
  runs?: (id: string) => { startMs: number; durationS: number }[];
  muscleOf?: (templateId: string, title: string) => string | null;
};

type Body = { doneMs?: unknown; forSession?: unknown; feel?: unknown; skipped?: unknown };
const bodyOf = (r: { body: unknown }): Body => (typeof r.body === 'object' && r.body !== null ? r.body as Body : {});

/** Mobility offered after a bike, strength or run session. Local only: rules, records and no AI call. */
export class MobilityCoach {
  constructor(private deps: Deps) {}

  private records(id: string) { return this.deps.store.all(id, 'mobility').filter((r) => !r.deleted); }
  private done(id: string) { return this.records(id).filter((r) => typeof bodyOf(r).doneMs === 'number'); }

  private suggestion(id: string): MobilitySession | null {
    const now = this.deps.nowMs();
    const rides = this.deps.rides(id).filter((r) => r.status === 'finished' && r.durationS >= MIN_COUNTED_S).map((r) => r.startedAtMs + r.durationS * 1000).filter((ms) => ms <= now);
    const workouts = this.deps.strength(id).filter((w) => w.durationS > 0 && w.startMs + w.durationS * 1000 <= now);
    const lastStrength = workouts.reduce<StrengthWorkout | null>((a, w) => (!a || w.startMs > a.startMs ? w : a), null);
    const muscleOf = this.deps.muscleOf ?? defaultMuscleOf;
    const doneMs = this.done(id).map((r) => bodyOf(r).doneMs as number);
    const runEnds = this.runEnds(id).filter((ms) => ms <= now);
    return suggestMobility({
      nowMs: now,
      lastRideMs: rides.length ? Math.max(...rides) : null,
      lastStrengthMs: lastStrength ? lastStrength.startMs + lastStrength.durationS * 1000 : null,
      lastMobilityMs: doneMs.length ? Math.max(...doneMs) : null,
      complaints: this.deps.complaints(id),
      usedMuscles: lastStrength ? lastStrength.exercises.flatMap((e) => { const m = muscleOf(e.templateId, e.title); return m ? [m] : []; }) : [],
      lastRunMs: runEnds.length ? Math.max(...runEnds) : null,
    }, (endMs) => this.rideKey(id, endMs));
  }

  private runEnds(id: string): number[] {
    try { return (this.deps.runs?.(id) ?? []).filter((r) => r.durationS > 0).map((r) => r.startMs + r.durationS * 1000); } catch { return []; }
  }

  /** Stands for one ride or run and says nothing about it: session ids go to the server with the plan, their times must not. */
  private rideKey(id: string, endMs: number): string {
    return createHmac('sha256', this.deps.store.localSecret(id)).update(String(endMs)).digest('hex').slice(0, 16);
  }

  private askFeel(id: string): boolean {
    const done = this.done(id).map((r) => bodyOf(r).doneMs as number);
    if (done.length < FEEL_MIN_SESSIONS) return false;
    const answered = this.records(id).filter((r) => typeof bodyOf(r).feel === 'string' || bodyOf(r).skipped === true).map((r) => r.updatedMs);
    return this.deps.nowMs() - Math.max(Math.min(...done), ...answered) >= FEEL_EVERY_MS;
  }

  view(id: string): MobilityView { return { session: this.suggestion(id), askFeel: this.askFeel(id) }; }

  /**
   * Only an offer this profile really had can be marked: the current one, or one from an earlier session that ended
   * within 24 hours (plus a short grace). An invented id stores nothing. Marking twice keeps the first time.
   */
  markDone(id: string, sessionId: string): void {
    const now = this.deps.nowMs();
    const m = /^mobility-(bike|strength|run)-([0-9a-f]+)$/.exec(sessionId);
    if (!m) return;
    const forSession = m[1] as MobilityFor;
    const ends = forSession === 'bike'
      ? this.deps.rides(id).filter((r) => r.status === 'finished' && r.durationS >= MIN_COUNTED_S).map((r) => r.startedAtMs + r.durationS * 1000)
      : forSession === 'run' ? this.runEnds(id)
      : this.deps.strength(id).filter((w) => w.durationS > 0).map((w) => w.startMs + w.durationS * 1000);
    // A card from before ride keys may still carry the plain end time. A run card always carries the key.
    const keyed = forSession !== 'strength';
    const endMs = ends.find((e) => (forSession !== 'run' && m[2] === String(e)) || (keyed && m[2] === this.rideKey(id, e)));
    if (endMs === undefined || endMs > now || now - endMs > OFFER_WINDOW_MS + TAP_GRACE_MS) return;
    const storedId = keyed ? `mobility-${forSession}-${this.rideKey(id, endMs)}` : sessionId;
    const have = this.deps.store.all(id, 'mobility');
    if (have.some((r) => r.id === storedId || r.id === `mobility-${forSession}-${endMs}`)) return;
    // The same 2 day rule as for the offer, so a second session's card cannot add a second entry.
    const doneMs = this.done(id).map((r) => bodyOf(r).doneMs as number);
    if (doneMs.length && now - Math.max(...doneMs) < PAUSE_MS) return;
    this.deps.store.put(id, { kind: 'mobility', id: storedId, updatedMs: now, deleted: false, body: { doneMs: now, forSession } });
  }

  /** An empty text is a skip: it stores the skip, so nothing asks again before the next 6 weeks. */
  feel(id: string, text: string): void {
    const t = text.trim().slice(0, FEEL_MAX);
    const now = this.deps.nowMs();
    this.deps.store.put(id, { kind: 'mobility', id: `feel-${now}`, updatedMs: now, deleted: false, body: t ? { feel: t } : { skipped: true } });
  }

  /** Recent sessions and the last answer, for the prompts as data only. Null when there is nothing. */
  promptData(id: string): MobilityPromptData | null {
    const now = this.deps.nowMs();
    const zuletzt = this.done(id).filter((r) => now - (bodyOf(r).doneMs as number) <= PROMPT_WINDOW_MS)
      .sort((a, b) => (bodyOf(b).doneMs as number) - (bodyOf(a).doneMs as number)).slice(0, 5)
      .map((r) => ({ tageHer: Math.max(0, Math.floor((now - (bodyOf(r).doneMs as number)) / DAY)), fuer: bodyOf(r).forSession === 'strength' || bodyOf(r).forSession === 'run' ? bodyOf(r).forSession as MobilityFor : 'bike' as const }));
    const feels = this.records(id).filter((r) => typeof bodyOf(r).feel === 'string' && (bodyOf(r).feel as string).trim()).sort((a, b) => b.updatedMs - a.updatedMs);
    const feel = feels.length && now - feels[0].updatedMs <= FEEL_EVERY_MS ? bodyOf(feels[0]).feel as string : null;
    return zuletzt.length || feel ? { zuletzt, feel } : null;
  }
}
