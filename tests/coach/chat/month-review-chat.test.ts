import { ChatCoach, REVIEW_SYSTEM_PROMPT } from '../../../src/coach/chat/chat-coach';
import { startReview, type ReviewReason } from '../../../src/coach/chat/month-review';
import type { Sent } from '../../../src/coach/chat/prompts';
import { DEFAULT_PREFS, chatThread } from '../../../src/shared/chat';
import type { RecordKind, TrackedRecord } from '../../../src/shared/records';

const NOW = new Date(2026, 10, 29, 18).getTime(); // Sunday 2026-11-29, the last Sunday of November
const store = (seed: TrackedRecord[] = []) => {
  const recs = new Map<string, TrackedRecord>(seed.map((r) => [`${r.kind}:${r.id}`, r]));
  return {
    all: (_id: string, kind: RecordKind) => [...recs.values()].filter((r) => r.kind === kind),
    put: (_id: string, r: TrackedRecord) => { recs.set(`${r.kind}:${r.id}`, r); return r; },
    recs,
  };
};
const complaint = (id: string, text: string, status = 'active'): TrackedRecord => ({ kind: 'complaint', id, updatedMs: 1, deleted: false, body: { text, status, atMs: 1 } });
const obs = (i: number) => ({ text: `Beobachtung ${i}.`, reason: `Grund ${i}.` });
const answer = (extra: object = {}) => ({ opening: 'Ein guter Monat mit vielen ruhigen Wochen.', observations: [obs(1)], complaintQuestions: [], nextWeeks: 'Lass uns so weitermachen.', ...extra });
let n = 0;
const coach = (s: ReturnType<typeof store>, ask: (p: { prompt: string; systemPrompt: string }) => Promise<unknown>) =>
  new ChatCoach({ store: s as never, ask: ask as never, nowMs: () => NOW, newId: () => `m${++n}`, strengthFacts: () => ({ wochen: [], uebungen: [], untenDauerhaft: [] }) });
const messages = (s: ReturnType<typeof store>) => chatThread([...s.recs.values()]).filter((m) => m.role === 'coach');

it('schreibt höchstens drei Beobachtungen', async () => {
  const s = store();
  const c = coach(s, async () => answer({ observations: [1, 2, 3, 4, 5].map(obs) }));
  expect(await c.openReview('p', 'month')).toBe(true);
  const [m] = messages(s);
  expect(m!.review!.observations).toHaveLength(3);
  expect(m!.text).toContain('Beobachtung 3. Grund 3.');
  expect(m!.text).not.toContain('Beobachtung 4.');
});

it('fragt jede offene Beschwerde genau einmal', async () => {
  const s = store([complaint('k1', 'Knie'), complaint('k2', 'Schulter', 'healing'), complaint('k3', 'Rücken', 'over')]);
  const c = coach(s, async () => answer({ complaintQuestions: [{ id: 'k1', question: 'Wie geht es dem Knie?' }, { id: 'k1', question: 'Und das Knie nochmal?' }, { id: 'k3', question: 'Was macht der Rücken?' }] }));
  expect(await c.openReview('p', 'month')).toBe(true);
  const text = messages(s)[0]!.text;
  expect(text).toContain('Wie geht es dem Knie?');
  expect(text).not.toContain('Und das Knie nochmal?');
  expect(text).toContain('Wie geht es dir inzwischen mit Schulter?');
  expect(text).not.toContain('Rücken');
});

it('liest nicht den Chat-Verlauf', async () => {
  const s = store([{ kind: 'chat', id: 'r1', updatedMs: 1, deleted: false, body: { role: 'rider', text: 'GEHEIM', atMs: NOW - 1000 } }]);
  const prompts: string[] = [];
  const c = coach(s, async ({ prompt, systemPrompt }) => { prompts.push(prompt); expect(systemPrompt).toBe(REVIEW_SYSTEM_PROMPT); return answer(); });
  expect(await c.openReview('p', 'pause')).toBe(true);
  expect(prompts[0]).not.toContain('GEHEIM');
  expect(prompts[0]).toContain('anlass');
});

it('sendet mit Push', async () => {
  const s = store();
  await coach(s, async () => answer()).openReview('p', 'month');
  expect(messages(s)[0]!.push).toBe(true);
});

it('schreibt nichts, wenn Claude ausfällt', async () => {
  const s = store();
  const c = coach(s, async () => { throw new Error('down'); });
  expect(await c.openReview('p', 'month')).toBe(false);
  expect([...s.recs.values()].some((r) => r.kind === 'chat')).toBe(false);
});

describe('startReview', () => {
  const gymDates = ['2026-10-05', '2026-10-15', '2026-11-02', '2026-11-08'];
  const sentStore = (init: Sent = {}) => {
    let s: Sent = { ...init };
    return { get: () => s, mark: (_id: string, k: keyof Sent, v: string) => { s = { ...s, [k]: v }; }, now: () => s };
  };
  const run = (sent: ReturnType<typeof sentStore>, tried: Map<string, number>, open: (id: string, r: ReviewReason) => Promise<boolean>, nowMs = NOW, sportsKey = 'bike:focus') =>
    startReview({ id: 'p', prefs: DEFAULT_PREFS, sportsKey, gymDates, sent, nowMs, tried, retryMs: 30 * 60_000, open });

  it('merkt beim ersten Mal nur den Schwerpunkt und sendet nichts', async () => {
    const sent = sentStore();
    const open = vi.fn(async () => true);
    expect(run(sent, new Map(), open)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(sent.now()).toEqual({ reviewSports: 'bike:focus' });
  });

  it('markiert nach dem Senden Tag und Schwerpunkt', async () => {
    const sent = sentStore({ reviewSports: 'bike:keep' });
    const open = vi.fn(async () => true);
    expect(await run(sent, new Map(), open)).toBe(true);
    expect(open).toHaveBeenCalledWith('p', 'sports');
    expect(sent.now()).toEqual({ review: '2026-11-29', reviewSports: 'bike:focus' });
    // Nothing is due any more, not even a minute later.
    expect(run(sent, new Map(), open, NOW + 60_000)).toBeNull();
  });

  it('markiert nichts, wenn Claude ausfällt, und wartet mit dem nächsten Versuch', async () => {
    const sent = sentStore({ reviewSports: 'bike:focus' });
    const tried = new Map<string, number>();
    const open = vi.fn(async () => false);
    expect(await run(sent, tried, open)).toBe(false);
    expect(sent.now()).toEqual({ reviewSports: 'bike:focus' });
    expect(run(sent, tried, open, NOW + 29 * 60_000)).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(await run(sent, tried, open, NOW + 30 * 60_000)).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
