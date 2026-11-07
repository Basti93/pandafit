/**
 * The running ride as the phone sees it. The Mac shares it with the server (about once per second, latest only), the server
 * keeps it in memory for the account and passes it on, the phone sends back three small commands. Nothing here is stored.
 */

/** Live data older than this counts as gone. */
export const LIVE_FRESH_MS = 10_000;
/** A command older than this is refused. */
export const LIVE_COMMAND_MAX_AGE_MS = 10_000;
/** At most this many commands within LIVE_RATE_WINDOW_MS. */
export const LIVE_RATE_MAX = 5;
export const LIVE_RATE_WINDOW_MS = 10_000;
/** The only step the phone may ask for. The service clamps on top of it. */
export const LIVE_ADJUST_PCT = 5;

export type LiveStep = { name?: string; index: number; count: number; remainingS: number };
export type LiveState = {
  rideId: string; profileId: string; atMs: number; elapsedS: number;
  powerW: number | null; hrBpm: number | null; cadenceRpm: number | null; targetW: number | null;
  step: LiveStep; nextStep?: { label: string; targetW?: number }; paused?: boolean;
};

export type LiveCommandKind = 'adjust' | 'mark' | 'skip';
/** Why a command did not happen. */
export type LiveRefusal = 'no-ride' | 'old' | 'rate' | 'invalid' | 'offline' | 'failed';
export type LiveCommandMessage = {
  type: 'live-command'; profileId: string; id: string; rideId: string; atMs: number;
  kind: LiveCommandKind; deltaPct?: number;
};
export type LiveMessage =
  | { type: 'live-state'; profileId: string; state: LiveState }
  | { type: 'live-end'; profileId: string; rideId: string }
  | { type: 'live-ack'; profileId: string; id: string; ok: boolean; reason?: LiveRefusal }
  | LiveCommandMessage;
/** A phone says it wants the running ride (it does not know the profile id). Not a LiveMessage: it carries nothing. */
export type LiveWatch = { type: 'live-watch' };
export const LIVE_TYPES: ReadonlySet<string> = new Set(['live-state', 'live-end', 'live-ack', 'live-command']);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const text = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length > 0 && x.length <= max ? x : null);
const orNull = (x: unknown): number | null => num(x);

/** A live state from the wire, or null if it is not one. Never throws. */
export const parseLiveState = (x: unknown): LiveState | null => {
  if (!isObj(x)) return null;
  const rideId = text(x.rideId, 100), profileId = text(x.profileId, 100);
  const atMs = num(x.atMs), elapsedS = num(x.elapsedS);
  if (!rideId || !profileId || atMs === null || elapsedS === null || !isObj(x.step)) return null;
  const index = num(x.step.index), count = num(x.step.count), remainingS = num(x.step.remainingS);
  if (index === null || count === null || remainingS === null) return null;
  const out: LiveState = {
    rideId, profileId, atMs, elapsedS,
    powerW: orNull(x.powerW), hrBpm: orNull(x.hrBpm), cadenceRpm: orNull(x.cadenceRpm), targetW: orNull(x.targetW),
    step: { index, count, remainingS },
  };
  const name = text(x.step.name, 100);
  if (name) out.step.name = name;
  if (isObj(x.nextStep)) {
    const label = text(x.nextStep.label, 100);
    if (label) { out.nextStep = { label }; const t = num(x.nextStep.targetW); if (t !== null) out.nextStep.targetW = t; }
  }
  if (x.paused === true) out.paused = true;
  return out;
};

/** A command from the wire, or null if it is not a well-formed one. An adjust is exactly +5 or -5. */
export const parseLiveCommand = (x: unknown): LiveCommandMessage | null => {
  if (!isObj(x) || x.type !== 'live-command') return null;
  const profileId = text(x.profileId, 100), id = text(x.id, 100), rideId = text(x.rideId, 100), atMs = num(x.atMs);
  if (!profileId || !id || !rideId || atMs === null) return null;
  if (x.kind === 'mark' || x.kind === 'skip') return { type: 'live-command', profileId, id, rideId, atMs, kind: x.kind };
  if (x.kind === 'adjust' && (x.deltaPct === LIVE_ADJUST_PCT || x.deltaPct === -LIVE_ADJUST_PCT)) {
    return { type: 'live-command', profileId, id, rideId, atMs, kind: 'adjust', deltaPct: x.deltaPct };
  }
  return null;
};

/** A command is fresh when it is at most LIVE_COMMAND_MAX_AGE_MS old; a clock running far ahead counts as old too. */
export const commandFresh = (atMs: number, nowMs: number): boolean => Math.abs(nowMs - atMs) <= LIVE_COMMAND_MAX_AGE_MS;
