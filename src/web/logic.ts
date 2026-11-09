import type { TrackedRecord } from '../shared/records';
import { readOutlook, type GymOutlook } from '../shared/gym-outlook';

const DAY = 86_400_000;
export const STALE_PLAN_MS = 7 * DAY;
const MOBILITY_WINDOW_MS = DAY;
const MOBILITY_PAUSE_MS = 2 * DAY;

export type PlanBody = {
  workout: import('../shared/gym/types').GymWorkout | null; reason: string | null; source: string | null; note: string | null;
  questions: string[]; atMs: number; mobility: MobilitySession | null; outlook: GymOutlook | null;
};
export type MobilitySession = { id: string; forSession: 'bike' | 'strength' | 'run'; minutes: number; exercises: { id: string; title: string; howTo: string; area: string }[]; reason: string };
export type Complaint = { text: string; status: string; atMs: number };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function readPlan(r: TrackedRecord | undefined): PlanBody | null {
  if (!r || r.deleted || !isObj(r.body)) return null;
  const b = r.body;
  const w = isObj(b.workout) && Array.isArray(b.workout.exercises) && typeof b.workout.name === 'string' ? (b.workout as unknown as PlanBody['workout']) : null;
  const m = isObj(b.mobility) && typeof b.mobility.id === 'string' && Array.isArray(b.mobility.exercises) ? (b.mobility as unknown as MobilitySession) : null;
  return {
    workout: w, reason: typeof b.reason === 'string' ? b.reason : null, source: typeof b.source === 'string' ? b.source : null,
    note: typeof b.note === 'string' ? b.note : null, questions: Array.isArray(b.questions) ? b.questions.filter((q): q is string => typeof q === 'string') : [],
    atMs: typeof b.atMs === 'number' ? b.atMs : r.updatedMs, mobility: m, outlook: readOutlook(b.outlook),
  };
}

export const planDateText = (atMs: number): string => `Plan vom ${new Date(atMs).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}`;
export const planIsStale = (atMs: number, now: number): boolean => now - atMs > STALE_PLAN_MS;

/** The session from the plan record, unless it is done already or older than 24 hours. The phone never computes one. */
export function mobilityToShow(plan: TrackedRecord | undefined, mobility: TrackedRecord[], now: number): MobilitySession | null {
  const p = readPlan(plan);
  const s = p?.mobility;
  if (!p || !s) return null;
  const m = /-(\d{10,})$/.exec(s.id);
  const triggerMs = m ? Number(m[1]) : p.atMs;
  if (now - triggerMs > MOBILITY_WINDOW_MS) return null;
  const doneMs = mobility.filter((r) => !r.deleted && isObj(r.body) && typeof r.body.doneMs === 'number')
    .map((r) => ({ id: r.id, ms: (r.body as { doneMs: number }).doneMs }));
  if (doneMs.some((d) => d.id === s.id || now - d.ms < MOBILITY_PAUSE_MS)) return null;
  return s;
}

export function openComplaints(records: TrackedRecord[]): (Complaint & { id: string })[] {
  return records.filter((r) => !r.deleted && isObj(r.body) && typeof r.body.text === 'string' && typeof r.body.status === 'string' && r.body.status !== 'over')
    .map((r) => ({ id: r.id, ...(r.body as Complaint) })).sort((a, b) => b.atMs - a.atMs);
}

export const isIphoneBrowser = (ua: string): boolean => /iPhone|iPad|iPod/.test(ua);
export const shouldShowInstallHint = (s: { ua: string; standalone: boolean; seen: boolean }): boolean => isIphoneBrowser(s.ua) && !s.standalone && !s.seen;
