import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { QUEUEABLE, type CoachClientMessage, type CoachHome, type CoachServerMessage, type CoachStateMessage } from '../protocol';
import type { LiveMessage } from '../../shared/live';
import { ruleBasedSession } from '../rules';
import { loadState, type CoachState } from '../state';
import { computeTogether } from '../together';
import { writeJsonAtomic } from '../../shared/node/atomic-write';
import { createLogger } from '../../shared/node/log';

const log = createLogger('remote-coach');

export type RemoteCoachOptions = {
  /** `<coachDir>/remote/<profileId>`: state.json and queue.json. */
  dir: string;
  profileId: string;
  /** The account link's server address (https://…), or null without a link. */
  url: () => string | null;
  /** The link's device token, or null without a link or once the server refused it. */
  token: () => string | null;
  /** False while a ride is open: then nothing is sent, writes are queued and the subscription stays. */
  mayWrite: () => boolean;
  /** The local rule coach's state, for when the server was never reached. Never sent. */
  fallback: () => CoachState;
  nowMs: () => number;
  WebSocketImpl?: typeof WebSocket;
  /** A view worth showing again (as coach-state, already with coachHome), or another answer from the server. */
  onMessage: (m: CoachServerMessage) => void;
  /** The api refused the token (401): the link is rejected and nothing is tried again until it is linked anew. */
  reject?: () => void;
};

type Entry = { qid: string; atMs: number; message: CoachClientMessage };
type Cache = { receivedMs: number; view: CoachStateMessage };

export const MAX_QUEUE = 1000;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
/** How often a queue held back (offline, a ride open) is looked at again. */
const FLUSH_MS = 2000;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The api's coach socket for a server address from an account link: https → wss, plain http (own machine only) → ws. */
export const coachSocketUrl = (server: string): string | null => {
  if (!/^https?:\/\//.test(server)) return null;
  return `${server.replace(/^http/, 'ws').replace(/\/+$/, '')}/coach`;
};

/** The local rule coach for a moved profile: its last local state with a rule session as the next one. Never sent anywhere. */
export const ruleFallback = (coachDir: string, profileId: string, ftpW: number, nowMs: number): CoachState => {
  const s = loadState(coachDir, profileId, ftpW, nowMs);
  return { ...s, next: { ...ruleBasedSession({ ftpW: s.ftpW, summaries: s.summaries, nowMs }), source: 'rules' } };
};

/** Temp file, fsync, rename, fsync of the folder: after a power cut the file is the old one or the new one, never empty. */
const writeAtomic = (file: string, data: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, data);
};

/**
 * One moved profile's coach on the server, seen from the Mac: a socket to the api's /coach, the last coach-state kept on
 * disk, and a queue of writes made while the server was unreachable or a ride was open. A queued entry leaves the queue
 * only once the server acknowledged it; anything un-acked is sent again after a reconnect, in order.
 */
export class RemoteCoach {
  private ws: WebSocket | null = null;
  private online = false;
  private stopped = true;
  private backoffMs = MIN_BACKOFF_MS;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  /** Queued entries sent on the current connection and not yet acknowledged. */
  private inflight = new Set<string>();
  /** Counts the connections opened: an answer always comes on the connection its request went out on. */
  private opened = 0;
  private queue: Entry[];
  private cache: Cache | null;

  constructor(private opts: RemoteCoachOptions) {
    this.queue = this.loadQueue();
    this.cache = this.loadCache();
  }

  private get queueFile(): string { return path.join(this.opts.dir, 'queue.json'); }
  private get stateFile(): string { return path.join(this.opts.dir, 'state.json'); }

  private loadQueue(): Entry[] {
    let text: string;
    try { text = fs.readFileSync(this.queueFile, 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      this.setAside();
      return [];
    }
    let d: unknown;
    try { d = JSON.parse(text); } catch { d = null; }
    if (!Array.isArray(d)) { this.setAside(); return []; }
    {
      return d.flatMap((e): Entry[] => (isObj(e) && typeof e.qid === 'string' && typeof e.atMs === 'number' && isObj(e.message) && QUEUEABLE.has(e.message.type as CoachClientMessage['type'])
        ? [{ qid: e.qid, atMs: e.atMs, message: e.message as CoachClientMessage }] : [])).slice(0, MAX_QUEUE);
    }
  }
  /** An unreadable queue is kept for a look by hand, never overwritten by the next write. */
  private setAside(): void {
    const name = `queue.corrupt-${this.opts.nowMs()}.json`;
    try {
      fs.renameSync(this.queueFile, path.join(this.opts.dir, name));
      console.error(`Coach-Warteschlange unlesbar, beiseitegelegt als ${name}`);
    } catch (e) {
      console.error(`Coach-Warteschlange unlesbar und nicht beiseitezulegen (${name})`, e);
      // Never written over: the queue stays in memory only until the file can be moved.
      this.queueBlocked = true;
    }
  }
  private loadCache(): Cache | null {
    try {
      const d = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as unknown;
      if (isObj(d) && typeof d.receivedMs === 'number' && isObj(d.view) && d.view.type === 'coach-state' && isObj(d.view.state)) return d as Cache;
    } catch { /* no cache yet */ }
    return null;
  }
  private queueBlocked = false;
  private saveQueue(): void {
    if (this.queueBlocked) return;
    try { writeAtomic(this.queueFile, this.queue); } catch (e) { log.error('offline queue not saved', e); /* kept in memory, written with the next change */ }
  }

  private changed(): void { try { this.opts.onMessage(this.view()); } catch { /* a listener never stops the coach */ } }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    this.poll = setInterval(() => this.flush(), FLUSH_MS);
    this.poll.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.poll) clearInterval(this.poll);
    this.retry = null; this.poll = null;
    const ws = this.ws;
    this.ws = null; this.online = false; this.inflight.clear();
    try { ws?.close(1000); } catch { /* already gone */ }
  }

  private later(): void {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, this.backoffMs);
    this.retry.unref?.();
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private connect(): void {
    if (this.stopped || this.ws) return;
    const server = this.opts.url();
    const token = this.opts.token();
    const url = server ? coachSocketUrl(server) : null;
    if (!url || !token) { this.later(); return; }
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    let ws: WebSocket;
    try { ws = new Impl(url, { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: 15_000 }); } catch { this.later(); return; }
    this.ws = ws;
    let refused = false;
    ws.on('error', () => { /* the close follows */ });
    // The api answers the upgrade with 401 only when the login itself failed; anything else is a server that is not there now.
    ws.on('unexpected-response', (_req, res) => {
      refused = res.statusCode === 401;
      res.resume?.();
      try { ws.terminate(); } catch { /* already gone */ }
    });
    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.online = true;
      this.opened++;
      this.inflight.clear();
      // The subscription is a read and stays, also with a ride open.
      try { ws.send(JSON.stringify({ type: 'subscribe', profileId: this.opts.profileId } satisfies CoachClientMessage)); } catch { /* the close follows */ }
      this.flush();
      this.changed();
    });
    ws.on('message', (data) => { if (this.ws === ws) this.received(String(data)); });
    // 1013 (coach not ready or unavailable) and 4404 (not moved on the server) alike: keep the cache, show offline, try later.
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      const was = this.online;
      this.online = false;
      this.inflight.clear();
      if (refused) { try { this.opts.reject?.(); } catch { /* the token stays unused anyway */ } }
      this.later();
      if (was) this.changed();
    });
  }

  private received(raw: string): void {
    let m: unknown;
    try { m = JSON.parse(raw); } catch { return; }
    if (!isObj(m) || typeof m.type !== 'string') return;
    // The coach answers: the backoff starts over only now, not on an open the api gives before the coach is there.
    this.backoffMs = MIN_BACKOFF_MS;
    if (m.type === 'queued-ack') {
      if (typeof m.qid !== 'string') return;
      this.inflight.delete(m.qid);
      const before = this.queue.length;
      this.queue = this.queue.filter((e) => e.qid !== m.qid);
      if (this.queue.length !== before) { this.saveQueue(); this.changed(); }
      return;
    }
    if (m.type === 'coach-state') {
      if (!isObj(m.state) || (m.state as { profileId?: unknown }).profileId !== this.opts.profileId) return;
      this.cache = { receivedMs: this.opts.nowMs(), view: m as CoachStateMessage };
      try { writeAtomic(this.stateFile, this.cache); } catch (e) { log.error('state cache not saved', e); /* shown from memory, written with the next state */ }
      this.changed();
      return;
    }
    try { this.opts.onMessage(m as CoachServerMessage); } catch { /* a listener never stops the coach */ }
  }

  /** Sends what is queued and not yet on its way, in order. Nothing goes out while a ride is open. */
  private flush(): void {
    if (!this.ws || !this.online || this.queue.length === 0) return;
    let may = false;
    try { may = this.opts.mayWrite(); } catch { /* unsure: wait */ }
    if (!may) return;
    for (const e of this.queue) {
      if (this.inflight.has(e.qid)) continue;
      try { this.ws.send(JSON.stringify({ type: 'queued', qid: e.qid, atMs: e.atMs, message: e.message } satisfies CoachClientMessage)); } catch { return; }
      this.inflight.add(e.qid);
    }
  }

  /**
   * A message from the Mac's interface. A write is queued with its time and goes out at once when it may ('sent'), or
   * later ('queued'). A request that wants the server now (a preview, a login, a key, an upload) is 'refused' while offline
   * or with a ride open.
   */
  send(m: CoachClientMessage): 'sent' | 'queued' | 'refused' {
    if (m.type === 'queued') return 'refused';
    if (QUEUEABLE.has(m.type)) {
      if (m.type === 'pass-progress') {
        const merged = this.mergeProgress(m);
        if (merged === 'kept') return 'queued';
      }
      // Full: refused, and the view says so, so nothing is dropped silently.
      if (this.queue.length >= MAX_QUEUE) { this.changed(); return 'refused'; }
      const e: Entry = { qid: randomUUID(), atMs: this.opts.nowMs(), message: m };
      this.queue.push(e);
      this.saveQueue();
      this.flush();
      const out = this.inflight.has(e.qid) ? 'sent' : 'queued';
      this.changed();
      return out;
    }
    let may = false;
    try { may = this.opts.mayWrite(); } catch { /* unsure: refuse */ }
    if (!this.ws || !this.online || (!may && m.type !== 'subscribe')) return 'refused';
    try { this.ws.send(JSON.stringify(m)); return 'sent'; } catch { return 'refused'; }
  }

  /**
   * The running ride, for the phone. Fire and forget: sent only when the socket is open right now, never queued, never kept.
   * A full socket buffer drops the message (the next state replaces it). Works with a ride open, on purpose. Never throws.
   */
  sendLive(m: LiveMessage): boolean {
    try {
      const ws = this.ws;
      if (!ws || !this.online) return false;
      if ((ws.bufferedAmount ?? 0) > 64 * 1024) return false;
      ws.send(JSON.stringify(m));
      return true;
    } catch { return false; }
  }

  /**
   * A pass ride reports its distance every 30 s: only the latest report per pass is kept in the queue, back to the last
   * summit or pick of that pass. A lower distance never replaces a higher one ('kept'); a higher one takes the old one's
   * place at the end of the queue ('replaced').
   */
  private mergeProgress(m: Extract<CoachClientMessage, { type: 'pass-progress' }>): 'kept' | 'replaced' | 'none' {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]!.message;
      if ((q.type === 'pass-summit' || q.type === 'pass-select') && q.passId === m.passId) return 'none';
      if (q.type !== 'pass-progress' || q.passId !== m.passId) continue;
      if (!(m.distanceM > q.distanceM)) return 'kept';
      this.queue.splice(i, 1);
      return 'replaced';
    }
    return 'none';
  }

  view(): CoachStateMessage {
    const home = (session: 'server' | 'cached' | 'rules'): CoachHome => ({ where: 'server', online: this.online, sinceMs: this.cache?.receivedMs ?? null, session, queued: this.queue.length, full: this.queue.length >= MAX_QUEUE });
    if (this.cache) {
      const v = this.cache.view;
      return this.online ? { ...v, coachHome: home('server') } : { ...v, thinking: false, debriefing: false, coachHome: home('cached') };
    }
    const now = this.opts.nowMs();
    return { type: 'coach-state', state: this.opts.fallback(), thinking: false, together: computeTogether([], [], now), coachHome: home('rules') };
  }

  /** Which connection is open now; changes with every new one. */
  connection(): number { return this.opened; }

  status(): { online: boolean; sinceMs: number | null; queued: number } {
    return { online: this.online, sinceMs: this.cache?.receivedMs ?? null, queued: this.queue.length };
  }
}
