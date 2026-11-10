import { ChatCoach, REVIEW_SYSTEM_PROMPT } from '../../../src/coach/chat/chat-coach';
import { startReview, type ReviewOpened, type ReviewReason } from '../../../src/coach/chat/month-review';
import type { Sent } from '../../../src/coach/chat/prompts';
import { DEFAULT_PREFS, MAX_CHAT_TEXT, chatThread, readChat } from '../../../src/shared/chat';
import { lastDates } from '../../../src/coach/stats/stats-days';
import { ruleNumber } from '../../../src/shared/training-policy';
import type { RecordKind, TrackedRecord } from '../../../src/shared/records';
import { blockRecord, readBlock, type BlockDay } from '../../../src/shared/block';
import { PUSH_QUESTION, ruleRecord } from '../../../src/shared/personal';
import { openProposals } from '../../../src/tracking/ui/chat-open';

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
  expect(await c.openReview('p', 'month')).toBe('written');
  const [m] = messages(s);
  expect(m!.review!.observations).toHaveLength(3);
  expect(m!.text).toContain('Beobachtung 3. Grund 3.');
  expect(m!.text).not.toContain('Beobachtung 4.');
});

it('fragt jede offene Beschwerde genau einmal', async () => {
  const s = store([complaint('k1', 'Knie'), complaint('k2', 'Schulter', 'healing'), complaint('k3', 'Rücken', 'over')]);
  const c = coach(s, async () => answer({ complaintQuestions: [{ id: 'k1', question: 'Wie geht es dem Knie?' }, { id: 'k1', question: 'Und das Knie nochmal?' }, { id: 'k3', question: 'Was macht der Rücken?' }] }));
  expect(await c.openReview('p', 'month')).toBe('written');
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
  expect(await c.openReview('p', 'pause')).toBe('written');
  expect(prompts[0]).not.toContain('GEHEIM');
  expect(prompts[0]).toContain('anlass');
});

it('baut die Nachricht in fester Reihenfolge', async () => {
  const s = store([complaint('k1', 'Knie')]);
  const c = coach(s, async () => answer({ observations: [obs(1), obs(2)], complaintQuestions: [{ id: 'k1', question: 'Wie geht es dem Knie?' }] }));
  expect(await c.openReview('p', 'month')).toBe('written');
  expect(messages(s)[0]!.text).toBe('Ein guter Monat mit vielen ruhigen Wochen.\n\nBeobachtung 1. Grund 1.\nBeobachtung 2. Grund 2.\n\nWie geht es dem Knie?\n\nLass uns so weitermachen.');
});

it('passt immer ganz in den Chat, Fragen und Vorschlag bleiben', async () => {
  const long = (w: string) => `${w} `.repeat(400).trim();
  const s = store([complaint('k1', long('Knie').slice(0, 200)), complaint('k2', long('Schulter').slice(0, 200))]);
  const c = coach(s, async () => answer({
    opening: long('Anfang'), observations: [1, 2, 3].map(() => ({ text: long('Satz'), reason: long('Grund') })),
    complaintQuestions: [{ id: 'k1', question: `${long('Knie')} FRAGE1?` }], nextWeeks: `ENDE ${long('Weiter')}`,
  }));
  expect(await c.openReview('p', 'month')).toBe('written');
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
  expect(await c.openReview('p', 'month')).toBe('written');
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

const goalRec = (push?: string): TrackedRecord => ({ kind: 'goal', id: 'goal', updatedMs: 1, deleted: false, body: { strength: 'muscle', focus: [], sports: {}, ...(push ? { push } : {}), atMs: 1 } });

it('fragt beim ersten Rückblick nach der Härte', async () => {
  const s = store();
  const c = coach(s, async () => answer());
  expect(await c.openReview('p', 'month', true)).toBe('asked');
  expect(messages(s)[0]!.askPush).toBe(true);
  expect(await c.openReview('p', 'month', false)).toBe('written');
  expect(messages(s)[1]!.askPush).toBeUndefined();
});

it('fragt beim ersten Rückblick nicht, wenn die Härte gewählt ist oder eine Beschwerde offen ist', async () => {
  const chosen = store([goalRec('hard')]);
  expect(await coach(chosen, async () => answer()).openReview('p', 'month', true)).toBe('written');
  expect(messages(chosen)[0]!.askPush).toBeUndefined();
  const hurt = store([complaint('k1', 'Knie', 'healing')]);
  expect(await coach(hurt, async () => answer()).openReview('p', 'month', true)).toBe('written');
  expect(messages(hurt)[0]!.askPush).toBeUndefined();
});

it('askPush fragt ohne KI nach der Härte', () => {
  const s = store();
  const ask = vi.fn(async () => answer());
  coach(s, ask).askPush('p');
  expect(ask).not.toHaveBeenCalled();
  const [m] = messages(s);
  expect(m!.text).toBe('Wie sehr soll ich dich beim Krafttraining fordern? Du kannst das jederzeit im Profil ändern.');
  expect(m!.push).toBe(true);
  expect(m!.askPush).toBe(true);
  expect(readChat({ role: 'coach', text: 'x', atMs: 1, askPush: true })?.askPush).toBe(true);
});

it('startReview fragt im Rückblick nach der Härte, solange Bo noch nie gefragt hat', async () => {
  const open = vi.fn(async () => 'written' as const);
  const mk = (sent: Sent) => ({ get: () => sent, mark: () => {} });
  const o = { id: 'p', prefs: DEFAULT_PREFS, sportsKey: 'bike:focus', gymDates: ['2026-10-05', '2026-10-15', '2026-11-02', '2026-11-08'], nowMs: NOW, retryMs: 0, open };
  await startReview({ ...o, sent: mk({ reviewSports: 'bike:focus' }), tried: new Map() });
  await startReview({ ...o, sent: mk({ reviewSports: 'bike:focus', review: '2026-10-25' }), tried: new Map() });
  // Bo already asked on his own: the first review does not ask a second time.
  await startReview({ ...o, sent: mk({ reviewSports: 'bike:focus', pushAsk: '2026-11-20' }), tried: new Map() });
  // A review that did not ask (an open complaint) leaves the question to the next review or to the question alone.
  expect(open.mock.calls).toEqual([['p', 'month', true], ['p', 'month', true], ['p', 'month', false]]);
});

describe('startReview', () => {
  const gymDates = ['2026-10-05', '2026-10-15', '2026-11-02', '2026-11-08'];
  const sentStore = (init: Sent = {}) => {
    let s: Sent = { ...init };
    return { get: () => s, mark: (_id: string, k: keyof Sent, v: string) => { s = { ...s, [k]: v }; }, now: () => s };
  };
  const run = (sent: ReturnType<typeof sentStore>, tried: Map<string, number>, open: (id: string, r: ReviewReason) => Promise<ReviewOpened>, nowMs = NOW, sportsKey = 'bike:focus') =>
    startReview({ id: 'p', prefs: DEFAULT_PREFS, sportsKey, gymDates, sent, nowMs, tried, retryMs: 30 * 60_000, open });

  it('merkt beim ersten Mal nur den Schwerpunkt und sendet nichts', async () => {
    const sent = sentStore();
    const open = vi.fn(async () => 'written' as const);
    expect(run(sent, new Map(), open)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(sent.now()).toEqual({ reviewSports: 'bike:focus' });
  });

  it('markiert nach dem Senden Tag und Schwerpunkt', async () => {
    const sent = sentStore({ reviewSports: 'bike:keep' });
    const open = vi.fn(async () => 'written' as const);
    expect(await run(sent, new Map(), open)).toBe('written');
    expect(open).toHaveBeenCalledWith('p', 'sports', true);
    expect(sent.now()).toEqual({ review: '2026-11-29', reviewSports: 'bike:focus' });
    // Nothing is due any more, not even a minute later.
    expect(run(sent, new Map(), open, NOW + 60_000)).toBeNull();
  });

  it('markiert die Frage nach der Härte nur, wenn der Rückblick sie wirklich gestellt hat', async () => {
    const written = sentStore({ reviewSports: 'bike:focus' });
    expect(await run(written, new Map(), vi.fn(async () => 'written' as const))).toBe('written');
    expect(written.now().pushAsk).toBeUndefined();
    const asked = sentStore({ reviewSports: 'bike:focus' });
    expect(await run(asked, new Map(), vi.fn(async () => 'asked' as const))).toBe('asked');
    expect(asked.now()).toMatchObject({ review: '2026-11-29', pushAsk: '2026-11-29' });
  });

  it('markiert nichts, wenn Claude ausfällt, und wartet mit dem nächsten Versuch', async () => {
    const sent = sentStore({ reviewSports: 'bike:focus' });
    const tried = new Map<string, number>();
    const open = vi.fn(async (): Promise<ReviewOpened> => false);
    expect(await run(sent, tried, open)).toBe(false);
    expect(sent.now()).toEqual({ reviewSports: 'bike:focus' });
    expect(run(sent, tried, open, NOW + 29 * 60_000)).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(await run(sent, tried, open, NOW + 30 * 60_000)).toBe(false);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

it('nennt im Ziel auch die Härte, die gerade gilt', async () => {
  const goal: TrackedRecord = { kind: 'goal', id: 'goal', updatedMs: 1, deleted: false, body: { strength: 'muscle', focus: [], sports: {}, push: 'hard', atMs: 1 } };
  const s = store([goal, complaint('k1', 'Knie', 'healing')]);
  const prompts: string[] = [];
  const c = coach(s, async ({ prompt }) => { prompts.push(prompt); return answer(); });
  expect(await c.openReview('p', 'month')).toBe('written');
  expect(prompts[0]).toContain('"push":"hard"');
  expect(prompts[0]).toContain('"haerteJetzt":"gentle"');
  expect(REVIEW_SYSTEM_PROMPT).toContain('haerteJetzt');
});

describe('Abschnitt im Rückblick', () => {
  const day = (sport: BlockDay['sport'], hardness: BlockDay['hardness'], extra: Partial<BlockDay> = {}): BlockDay => ({ sport, hardness, ...extra });
  const RHYTHM: BlockDay[] = [
    day('gym', 'hard', { template: 0, legs: true }), day('bike', 'easy'), day('gym', 'moderate', { template: 1 }), day('rest', 'easy'),
    day('bike', 'hard'), day('run', 'easy'), day('rest', 'easy'),
  ];
  const LEGS = ['pf-squat', 'pf-romanian-deadlift', 'pf-leg-press', 'pf-hip-thrust'];
  const UPPER = ['pf-bench-press', 'pf-incline-press-db', 'pf-pec-deck'];
  const proposal = (over: object = {}) => ({ templates: [{ name: 'Unterkörper A', core: LEGS }, { name: 'Oberkörper B', core: UPPER }], rhythm: RHYTHM, ...over });
  const blocks = (s: ReturnType<typeof store>) => [...s.recs.values()].filter((r) => r.kind === 'block');
  const exclude = (ids: string[]): TrackedRecord => ruleRecord('rule-x', { kind: 'exclude', text: 'Keine Beinpresse.', sport: 'gym', exerciseIds: ids }, 'active', 'person', 1);

  it('legt einen vorgeschlagenen Abschnitt an', async () => {
    const s = store();
    const prompts: string[] = [];
    expect(await coach(s, async ({ prompt }) => { prompts.push(prompt); return answer({ block: proposal() }); }).openReview('p', 'month')).toBe('written');
    const [m] = messages(s);
    expect(m!.block).toBeDefined();
    const rec = blocks(s).find((r) => r.id === m!.block)!;
    const b = readBlock(rec.body)!;
    expect(b.state).toBe('proposed');
    expect(b.templates).toEqual([{ name: 'Unterkörper A', core: LEGS }, { name: 'Oberkörper B', core: UPPER }]);
    expect(b.rhythm).toEqual(RHYTHM);
    expect(b.start).toBeUndefined();
    expect(prompts[0]).toContain('<katalog-nur-daten>');
    expect(REVIEW_SYSTEM_PROMPT).toContain('Schlag einen festen Abschnitt nur vor, wenn er zum Ziel und zu den letzten Wochen passt; sonst bleib locker. Kernübungen nach Ziel, Vorlieben und Regeln der Person, nie ausgeschlossene, 3 bis 4 je Vorlage, ids aus katalog.');
    expect(readChat({ role: 'coach', text: 'x', atMs: 1, block: 'block-m1' })?.block).toBe('block-m1');
  });

  it('lässt ausgeschlossene Kernübungen weg', async () => {
    const s = store([exclude(['pf-leg-press'])]);
    expect(await coach(s, async () => answer({ block: proposal() })).openReview('p', 'month')).toBe('written');
    const b = readBlock(blocks(s)[0]!.body)!;
    expect(b.templates[0]!.core).toEqual(['pf-squat', 'pf-romanian-deadlift', 'pf-hip-thrust']);

    const few = store([exclude(['pf-pec-deck'])]);
    expect(await coach(few, async () => answer({ block: proposal() })).openReview('p', 'month')).toBe('written');
    expect(blocks(few)).toHaveLength(0);
    const [m] = messages(few);
    expect(m!.block).toBeUndefined();
    expect(m!.text).toContain('Lass uns so weitermachen.');
  });

  it('lässt unbekannte Übungen und dieselbe Ausführung doppelt nicht zu', async () => {
    const unknown = store();
    await coach(unknown, async () => answer({ block: proposal({ templates: [{ name: 'Unterkörper A', core: LEGS }, { name: 'Oberkörper B', core: ['pf-bench-press', 'gibt-es-nicht', 'pf-pec-deck'] }] }) })).openReview('p', 'month');
    expect(blocks(unknown)).toHaveLength(0);
    const twice = store();
    await coach(twice, async () => answer({ block: proposal({ templates: [{ name: 'Unterkörper A', core: LEGS }, { name: 'Oberkörper B', core: ['pf-bench-press', 'pf-bench-press-db', 'pf-pec-deck'] }] }) })).openReview('p', 'month');
    expect(blocks(twice)).toHaveLength(0);
    expect(messages(twice)[0]!.block).toBeUndefined();
  });

  it('verwirft einen Rhythmus gegen die Erholungsregeln', async () => {
    const s = store();
    const hard = RHYTHM.map((d, i) => (i === 5 ? day('run', 'hard') : d));
    expect(await coach(s, async () => answer({ block: proposal({ rhythm: hard }) })).openReview('p', 'month')).toBe('written');
    expect(blocks(s)).toHaveLength(0);
    expect(messages(s)[0]!.block).toBeUndefined();
  });

  it('schlägt keinen Abschnitt vor, während einer läuft', async () => {
    const running = blockRecord('block-old', { state: 'active', templates: [{ name: 'Unterkörper A', core: LEGS }, { name: 'Oberkörper B', core: UPPER }], rhythm: RHYTHM, start: '2026-11-23', end: '2026-12-27', atMs: 1 }, 1);
    const s = store([running]);
    expect(await coach(s, async () => answer({ block: proposal() })).openReview('p', 'month')).toBe('written');
    expect(blocks(s).map((r) => r.id)).toEqual(['block-old']);
    expect(messages(s)[0]!.block).toBeUndefined();
  });

  it('stellt die Frage nach der Härte neben dem Abschnitt als eigene Karte', async () => {
    const s = store();
    expect(await coach(s, async () => answer({ block: proposal() })).openReview('p', 'month', true)).toBe('asked');
    const [review, question] = messages(s);
    expect(review!.block).toBeDefined();
    expect(review!.askPush).toBeUndefined();
    expect(review!.push).toBe(true);
    expect(question!.askPush).toBe(true);
    expect(question!.text).toBe(PUSH_QUESTION);
    expect(question!.push).toBeUndefined();
    const thread = chatThread([...s.recs.values()]);
    expect(openProposals(thread, [], [], [], '2026-11-23').map((m) => m.id)).toEqual([question!.id]);
  });
});
