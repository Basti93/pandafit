import type { CoachClientMessage, CoachHome, CoachServerMessage, CoachStateMessage } from '../../shared/coach-protocol';
import type { CoachRuntime } from '../runtime';
import { clearMoved, driftOf, mealsMoved } from './home';
import type { RemoteCoach } from './remote-coach';

/** How long a request to the server waits for its answer before the interface gets the empty one. */
const ANSWER_MS = 60_000;

export type RouterOptions = {
  local: CoachRuntime;
  /** The server coach of a moved profile, or null for a profile coached here. */
  remote: (profileId: string) => RemoteCoach | null;
  /** True until the household's meal plan went to the server: until then it stays local for everyone. */
  mealsLocal: () => boolean;
  /**
   * True while anyone on this Mac is still coached here: the Mac's together page (local states plus the cached server
   * states) is laid over the server's, which cannot see the profiles still here. Once everyone moved, the server's counts.
   */
  togetherLocal: () => boolean;
  /** The local runtime's `coach` folder, where the moved marker lives. */
  coachDir: string;
  /** A local profile on its way to the server: how far the move is, or why it stops. Null otherwise. */
  moving?: (profileId: string) => CoachHome | null;
  /** Closed rides of a moved profile that the server does not hold yet. */
  pendingRides?: (profileId: string) => number;
  /** Default: setTimeout. For tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
};

type Pending = { reply: (m: CoachServerMessage) => void; done: boolean; connection: number; rideId: string | null; empty: CoachServerMessage };
/** Requests whose answer the interface waits for, by the type of the answer. */
const ANSWERS: Partial<Record<CoachClientMessage['type'], CoachServerMessage['type']>> = {
  'gym-preview': 'gym-preview', 'gym-confirm': 'gym-confirm-result', 'ride-detail': 'ride-detail',
};
/** The answer the interface gets at once when the server cannot be asked, or after the wait, so it never waits for nothing. */
const emptyAnswer = (m: CoachClientMessage): CoachServerMessage | null => {
  switch (m.type) {
    case 'gym-preview': return { type: 'gym-preview', preview: null };
    case 'gym-confirm': return { type: 'gym-confirm-result', result: 'failed' };
    case 'ride-detail': return { type: 'ride-detail', detail: { rideId: m.rideId, points: [] } };
    default: return null;
  }
};

/**
 * Sends a profile's coach messages where its coach runs: the local runtime, or the server for a moved profile. Records and
 * the account link always stay local, and the meal plan stays local while anyone in it is still coached here.
 */
export const createRouter = (opts: RouterOptions) => {
  const { local } = opts;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
  /** Per profile and answer type: who waits, oldest first. The server answers a socket's requests in order. */
  const waiting = new Map<string, Pending[]>();
  const keyOf = (profileId: string, type: string) => `${profileId}\u0000${type}`;

  const remoteOf = (profileId: string): RemoteCoach | null => { try { return opts.remote(profileId); } catch { return null; } };
  const mealsLocal = (): boolean => { try { return opts.mealsLocal(); } catch { return true; } };
  const togetherLocal = (): boolean => { try { return opts.togetherLocal(); } catch { return true; } };

  const movingOf = (profileId: string): CoachHome | null => { try { return opts.moving?.(profileId) ?? null; } catch { return null; } };
  /** A local view with the move's progress, when a move is under way. */
  const withMoving = (profileId: string, v: CoachStateMessage): CoachStateMessage => {
    const home = movingOf(profileId);
    return home ? { ...v, coachHome: home } : v;
  };

  const view = (profileId: string): CoachStateMessage | null => {
    const remote = remoteOf(profileId);
    if (!remote) { const v = local.view(profileId); return v ? withMoving(profileId, v) : v; }
    const v = remote.view();
    // The link is this Mac's: its status comes from the local account sync, not from the server's own link.
    let account = v.account;
    try { account = local.accountSync.status(profileId); } catch { /* the server's then */ }
    const out: CoachStateMessage = { ...v, ...(account ? { account } : {}) };
    // Items changed here after the server took over are shown, never dropped silently.
    const drift = driftOf(opts.coachDir, profileId);
    if (drift.length > 0 && out.coachHome?.where === 'server') out.coachHome = { ...out.coachHome, drift };
    if (out.coachHome?.where === 'server' && opts.pendingRides) {
      try { out.coachHome = { ...out.coachHome, pendingRides: opts.pendingRides(profileId) }; } catch { /* no line then */ }
    }
    if (mealsLocal()) out.meals = local.mealsView(profileId);
    if (togetherLocal()) { try { out.together = local.together(); } catch { /* the server's then */ } }
    return out;
  };

  const handle = (m: CoachClientMessage, reply: (msg: CoachServerMessage) => void): void => {
    const send = (msg: CoachServerMessage) => { try { reply(msg); } catch { /* connection gone */ } };
    try {
      const profileId = (m as { profileId?: unknown }).profileId;
      const remote = typeof profileId === 'string' ? remoteOf(profileId) : null;
      // Records sync through the account sync as before, and the link is this Mac's.
      if (!remote || m.type === 'records-put' || m.type === 'records-list' || m.type === 'account-link') {
        local.handle(m, typeof profileId === 'string' && !remote ? (msg) => reply(msg.type === 'coach-state' ? withMoving(profileId, msg) : msg) : reply);
        return;
      }
      const id = profileId as string;
      // Back to the local coach, whose view goes out at once.
      if (m.type === 'account-unlink') {
        // Stopped first, so nothing writes its files after they were set aside; asked again after the unlink, so the
        // owner of the server coaches lets go of it and a later move starts a fresh one.
        remote.stop();
        clearMoved(opts.coachDir, id);
        local.handle(m, reply);
        remoteOf(id);
        local.handle({ type: 'subscribe', profileId: id }, reply);
        return;
      }
      if (m.type === 'subscribe') { const v = view(id); if (v) send(v); return; }
      if (m.type.startsWith('meals-') && mealsLocal()) { local.handle(m, reply); return; }
      const answer = ANSWERS[m.type];
      const empty = emptyAnswer(m);
      const result = remote.send(m);
      if (!answer || !empty) return;
      if (result !== 'sent') { send(empty); return; }
      const key = keyOf(id, answer);
      // A timed-out request stays in line as done, so its late answer is dropped instead of reaching the next request.
      const p: Pending = { reply: send, done: false, connection: remote.connection(), rideId: m.type === 'ride-detail' ? m.rideId : null, empty };
      waiting.set(key, [...(waiting.get(key) ?? []), p]);
      setTimer(() => {
        if (p.done) return;
        p.done = true;
        send(empty);
      }, ANSWER_MS);
    } catch { /* ignore invalid message */ }
  };

  /** An answer from a profile's server coach to a request made through handle. False when nobody waits for it. */
  const answered = (profileId: string, m: CoachServerMessage): boolean => {
    const key = keyOf(profileId, m.type);
    const now = remoteOf(profileId)?.connection() ?? null;
    // Requests from a connection that broke are never answered: they get the empty answer now, if they have not yet.
    const stale = (waiting.get(key) ?? []).filter((p) => p.connection !== now);
    for (const p of stale) if (!p.done) { p.done = true; p.reply(p.empty); }
    let list = (waiting.get(key) ?? []).filter((p) => p.connection === now);
    // The server answers in order on one connection; a ride's detail is matched by its ride id all the same.
    const rideId = m.type === 'ride-detail' ? m.detail.rideId : null;
    const i = rideId === null ? (list.length ? 0 : -1) : list.findIndex((p) => p.rideId === rideId);
    const p = i < 0 ? null : list[i]!;
    if (p) list = list.filter((x) => x !== p);
    if (list.length) waiting.set(key, list); else waiting.delete(key);
    if (!p || p.done) return false;
    p.done = true;
    p.reply(m);
    return true;
  };

  return { handle, view, answered };
};
export type CoachRouter = ReturnType<typeof createRouter>;

/** The meal plan stays local until it went to the server; see `mealsDue` for when it goes. */
export const mealsStayLocal = (coachDir: string): boolean => !mealsMoved(coachDir);
