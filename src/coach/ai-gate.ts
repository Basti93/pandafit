import fs from 'node:fs';
import path from 'node:path';
import { ClaudeError } from './claude-client';
import { policyRule, ruleValues } from '../shared/training-policy';

/** What every AI caller sends; `background` marks work that may wait (tagging, backfills) and counts against the daily budget. */
export type GateInput = { prompt: string; systemPrompt: string; schema: object; timeoutMs?: number; model?: string; background?: boolean };
export type GateAsk = (input: GateInput) => Promise<unknown>;

const MIN = 60_000;
const TZ = 'Europe/Berlin';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const partsOf = (ms: number): { y: number; m: number; d: number; asUtc: number } => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)])) as Record<string, number>;
  return { y: p.year!, m: p.month!, d: p.day!, asUtc: Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) };
};
/** The Berlin calendar day of an instant, as YYYY-MM-DD. */
export const berlinDay = (ms: number): string => { const p = partsOf(ms); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
/** The next midnight in Berlin after `ms` (23, 24 or 25 hour days included). */
export const nextBerlinMidnight = (ms: number): number => {
  const p = partsOf(ms);
  const wall = Date.UTC(p.y, p.m - 1, p.d + 1, 0, 0, 0);
  let t = wall - (partsOf(wall).asUtc - wall);
  t = wall - (partsOf(t).asUtc - t);
  return t;
};

type State = { blockedUntilMs: number; reason: string; failures: number; day: string; used: number };

/**
 * The one gate in front of the shared AI service. A limit answer blocks every call (no request leaves) until it should be over;
 * background calls also stop at a daily budget so they cannot starve chat and plans. A blocked call fails at once with
 * a ClaudeError flagged `blocked`, so each caller takes its existing fallback. The state lives in `file` and survives restarts.
 */
export class AiGate {
  private state: State = { blockedUntilMs: 0, reason: '', failures: 0, day: '', used: 0 };
  private budgetLoggedDay = '';
  private readonly nowMs: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly file: string, o: { nowMs?: () => number; log?: (line: string) => void } = {}) {
    this.nowMs = o.nowMs ?? (() => Date.now());
    this.log = o.log ?? ((l) => console.warn(l));
    try { this.state = { ...this.state, ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<State>) }; } catch { /* first start */ }
  }

  private save(): void {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state)); } catch { /* the gate still works in memory */ }
  }

  blockedUntilMs(): number { return this.state.blockedUntilMs > this.nowMs() ? this.state.blockedUntilMs : 0; }
  backgroundUsed(): number { return this.state.day === berlinDay(this.nowMs()) ? this.state.used : 0; }

  private blocked(message: string): ClaudeError { return new ClaudeError('failed', message, { blocked: true }); }

  private block(until: number, reason: string): void {
    this.state.blockedUntilMs = until;
    this.state.reason = reason;
    this.save();
    this.log(`KI-Dienst pausiert (${reason}) bis ${new Date(until).toISOString()}`);
  }

  private onFailure(e: unknown): void {
    if (!(e instanceof ClaudeError) || e.info.blocked) return;
    const now = this.nowMs();
    if (this.state.blockedUntilMs > now) return; // a call that was already under way when the block started
    const V = ruleValues('ai.limit-pause');
    const code = e.info.code;
    if (code === 'client_limit') return this.block(nextBerlinMidnight(now) + V.midnightGraceMin! * MIN, 'client_limit');
    if (code === 'plan_limit' || (e.kind === 'limit' && e.info.http === undefined)) {
      const reset = e.info.resetAtMs;
      return this.block(reset !== undefined && reset > now ? reset : now + V.planFallbackMin! * MIN, 'plan_limit');
    }
    const http = e.info.http;
    if (code === 'busy' || code === 'timeout' || code === 'invalid') return; // the service's own queue answers: no reason to stay away
    if (e.info.network || http === 429 || http === 401 || http === 403 || (http !== undefined && http >= 500)) {
      this.state.failures++;
      const wait = Math.min(V.backoffMaxMin!, V.backoffMinMin! * 2 ** (this.state.failures - 1)) * MIN;
      this.block(now + wait, `HTTP ${http ?? 'nicht erreichbar'}, Versuch ${this.state.failures}`);
    }
  }

  wrap(ask: (input: Omit<GateInput, 'background'>) => Promise<unknown>): GateAsk {
    return async (input) => {
      const now = this.nowMs();
      if (this.state.blockedUntilMs > now) throw this.blocked(`KI-Dienst pausiert (${this.state.reason}).`);
      const { background, ...rest } = input;
      if (background) {
        const day = berlinDay(now);
        if (this.state.day !== day) { this.state.day = day; this.state.used = 0; }
        if (this.state.used >= (policyRule('ai.background-daily').value as number)) {
          if (this.budgetLoggedDay !== day) { this.budgetLoggedDay = day; this.log('KI-Hintergrundbudget für heute verbraucht'); }
          throw this.blocked('KI-Hintergrundbudget für heute verbraucht.');
        }
        this.state.used++; // a failed call counts too
        this.save();
      }
      try {
        const out = await ask(rest);
        if (this.state.failures > 0) { this.state.failures = 0; this.save(); }
        return out;
      } catch (e) {
        this.onFailure(e);
        throw e;
      }
    };
  }
}
