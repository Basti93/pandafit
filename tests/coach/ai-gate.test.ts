import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiGate, berlinDay, nextBerlinMidnight } from '../../src/coach/ai-gate';
import { ClaudeError } from '../../src/coach/claude-client';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')); dirs.push(d); return path.join(d, 'ai-gate.json'); };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const input = { prompt: 'p', systemPrompt: 's', schema: {} };
const limit = (code: string, http = 429, resetAtMs?: number) => new ClaudeError(code === 'plan_limit' ? 'limit' : 'failed', code, { http, code, ...(resetAtMs ? { resetAtMs } : {}) });
const setup = (t0: string, file = tmp()) => {
  let now = Date.parse(t0);
  const log = vi.fn();
  const mk = () => new AiGate(file, { nowMs: () => now, log });
  const ask = vi.fn<(i: object) => Promise<unknown>>(async () => 'ok');
  return { file, log, ask, mk, at: (t: string) => { now = Date.parse(t); }, advance: (ms: number) => { now += ms; }, now: () => now };
};
const blockedErr = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as ClaudeError; } };

describe('Berlin midnight', () => {
  it('is the next local midnight, also on the days the clock changes', () => {
    expect(new Date(nextBerlinMidnight(Date.parse('2026-11-07T10:00:00Z'))).toISOString()).toBe('2026-11-07T23:00:00.000Z'); // CET
    expect(new Date(nextBerlinMidnight(Date.parse('2026-07-07T10:00:00Z'))).toISOString()).toBe('2026-07-07T22:00:00.000Z'); // CEST
    expect(new Date(nextBerlinMidnight(Date.parse('2026-03-29T00:30:00Z'))).toISOString()).toBe('2026-03-29T22:00:00.000Z'); // 23 h day
    expect(new Date(nextBerlinMidnight(Date.parse('2026-10-25T00:30:00Z'))).toISOString()).toBe('2026-10-25T23:00:00.000Z'); // 25 h day
    expect(berlinDay(Date.parse('2026-11-07T23:30:00Z'))).toBe('2026-11-08');
  });
});

describe('the AI gate', () => {
  it('blocks every call after client_limit until Berlin midnight plus a few minutes, logging once', async () => {
    const t = setup('2026-11-07T17:00:00Z');
    const gate = t.mk();
    const ask = gate.wrap(t.ask);
    t.ask.mockRejectedValueOnce(limit('client_limit'));
    await expect(ask(input)).rejects.toThrow();
    for (let i = 0; i < 20; i++) expect((await blockedErr(ask(input)))?.info.blocked).toBe(true);
    expect(t.ask).toHaveBeenCalledTimes(1);
    expect(t.log).toHaveBeenCalledTimes(1);
    t.at('2026-11-07T23:04:00Z');
    expect((await blockedErr(ask(input)))?.info.blocked).toBe(true);
    t.at('2026-11-07T23:06:00Z');
    expect(await ask(input)).toBe('ok');
  });

  it('survives a restart', async () => {
    const t = setup('2026-11-07T17:00:00Z');
    t.ask.mockRejectedValueOnce(limit('client_limit'));
    await blockedErr(t.mk().wrap(t.ask)(input));
    expect((await blockedErr(t.mk().wrap(t.ask)(input)))?.info.blocked).toBe(true);
    expect(t.ask).toHaveBeenCalledTimes(1);
  });

  it('blocks plan_limit until the reset time, or one hour without one', async () => {
    const a = setup('2026-11-07T10:00:00Z');
    a.ask.mockRejectedValueOnce(limit('plan_limit', 429, Date.parse('2026-11-07T13:30:00Z')));
    const askA = a.mk().wrap(a.ask);
    await blockedErr(askA(input));
    a.at('2026-11-07T13:29:00Z');
    expect((await blockedErr(askA(input)))?.info.blocked).toBe(true);
    a.at('2026-11-07T13:31:00Z');
    expect(await askA(input)).toBe('ok');

    const b = setup('2026-11-07T10:00:00Z');
    b.ask.mockRejectedValueOnce(limit('plan_limit'));
    const askB = b.mk().wrap(b.ask);
    await blockedErr(askB(input));
    b.advance(59 * 60_000);
    expect((await blockedErr(askB(input)))?.info.blocked).toBe(true);
    b.advance(2 * 60_000);
    expect(await askB(input)).toBe('ok');
  });

  it('backs off exponentially on other 429 and 5xx, from 1 up to 30 minutes', async () => {
    const t = setup('2026-11-07T10:00:00Z');
    const gate = t.mk();
    const ask = gate.wrap(t.ask);
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      t.ask.mockRejectedValueOnce(limit('whatever', i % 2 ? 503 : 429));
      t.advance(31 * 60_000); // past the previous block, so the call reaches the service
      await blockedErr(ask(input));
      seen.push((gate.blockedUntilMs() - t.now()) / 60_000);
    }
    expect(seen).toEqual([1, 2, 4, 8, 16, 30, 30]);
    t.advance(31 * 60_000);
    expect(await ask(input)).toBe('ok'); // a success starts the growth again
    t.ask.mockRejectedValueOnce(limit('x', 500));
    await blockedErr(ask(input));
    expect((gate.blockedUntilMs() - t.now()) / 60_000).toBe(1);
  });

  it('does not block on the service queue answers busy and timeout', async () => {
    const t = setup('2026-11-07T10:00:00Z');
    const ask = t.mk().wrap(t.ask);
    t.ask.mockRejectedValueOnce(new ClaudeError('timeout', 'busy', { http: 503, code: 'busy' }));
    await blockedErr(ask(input));
    expect(await ask(input)).toBe('ok');
  });

  it('counts background calls per Berlin day, persisted, and starts again the next day', async () => {
    const t = setup('2026-11-07T10:00:00Z');
    const ask = t.mk().wrap(t.ask);
    for (let i = 0; i < 60; i++) await ask({ ...input, background: true });
    expect((await blockedErr(ask({ ...input, background: true })))?.info.blocked).toBe(true);
    expect(t.log).toHaveBeenCalledTimes(1);
    expect((await blockedErr(t.mk().wrap(t.ask)({ ...input, background: true })))?.info.blocked).toBe(true); // after a restart
    expect(t.ask).toHaveBeenCalledTimes(60);
    expect(t.ask.mock.calls[0]![0]).not.toHaveProperty('background');
    t.at('2026-11-07T23:10:00Z'); // 00:10 Berlin, next day
    expect(await ask({ ...input, background: true })).toBe('ok');
  });

  it('does not block interactive calls with the background budget, but client_limit blocks both', async () => {
    const t = setup('2026-11-07T10:00:00Z');
    const ask = t.mk().wrap(t.ask);
    for (let i = 0; i < 60; i++) await ask({ ...input, background: true });
    expect(await ask(input)).toBe('ok'); // chat still gets an answer
    t.ask.mockRejectedValueOnce(limit('client_limit'));
    await blockedErr(ask(input));
    expect((await blockedErr(ask(input)))?.info.blocked).toBe(true);
    expect((await blockedErr(ask({ ...input, background: true })))?.info.blocked).toBe(true);
  });
});
