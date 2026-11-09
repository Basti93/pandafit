export type Logger = {
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
  error(msg: string, err?: unknown, data?: object): void;
};

const errInfo = (err: unknown): { name: string; message: string } =>
  err instanceof Error ? { name: err.name, message: err.message } : { name: 'Error', message: String(err) };

/**
 * One JSON line per entry on stderr. `data` carries ids, counts and durations only: never bodies, tokens, health values or chat text.
 * PANDAFIT_LOG=silent turns it off (tests).
 */
export const createLogger = (scope: string): Logger => {
  const write = (level: string, msg: string, extra: object): void => {
    if (process.env.PANDAFIT_LOG === 'silent') return;
    try { process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...extra })}\n`); } catch { /* logging must never throw */ }
  };
  return {
    info: (msg, data) => write('info', msg, data ?? {}),
    warn: (msg, data) => write('warn', msg, data ?? {}),
    error: (msg, err, data) => write('error', msg, { ...(err === undefined ? {} : { err: errInfo(err) }), ...(data ?? {}) }),
  };
};

type HookApp = {
  addHook(name: 'onResponse', fn: (req: { method: string; routeOptions?: { url?: string }; routerPath?: string }, reply: { statusCode: number; elapsedTime?: number; getResponseTime?: () => number }, done: () => void) => void): unknown;
};

/** Logs every 5xx response with method, route pattern (not the URL with its parameters) and duration. */
export const logServerErrors = (app: HookApp): void => {
  const log = createLogger('http');
  app.addHook('onResponse', (req, reply, done) => {
    if (reply.statusCode >= 500) {
      const ms = Math.round(reply.elapsedTime ?? reply.getResponseTime?.() ?? 0);
      log.error('server error', undefined, { method: req.method, route: req.routeOptions?.url ?? req.routerPath ?? 'unknown', status: reply.statusCode, ms });
    }
    done();
  });
};

/** Fastify's own logger: warnings and errors only, nothing in tests. */
export const fastifyLogger = (): { level: string } => ({ level: process.env.PANDAFIT_LOG === 'silent' ? 'silent' : 'warn' });
