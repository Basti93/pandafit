import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { registerCoachProxy } from '../../web-server/coach-proxy';

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const c of closers.splice(0)) await c().catch(() => {}); });

const IMG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8, 5)]);

it('passes a picture and its caching headers through for a login, answers 304 for a known ETag, and refuses without a login', async () => {
  const seen: IncomingHttpHeaders[] = [];
  const coach = Fastify({ logger: false });
  coach.get('/recipes/:id/image', async (req, reply) => {
    seen.push(req.headers);
    reply.header('Cache-Control', 'private, max-age=604800').header('ETag', '"abc"');
    if (req.headers['if-none-match'] === '"abc"') return reply.code(304).send();
    return reply.type('image/jpeg').send(IMG);
  });
  await coach.listen({ port: 0, host: '127.0.0.1' });
  closers.push(() => coach.close());
  const app = Fastify({ logger: false });
  let loggedIn = true;
  registerCoachProxy(app, { coachUrl: `http://127.0.0.1:${(coach.server.address() as AddressInfo).port}`, token: 't'.repeat(64), resolve: async () => (loggedIn ? 7 : null) });
  closers.push(() => app.close());

  const ok = await app.inject({ method: 'GET', url: '/coach/recipes/c-0123456789abcd/image', headers: { cookie: 'session=x' } });
  expect(ok.statusCode).toBe(200);
  expect(ok.headers['content-type']).toBe('image/jpeg');
  expect(ok.headers['cache-control']).toBe('private, max-age=604800');
  expect(ok.headers.etag).toBe('"abc"');
  expect(ok.rawPayload.equals(IMG)).toBe(true);
  expect(seen[0]!['x-pandafit-account']).toBe('7');
  expect(seen[0]!.cookie).toBeUndefined();

  const known = await app.inject({ method: 'GET', url: '/coach/recipes/c-0123456789abcd/image', headers: { 'if-none-match': '"abc"' } });
  expect(known.statusCode).toBe(304);
  expect(known.rawPayload.length).toBe(0);

  loggedIn = false;
  const out = await app.inject({ method: 'GET', url: '/coach/recipes/c-0123456789abcd/image' });
  expect(out.statusCode).toBe(401);
  expect(seen).toHaveLength(2);
});
