import { ClaudeError, type ClaudeErrorInfo, type ClaudeErrorKind } from './claude-client';

/** Waiting in the service's queue (up to 120 s) plus a reserve, on top of the run time the coach allows. */
const WAIT_RESERVE_MS = 130_000;
const DEFAULT_RUN_MS = 180_000;
export const remoteTimeoutMs = (timeoutMs: number | undefined): number => (timeoutMs ?? DEFAULT_RUN_MS) + WAIT_RESERVE_MS;

const KINDS: Record<string, [ClaudeErrorKind, string]> = {
  plan_limit: ['limit', 'Das Plan-Limit ist erreicht.'],
  client_limit: ['failed', 'Tageslimit des Coaches im KI-Dienst erreicht.'],
  busy: ['timeout', 'Der KI-Dienst ist gerade belegt.'],
  timeout: ['timeout', 'claude hat nicht rechtzeitig geantwortet.'],
  invalid: ['invalid', 'Claude lieferte keine gültigen Daten.'],
  unauthorized: ['failed', 'Der KI-Dienst kennt das Token des Coaches nicht.'],
};

/** A reset time as the service may give it: epoch seconds or milliseconds, or an ISO date. */
const resetOf = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? undefined : t; }
  return undefined;
};
const retryAfterOf = (h: string | null | undefined): number | undefined => {
  const sec = Number(h);
  return h && Number.isFinite(sec) && sec > 0 ? Date.now() + sec * 1000 : undefined;
};

/**
 * askClaude through the home server's AI service (heimserver ki/README.md). Same input and result as askClaude.
 * Never falls back to a local claude: two copies of one login would invalidate each other.
 */
export const askRemote = async (
  input: { prompt: string; systemPrompt: string; schema: object; timeoutMs?: number; model?: string },
  cfg: { url: string; token: string; fetchFn?: typeof fetch },
): Promise<unknown> => {
  let res: Response;
  try {
    res = await (cfg.fetchFn ?? fetch)(`${cfg.url}/v1/ask`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: input.prompt, system: input.systemPrompt, schema: input.schema,
        max_seconds: Math.ceil((input.timeoutMs ?? DEFAULT_RUN_MS) / 1000),
        ...(input.model ? { model: input.model } : {}),
      }),
      signal: AbortSignal.timeout(remoteTimeoutMs(input.timeoutMs)),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new ClaudeError('timeout', 'Der KI-Dienst hat nicht rechtzeitig geantwortet.');
    throw new ClaudeError('failed', `KI-Dienst nicht erreichbar: ${(e as Error).message}`.slice(0, 200), { network: true });
  }
  let json: { status?: string; code?: string; output?: unknown; message?: string; reset_at?: unknown; resets_at?: unknown; reset?: unknown } = {};
  try { json = await res.json(); } catch { /* treated as failed below */ }
  if (res.ok && json.status === 'ok') {
    if (json.output === undefined) throw new ClaudeError('invalid', 'Die Antwort enthielt keine strukturierten Daten.');
    return json.output;
  }
  const code = json.status ?? json.code ?? '';
  const [kind, message] = KINDS[code] ?? ['failed', `KI-Dienst: HTTP ${res.status} ${json.message ?? ''}`.trim().slice(0, 200)];
  const resetAtMs = resetOf(json.reset_at ?? json.resets_at ?? json.reset) ?? retryAfterOf(res.headers?.get?.('retry-after'));
  const info: ClaudeErrorInfo = { http: res.status, ...(code ? { code } : {}), ...(resetAtMs !== undefined ? { resetAtMs } : {}) };
  throw new ClaudeError(kind, message, info);
};
