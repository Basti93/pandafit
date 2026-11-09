import { createLogger } from '../../src/shared/node/log';

const capture = (fn: () => void): string[] => {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => { lines.push(String(s)); return true; }) as never);
  const prev = process.env.PANDAFIT_LOG;
  delete process.env.PANDAFIT_LOG;
  try { fn(); } finally { spy.mockRestore(); if (prev !== undefined) process.env.PANDAFIT_LOG = prev; }
  return lines;
};

test('writes one JSON line per entry with level, scope and data', () => {
  const [line] = capture(() => createLogger('hevy').warn('sync slow', { ms: 12 }));
  expect(line!.endsWith('\n')).toBe(true);
  const e = JSON.parse(line!);
  expect(e).toMatchObject({ level: 'warn', scope: 'hevy', msg: 'sync slow', ms: 12 });
  expect(typeof e.t).toBe('string');
});
test('error carries name and message of the error object, no stack', () => {
  const [line] = capture(() => createLogger('x').error('boom', new TypeError('bad')));
  const e = JSON.parse(line!);
  expect(e.level).toBe('error');
  expect(e.err).toEqual({ name: 'TypeError', message: 'bad' });
});
test('a non-error value is described, not dumped', () => {
  const [line] = capture(() => createLogger('x').error('boom', 'text'));
  expect(JSON.parse(line!).err).toEqual({ name: 'Error', message: 'text' });
});
test('PANDAFIT_LOG=silent writes nothing', () => {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => { lines.push(String(s)); return true; }) as never);
  const prev = process.env.PANDAFIT_LOG;
  process.env.PANDAFIT_LOG = 'silent';
  try { createLogger('x').error('boom', new Error('e')); } finally { spy.mockRestore(); if (prev === undefined) delete process.env.PANDAFIT_LOG; else process.env.PANDAFIT_LOG = prev; }
  expect(lines).toEqual([]);
});

test('the http hook logs a 5xx with method, route and duration, but not the url parameters', async () => {
  const { default: Fastify } = await import('fastify');
  const { logServerErrors } = await import('../../src/shared/node/log');
  const app = Fastify({ logger: false });
  logServerErrors(app as never);
  app.get('/item/:id', async (_req, reply) => reply.code(503).send({ secret: 'x' }));
  app.get('/ok', async () => ({ ok: true }));
  const lines = capture(() => {});
  void lines;
  const written: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => { written.push(String(s)); return true; }) as never);
  const prev = process.env.PANDAFIT_LOG;
  delete process.env.PANDAFIT_LOG;
  try {
    await app.inject({ method: 'GET', url: '/item/12345?token=abc' });
    await app.inject({ method: 'GET', url: '/ok' });
  } finally { spy.mockRestore(); if (prev !== undefined) process.env.PANDAFIT_LOG = prev; }
  expect(written).toHaveLength(1);
  const e = JSON.parse(written[0]!);
  expect(e).toMatchObject({ scope: 'http', level: 'error', method: 'GET', route: '/item/:id', status: 503 });
  expect(typeof e.ms).toBe('number');
  expect(written[0]).not.toContain('12345');
  expect(written[0]).not.toContain('abc');
});
