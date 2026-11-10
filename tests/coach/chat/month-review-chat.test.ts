import { ChatCoach, REVIEW_SYSTEM_PROMPT } from '../../../src/coach/chat/chat-coach';
import { startReview, type ReviewReason } from '../../../src/coach/chat/month-review';
import type { Sent } from '../../../src/coach/chat/prompts';
import { DEFAULT_PREFS, MAX_CHAT_TEXT, chatThread, readChat } from '../../../src/shared/chat';
import { lastDates } from '../../../src/coach/stats/stats-days';
import { ruleNumber } from '../../../src/shared/training-policy';
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
  expect(text).toContain('Du hattest „Schulter“ erwähnt. Wie geht es dir damit inzwischen?');
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

it('baut die Nachricht in fester Reihenfolge', async () => {
  const s = store([complaint('k1', 'Knie')]);
  const c = coach(s, async () => answer({ observations: [obs(1), obs(2)], complaintQuestions: [{ id: 'k1', question: 'Wie geht es dem Knie?' }] }));
  expect(await c.openReview('p', 'month')).toBe(true);
  expect(messages(s)[0]!.text).toBe('Ein guter Monat mit vielen ruhigen Wochen.\n\nBeobachtung 1. Grund 1.\nBeobachtung 2. Grund 2.\n\nWie geht es dem Knie?\n\nLass uns so weitermachen.');
});

it('passt immer ganz in den Chat, Fragen und Vorschlag bleiben', async () => {
  const long = (w: string) => `${w} `.repeat(400).trim();
  const s = store([complaint('k1', long('Knie').slice(0, 200)), complaint('k2', long('Schulter').slice(0, 200))]);
  const c = coach(s, async () => answer({
    opening: long('Anfang'), observations: [1, 2, 3].map(() => ({ text: long('Satz'), reason: long('Grund') })),
    complaintQuestions: [{ id: 'k1', question: `${long('Knie')} FRAGE1?` }], nextWeeks: `ENDE ${long('Weiter')}`,
  }));
  expect(await c.openReview('p', 'month')).toBe(true);
  const raw = [...s.recs.values()].find((r) => r.kind === 'chat')!.body as { text: string };
  expect(raw.text.length).toBeLessThanOrEqual(MAX_CHAT_TEXT);
  const parts = raw.text.split('\n\n');
  expect(parts[parts.length - 1]).toMatch(/^ENDE Weiter/);
  expect(parts[parts.length - 2]!.split('\n')).toHaveLength(2);
  expect(parts[parts.length - 2]).toContain('Wie geht es dir damit inzwischen?');
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

it('nennt nur Wochen, die der Statistik-Zeitraum abdeckt', async () => {
  const days = lastDates(NOW, 9).map((date) => ({ date, minutes: { bike: 30, strength: 0, run: 0, mobility: 0, other: 0 }, hardness: 'easy', legs: false }));
  const stats: TrackedRecord = { kind: 'stats', id: 'stats', updatedMs: 1, deleted: false, body: { type: 'stats', atMs: 1, goal: null, days, muscles: {} } };
  const prompts: string[] = [];
  const c = coach(store([stats]), async ({ prompt }) => { prompts.push(prompt); return answer(); });
  expect(await c.openReview('p', 'month')).toBe(true);
  const wochen = JSON.parse(/<wochen-nur-daten>\s*([\s\S]*?)\s*<\/wochen-nur-daten>/.exec(prompts[0]!)![1]!) as { woche: string }[];
  expect(wochen.length).toBeLessThanOrEqual(9);
  expect(wochen.length).toBeGreaterThan(0);
  expect(wochen.every((w) => w.woche >= '2026-09-28')).toBe(true);
});

it('readChat behält eine Nachricht mit zu vielen Beobachtungen und kürzt sie', () => {
  const many = Array.from({ length: ruleNumber('review.max-observations') + 2 }, (_, i) => obs(i));
  const m = readChat({ role: 'coach', text: 'x', atMs: 1, review: { observations: many } });
  expect(m?.review?.observations).toHaveLength(ruleNumber('review.max-observations'));
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
