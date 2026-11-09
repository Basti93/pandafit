import { lookup as dnsLookup } from 'node:dns/promises';
import { logServerErrors, fastifyLogger } from '../src/shared/node/log';
import { ACCOUNT_ID, BODY_LIMIT, installErrorHandler, tokenDigest, tokenMatches } from '../src/shared/node/server-kit';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb } from './db';
import type { DatabaseSync } from 'node:sqlite';
import { pushFor, type PushOptions } from './push';
import { listRecords, pageOfQuery, putRecordsAndNotify, recordsOfBody } from './records';

/** The internal listener's port, reached by the coach container over the internal network only. */
export const INTERNAL_PORT = 8081;

export const validInternalToken = (t: string): boolean => /^[0-9a-f]{64}$/i.test(t);

/**
 * The coach's way to an account's records: the same store and rules as the public /records routes, with the internal token in
 * place of a login, and the account named in the path. A separate app on its own port and database handle, so the public port
 * never has these routes. A new meal week written here sends its push like one written by a phone.
 */
/** How long a resolved peer address list is trusted. */
const PEER_TTL_MS = 10_000;
export type PeerCheck = { host: string; lookup?: (host: string) => Promise<{ address: string }[]> };
const bare = (ip: string): string => ip.replace(/^::ffff:/i, '').toLowerCase();

export const buildInternal = (opts: { dbPath: string; db?: DatabaseSync; token: string; push?: PushOptions; nowMs?: () => number; peer?: PeerCheck }): FastifyInstance => {
  const db = opts.db ?? openDb(opts.dbPath);
  const now = opts.nowMs ?? Date.now;
  const app = Fastify({ logger: fastifyLogger(), bodyLimit: BODY_LIMIT, requestTimeout: 30000 });
  logServerErrors(app);
  // No version announcement here: the public app does that once.
  const { push } = pushFor(db, opts.push && { ...opts.push, version: null }, now);
  const expected = tokenDigest(`Bearer ${opts.token}`);

  installErrorHandler(app, 'internal error');
  // With a peer name set, only the addresses it resolves to may talk to this listener (the name is the coach on the internal network).
  // A failed lookup refuses everyone. The answer is cached for 10 seconds.
  const peer = opts.peer;
  const resolveAll = peer?.lookup ?? ((h: string) => dnsLookup(h, { all: true }));
  let known: { at: number; addresses: Set<string> } | null = null;
  const peerAddresses = async (): Promise<Set<string>> => {
    const t = now();
    if (known && t - known.at < PEER_TTL_MS && t >= known.at) return known.addresses;
    try {
      known = { at: t, addresses: new Set((await resolveAll(peer!.host)).map((a) => bare(a.address))) };
    } catch {
      known = { at: t, addresses: new Set() };
    }
    return known.addresses;
  };
  app.addHook('onRequest', async (req, reply) => {
    if (peer && !(await peerAddresses()).has(bare(req.socket.remoteAddress ?? ''))) return reply.code(403).send({ error: 'forbidden' });
    const auth = req.headers.authorization;
    if (!tokenMatches(auth, expected)) return reply.code(401).send({ error: 'unauthorized' });
  });

  /** The account in the path, when it exists. */
  const accountOf = (raw: string): number | null => {
    if (!ACCOUNT_ID.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id) ? id : null;
  };

  app.post<{ Params: { id: string } }>('/internal/accounts/:id/records', async (req, reply) => {
    const account = accountOf(req.params.id);
    if (account === null) return reply.code(404).send({ error: 'not found' });
    const list = recordsOfBody(req.body);
    if (!list) return reply.code(400).send({ error: 'bad request' });
    return putRecordsAndNotify(db, push, account, list, now(), 'coach');
  });

  app.get<{ Params: { id: string }; Querystring: { since?: string; limit?: string } }>('/internal/accounts/:id/records', async (req, reply) => {
    const account = accountOf(req.params.id);
    if (account === null) return reply.code(404).send({ error: 'not found' });
    const page = pageOfQuery(req.query);
    if (!page) return reply.code(400).send({ error: 'bad request' });
    return listRecords(db, account, page.since, page.limit);
  });

  app.addHook('onClose', async () => { if (!opts.db) db.close(); });
  return app;
};

/**
 * Builds and starts the internal app. A port that cannot be had is logged (never the token) and the api carries on without it:
 * the coach's records sync then waits and tries again.
 */
export async function startInternal(opts: Parameters<typeof buildInternal>[0] & { host: string; port: number }): Promise<FastifyInstance | null> {
  const app = buildInternal(opts);
  try {
    await app.listen({ host: opts.host, port: opts.port });
    return app;
  } catch (e) {
    console.error('internal listener failed to start', opts.host, opts.port, (e as { code?: string }).code ?? (e as { name?: string }).name ?? 'Error');
    await app.close().catch(() => {});
    return null;
  }
}
