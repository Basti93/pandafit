import type { IncomingMessage } from 'node:http';
import { tokenMatches } from './local-token';

/**
 * Only our own UI and local scripts (without an Origin) may talk to it, so that no foreign web page can end a running ride.
 * The machine's token in `?t=` is the real guard: a foreign page cannot read it. Origin `null` passes only with the token,
 * because a file:// page in Electron may report it.
 * An occupied port is retried; recording continues even without a UI.
 */
export const originAllowed = (devOrigin?: string) => {
  const allowed = new Set<string | undefined>([undefined, 'file://', 'null', devOrigin]);
  return ({ origin }: { origin?: string }): boolean => allowed.has(origin);
};

export const tokenOf = (req: IncomingMessage): string | null => {
  try { return new URL(req.url ?? '/', 'http://local').searchParams.get('t'); } catch { return null; }
};

export const localClientAllowed = (token: string, devOrigin?: string) => {
  const origin = originAllowed(devOrigin);
  return (info: { origin?: string; req: IncomingMessage }): boolean => origin(info) && tokenMatches(token, tokenOf(info.req));
};
