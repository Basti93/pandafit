import {
  commandFresh, LIVE_FRESH_MS, LIVE_RATE_MAX, LIVE_RATE_WINDOW_MS, parseLiveCommand, parseLiveState,
  type LiveMessage, type LiveRefusal, type LiveState,
} from '../../shared/live';

type Running<P> = { profileId: string; state: LiveState; receivedMs: number; owner: P };
type Asked<P> = { peer: P; atMs: number };

const MAX_ASKED = 64;
const ASKED_MS = 30_000;

export type LiveChannelDeps<P> = {
  nowMs: () => number;
  send: (peer: P, m: LiveMessage) => void;
  /** Every open connection of one account. */
  peers: (accountId: number) => Iterable<P>;
  /** Whether the connection asked to follow the running ride (a phone; the Mac does not). */
  watching: (peer: P) => boolean;
};

/**
 * The running ride of each account, in memory only. A Mac's connection is the owner of an account's ride by sending its state; the account's other
 * connections (the phone) get it, and send commands back that go to the owner alone. Everything is per account, so nothing crosses accounts.
 * Nothing here can throw into the coach: every entry point catches.
 */
export class LiveChannel<P> {
  private running = new Map<number, Running<P>>();
  private asked = new Map<number, Map<string, Asked<P>>>();
  private recent = new Map<number, number[]>();

  constructor(private deps: LiveChannelDeps<P>) {}

  /** The fresh state of an account, if there is one. Older than LIVE_FRESH_MS counts as gone. */
  fresh(accountId: number): LiveState | null {
    const r = this.running.get(accountId);
    if (!r) return null;
    if (this.deps.nowMs() - r.receivedMs > LIVE_FRESH_MS) { this.running.delete(accountId); return null; }
    return r.state;
  }

  /** A connection that just started watching sees the running ride at once, if it is fresh. */
  hello(accountId: number, peer: P): void {
    try {
      const state = this.fresh(accountId);
      const r = this.running.get(accountId);
      if (state && r && r.owner !== peer) this.deps.send(peer, { type: 'live-state', profileId: r.profileId, state });
    } catch { /* nothing */ }
  }

  /** A connection that closed: if it was the owner, the ride is gone for the phones (they show it as stale). */
  closed(accountId: number, peer: P): void {
    try {
      if (this.running.get(accountId)?.owner === peer) this.running.delete(accountId);
      const asked = this.asked.get(accountId);
      if (asked) for (const [id, a] of asked) if (a.peer === peer) asked.delete(id);
    } catch { /* nothing */ }
  }

  /** One live message from a connection of the account. Anything malformed or for another profile is dropped. */
  handle(accountId: number, profileId: string, peer: P, m: Record<string, unknown>): void {
    try {
      if (m.profileId !== profileId) return;
      switch (m.type) {
        case 'live-state': this.onState(accountId, profileId, peer, m); return;
        case 'live-end': this.onEnd(accountId, profileId, peer, m); return;
        case 'live-ack': this.onAck(accountId, peer, m); return;
        case 'live-command': this.onCommand(accountId, profileId, peer, m); return;
      }
    } catch { /* a bad live message changes nothing */ }
  }

  private others(accountId: number, peer: P): P[] { return [...this.deps.peers(accountId)].filter((p) => p !== peer); }

  private onState(accountId: number, profileId: string, peer: P, m: Record<string, unknown>): void {
    const state = parseLiveState(m.state);
    if (!state || state.profileId !== profileId) return;
    this.running.set(accountId, { profileId, state, receivedMs: this.deps.nowMs(), owner: peer });
    for (const p of this.others(accountId, peer)) if (this.deps.watching(p)) this.deps.send(p, { type: 'live-state', profileId, state });
  }

  private onEnd(accountId: number, profileId: string, peer: P, m: Record<string, unknown>): void {
    const r = this.running.get(accountId);
    if (typeof m.rideId !== 'string' || !r || r.owner !== peer || r.state.rideId !== m.rideId) return;
    this.running.delete(accountId);
    for (const p of this.others(accountId, peer)) if (this.deps.watching(p)) this.deps.send(p, { type: 'live-end', profileId, rideId: m.rideId });
  }

  private refuse(peer: P, profileId: string, id: string, reason: LiveRefusal): void {
    this.deps.send(peer, { type: 'live-ack', profileId, id, ok: false, reason });
  }

  private onCommand(accountId: number, profileId: string, peer: P, m: Record<string, unknown>): void {
    const cmd = parseLiveCommand(m);
    if (!cmd) {
      if (typeof m.id === 'string' && m.id.length <= 100) this.refuse(peer, profileId, m.id, 'invalid');
      return;
    }
    const now = this.deps.nowMs();
    const hits = (this.recent.get(accountId) ?? []).filter((t) => now - t < LIVE_RATE_WINDOW_MS);
    if (hits.length >= LIVE_RATE_MAX) { this.recent.set(accountId, hits); this.refuse(peer, profileId, cmd.id, 'rate'); return; }
    this.recent.set(accountId, [...hits, now]);
    if (!commandFresh(cmd.atMs, now)) { this.refuse(peer, profileId, cmd.id, 'old'); return; }
    const state = this.fresh(accountId);
    const r = this.running.get(accountId);
    if (!state || !r || state.rideId !== cmd.rideId) { this.refuse(peer, profileId, cmd.id, 'no-ride'); return; }
    // The owner never commands itself, and only the owner gets commands.
    if (r.owner === peer) return;
    let asked = this.asked.get(accountId);
    if (!asked) { asked = new Map(); this.asked.set(accountId, asked); }
    for (const [id, a] of asked) if (now - a.atMs > ASKED_MS) asked.delete(id);
    if (asked.size >= MAX_ASKED) { this.refuse(peer, profileId, cmd.id, 'rate'); return; }
    asked.set(cmd.id, { peer, atMs: now });
    try { this.deps.send(r.owner, cmd); } catch { asked.delete(cmd.id); this.refuse(peer, profileId, cmd.id, 'offline'); }
  }

  private onAck(accountId: number, peer: P, m: Record<string, unknown>): void {
    const r = this.running.get(accountId);
    if (!r || r.owner !== peer || typeof m.id !== 'string') return;
    const asked = this.asked.get(accountId);
    const a = asked?.get(m.id);
    if (!a) return;
    asked!.delete(m.id);
    const ok = m.ok === true;
    const reason = ok ? undefined : (['no-ride', 'old', 'rate', 'invalid', 'offline', 'failed'] as const).find((x) => x === m.reason) ?? 'failed';
    this.deps.send(a.peer, { type: 'live-ack', profileId: r.profileId, id: m.id, ok, ...(reason ? { reason } : {}) });
  }
}
