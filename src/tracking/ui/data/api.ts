/** The one fetch wrapper of the web app: same-origin cookies, no redirects, always a timeout. `fetchFn` is injected so tests and the shell control it. */
export type ApiInit = RequestInit & { timeoutMs?: number };
export const API_TIMEOUT_MS = 15_000;

export function apiFetch(fetchFn: typeof fetch, path: string, init: ApiInit = {}): Promise<Response> {
  const { timeoutMs = API_TIMEOUT_MS, ...rest } = init;
  return fetchFn(path, { ...rest, credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
}

/** A JSON body sent with POST. */
export const jsonInit = (method: 'POST', body: unknown, timeoutMs?: number): ApiInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(timeoutMs === undefined ? {} : { timeoutMs }),
});
