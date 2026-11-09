import fs from 'node:fs';
import path from 'node:path';
import type { RideEvent, Sample } from '../shared/sample';
import { writeJsonAtomic } from '../shared/node/atomic-write';
import { stepFtpFraction, type Session } from '../shared/session';
import { readMeta, type RideMeta } from './read';

/** A crash can leave meta.json empty or cut off. The samples still prove the ride exists, so the meta is rebuilt from them. */
const rebuildMeta = (dir: string, name: string): RideMeta | null => {
  let first: Sample | undefined;
  for (const line of fs.readFileSync(path.join(dir, name, 'samples.jsonl'), 'utf8').split('\n')) {
    if (!line) continue;
    try { first = JSON.parse(line) as Sample; break; } catch { /* truncated line */ }
  }
  if (!first) return null;
  let sessionId = '';
  let profileId = '';
  try {
    const stored = JSON.parse(fs.readFileSync(path.join(dir, name, 'session.json'), 'utf8')) as { session: { id: string }; profileId?: string };
    sessionId = String(stored.session.id);
    if (typeof stored.profileId === 'string') profileId = stored.profileId;
  } catch { /* unknown session */ }
  const meta: RideMeta = { rideId: name, profileId, sessionId, startedAtMs: first.wallClockMs, status: 'open', formatVersion: 1 };
  writeJsonAtomic(path.join(dir, name, 'meta.json'), meta);
  return meta;
};

export const findOpenRides = (dir: string): RideMeta[] => {
  if (!fs.existsSync(dir)) return [];
  const open: RideMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    // A crash before the first meta.json write leaves only the samples; they still count as a ride.
    if (!fs.existsSync(path.join(dir, name, 'meta.json')) && !fs.existsSync(path.join(dir, name, 'samples.jsonl'))) continue;
    try {
      let meta: RideMeta | null;
      try { meta = readMeta(dir, name); } catch { meta = rebuildMeta(dir, name); }
      if (meta?.status === 'open') open.push(meta);
    } catch { /* an unreadable ride must not prevent startup */ }
  }
  return open;
};

/** Seconds of the session skipped before the crash, from the logged skip events ("<step>:<addedS>"). */
const skippedOf = (events: RideEvent[]): number =>
  events.reduce((sum, e) => {
    if (e.type !== 'skip') return sum;
    const added = Number(e.detail?.split(':')[1]);
    return Number.isFinite(added) && added > 0 ? sum + added : sum;
  }, 0);

export type Adjustments = { adjustPct: number; adjustedStep: number; autoPct: number; holdPct: number; autoStep: number };
const NONE: Adjustments = { adjustPct: 0, adjustedStep: -1, autoPct: 0, holdPct: 0, autoStep: -1 };
// Same constants as the engine's automatic reduction and heart rate hold.
const AUTO_STEP_PCT = 5;
const AUTO_MAX_PCT = 20;
const HOLD_UP_PCT = 2;
const HOLD_DOWN_PCT = 3;
const HOLD_MAX_UP_PCT = 15;
const HOLD_MAX_DOWN_PCT = 40;
const HOLD_CEILING_FRACTION = 0.8;

const stepIndexAt = (session: Session, atS: number): number => {
  let end = 0;
  for (let i = 0; i < session.steps.length; i++) {
    end += session.steps[i].durationS;
    if (atS < end) return i;
  }
  return session.steps.length - 1;
};

/**
 * Manual adjusts, automatic reductions and heart rate hold only apply to the step they happened in.
 * They are replayed from the logged target-adjust events, with the position the engine had when it logged them.
 * Counters (seconds of high heart rate, cadence) are not logged and start again from zero.
 */
const adjustmentsOf = (ride: { samples: Sample[]; events?: RideEvent[] }, session: Session): Adjustments => {
  const out = { ...NONE };
  let skipped = 0;
  let si = 0;
  let elapsed = 0;
  let adjustSteps: { step: number; delta: number }[] = [];
  let autoEvents: { step: number; kind: 'auto' | 'up' | 'down' }[] = [];
  for (const e of ride.events ?? []) {
    while (si < ride.samples.length && ride.samples[si].wallClockMs <= e.wallClockMs) elapsed = ride.samples[si++].rideElapsedS;
    if (e.type === 'skip') {
      const added = Number(e.detail?.split(':')[1]);
      if (Number.isFinite(added) && added > 0) skipped += added;
      continue;
    }
    if (e.type !== 'target-adjust' || !e.detail) continue;
    const step = stepIndexAt(session, elapsed + skipped);
    if (e.detail.startsWith('auto:')) autoEvents.push({ step, kind: 'auto' });
    else if (e.detail === 'hold:up') autoEvents.push({ step, kind: 'up' });
    else if (e.detail === 'hold:down') autoEvents.push({ step, kind: 'down' });
    else {
      const delta = Number(e.detail);
      if (Number.isFinite(delta)) adjustSteps.push({ step, delta });
    }
  }
  const lastAdjust = adjustSteps.at(-1);
  if (lastAdjust) {
    out.adjustedStep = lastAdjust.step;
    out.adjustPct = adjustSteps.filter((a) => a.step === lastAdjust.step).reduce((sum, a) => sum + a.delta, 0);
  }
  const lastAuto = autoEvents.at(-1);
  if (lastAuto) {
    out.autoStep = lastAuto.step;
    const ceiling = Math.min(HOLD_MAX_UP_PCT, (HOLD_CEILING_FRACTION / stepFtpFraction(session.steps[lastAuto.step]) - 1) * 100);
    for (const a of autoEvents.filter((x) => x.step === lastAuto.step)) {
      if (a.kind === 'auto') out.autoPct = Math.min(AUTO_MAX_PCT, out.autoPct + AUTO_STEP_PCT);
      else if (a.kind === 'up') out.holdPct = Math.min(ceiling, out.holdPct + HOLD_UP_PCT);
      else out.holdPct = Math.max(-HOLD_MAX_DOWN_PCT, out.holdPct - HOLD_DOWN_PCT);
    }
  }
  return out;
};

export type ResumePoint = { resumeAtS: number; startSeq: number; skippedS: number } & Adjustments;

/** Without the session the position of the events is unknown, so no adjustments are restored. */
export const resumePoint = (ride: { samples: Sample[]; events?: RideEvent[] }, session?: Session): ResumePoint => {
  const last = ride.samples.at(-1);
  const skippedS = skippedOf(ride.events ?? []);
  const adj = session ? adjustmentsOf(ride, session) : NONE;
  return last ? { resumeAtS: last.rideElapsedS, startSeq: last.seq + 1, skippedS, ...adj } : { resumeAtS: 0, startSeq: 0, skippedS, ...adj };
};
