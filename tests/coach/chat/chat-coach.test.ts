import { CHAT_SYSTEM_PROMPT, WORKOUT_SYSTEM_PROMPT, ChatCoach } from '../../../src/coach/chat/chat-coach';
import { ClaudeError } from '../../../src/coach/claude-client';
import { chatThread } from '../../../src/shared/chat';
import type { RecordKind, TrackedRecord } from '../../../src/shared/records';
import { weekDates } from '../../../src/shared/week-plan';

const NOW = new Date(2026, 10, 4, 18).getTime(); // Wednesday 2026-11-04
const store = (seed: TrackedRecord[] = []) => {
  const recs = new Map<string, TrackedRecord>(seed.map((r) => [`${r.kind}:${r.id}`, r]));
  return {
    all: (_id: string, kind: RecordKind) => [...recs.values()].filter((r) => r.kind === kind),
    put: (_id: string, r: TrackedRecord) => { recs.set(`${r.kind}:${r.id}`, r); return r; },
    recs,
  };
};
const rider = (id: string, text: string, atMs = NOW - 1000, extra = {}): TrackedRecord => ({ kind: 'chat', id, updatedMs: atMs, deleted: false, body: { role: 'rider', text, atMs, ...extra } });
const days = (monday: string, hard: number[] = [], legsHardOn: number | null = null) => weekDates(monday).map((date, i) => ({
  date, sport: i === legsHardOn ? 'gym' : hard.includes(i) ? 'bike' : 'rest', hardness: hard.includes(i) || i === legsHardOn ? 'hard' : 'easy', fixed: false, ...(i === legsHardOn ? { legs: true } : {}),
}));
let n = 0;
const coach = (s: ReturnType<typeof store>, ask: (p: { prompt: string }) => Promise<unknown>) =>
  new ChatCoach({ store: s as never, ask: ask as never, nowMs: () => NOW, newId: () => `c${++n}` });
const replies = (s: ReturnType<typeof store>) => chatThread([...s.recs.values()]).filter((m) => m.role === 'coach');

test('answers the waiting message once, with a valid proposal for this week', async () => {
  const s = store([rider('r1', '3× Rad diese Woche')]);
  const asks: string[] = [];
  const c = coach(s, async ({ prompt }) => { asks.push(prompt); return { text: 'So?', proposal: { weekStart: '2026-11-02', days: days('2026-11-02', [1, 3]) }, riderAskedForMore: false }; });
  expect(await c.tick('p')).toBe(true);
  expect(await c.tick('p')).toBe(false);
  const [m] = replies(s);
  expect(m).toMatchObject({ text: 'So?', replyTo: 'r1' });
  expect(m!.proposal?.weekStart).toBe('2026-11-02');
  expect(asks).toHaveLength(1);
  expect(asks[0]).toContain('3× Rad diese Woche');
});

test('a proposal that breaks a rule is asked again once, and dropped if still broken', async () => {
  const s = store([rider('r1', 'Plan')]);
  let calls = 0;
  const c = coach(s, async () => { calls++; return { text: 'Hier.', proposal: { weekStart: '2026-11-02', days: days('2026-11-02', [0, 2, 4]) }, riderAskedForMore: false }; });
  await c.tick('p');
  expect(calls).toBe(2);
  const [m] = replies(s);
  expect(m!.proposal).toBeUndefined();
  expect(m!.text).toContain('passte nicht zu unseren Regeln');
  expect(m!.text).toContain('Die Woche hat mehr als zwei harte Tage');
});

test('when the rider asks for more, the proposal stays with its warnings', async () => {
  const s = store([rider('r1', 'Ich will drei harte Tage')]);
  const c = coach(s, async () => ({ text: 'Viel, aber okay.', proposal: { weekStart: '2026-11-02', days: days('2026-11-02', [0, 2, 4]) }, riderAskedForMore: true }));
  await c.tick('p');
  expect(replies(s)[0]).toMatchObject({ warnings: ['Die Woche hat mehr als zwei harte Tage.'] });
});

test('never with an open complaint, even when asked for more', async () => {
  const complaint: TrackedRecord = { kind: 'complaint', id: 'k', updatedMs: 1, deleted: false, body: { text: 'Knie zwickt', status: 'active', atMs: 1 } };
  const s = store([rider('r1', 'Ich will drei harte Tage'), complaint]);
  const c = coach(s, async () => ({ text: 'Hm.', proposal: { weekStart: '2026-11-02', days: days('2026-11-02', [0, 2, 4]) }, riderAskedForMore: true }));
  await c.tick('p');
  expect(replies(s)[0]!.proposal).toBeUndefined();
});

test('a proposal for another week is dropped, the text stays', async () => {
  const s = store([rider('r1', 'Plan')]);
  const c = coach(s, async () => ({ text: 'Weit voraus.', proposal: { weekStart: '2026-11-23', days: days('2026-11-23') }, riderAskedForMore: false }));
  await c.tick('p');
  expect(replies(s)[0]).toMatchObject({ text: 'Weit voraus.' });
  expect(replies(s)[0]!.proposal).toBeUndefined();
});

test('a limit or failure answers kindly and marks it failed; old and handled messages get nothing', async () => {
  const s = store([rider('r1', 'Hallo')]);
  await coach(s, async () => { throw new ClaudeError('limit', 'x'); }).tick('p');
  expect(replies(s)[0]).toMatchObject({ failed: true, replyTo: 'r1' });
  expect(replies(s)[0]!.text).toContain('Kontingent');
  const old = store([rider('r2', 'Hallo', NOW - 3 * 86_400_000)]);
  expect(await coach(old, async () => ({ text: 'x', proposal: null, riderAskedForMore: false })).tick('p')).toBe(false);
  const take = store([rider('r3', 'Übernommen', NOW, { takes: 'c0' })]);
  expect(await coach(take, async () => ({ text: 'x', proposal: null, riderAskedForMore: false })).tick('p')).toBe(false);
});

test('messages older than 90 days are deleted', async () => {
  const s = store([rider('old', 'alt', NOW - 91 * 86_400_000)]);
  await coach(s, async () => ({ text: 'x', proposal: null, riderAskedForMore: false })).tick('p');
  expect(s.recs.get('chat:old')!.deleted).toBe(true);
});

test('a complaint told in the chat is started, one said to be over is ended, and the coach turns careful at once', async () => {
  const s = store([rider('r1', 'Mein Knie zwickt, und die Schulter ist wieder gut')]);
  const list = [{ id: 'k1', text: 'Schulter', status: 'active' }];
  const added: string[] = [], ended: string[] = [];
  const c = new ChatCoach({
    store: s as never, nowMs: () => NOW, newId: () => `c${++n}`,
    complaints: () => list,
    addComplaint: (_id, text) => { added.push(text); list.push({ id: 'k2', text, status: 'active' }); },
    endComplaint: (_id, cid) => { ended.push(cid); list.find((x) => x.id === cid)!.status = 'over'; },
    ask: (async () => ({ text: 'Gute Besserung.', proposal: { weekStart: '2026-11-02', days: days('2026-11-02', [0, 2, 4]) }, riderAskedForMore: true, newComplaint: 'Knie zwickt', complaintsOver: ['k1', 'unknown'] })) as never,
  });
  await c.tick('p');
  expect(added).toEqual(['Knie zwickt']);
  expect(ended).toEqual(['k1']);
  // The new complaint makes it careful: the broken proposal stays out even though the rider asked for more.
  expect(replies(s)[0]!.proposal).toBeUndefined();
});

describe('in a workout', () => {
  const workout = (endMs: number | null = null): TrackedRecord => ({ kind: 'workout', id: 'w1', updatedMs: 1, deleted: false, body: {
    id: 'w1', title: 'Oberkörper', startMs: NOW - 20 * 60_000, endMs, source: 'pandafit', rest: null,
    exercises: [{ rid: 'e1', exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [
      { rid: 's1', type: 'normal', weightKg: 60, reps: 8, durationS: null, doneMs: NOW - 60_000 }, { rid: 's2', type: 'normal', weightKg: 60, reps: 8, durationS: null, doneMs: null }] }],
  } });
  it('sees the open workout and keeps only ops that fit it', async () => {
    const s = store([workout(), rider('r1', 'Bank ist belegt', NOW - 1000, { inWorkout: 'w1' })]);
    let prompt = '';
    const c = coach(s, async (p) => { prompt = p.prompt; return { text: 'Nimm die Brustpresse.', newComplaint: null, complaintsOver: [], change: { ops: [{ op: 'swap', ex: 'e1', to: 'pf-chest-press-machine' }, { op: 'drop', ex: 'gone' }] } }; });
    await c.tick('p');
    expect(prompt).toContain('"ex":"e1"');
    expect(prompt).toContain('Bank ist belegt');
    const [m] = replies(s);
    expect(m).toMatchObject({ inWorkout: 'w1', replyTo: 'r1', workoutChange: { workoutId: 'w1', ops: [{ op: 'swap', ex: 'e1', to: 'pf-chest-press-machine' }] } });
    expect(m!.text).toContain('Das geht nicht, weil die Übung nicht mehr da ist.');
  });
  it('says in words when no op fits, instead of dropping it silently', async () => {
    const s = store([workout(), rider('r1', 'Bank ist belegt', NOW - 1000, { inWorkout: 'w1' })]);
    await coach(s, async () => ({ text: 'Dann so.', newComplaint: null, complaintsOver: [], change: { ops: [{ op: 'swap', ex: 'e1', to: 'nope' }] } })).tick('p');
    const [m] = replies(s);
    expect(m!.workoutChange).toBeUndefined();
    expect(m!.text).toBe('Dann so.\nDas geht nicht, weil die Übung nicht im Katalog ist.');
  });
  it('a finished workout gets a kind note and no Claude call', async () => {
    const s = store([workout(NOW - 500), rider('r1', 'Noch was?', NOW - 1000, { inWorkout: 'w1' })]);
    let called = false;
    await coach(s, async () => { called = true; return {}; }).tick('p');
    expect(called).toBe(false);
    expect(replies(s)[0]!.text).toContain('schon beendet');
  });
});

test('a failure in a workout carries the workout, so the panel shows it', async () => {
  const s = store([rider('r1', 'Bank belegt', NOW - 1000, { inWorkout: 'w9' })]);
  await coach(s, async () => { throw new ClaudeError('failed', 'x'); }).tick('p');
  // No open workout w9 reached this side: the kind note still belongs to the workout panel.
  expect(replies(s)[0]).toMatchObject({ inWorkout: 'w9', replyTo: 'r1' });
});

test('the week conversation never starts or ends complaints by itself', async () => {
  const added: string[] = [], ended: string[] = [];
  const s = store();
  const c = new ChatCoach({
    store: s as never, nowMs: () => NOW, newId: () => `c${++n}`,
    complaints: () => [{ id: 'k1', text: 'Knie', status: 'active' }],
    addComplaint: (_i, t) => added.push(t), endComplaint: (_i, id) => ended.push(id),
    ask: (async () => ({ text: 'Nächste Woche?', proposal: null, riderAskedForMore: false, newComplaint: 'Rücken', complaintsOver: ['k1'] })) as never,
  });
  expect(await c.openWeek('p')).toBe(true);
  expect(added).toEqual([]);
  expect(ended).toEqual([]);
});

describe('a complaint that heals', () => {
  const run = async (ask: () => Promise<unknown>, week = false) => {
    const healed: string[] = [], ended: string[] = [];
    const s = week ? store() : store([rider('r1', 'Das Knie wird besser')]);
    const c = new ChatCoach({
      store: s as never, nowMs: () => NOW, newId: () => `c${++n}`,
      complaints: () => [{ id: 'c1', text: 'Knie', status: 'active' }],
      healComplaint: (_i, id) => healed.push(id), endComplaint: (_i, id) => ended.push(id),
      ask: ask as never,
    });
    if (week) await c.openWeek('p'); else await c.tick('p');
    return { healed, ended };
  };
  const answer = (extra: object) => async () => ({ text: 'Schön.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], complaintsHealing: [], ...extra });

  it('setzt eine Beschwerde auf heilt, wenn die Person es sagt', async () => {
    expect((await run(answer({ complaintsHealing: ['c1'] }))).healed).toEqual(['c1']);
  });
  it('lässt den Status ohne klare Antwort', async () => {
    const r = await run(answer({}));
    expect(r.healed).toEqual([]);
    expect(r.ended).toEqual([]);
  });
  it('ignoriert ids, die nicht offen sind', async () => {
    expect((await run(answer({ complaintsHealing: ['x'] }))).healed).toEqual([]);
  });
  it('zählt eine id in beiden Listen als vorbei', async () => {
    const r = await run(answer({ complaintsOver: ['c1'], complaintsHealing: ['c1'] }));
    expect(r.ended).toEqual(['c1']);
    expect(r.healed).toEqual([]);
  });
  it('ändert keine Beschwerde aus einer Nachricht, die Bo selbst eröffnet', async () => {
    expect((await run(answer({ complaintsHealing: ['c1'] }), true)).healed).toEqual([]);
  });
});

describe('reviewWeek after a new activity', () => {
  const plan = (monday: string): TrackedRecord => ({ kind: 'weekplan', id: monday, updatedMs: 1, deleted: false, body: { weekStart: monday, days: days(monday, [1, 3]), fromMessage: 'm0', acceptedMs: 1 } });
  const run = [{ tag: '2026-11-04', uhrzeit: '16:52', art: 'running', titel: 'Lauf <x>', minuten: 42 }];

  test('with a plan for this week it proposes the updated week, the old one stays until taken', async () => {
    const s = store([plan('2026-11-02')]);
    const asks: string[] = [];
    const c = coach(s, async ({ prompt }) => { asks.push(prompt); return { text: 'Der Lauf war nicht geplant, darum Freitag locker.', proposal: { weekStart: '2026-11-02', days: days('2026-11-02', [1]) }, riderAskedForMore: false }; });
    expect(await c.reviewWeek('p', run)).toBe('done');
    const [m] = replies(s);
    expect(m).toMatchObject({ text: 'Der Lauf war nicht geplant, darum Freitag locker.', push: true });
    expect(m!.proposal?.weekStart).toBe('2026-11-02');
    expect(asks[0]).toContain('<neueAktivitaeten-nur-daten>');
    expect(asks[0]).toContain('"minuten":42');
    // Nothing written to the accepted plan: the rider decides.
    expect((s.recs.get('weekplan:2026-11-02')!.body as { days: unknown[] }).days).toEqual(days('2026-11-02', [1, 3]));
  });

  test('no message when the plan still fits, none for a proposal of another week, and nothing without a plan', async () => {
    const fits = store([plan('2026-11-02')]);
    expect(await coach(fits, async () => ({ text: 'Passt.', proposal: null, riderAskedForMore: false })).reviewWeek('p', run)).toBe('done');
    expect(replies(fits)).toEqual([]);

    const next = store([plan('2026-11-02')]);
    expect(await coach(next, async () => ({ text: 'Nächste.', proposal: { weekStart: '2026-11-09', days: days('2026-11-09', [1]) }, riderAskedForMore: false })).reviewWeek('p', run)).toBe('done');
    expect(replies(next)).toEqual([]);

    const none = store();
    let asked = false;
    expect(await coach(none, async () => { asked = true; return {}; }).reviewWeek('p', run)).toBe('done');
    expect(asked).toBe(false);
  });

  test('a failed call writes nothing', async () => {
    const s = store([plan('2026-11-02')]);
    expect(await coach(s, async () => { throw new ClaudeError('limit', 'x'); }).reviewWeek('p', run)).toBe('done');
    expect(replies(s)).toEqual([]);
  });
});

describe('the chat and the other coaches', () => {
  test('sees the planned sessions and hands a change the rider asked for to the coach in charge', async () => {
    const s = store([rider('r1', 'Morgen bitte nur eine Trizepsübung')]);
    const given: unknown[] = [];
    const asks: string[] = [];
    const c = new ChatCoach({
      store: s as never, nowMs: () => NOW, newId: () => `c${++n}`,
      sessions: () => ({ kraft: { name: 'Oberkörper', uebungen: ['Trizepsdrücken am Kabel', 'Trizepsdrücken mit Seil'] } }),
      giveTask: (_id, t) => given.push(t),
      ask: (async ({ prompt }: { prompt: string }) => { asks.push(prompt); return { text: 'Gebe ich an die Planung weiter.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], tasks: [{ coach: 'gym', text: 'Nur eine Trizepsübung', lasting: false }, { coach: 'meals', text: 'x', lasting: false }] }; }) as never,
    });
    expect(await c.tick('p')).toBe(true);
    expect(given).toEqual([{ to: 'gym', text: 'Nur eine Trizepsübung', lasting: false }]);
    expect(asks[0]).toContain('<einheiten-nur-daten>');
    expect(asks[0]).toContain('Trizepsdrücken mit Seil');
    expect(replies(s)[0]!.text).toBe('Gebe ich an die Planung weiter.');
  });

  test('a lasting wish of the rider becomes one proposed wish rule, not a task', async () => {
    const s = store([rider('r1', 'Künftig am Rad nur kurze Intervalle')]);
    const given: unknown[] = [];
    const c = new ChatCoach({
      store: s as never, nowMs: () => NOW, newId: () => `c${++n}`, giveTask: (_id, t) => given.push(t),
      ask: (async () => ({ text: 'Gemerkt.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], tasks: [{ coach: 'bike', text: 'Nur kurze Intervalle', lasting: true, forDate: null }] })) as never,
    });
    expect(await c.tick('p')).toBe(true);
    expect(given).toEqual([]);
    const rules = s.all('p', 'rule' as never).filter((r: TrackedRecord) => r.kind === 'rule');
    expect(rules).toHaveLength(1);
    expect(rules[0]!.body).toMatchObject({ kind: 'wish', state: 'proposed', sport: 'bike', text: 'Nur kurze Intervalle' });
    expect(s.all('p', 'task' as never).filter((r: TrackedRecord) => r.kind === 'task')).toEqual([]);
  });

  test('a message the coach opened by itself hands out no task', async () => {
    const s = store();
    const given: unknown[] = [];
    const c = new ChatCoach({
      store: s as never, nowMs: () => NOW, newId: () => `c${++n}`, giveTask: (_id, t) => given.push(t),
      ask: (async () => ({ text: 'Woche?', proposal: null, riderAskedForMore: false, tasks: [{ coach: 'gym', text: 'mehr', lasting: false }] })) as never,
    });
    expect(await c.openWeek('p')).toBe(true);
    expect(given).toEqual([]);
  });
});

describe('a swap for the next workout is resolved against the whole catalog', () => {
  const swap = (toId: string | undefined, toTitle?: string) => ({ text: 'Okay.', nextChange: { reason: 'Wunsch', ops: [{ op: 'swap', exerciseId: 'pf-squat', ...(toId ? { toId } : {}), ...(toTitle ? { toTitle } : {}) }] } });
  const exclude: TrackedRecord = { kind: 'rule', id: 'rule-x', updatedMs: 1, deleted: false, body: { kind: 'exclude', text: 'ohne', sport: 'gym', state: 'active', source: 'chat', atMs: 1, exerciseIds: ['pf-goblet-squat'] } };

  test('an unknown id gets one retry with the catalog, then a valid change record', async () => {
    const s = store([rider('r1', 'Tausch die Kniebeuge')]);
    const prompts: string[] = [];
    const c = coach(s, async ({ prompt }) => { prompts.push(prompt); return prompts.length === 1 ? swap('gibt-es-nicht') : swap('pf-goblet-squat'); });
    await c.tick('p');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('katalog');
    expect(prompts[0]).not.toContain('<katalog');
    const m = replies(s)[0]!;
    expect(m.text).not.toContain('Geht nicht');
    expect(m.nextChange).toMatch(/^chg-/);
    expect(s.recs.get(`change:${m.nextChange}`)!.body).toMatchObject({ ops: [{ op: 'swap', exerciseId: 'pf-squat', toId: 'pf-goblet-squat' }] });
  });

  test('a toTitle resolves without a retry', async () => {
    const s = store([rider('r1', 'Tausch die Kniebeuge')]);
    let calls = 0;
    const c = coach(s, async () => { calls++; return swap(undefined, 'Goblet Squat'); });
    await c.tick('p');
    expect(calls).toBe(1);
    expect(replies(s)[0]!.nextChange).toBeDefined();
    expect([...s.recs.values()].find((r) => r.kind === 'change')!.body).toMatchObject({ ops: [{ op: 'swap', toId: 'pf-goblet-squat' }] });
  });

  test('a toTitle resolves ignoring case and extra spaces', async () => {
    const s = store([rider('r1', 'Tausch die Kniebeuge')]);
    const c = coach(s, async () => swap(undefined, '  goblet   SQUAT '));
    await c.tick('p');
    expect([...s.recs.values()].find((r) => r.kind === 'change')!.body).toMatchObject({ ops: [{ op: 'swap', toId: 'pf-goblet-squat' }] });
  });

  test('an excluded target is refused, without a retry', async () => {
    const s = store([rider('r1', 'Tausch die Kniebeuge'), exclude]);
    let calls = 0;
    const c = coach(s, async () => { calls++; return swap(undefined, 'Goblet Squat'); });
    await c.tick('p');
    expect(calls).toBe(1);
    expect(replies(s)[0]!.text).toMatch(/Das geht nicht, weil du .* ausgeschlossen hast\./);
    expect([...s.recs.values()].some((r) => r.kind === 'change')).toBe(false);
  });

  test('still unknown after the retry: the "Geht nicht" line, not a silent drop', async () => {
    const s = store([rider('r1', 'Tausch die Kniebeuge')]);
    let calls = 0;
    const c = coach(s, async () => { calls++; return swap('gibt-es-nicht'); });
    await c.tick('p');
    expect(calls).toBe(2);
    const m = replies(s)[0]!;
    expect(m.text).toContain('Das geht nicht, weil die Übung nicht im Katalog steht.');
    expect(m.nextChange).toBeUndefined();
  });
});

describe('an explicit yes in the chat takes the open rule draft', () => {
  const coachMsg = (rule: string): TrackedRecord => ({ kind: 'chat', id: 'c0', updatedMs: NOW - 5000, deleted: false, body: { role: 'coach', text: 'Soll ich das als Regel merken?', atMs: NOW - 5000, rule } });
  const draft = (kind: string, state = 'proposed'): TrackedRecord => ({ kind: 'rule', id: 'rule-d', updatedMs: 1, deleted: false, body: { kind, text: 'Kurze Pausen', sport: 'all', state, source: 'chat', atMs: 1, ...(kind === 'goal' ? { goal: { strength: 'muscle' } } : {}) } });
  const yes = (extra = {}) => async () => ({ text: 'Gilt ab jetzt.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], tasks: [], nextChange: null, ruleDraft: null, acceptsRule: true, ...extra });
  const rules = (s: ReturnType<typeof store>) => [...s.recs.values()].filter((r) => r.kind === 'rule');

  test('takes the open draft on an explicit wish', async () => {
    const s = store([coachMsg('rule-d'), draft('wish'), rider('r1', 'Trag das als Regel ein')]);
    await coach(s, yes()).tick('p');
    expect(rules(s)).toHaveLength(1);
    expect(rules(s)[0]!.body).toMatchObject({ state: 'active' });
    expect(replies(s).at(-1)!.rule).toBe('rule-d');
  });

  test('takes nothing without an open draft', async () => {
    const done = draft('wish', 'active');
    const s = store([coachMsg('rule-d'), done, rider('r1', 'Trag das ein')]);
    await coach(s, yes()).tick('p');
    expect(rules(s)).toEqual([done]);
    expect(replies(s).at(-1)!.rule).toBeUndefined();
    const s2 = store([rider('r1', 'Trag das ein')]);
    await coach(s2, yes()).tick('p');
    expect(rules(s2)).toEqual([]);
  });

  test('says so when there is no open proposal to take', async () => {
    const s = store([rider('r1', 'Trag das ein')]);
    await coach(s, yes()).tick('p');
    expect(replies(s).at(-1)!.text).toBe('Gilt ab jetzt.\nIch sehe gerade keinen offenen Vorschlag, den ich übernehmen könnte. Deshalb gilt noch keine neue Regel.');
    const taken = store([coachMsg('rule-d'), draft('wish'), rider('r1', 'Trag das als Regel ein')]);
    await coach(taken, yes()).tick('p');
    expect(replies(taken).at(-1)!.text).toBe('Gilt ab jetzt.');
  });

  describe('a proposed section', () => {
    const RHYTHM = [
      { sport: 'gym', hardness: 'hard', template: 0 }, { sport: 'bike', hardness: 'easy' }, { sport: 'gym', hardness: 'moderate', template: 1 }, { sport: 'rest', hardness: 'easy' },
      { sport: 'bike', hardness: 'hard' }, { sport: 'run', hardness: 'easy' }, { sport: 'rest', hardness: 'easy' },
    ];
    const blockBody = (state: string) => ({ state, atMs: 1, rhythm: RHYTHM, templates: [{ name: 'Oberkörper A', core: ['pf-a', 'pf-b', 'pf-c'] }, { name: 'Unterkörper B', core: ['pf-d', 'pf-e', 'pf-f'] }], ...(state === 'active' ? { start: '2026-11-09', end: '2026-12-06' } : {}) });
    const blockRec = (state = 'proposed'): TrackedRecord => ({ kind: 'block', id: 'block-c0', updatedMs: 1, deleted: false, body: blockBody(state) });
    const coachBlockMsg: TrackedRecord = { kind: 'chat', id: 'c0', updatedMs: NOW - 5000, deleted: false, body: { role: 'coach', text: 'Das schlage ich als festen Abschnitt vor.', atMs: NOW - 5000, block: 'block-c0' } };
    const blocks = (st: ReturnType<typeof store>) => [...st.recs.values()].filter((r) => r.kind === 'block');

    test('takes the open section on an explicit wish', async () => {
      const s = store([coachBlockMsg, blockRec(), rider('r1', 'Ja, machen wir')]);
      await coach(s, yes()).tick('p');
      expect(blocks(s)[0]!.body).toMatchObject({ state: 'active', start: '2026-11-09', end: '2026-12-20', priorMode: 'week' });
      expect(replies(s).at(-1)!.block).toBe('block-c0');
      expect([...s.recs.values()].filter((r) => r.kind === 'weekplan').map((r) => r.id)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14']);
      expect(replies(s).at(-1)!.text).toBe('Gilt ab jetzt.');
    });

    test('the prompt tells the model that a yes also means an open section', () => {
      expect(CHAT_SYSTEM_PROMPT).toContain('offenen festen Abschnitt');
      expect(WORKOUT_SYSTEM_PROMPT).toContain('offenen festen Abschnitt');
    });

    test('the Härte question right after the review does not hide the section', async () => {
      const ask: TrackedRecord = { kind: 'chat', id: 'c0b', updatedMs: NOW - 4999, deleted: false, body: { role: 'coach', text: 'Wie sehr soll ich dich fordern?', atMs: NOW - 4999, askPush: true } };
      const s = store([coachBlockMsg, ask, blockRec(), rider('r1', 'Ja, machen wir')]);
      await coach(s, yes()).tick('p');
      expect(blocks(s)[0]!.body).toMatchObject({ state: 'active' });
    });

    test('a standalone Härte question still means there is nothing to take', async () => {
      const ask: TrackedRecord = { kind: 'chat', id: 'c0b', updatedMs: NOW - 2000, deleted: false, body: { role: 'coach', text: 'Wie sehr soll ich dich fordern?', atMs: NOW - 2000, askPush: true } };
      const s = store([coachBlockMsg, ask, blockRec(), rider('r1', 'Ja, machen wir')]);
      await coach(s, yes()).tick('p');
      expect(blocks(s)[0]!.body).toMatchObject({ state: 'proposed' });
      expect(replies(s).at(-1)!.text).toContain('keinen offenen Vorschlag');
    });

    test('takes nothing without an open section', async () => {
      const done = blockRec('active');
      const s = store([coachBlockMsg, done, rider('r1', 'Ja, machen wir')]);
      await coach(s, yes()).tick('p');
      expect(blocks(s)).toEqual([done]);
      expect(replies(s).at(-1)!.block).toBeUndefined();
      expect(replies(s).at(-1)!.text).toContain('keinen offenen Vorschlag');
    });
  });

  describe('in a workout', () => {
    const open: TrackedRecord = { kind: 'workout', id: 'w1', updatedMs: 1, deleted: false, body: { id: 'w1', title: 'Oberkörper', startMs: NOW - 20 * 60_000, endMs: null, source: 'pandafit', rest: null, exercises: [] } };
    const yesInWorkout = async () => ({ text: 'Gilt ab jetzt.', newComplaint: null, complaintsOver: [], acceptsRule: true });
    const inWorkout = (m: TrackedRecord): TrackedRecord => ({ ...m, body: { ...(m.body as object), inWorkout: 'w1' } });

    test('takes the draft the coach proposed in the same workout', async () => {
      const s = store([open, inWorkout(coachMsg('rule-d')), draft('wish'), rider('r1', 'Ja, trag das ein', NOW - 1000, { inWorkout: 'w1' })]);
      await coach(s, yesInWorkout).tick('p');
      expect(rules(s)[0]!.body).toMatchObject({ state: 'active' });
      expect(replies(s).at(-1)).toMatchObject({ inWorkout: 'w1', rule: 'rule-d' });
    });

    test('never takes a draft from a message outside the workout', async () => {
      const d = draft('wish');
      const s = store([open, coachMsg('rule-d'), d, rider('r1', 'Ja, trag das ein', NOW - 1000, { inWorkout: 'w1' })]);
      await coach(s, yesInWorkout).tick('p');
      expect(rules(s)).toEqual([d]);
      expect(replies(s).at(-1)!.rule).toBeUndefined();
      expect(replies(s).at(-1)!.text).toContain('keinen offenen Vorschlag');
    });
  });

  test('never takes a goal from the chat', async () => {
    const g = draft('goal');
    const s = store([coachMsg('rule-d'), g, rider('r1', 'Ja, trag ein')]);
    await coach(s, yes()).tick('p');
    expect(rules(s)).toEqual([g]);
    expect(replies(s).at(-1)!.text).toContain('Übernehmen');
    expect(replies(s).at(-1)!.rule).toBeUndefined();
  });
});

describe('Härte im Chat', () => {
  const goalHard: TrackedRecord = { kind: 'goal', id: 'goal', updatedMs: 1, deleted: false, body: { strength: 'muscle', focus: [], sports: {}, push: 'hard', atMs: 1 } };
  const ziel = (prompt: string) => JSON.parse(prompt.split('<ziel-nur-daten>\n')[1]!.split('\n</ziel-nur-daten>')[0]!);

  test('der Regelentwurf kennt goal.push als dauerhafte Änderung ohne weeks', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('push gentle, normal oder hard, wenn die Person sagt, wie sehr du sie fordern sollst; das gilt dauerhaft, also ohne weeks');
  });
  test('der Ziel-Block nennt neben der gewählten auch die Härte, die gerade gilt', async () => {
    const complaint: TrackedRecord = { kind: 'complaint', id: 'k', updatedMs: 1, deleted: false, body: { text: 'Knie zwickt', status: 'active', atMs: 1 } };
    const prompts: string[] = [];
    const ask = async ({ prompt }: { prompt: string }) => { prompts.push(prompt); return { text: 'Okay.', proposal: null, riderAskedForMore: false }; };
    await coach(store([rider('r1', 'Hallo'), goalHard, complaint]), ask).tick('p');
    expect(ziel(prompts[0]!)).toMatchObject({ push: 'hard', haerteJetzt: 'gentle' });
    await coach(store([rider('r1', 'Hallo'), goalHard]), ask).tick('p');
    expect(ziel(prompts[1]!)).toMatchObject({ push: 'hard', haerteJetzt: 'hard' });
    expect(CHAT_SYSTEM_PROMPT).toContain('haerteJetzt');
  });
});

test('askDrift writes the question about the fixed section without AI', () => {
  const s = store();
  coach(s, async () => { throw new Error('no AI'); }).askDrift('p', 'block-m1');
  expect(replies(s)).toMatchObject([{ text: 'Die letzten zwei Wochen sahen anders aus als geplant. Sollen wir wieder locker planen?', push: true, drift: 'block-m1' }]);
});

describe('the fixed section in the chat', () => {
  const RHYTHM = [
    { sport: 'gym', hardness: 'hard', template: 0 }, { sport: 'bike', hardness: 'easy' }, { sport: 'gym', hardness: 'moderate', template: 1 },
    { sport: 'rest', hardness: 'easy' }, { sport: 'bike', hardness: 'hard' }, { sport: 'run', hardness: 'easy' }, { sport: 'rest', hardness: 'easy' },
  ];
  const section = (start: string, end: string): TrackedRecord => ({
    kind: 'block', id: 'block-m0', updatedMs: 1, deleted: false,
    body: { state: 'active', atMs: 1, start, end, rhythm: RHYTHM, templates: [{ name: 'Oberkörper A', core: ['a', 'b', 'c'] }, { name: 'Unterkörper B', core: ['d', 'e', 'f'] }] },
  });
  const LINE = 'Im festen Abschnitt bleibt der Rhythmus; schlag eine andere Woche nur auf Wunsch vor.';

  test('the chat prompt names the running section and keeps its rhythm', async () => {
    const s = store([rider('r1', 'Wie sieht die Woche aus?'), section('2026-11-02', '2026-11-29')]);
    const prompts: string[] = [];
    await coach(s, async ({ prompt }) => { prompts.push(prompt); return { text: 'So.', proposal: null, riderAskedForMore: false }; }).tick('p');
    expect(prompts[0]).toContain('<abschnitt-nur-daten>\n{"woche":1,"von":4,"leichteWoche":false,"vorlagen":[{"name":"Oberkörper A","kern":["a","b","c"]},{"name":"Unterkörper B","kern":["d","e","f"]}],"bis":"2026-11-29"}\n');
    expect(prompts[0]).toContain(LINE);
  });

  test('without a section the prompt has neither', async () => {
    const s = store([rider('r1', 'Hallo')]);
    const prompts: string[] = [];
    await coach(s, async ({ prompt }) => { prompts.push(prompt); return { text: 'Hi.', proposal: null, riderAskedForMore: false }; }).tick('p');
    expect(prompts[0]).not.toContain('abschnitt-nur-daten');
    expect(prompts[0]).not.toContain(LINE);
  });

  test('the week conversation proposes no new week while the next week is in the section', async () => {
    const s = store([section('2026-11-02', '2026-11-29')]);
    const prompts: string[] = [];
    const c = coach(s, async ({ prompt }) => { prompts.push(prompt); return { text: 'Weiter so.', proposal: { weekStart: '2026-11-09', days: days('2026-11-09', [1, 3]) }, riderAskedForMore: false }; });
    expect(await c.openWeek('p')).toBe(true);
    const [m] = replies(s);
    expect(m!.proposal).toBeUndefined();
    expect(prompts[0]).toContain(LINE);
    expect(prompts[0]).not.toContain('schlag die nächste Woche vor');
  });

  test('the week conversation proposes the next week when the section ends this week', async () => {
    const s = store([section('2026-10-12', '2026-11-08')]);
    const c = coach(s, async () => ({ text: 'Hier.', proposal: { weekStart: '2026-11-09', days: days('2026-11-09', [1, 3]) }, riderAskedForMore: false }));
    expect(await c.openWeek('p')).toBe(true);
    expect(replies(s)[0]!.proposal?.weekStart).toBe('2026-11-09');
  });
});

describe('the running section in the chat', () => {
  const RHYTHM = [
    { sport: 'gym', hardness: 'hard', template: 0 }, { sport: 'bike', hardness: 'easy' }, { sport: 'gym', hardness: 'moderate', template: 1 }, { sport: 'rest', hardness: 'easy' },
    { sport: 'bike', hardness: 'hard' }, { sport: 'run', hardness: 'easy' }, { sport: 'rest', hardness: 'easy' },
  ];
  const running: TrackedRecord = { kind: 'block', id: 'block-x', updatedMs: 1, deleted: false, body: {
    state: 'active', atMs: 1, rhythm: RHYTHM, start: '2026-11-02', end: '2026-11-29', priorMode: 'spontaneous',
    templates: [{ name: 'Oberkörper A', core: ['pf-a', 'pf-b', 'pf-c'] }, { name: 'Unterkörper B', core: ['pf-d', 'pf-e', 'pf-f'] }],
  } };
  const answer = (extra = {}) => ({ text: 'Okay.', proposal: null, riderAskedForMore: false, newComplaint: null, complaintsOver: [], complaintsHealing: [], tasks: [], nextChange: null, ruleDraft: null, acceptsRule: false, endsBlock: false, ...extra });
  const catalog = [{ id: 'pf-a', title: 'Bankdrücken' }, { id: 'pf-d', title: 'Kniebeuge' }];
  const coachWith = (s: ReturnType<typeof store>, ask: (p: { prompt: string }) => Promise<unknown>) =>
    new ChatCoach({ store: s as never, ask: ask as never, nowMs: () => NOW, newId: () => `c${++n}`, catalog: () => catalog as never });

  test('Bo knows the core exercises of every template by name', async () => {
    const s = store([running, rider('r1', 'Was steht im Abschnitt an?')]);
    const asks: string[] = [];
    await coachWith(s, async ({ prompt }) => { asks.push(prompt); return answer(); }).tick('p');
    expect(asks[0]).toContain('"kern":["Bankdrücken","pf-b","pf-c"]');
    expect(asks[0]).toContain('"kern":["Kniebeuge","pf-e","pf-f"]');
  });

  test('a wish to end the section gets a card to end it, nothing ends by itself', async () => {
    const s = store([running, rider('r1', 'Lass uns den Abschnitt beenden')]);
    await coachWith(s, async () => answer({ endsBlock: true })).tick('p');
    expect(replies(s).at(-1)!.endBlock).toBe('block-x');
    expect(s.recs.get('block:block-x')!.body).toMatchObject({ state: 'active' });
  });

  test('without a running section there is no card to end it', async () => {
    const s = store([rider('r1', 'Lass uns den Abschnitt beenden')]);
    await coachWith(s, async () => answer({ endsBlock: true })).tick('p');
    expect(replies(s).at(-1)!.endBlock).toBeUndefined();
  });

  test('the prompt tells the model how to end a section', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('endsBlock');
  });
});
