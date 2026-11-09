import { bodyOf } from '../shared/record-bodies';
import type { TrackedRecord } from '../shared/records';
export { readPlan, type PlanBody, type MobilitySession } from '../shared/plan-body';
import { readPlan, type MobilitySession } from '../shared/plan-body';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const DAY = 86_400_000;
export const STALE_PLAN_MS = 7 * DAY;
const MOBILITY_WINDOW_MS = DAY;
const MOBILITY_PAUSE_MS = 2 * DAY;

export type Complaint = { text: string; status: string; atMs: number };

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
    .map((r) => ({ id: r.id, ...bodyOf('complaint', r) })).sort((a, b) => b.atMs - a.atMs);
}

export const isIphoneBrowser = (ua: string): boolean => /iPhone|iPad|iPod/.test(ua);
export const shouldShowInstallHint = (s: { ua: string; standalone: boolean; seen: boolean }): boolean => isIphoneBrowser(s.ua) && !s.standalone && !s.seen;
