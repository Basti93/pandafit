import type { TrackedRecord } from './records';
import { ruleNumber } from './training-policy';
import { parseProposal, type WeekProposal } from './week-plan';

/**
 * One chat thread per profile, one `chat` record per message. The rider's messages are written by any of their devices,
 * the coach's only by the side that coaches the profile. `replyTo` ties a coach answer to the rider message it answers;
 * `takes`/`declines`/`undoes` mark the rider's answer to a proposal (no coach reply follows those).
 */
/**
 * A change to the rest of an open workout, proposed by the coach during the workout. Only open sets change; done sets never.
 * drop: the exercise's open sets go (an exercise without done sets goes entirely). swap: its open sets move to another own
 * exercise. sets: keep this many open sets. lighter: open sets lose this many percent of their weight (5 to 30).
 */
export type WorkoutOp = { op: 'drop'; ex: string } | { op: 'swap'; ex: string; to: string } | { op: 'sets'; ex: string; open: number } | { op: 'lighter'; ex: string; pct: number };
export type WorkoutChange = { workoutId: string; ops: WorkoutOp[] };

export type ChatMessage = {
  role: 'rider' | 'coach';
  text: string;
  atMs: number;
  replyTo?: string;
  proposal?: WeekProposal;
  /** Rules the proposal breaks because the rider asked for it; shown once, applied only on "Übernehmen". */
  warnings?: string[];
  takes?: string;
  declines?: string;
  /** The rider took the proposal back (the week plan undone). */
  undoes?: string;
  /** The coach could not answer (no Claude, limit); the rider may write again. */
  failed?: boolean;
  /** A coach message the rider did not ask for (the week conversation, the evening before): the server sends a push for it. */
  push?: boolean;
  /** Written during this open workout: the coach answers about the rest of it. */
  inWorkout?: string;
  workoutChange?: WorkoutChange;
  /** The id of the `change` record (a change for the next workout) this message proposes. */
  nextChange?: string;
  /** The id of the `rule` record (a rule or goal change) this message proposes. */
  rule?: string;
  /** The monthly review: the observations Bo made, each with its reason (also in `text`). */
  review?: { observations: { text: string; reason: string }[] };
};
export type ChatEntry = ChatMessage & { id: string };

/** Kept this long; older messages are deleted by the coach side. */
export const CHAT_KEEP_MS = 90 * 86_400_000;
/** The coach sees this many of the latest messages. */
export const CHAT_CONTEXT = 30;
export const MAX_CHAT_TEXT = 2000;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

export function readChat(x: unknown): ChatMessage | null {
  if (!isObj(x) || (x.role !== 'rider' && x.role !== 'coach') || typeof x.text !== 'string' || typeof x.atMs !== 'number' || !Number.isFinite(x.atMs)) return null;
  const m: ChatMessage = { role: x.role, text: x.text.slice(0, MAX_CHAT_TEXT), atMs: x.atMs };
  if (typeof x.replyTo === 'string') m.replyTo = x.replyTo;
  if (typeof x.takes === 'string') m.takes = x.takes;
  if (typeof x.declines === 'string') m.declines = x.declines;
  if (typeof x.undoes === 'string') m.undoes = x.undoes;
  if (x.failed === true) m.failed = true;
  if (typeof x.inWorkout === 'string') m.inWorkout = x.inWorkout;
  if (x.push === true) m.push = true;
  if (typeof x.nextChange === 'string') m.nextChange = x.nextChange;
  if (typeof x.rule === 'string') m.rule = x.rule;
  if (x.workoutChange !== undefined) { const c = readWorkoutChange(x.workoutChange); if (!c) return null; m.workoutChange = c; }
  if (x.proposal !== undefined) { const p = parseProposal(x.proposal); if (!p) return null; m.proposal = p; }
  if (x.warnings !== undefined) { if (!strings(x.warnings)) return null; m.warnings = x.warnings; }
  if (x.review !== undefined) { const r = readReview(x.review); if (!r) return null; m.review = r; }
  return m;
}

function readReview(x: unknown): ChatMessage['review'] | null {
  if (!isObj(x) || !Array.isArray(x.observations) || x.observations.length > ruleNumber('review.max-observations')) return null;
  const observations: { text: string; reason: string }[] = [];
  for (const o of x.observations) {
    if (!isObj(o) || typeof o.text !== 'string' || typeof o.reason !== 'string') return null;
    observations.push({ text: o.text, reason: o.reason });
  }
  return { observations };
}

/** The thread, oldest first, unreadable and deleted records skipped. */
export const chatThread = (records: TrackedRecord[]): ChatEntry[] =>
  records.flatMap((r) => { if (r.kind !== 'chat' || r.deleted) return []; const m = readChat(r.body); return m ? [{ ...m, id: r.id }] : []; })
    .sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : 1));

/**
 * The rider message still waiting for the coach: the latest rider message (not a take or decline) without an answer. Coach
 * messages are skipped, so an answer to an older message or a note the rider did not ask for never hides it; an answered
 * latest message means nothing waits.
 */
export function waitingMessage(thread: ChatEntry[]): ChatEntry | null {
  const answered = new Set(thread.filter((m) => m.role === 'coach' && m.replyTo).map((m) => m.replyTo));
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i]!;
    if (m.role === 'coach' || m.takes || m.declines || m.undoes) continue;
    return answered.has(m.id) ? null : m;
  }
  return null;
}

/** Whether the rider already took or declined a proposal. */
export const proposalAnswer = (thread: ChatEntry[], id: string): 'taken' | 'declined' | 'undone' | null => {
  let answer: 'taken' | 'declined' | 'undone' | null = null;
  for (const m of thread) { if (m.takes === id) answer = 'taken'; else if (m.declines === id) answer = 'declined'; else if (m.undoes === id) answer = 'undone'; }
  return answer;
};

const OPS = ['drop', 'swap', 'sets', 'lighter'];
/** The shape only; whether the rows exist is checked against the workout when the change is applied. */
export function readWorkoutChange(x: unknown): WorkoutChange | null {
  if (!isObj(x) || typeof x.workoutId !== 'string' || !Array.isArray(x.ops) || x.ops.length > 20) return null;
  const ops: WorkoutOp[] = [];
  for (const o of x.ops) {
    if (!isObj(o) || !OPS.includes(o.op as string) || typeof o.ex !== 'string') return null;
    if (o.op === 'drop') ops.push({ op: 'drop', ex: o.ex });
    else if (o.op === 'swap') { if (typeof o.to !== 'string') return null; ops.push({ op: 'swap', ex: o.ex, to: o.to }); }
    else if (o.op === 'sets') { if (!Number.isInteger(o.open) || (o.open as number) < 0 || (o.open as number) > 10) return null; ops.push({ op: 'sets', ex: o.ex, open: o.open as number }); }
    else { if (typeof o.pct !== 'number' || o.pct < 5 || o.pct > 30) return null; ops.push({ op: 'lighter', ex: o.ex, pct: o.pct }); }
  }
  return { workoutId: x.workoutId, ops };
}

/**
 * When the coach writes by itself, per profile (record kind coachprefs, id "prefs"). Week and evening are off by default, the monthly review is on. `day` is 0 for Monday;
 * hours are local hours of the coaching side.
 */
export type CoachPrefs = { week: { on: boolean; day: number; hour: number }; evening: { on: boolean; hour: number }; review: { on: boolean } };
export const COACH_PREFS_ID = 'prefs';
export const DEFAULT_PREFS: CoachPrefs = { week: { on: false, day: 6, hour: 18 }, evening: { on: false, hour: 19 }, review: { on: true } };
const hour = (x: unknown, d: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 23 ? (x as number) : d);
export function readCoachPrefs(x: unknown): CoachPrefs {
  if (!isObj(x)) return DEFAULT_PREFS;
  const w = isObj(x.week) ? x.week : {}, e = isObj(x.evening) ? x.evening : {}, v = isObj(x.review) ? x.review : {};
  return {
    week: { on: w.on === true, day: Number.isInteger(w.day) && (w.day as number) >= 0 && (w.day as number) <= 6 ? (w.day as number) : 6, hour: hour(w.hour, 18) },
    evening: { on: e.on === true, hour: hour(e.hour, 19) },
    review: { on: v.on !== false },
  };
}
export const prefsOf = (records: TrackedRecord[]): CoachPrefs => readCoachPrefs(records.find((r) => r.kind === 'coachprefs' && r.id === COACH_PREFS_ID && !r.deleted)?.body);
