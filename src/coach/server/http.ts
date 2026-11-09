import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { logServerErrors, fastifyLogger } from '../../shared/node/log';
import { ACCOUNT_ID, startHeartbeat, tokenDigest, tokenMatches } from '../../shared/node/server-kit';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { parseCoachClientMessage } from '../../shared/coach-messages';
import { QUEUEABLE, type CoachClientMessage, type CoachServerMessage, type CoachStateMessage } from '../protocol';
import { ChangeClock, changeKey, isHouseholdKey } from './change-clock';
import { HandledQids } from './handled-qids';
import { RIDE_ID } from '../ride-upload-format';
import { listRides, loadRide, storeRide } from './ride-store';
import { RecordStore } from '../tracking/store';
import type { AccountCoach, Household } from './household';
import { LIVE_TYPES, type LiveMessage } from '../../shared/live';
import { LiveChannel } from './live';
import { MAX_ITEM_BYTES, MigrationError, parseManifest } from './migration';

export type CoachServerOptions = {
  household: Household; internalToken: string; nowMs?: () => number;
  /** How often sockets are pinged; one that has not answered the previous ping by then is cut. Shorter in tests. */
  pingMs?: number;
  /** How long a connection may stay silent, request body included, before it is cut. Shorter in tests. */
  idleMs?: number;
};

const MAX_PAYLOAD = 256 * 1024;
/** A client's id for a queued entry: a uuid, with room to spare. */
const MAX_QID = 100;

type Conn = { ws: WebSocket; subscribed: boolean; /** Follows the running ride (the phone). */ watching: boolean; lastSent: string | null };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Per account: what the restore drill compares. Counts only, never content, read from the disk without starting a coach. */
const accountCounts = (a: { profileId: string; dir: string }) => {
  const count = (dir: string, test: (name: string) => boolean): number => { try { return fs.readdirSync(dir).filter(test).length; } catch { return 0; } };
  const rides = count(path.join(a.dir, 'rides'), (name) => RIDE_ID.test(name) && fs.existsSync(path.join(a.dir, 'rides', name, 'meta.json')));
  let records = 0;
  try { records = new RecordStore({ dir: path.join(a.dir, 'coach', 'tracking') }).all(a.profileId).length; } catch { /* no records yet */ }
  return {
    profileId: a.profileId, rides, records,
    coach: fs.existsSync(path.join(a.dir, 'coach', `${encodeURIComponent(a.profileId)}.json`)),
    garminDb: fs.existsSync(path.join(a.dir, 'garmin', 'data', a.profileId, 'garmin.db')),
    hevyKey: fs.existsSync(path.join(a.dir, 'hevy', a.profileId, 'api-key')),
  };
};

/**
 * The household coach on the internal network. Only the api reaches it, and the api names the account in a header with the
 * internal token, so the account always comes from a login and never from a client. Every message must carry that account's
 * profile id. Message bodies are never logged.
 */
export const buildCoachServer = (opts: CoachServerOptions): FastifyInstance => {
  const { household } = opts;
  const nowMs = opts.nowMs ?? (() => Date.now());
  // No limit on a request's total time: an upload streamed through the api at the client's pace (up to 128 MiB) must complete.
  // A connection that goes silent is cut instead; Node's headersTimeout still bounds the headers.
  const app = Fastify({ logger: fastifyLogger(), bodyLimit: 64 * 1024, requestTimeout: 0, connectionTimeout: opts.idleMs ?? 60_000 });
  logServerErrors(app);
  const expectedToken = tokenDigest(opts.internalToken);

  const tokenOk = (h: unknown): boolean => tokenMatches(h, expectedToken);
  const accountOf = (h: unknown): number | null => {
    if (typeof h !== 'string' || !ACCOUNT_ID.test(h)) return null;
    const id = Number(h);
    return Number.isSafeInteger(id) ? id : null;
  };
  const authorised = (req: IncomingMessage): number | null => (tokenOk(req.headers['x-pandafit-internal']) ? accountOf(req.headers['x-pandafit-account']) : null);

  app.addHook('onRequest', async (req, reply) => {
    // /healthz checks the token itself, for counts only.
    if (req.url.split('?')[0] === '/healthz') return;
    if (authorised(req.raw) === null) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/healthz', async (req, reply) => {
    // One parser decides: any counts=1 among the query values asks for counts, and that needs the token.
    const value = (req.query as Record<string, unknown>).counts;
    const counts = (Array.isArray(value) ? value : [value]).includes('1');
    if (!counts) return { ok: true };
    if (!tokenOk(req.headers['x-pandafit-internal'])) return reply.code(401).send({ error: 'unauthorized' });
    const accounts: Record<string, ReturnType<typeof accountCounts>> = {};
    for (const a of household.movedAccounts()) accounts[String(a.accountId)] = accountCounts(a);
    return { ok: true, accounts };
  });

  const desk = household.migrationDesk();

  app.get('/status', async (req) => {
    const accountId = authorised(req.raw)!;
    const a = household.account(accountId);
    // Before the move the profile id bound by begin.
    return { profileId: a?.profileId ?? desk.boundProfileId(accountId), moved: a !== null };
  });

  // ---- Rides from the Mac ----

  // The account comes from the header, so a ride lands in that account's folder only and only with its bound profile id.
  // During a move (begun, not finished) rides land there too, without a coach to read them yet.
  // The account's rides, for a Mac that lost its own. Only the account's folder and only the bound profile's closed rides.
  const rideTarget = (accountId: number): { dir: string; profileId: string } | null => {
    const a = household.account(accountId);
    if (a) return { dir: a.dir, profileId: a.profileId };
    const bound = desk.boundProfileId(accountId);
    return bound ? { dir: path.join(household.accountsDir(), String(accountId)), profileId: bound } : null;
  };

  app.get('/rides', async (req, reply) => {
    const target = rideTarget(authorised(req.raw)!);
    if (!target) return reply.code(404).send({ error: 'not moved' });
    return { rides: listRides(path.join(target.dir, 'rides'), target.profileId) };
  });

  app.get('/rides/:rideId', async (req, reply) => {
    const target = rideTarget(authorised(req.raw)!);
    if (!target) return reply.code(404).send({ error: 'not moved' });
    const u = loadRide(path.join(target.dir, 'rides'), (req.params as { rideId: string }).rideId, target.profileId);
    return u ?? reply.code(404).send({ error: 'no such ride' });
  });

  app.put('/rides/:rideId', { bodyLimit: 32 * 1024 * 1024 }, async (req, reply) => {
    const accountId = authorised(req.raw)!;
    const target = rideTarget(accountId);
    const a = household.account(accountId);
    if (!target) return reply.code(404).send({ error: 'not moved' });
    const upload = req.body;
    const rideId = (req.params as { rideId: string }).rideId;
    if (!RIDE_ID.test(rideId) || (upload as { rideId?: unknown } | null)?.rideId !== rideId) return reply.code(409).send({ reason: 'invalid' });
    let out;
    try { out = storeRide({ ridesDir: path.join(target.dir, 'rides'), profileId: target.profileId, upload, nowMs: nowMs() }); } catch { return reply.code(500).send({ error: 'store failed' }); }
    if (!out.ok) return reply.code(409).send({ reason: out.reason });
    // The coach reads the new ride now; a replaced copy is summarized again. A scan never uploads to Garmin: that only happens when the person asks.
    if (a && !out.same) { try { a.runtime.rideReplaced(a.profileId, rideId); a.runtime.scan(); } catch { /* the next scan reads it */ } }
    return { sha256: out.sha256, same: out.same };
  });

  // ---- Browsing recipes ----

  // The logged-in person's view of the household's recipes: only what the AI confirmed, their favourites marked.
  const noStore = { 'Cache-Control': 'private, no-store' };
  const list = (v: unknown): string[] => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
  app.get('/recipes/search', async (req, reply) => {
    const account = household.account(authorised(req.raw)!);
    const meals = account ? household.meals() : null;
    if (!account || !meals) return reply.code(404).send({ error: 'not moved' });
    const q = req.query as Record<string, unknown>;
    const num = (v: unknown): number | undefined => { const n = typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) ? n : undefined; };
    const page = meals.browse(account.profileId, {
      ...(typeof q.q === 'string' ? { q: q.q } : {}), tags: list(q.tags), own: q.own === '1', fav: q.fav === '1',
      ...(num(q.limit) !== undefined ? { limit: num(q.limit)! } : {}), ...(num(q.offset) !== undefined ? { offset: num(q.offset)! } : {}),
    });
    return reply.headers(noStore).send(page);
  });

  app.get('/recipes/:id', async (req, reply) => {
    const account = household.account(authorised(req.raw)!);
    const meals = account ? household.meals() : null;
    if (!account || !meals) return reply.code(404).send({ error: 'not moved' });
    const d = meals.recipeDetail(account.profileId, (req.params as { id: string }).id);
    return d ? reply.headers(noStore).send(d) : reply.code(404).send({ error: 'no such recipe' });
  });

  // ---- Recipe pictures ----

  // Only for an account that moved, and only a recipe the household can plan from. The picture is served as stored.
  app.get('/recipes/:id/image', async (req, reply) => {
    const accountId = authorised(req.raw)!;
    const id = (req.params as { id: string }).id;
    const account = household.account(accountId);
    if (!account) return reply.code(404).send({ error: 'not moved' });
    const store = household.meals()?.recipes() ?? null;
    let found: ReturnType<NonNullable<typeof store>['imageOf']> = null;
    try { found = store && /^[cl]-[0-9a-f]{14}$/.test(id) && store.canSee(id, account.profileId) ? store.imageOf(id) : null; } catch { found = null; }
    if (!found) return reply.code(404).send({ error: 'no picture' });
    let stat: fs.Stats;
    let bytes: Buffer;
    try { stat = fs.statSync(found.file); bytes = fs.readFileSync(found.file); } catch { return reply.code(404).send({ error: 'no picture' }); }
    const etag = `"${createHash('sha1').update(bytes).digest('hex').slice(0, 20)}"`;
    reply.header('Cache-Control', 'private, max-age=604800').header('ETag', etag).header('X-Content-Type-Options', 'nosniff').header('Last-Modified', stat.mtime.toUTCString());
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type(found.type).send(bytes);
  });

  // ---- The move from the Mac ----

  // Answers name only states, item names and ride ids: never content, never a secret.
  const deskError = (reply: FastifyReply, e: unknown) => {
    if (e instanceof MigrationError) return reply.code(e.reason === 'invalid' ? 400 : e.reason === 'too-large' ? 413 : 409).send({ reason: e.reason });
    return reply.code(500).send({ error: 'migration failed' });
  };

  app.post('/migrate/begin', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const m = parseManifest(req.body);
    if (!m) return reply.code(400).send({ reason: 'invalid' });
    try {
      const out = desk.begin(authorised(req.raw)!, m);
      return out.state === 'refused' ? reply.code(409).send(out) : out;
    } catch (e) { return deskError(reply, e); }
  });

  app.post('/migrate/finish', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const m = parseManifest(req.body);
    if (!m) return reply.code(400).send({ reason: 'invalid' });
    try { return desk.finish(authorised(req.raw)!, m); } catch (e) { return deskError(reply, e); }
  });

  // Raw bodies: an item is streamed to disk, the meal file is read as bytes. Their parsers stay inside this scope.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => { done(null, payload); });
    scope.put('/migrate/item/:name', async (req, reply) => {
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length > MAX_ITEM_BYTES) return reply.code(413).send({ reason: 'too-large' });
      const sha = req.headers['x-sha256'];
      const body = req.body as NodeJS.ReadableStream | undefined;
      if (!body || typeof (body as { pipe?: unknown }).pipe !== 'function') return reply.code(400).send({ reason: 'invalid' });
      let out;
      try { out = await desk.putItem(authorised(req.raw)!, (req.params as { name: string }).name, body, typeof sha === 'string' ? sha : ''); } catch (e) { return deskError(reply, e); }
      if (out === 'unknown') return reply.code(404).send({ result: out });
      if (out !== 'ok') return reply.code(409).send({ result: out });
      return { result: out };
    });
  });
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 4 * 1024 * 1024 }, (_req, body, done) => { done(null, body); });
    scope.post('/migrate/meals', async (req, reply) => {
      const body = req.body;
      if (!Buffer.isBuffer(body)) return reply.code(400).send({ reason: 'invalid' });
      let out;
      try { out = desk.meals(authorised(req.raw)!, body); } catch (e) { return deskError(reply, e); }
      return out === 'ok' ? { result: out } : reply.code(404).send({ result: out });
    });
  });

  // ---- The coach socket ----

  const conns = new Map<number, Set<Conn>>();
  const clocks = new Map<number, ChangeClock>();
  const unlisten = new Map<number, () => void>();
  const handledQids = new Map<number, HandledQids>();
  const qidsOf = (a: AccountCoach): HandledQids => {
    let q = handledQids.get(a.accountId);
    if (!q) { q = new HandledQids(path.join(a.dir, 'qids.json')); handledQids.set(a.accountId, q); }
    return q;
  };
  const clockOf = (a: AccountCoach): ChangeClock => {
    let c = clocks.get(a.accountId);
    if (!c) { c = new ChangeClock(path.join(a.dir, 'clock.json')); clocks.set(a.accountId, c); }
    return c;
  };

  /** The runtime's view plus the account's profile, whose FTP is the coach's. */
  const viewOf = (a: AccountCoach): CoachStateMessage | null => {
    const v = a.runtime.view(a.profileId);
    if (!v) return null;
    return { ...v, profile: { ...a.profile(), ftpW: v.state.ftpW } };
  };
  const send = (c: Conn, m: CoachServerMessage): void => { try { c.ws.send(JSON.stringify(m)); } catch { /* connection gone */ } };
  /** A view goes out only when it changed since the last one on this connection. */
  const sendView = (c: Conn, a: AccountCoach): void => {
    const v = viewOf(a);
    if (!v) return;
    try {
      const body = JSON.stringify(v);
      if (c.lastSent !== body) { c.ws.send(body); c.lastSent = body; }
    } catch { /* connection gone */ }
  };
  // The running ride of each account, in memory only; see live.ts.
  const live = new LiveChannel<Conn>({
    nowMs, send: (c, m: LiveMessage) => send(c, m), peers: (id) => conns.get(id) ?? [], watching: (c) => c.watching,
  });
  const publish = (a: AccountCoach): void => { for (const c of conns.get(a.accountId) ?? []) if (c.subscribed) sendView(c, a); };

  const listen = (a: AccountCoach): void => {
    if (unlisten.has(a.accountId)) return;
    unlisten.set(a.accountId, a.runtime.onChange((profileId) => {
      if (profileId === a.profileId) for (const c of conns.get(a.accountId) ?? []) if (c.subscribed) send(c, { type: 'records-changed', profileId });
      publish(a);
    }));
  };

  /** Whether a keyed change will take effect, judged before it is applied. A refused one must not move the clock. */
  const takesEffect = (a: AccountCoach, m: CoachClientMessage): boolean => {
    try {
      const meals = a.runtime.view(a.profileId)?.meals ?? null;
      const planned = (week: unknown) => meals !== null && meals.settings.on && meals.weeks.some((w) => w.plan.week === week);
      switch (m.type) {
        case 'complaint-update': return (a.runtime.coachState(a.profileId)?.complaints ?? []).some((c) => c.id === m.id) && ['active', 'healing', 'over'].includes(m.status);
        case 'set-ftp': return typeof m.ftpW === 'number' && m.ftpW >= 50;
        case 'feedback': return typeof m.rideId === 'string' && ['easy', 'right', 'hard'].includes(m.rating);
        case 'meals-settings': return meals !== null;
        case 'meals-item': return planned(m.week) && typeof m.item === 'string' && ['offen', 'gekauft', 'da'].includes(m.state);
        case 'meals-eater': return planned(m.week) && (meals?.weeks.find((w) => w.plan.week === m.week)?.plan.people.some((p) => p.id === m.person) ?? false);
        case 'garmin-upload-settings': return m.mode === 'off' || m.mode === 'ask';
        default: return true;
      }
    } catch { return false; }
  };

  /** True for a complaint change made before the complaint's last change, wherever that was made. */
  const olderThanComplaint = (a: AccountCoach, m: CoachClientMessage, atMs: number): boolean => {
    if (m.type !== 'complaint-update') return false;
    const have = (a.runtime.coachState(a.profileId)?.complaints ?? []).find((x) => x.id === m.id);
    return have !== undefined && atMs < have.updatedMs;
  };

  /** One message for this account, live or from a client's queue. Anything for another profile id is refused without an answer. */
  const apply = (c: Conn, a: AccountCoach, m: Record<string, unknown>, atMs: number, queued: boolean): void => {
    if (typeof m.type !== 'string' || m.profileId !== a.profileId) return;
    const msg = m as CoachClientMessage;
    const key = changeKey(msg);
    // The shared meal plan's items have one clock for the household; everything else is the account's own.
    const clock = key === null ? null : isHouseholdKey(key) ? household.mealClock() : clockOf(a);
    // A queued change older than the item's last change is skipped. A live one is the newest by definition.
    if (key !== null && clock && queued && !clock.admits(key, atMs)) return;
    // The phone changes a complaint through the records, which the clock does not see; the complaint's own time does.
    if (queued && olderThanComplaint(a, msg, atMs)) return;
    // Only a change that takes effect moves the clock.
    const stamp = (): void => { if (key !== null && clock) clock.stamp(key, atMs); };
    if (msg.type === 'profile-update') {
      try { a.setProfile(msg.profile); } catch { return; }
      stamp();
      publish(a);
      return;
    }
    if (key !== null && takesEffect(a, msg)) stamp();
    if (msg.type === 'subscribe') {
      c.subscribed = true;
      // The runtime reads new rides on subscribe; its own view is replaced by the one with the profile.
      a.runtime.handle(msg, () => {});
      sendView(c, a);
      return;
    }
    // A queued change keeps the time it was made, so it is newest only against older changes, here and in the exported records.
    a.runtime.handle(msg, (reply) => {
      if (reply.type === 'coach-state') sendView(c, a);
      else send(c, reply);
    }, queued ? atMs : undefined);
  };

  const onMessage = (c: Conn, a: AccountCoach, data: RawData, isBinary: boolean): void => {
    if (isBinary) return;
    let m: unknown;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!isObj(m)) return;
    const now = nowMs();
    try {
      if (m.type === 'queued') {
        const qid = typeof m.qid === 'string' && m.qid !== '' && m.qid.length <= MAX_QID ? m.qid : null;
        try {
          // Handled before and its ack lost: acked again, never applied twice.
          if (qid !== null && qidsOf(a).has(qid)) return;
          const inner = m.message;
          if (typeof m.atMs !== 'number' || !Number.isFinite(m.atMs) || !isObj(inner)) return;
          if (typeof inner.type !== 'string' || !QUEUEABLE.has(inner.type as CoachClientMessage['type'])) return;
          if (parseCoachClientMessage(inner) === null) return;
          // A clock running ahead on the client never makes a change newer than now.
          apply(c, a, inner, Math.min(m.atMs, now), true);
        } finally {
          // Applied, stale or invalid: the entry is done either way, so the client may drop it. Its qid is remembered first, so
          // a re-send after a lost ack is not applied again. Kept in memory even when the file cannot be written.
          if (qid !== null) {
            try { if (!qidsOf(a).has(qid)) qidsOf(a).add(qid, now); } catch { /* remembered until the coach restarts */ }
            send(c, { type: 'queued-ack', qid });
          }
        }
        return;
      }
      if (m.type === 'live-watch') { c.watching = true; live.hello(a.accountId, c); return; }
      if (typeof m.type === 'string' && LIVE_TYPES.has(m.type)) { live.handle(a.accountId, a.profileId, c, m); return; }
      if (parseCoachClientMessage(m) === null) return;
      apply(c, a, m, now, false);
    } catch { /* an invalid message changes nothing */ }
  };

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  // A socket whose other end vanished without a close (the api restarted, the network broke) is found and cut.
  const heartbeat = startHeartbeat(wss, opts.pingMs ?? 30_000);
  app.server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if ((req.url ?? '').split('?')[0] !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {});
      heartbeat.watch(ws);
      const accountId = authorised(req);
      if (accountId === null) { ws.close(4401, 'unauthorized'); return; }
      const a = household.account(accountId);
      if (!a) { ws.close(4404, 'not moved'); return; }
      listen(a);
      const c: Conn = { ws, subscribed: false, watching: false, lastSent: null };
      let set = conns.get(accountId);
      if (!set) { set = new Set(); conns.set(accountId, set); }
      set.add(c);
      ws.on('message', (data, isBinary) => onMessage(c, a, data, isBinary));
      ws.on('close', () => { set.delete(c); live.closed(accountId, c); });
    });
  });

  app.addHook('onClose', async () => {
    heartbeat.stop();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    for (const off of unlisten.values()) off();
    unlisten.clear();
  });

  return app;
};
