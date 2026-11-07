import { askRemote } from '../../src/coach/remote-claude-client';
import type { ClaudeError } from '../../src/coach/claude-client';

const input = { prompt: 'p', systemPrompt: 's', schema: { type: 'object' }, timeoutMs: 90_500, model: 'm' };
const respond = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status }));
const kindOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as ClaudeError).kind; } };
const cfg = (fetchFn: typeof fetch) => ({ url: 'http://homeserver-ai:8080', token: 'tok', fetchFn });

test('sends_contract_body', async () => {
  const fetchFn = respond(200, { status: 'ok', output: { a: 1 } });
  expect(await askRemote(input, cfg(fetchFn as unknown as typeof fetch))).toEqual({ a: 1 });
  const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://homeserver-ai:8080/v1/ask');
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  expect(JSON.parse(String(init.body))).toEqual({ prompt: 'p', system: 's', schema: { type: 'object' }, max_seconds: 91, model: 'm' });
});

test('maps_statuses_to_claude_error_kinds', async () => {
  const cases: [number, string, string][] = [
    [429, 'plan_limit', 'limit'], [429, 'client_limit', 'failed'], [503, 'busy', 'timeout'], [504, 'timeout', 'timeout'],
    [422, 'invalid', 'invalid'], [401, 'unauthorized', 'failed'], [502, 'failed', 'failed'], [500, 'whatever', 'failed'],
  ];
  for (const [code, status, kind] of cases) {
    expect(await kindOf(askRemote(input, cfg(respond(code, { status }) as unknown as typeof fetch))), status).toBe(kind);
  }
});

test('client_limit_names_the_service_limit', async () => {
  await expect(askRemote(input, cfg(respond(429, { status: 'client_limit' }) as unknown as typeof fetch))).rejects.toThrow('Tageslimit des Coaches im KI-Dienst erreicht');
});

test('network_error_maps_to_failed', async () => {
  const fetchFn = vi.fn(async () => { throw new TypeError('fetch failed'); });
  expect(await kindOf(askRemote(input, cfg(fetchFn as unknown as typeof fetch)))).toBe('failed');
});

test('fetch_timeout_is_timeout', async () => {
  let signal: AbortSignal | undefined;
  const fetchFn = vi.fn(async (_u: string, init: RequestInit) => { signal = init.signal ?? undefined; throw new DOMException('timed out', 'TimeoutError'); });
  expect(await kindOf(askRemote({ ...input, timeoutMs: undefined }, cfg(fetchFn as unknown as typeof fetch)))).toBe('timeout');
  expect(signal).toBeDefined();
});

test('fetch_timeout_budget_covers_wait_and_run', () => {
  // exported for the test: queue wait (120 s) plus reserve on top of the run time
  return import('../../src/coach/remote-claude-client').then(({ remoteTimeoutMs }) => {
    expect(remoteTimeoutMs(undefined)).toBe(180_000 + 130_000);
    expect(remoteTimeoutMs(60_000)).toBe(60_000 + 130_000);
  });
});

test('ok_without_output_is_invalid', async () => {
  expect(await kindOf(askRemote(input, cfg(respond(200, { status: 'ok' }) as unknown as typeof fetch)))).toBe('invalid');
});

test('carries_http_status_code_and_reset_for_the_gate', async () => {
  const reset = Date.parse('2026-11-08T03:00:00Z');
  try { await askRemote(input, cfg(respond(429, { status: 'plan_limit', reset_at: new Date(reset).toISOString() }) as unknown as typeof fetch)); } catch (e) {
    expect((e as ClaudeError).info).toEqual({ http: 429, code: 'plan_limit', resetAtMs: reset });
  }
  try { await askRemote(input, cfg((async () => { throw new Error('down'); }) as unknown as typeof fetch)); } catch (e) {
    expect((e as ClaudeError).info).toEqual({ network: true });
  }
});
