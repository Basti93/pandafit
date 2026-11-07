import { LIVE_ADJUST_PCT, LIVE_FRESH_MS, parseLiveState, type LiveCommandKind, type LiveState } from '../shared/live';

/** The part of a browser WebSocket the client uses; tests bring their own. */
export type LiveSocket = {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

/** What the screen shows: the last live state and when it came, and when the Mac said the ride ended. */
export type LiveSnapshot = { state: LiveState | null; receivedMs: number; endedMs: number | null };
export type CommandResult = 'ok' | 'refused' | 'timeout';

const ACK_MS = 5000;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const EMPTY: LiveSnapshot = { state: null, receivedMs: 0, endedMs: null };

/** The ride companion's side on the phone: follows the account's coach socket for the running ride and sends the three commands. Never throws. */
export class LiveClient {
  private ws: LiveSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = MIN_BACKOFF_MS;
  private stopped = true;
  private snap: LiveSnapshot = EMPTY;
  private subs = new Set<() => void>();
  private pending = new Map<string, { done: (r: CommandResult) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private o: { open: () => LiveSocket; now: () => number; newId: () => string }) {}

  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  snapshot = (): LiveSnapshot => this.snap;
  private set(s: LiveSnapshot): void { this.snap = s; for (const f of [...this.subs]) { try { f(); } catch { /* a listener never stops the client */ } } }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* gone */ }
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.done('timeout'); this.pending.delete(id); }
  }

  private later(): void {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private connect(): void {
    if (this.stopped || this.ws) return;
    let ws: LiveSocket;
    try { ws = this.o.open(); } catch { this.later(); return; }
    this.ws = ws;
    ws.onopen = () => { if (this.ws === ws) { this.backoff = MIN_BACKOFF_MS; try { ws.send(JSON.stringify({ type: 'live-watch' })); } catch { /* the close follows */ } } };
    ws.onmessage = (e) => { if (this.ws === ws) { try { this.received(String(e.data)); } catch { /* a bad message changes nothing */ } } };
    ws.onerror = () => { /* the close follows */ };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const [id, p] of this.pending) { clearTimeout(p.timer); p.done('timeout'); this.pending.delete(id); }
      this.later();
    };
  }

  private received(raw: string): void {
    const m = JSON.parse(raw) as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return;
    const now = this.o.now();
    if (m.type === 'live-state') {
      const state = parseLiveState(m.state);
      if (state) this.set({ state, receivedMs: now, endedMs: null });
    } else if (m.type === 'live-end') {
      const s = this.snap;
      if (s.state && s.state.rideId === m.rideId) this.set({ ...s, endedMs: now });
    } else if (m.type === 'live-ack' && typeof m.id === 'string') {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.done(m.ok === true ? 'ok' : 'refused');
    }
  }

  /** One command for the running ride. Resolves with the Mac's answer, 'refused' at once without a link or a ride, 'timeout' after 5 s without an answer. */
  command(kind: LiveCommandKind, deltaPct?: number): Promise<CommandResult> {
    const ws = this.ws;
    const s = this.snap;
    if (!ws || !s.state || s.endedMs !== null || this.o.now() - s.receivedMs > LIVE_FRESH_MS) return Promise.resolve('refused');
    const id = this.o.newId();
    return new Promise<CommandResult>((done) => {
      const timer = setTimeout(() => { this.pending.delete(id); done('timeout'); }, ACK_MS);
      this.pending.set(id, { done, timer });
      try {
        ws.send(JSON.stringify({
          type: 'live-command', profileId: s.state!.profileId, id, rideId: s.state!.rideId, atMs: this.o.now(), kind,
          ...(kind === 'adjust' ? { deltaPct } : {}),
        }));
      } catch { clearTimeout(timer); this.pending.delete(id); done('refused'); }
    });
  }
}

export { LIVE_ADJUST_PCT };
