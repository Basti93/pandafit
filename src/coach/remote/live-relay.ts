import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/protocol';
import {
  commandFresh, LIVE_RATE_MAX, LIVE_RATE_WINDOW_MS, parseLiveCommand,
  type LiveMessage, type LiveRefusal, type LiveState,
} from '../../shared/live';

export type LiveRelayOptions = {
  /** `ws://127.0.0.1:7410` */
  serviceUrl: string;
  /** Whether a ride is open on this Mac (the same check the rest of the coach uses). */
  rideOpen: () => boolean;
  /** Where to send the ride's live messages: the server connection of a moved profile, or null if that profile is not coached by the server. */
  target: (profileId: string) => ((m: LiveMessage) => boolean) | null;
  nowMs: () => number;
  WebSocketImpl?: typeof WebSocket;
  /** How often the latest state goes out. Shorter in tests. */
  everyMs?: number;
};

type Sock = Pick<WebSocket, 'on' | 'send' | 'close' | 'terminate' | 'readyState'>;

const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30_000;
/** A command is only carried out while the service's own state is this fresh. */
const SERVICE_FRESH_MS = 5000;
const SEEN_MAX = 200;
export const COMMAND_NOTE = 'Handy';

/**
 * The Mac's share of the ride companion. A separate, read-mostly client of the local service: it listens to the same state the Mac UI
 * gets, shares the latest of it with the server about once per second, and turns the phone's checked commands into the same messages the
 * Mac UI sends. It lives in the coach process, never in the service. Every path catches; a failure ends in a log-free no-op, and the
 * service sees at most one more or fewer WebSocket client.
 */
export class LiveRelay {
  private ws: Sock | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private backoffMs = MIN_BACKOFF_MS;
  private pending: LiveState | null = null;
  private current: { rideId: string; profileId: string; seenMs: number } | null = null;
  private seen = new Map<string, boolean>();
  private commandsAt: number[] = [];

  constructor(private opts: LiveRelayOptions) {}

  /** Called regularly (every scan): connects while a ride is open, lets go when none is. */
  tick(): void {
    try {
      let open = false;
      try { open = this.opts.rideOpen(); } catch { /* unsure: not open */ }
      if (open && !this.ws && !this.retry) this.connect();
      if (!open && this.ws) this.disconnect();
    } catch { /* the next tick tries again */ }
  }

  stop(): void { try { this.disconnect(); } catch { /* gone anyway */ } }

  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry);
    if (this.timer) clearInterval(this.timer);
    this.retry = null; this.timer = null;
    const ws = this.ws;
    this.ws = null;
    this.endCurrent();
    this.pending = null;
    try { ws?.close(1000); } catch { /* already gone */ }
  }

  private later(): void {
    if (this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.tick(); }, this.backoffMs);
    this.retry.unref?.();
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private connect(): void {
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    let ws: Sock;
    try { ws = new Impl(this.opts.serviceUrl) as unknown as Sock; } catch { this.later(); return; }
    this.ws = ws;
    ws.on('error', () => { /* the close follows */ });
    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.timer = setInterval(() => this.flush(), this.opts.everyMs ?? 1000);
      this.timer.unref?.();
    });
    ws.on('message', (data: unknown) => {
      if (this.ws !== ws) return;
      try { this.fromService(String(data)); } catch { /* a bad message from the service changes nothing */ }
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.pending = null;
      // The server shows the ride as stale after a few seconds; there is no end to announce, we do not know it.
      this.current = null;
      this.later();
    });
  }

  private fromService(raw: string): void {
    const m = JSON.parse(raw) as ServerMessage;
    if (!m || m.type !== 'state') return;
    this.backoffMs = MIN_BACKOFF_MS;
    const ride = m.ride;
    if (!ride || ride.status !== 'open' || !m.engine) { this.endCurrent(); this.pending = null; return; }
    if (this.current && this.current.rideId !== ride.rideId) this.endCurrent();
    const now = this.opts.nowMs();
    this.current = { rideId: ride.rideId, profileId: ride.profileId, seenMs: now };
    const e = m.engine;
    const count = m.session?.steps.length ?? e.stepIndex + 1;
    this.pending = {
      rideId: ride.rideId, profileId: ride.profileId, atMs: now, elapsedS: e.rideElapsedS,
      powerW: m.latest?.powerW ?? null, hrBpm: m.latest?.hrBpm ?? null, cadenceRpm: m.latest?.cadenceRpm ?? null, targetW: e.targetW,
      step: { name: e.label || undefined, index: e.stepIndex, count, remainingS: e.stepRemainingS },
      ...(e.nextLabel ? { nextStep: { label: e.nextLabel } } : {}),
      ...(e.paused ? { paused: true } : {}),
    };
    if (!this.pending.step.name) delete this.pending.step.name;
  }

  /** The latest state goes out, once; there is no backlog. */
  private flush(): void {
    try {
      const s = this.pending;
      this.pending = null;
      if (!s) return;
      this.send(s.profileId, { type: 'live-state', profileId: s.profileId, state: s });
    } catch { /* the next state replaces it */ }
  }

  private endCurrent(): void {
    const c = this.current;
    this.current = null;
    if (c) this.send(c.profileId, { type: 'live-end', profileId: c.profileId, rideId: c.rideId });
  }

  private send(profileId: string, m: LiveMessage): boolean {
    try { return this.opts.target(profileId)?.(m) ?? false; } catch { return false; }
  }

  /** A command the server passed on. Checked here again, then done as the Mac UI would do it. Always answered. */
  onCommand(raw: unknown): void {
    try {
      const cmd = parseLiveCommand(raw);
      if (!cmd) return;
      const answer = (ok: boolean, reason?: LiveRefusal): void => {
        this.seen.set(cmd.id, ok);
        while (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.keys().next().value as string);
        this.send(cmd.profileId, { type: 'live-ack', profileId: cmd.profileId, id: cmd.id, ok, ...(reason ? { reason } : {}) });
      };
      // The same id again: answered as before, never done twice.
      if (this.seen.has(cmd.id)) { this.send(cmd.profileId, { type: 'live-ack', profileId: cmd.profileId, id: cmd.id, ok: this.seen.get(cmd.id)! }); return; }
      const now = this.opts.nowMs();
      this.commandsAt = this.commandsAt.filter((t) => now - t < LIVE_RATE_WINDOW_MS);
      if (this.commandsAt.length >= LIVE_RATE_MAX) { answer(false, 'rate'); return; }
      this.commandsAt.push(now);
      if (!commandFresh(cmd.atMs, now)) { answer(false, 'old'); return; }
      const c = this.current;
      const ws = this.ws;
      if (!c || !ws || c.rideId !== cmd.rideId || c.profileId !== cmd.profileId || now - c.seenMs > SERVICE_FRESH_MS) { answer(false, 'no-ride'); return; }
      const msg: ClientMessage = cmd.kind === 'adjust' ? { type: 'adjust', deltaPct: cmd.deltaPct! } : cmd.kind === 'skip' ? { type: 'skip' } : { type: 'mark', note: COMMAND_NOTE };
      try { ws.send(JSON.stringify(msg)); } catch { answer(false, 'failed'); return; }
      answer(true);
    } catch { /* a bad command is dropped */ }
  }
}
