import { readCoachPrefs, latestReview, chatThread, proposalAnswer, readChat, waitingMessage, chartsOf, cardFields } from '../../src/shared/chat';
import type { TrackedRecord } from '../../src/shared/records';

const rec = (id: string, body: object, deleted = false): TrackedRecord => ({ kind: 'chat', id, updatedMs: 1, deleted, body });

test('reads a message and refuses broken ones', () => {
  expect(readChat({ role: 'rider', text: 'Hallo', atMs: 1 })).toEqual({ role: 'rider', text: 'Hallo', atMs: 1 });
  expect(readChat({ role: 'bot', text: 'x', atMs: 1 })).toBeNull();
  expect(readChat({ role: 'coach', text: 'x', atMs: 1, proposal: { weekStart: '2026-11-03', days: [] } })).toBeNull();
});

test('the thread is ordered, deleted messages are gone', () => {
  const t = chatThread([rec('b', { role: 'coach', text: '2', atMs: 2 }), rec('a', { role: 'rider', text: '1', atMs: 1 }), rec('c', { role: 'rider', text: 'x', atMs: 3 }, true)]);
  expect(t.map((m) => m.id)).toEqual(['a', 'b']);
});

test('the waiting message is the last unanswered rider message; takes and declines wait for nothing', () => {
  const r1 = rec('r1', { role: 'rider', text: 'Plan bitte', atMs: 1 });
  expect(waitingMessage(chatThread([r1]))?.id).toBe('r1');
  const c1 = rec('c1', { role: 'coach', text: 'Hier', atMs: 2, replyTo: 'r1' });
  expect(waitingMessage(chatThread([r1, c1]))).toBeNull();
  const take = rec('t', { role: 'rider', text: 'Übernommen', atMs: 3, takes: 'c1' });
  expect(waitingMessage(chatThread([r1, c1, take]))).toBeNull();
  expect(proposalAnswer(chatThread([r1, c1, take]), 'c1')).toBe('taken');
  const r2 = rec('r2', { role: 'rider', text: 'Und Freitag?', atMs: 4 });
  expect(waitingMessage(chatThread([r1, c1, take, r2]))?.id).toBe('r2');
});

test('a second rider message sent while the first is being answered still waits; unasked coach notes do not hide it', () => {
  const a = rec('a', { role: 'rider', text: 'Gerät belegt', atMs: 1 });
  const b = rec('b', { role: 'rider', text: 'und Schulter zwickt', atMs: 2 });
  const ansA = rec('x', { role: 'coach', text: 'Nimm die Maschine.', atMs: 3, replyTo: 'a' });
  expect(waitingMessage(chatThread([a, b, ansA]))?.id).toBe('b');
  const note = rec('n', { role: 'coach', text: 'Morgen: Rad', atMs: 4, push: true });
  expect(waitingMessage(chatThread([a, b, ansA, note]))?.id).toBe('b');
  expect(waitingMessage(chatThread([a, ansA, note]))).toBeNull();
});

test('the monthly review is on unless switched off', () => {
  expect(readCoachPrefs({ week: {}, evening: {} }).review.on).toBe(true);
  expect(readCoachPrefs({ review: { on: false } }).review.on).toBe(false);
  expect(readCoachPrefs({ review: { on: true } }).review.on).toBe(true);
});

test('a review is cut to three observations made of strings', () => {
  const o = (i: number) => ({ text: `Satz ${i}.`, reason: `Grund ${i}.` });
  const base = { role: 'coach', text: 'Rückblick', atMs: 1 };
  expect(readChat({ ...base, review: { observations: [1, 2, 3, 4].map(o) } })).toEqual({ ...base, review: { observations: [1, 2, 3].map(o) } });
  expect(readChat({ ...base, review: { observations: [{ text: 1, reason: 'x' }] } })).toBeNull();
  expect(readChat({ ...base, review: { observations: [1, 2].map(o) } })).toEqual({ ...base, review: { observations: [1, 2].map(o) } });
});

test('latestReview nimmt die jüngste Coach-Nachricht mit Rückblick', () => {
  const obs = (t: string) => ({ observations: [{ text: t, reason: 'weil' }] });
  const t = chatThread([
    rec('a', { role: 'coach', text: 'alt', atMs: 1, review: obs('alt') }),
    rec('b', { role: 'coach', text: 'neu', atMs: 5, review: obs('neu') }),
    rec('c', { role: 'coach', text: 'später ohne', atMs: 9 }),
    rec('d', { role: 'rider', text: 'Hallo', atMs: 10 }),
  ]);
  expect(latestReview(t)).toEqual({ atMs: 5, observations: [{ text: 'neu', reason: 'weil' }] });
  expect(latestReview([])).toBeNull();
});

test('ein gespeicherter Rückblick wird auf 150 Zeichen je Text und Grund gekürzt', () => {
  const long = 'x'.repeat(1000);
  const m = readChat({ role: 'coach', text: 'Rückblick', atMs: 1, review: { observations: [{ text: long, reason: long }] } });
  expect(m?.review?.observations[0]).toEqual({ text: 'x'.repeat(150), reason: 'x'.repeat(150) });
});

describe('Muskel-Diagramm an einer Nachricht', () => {
  const chart = { kind: 'muskeln', fromMs: 1, toMs: 2, axes: [{ group: 'chest', sets: 3, min: 1, max: 2 }, { group: 'back', sets: 0, min: 1, max: 2 }, { group: 'abs', sets: 1, min: 0, max: 2 }] };
  it('liest das Diagramm mit', () => {
    expect(readChat({ role: 'coach', text: 'x', atMs: 1, chart })?.chart).toEqual(chart);
  });
  it('liest alte Nachrichten ohne Diagramm', () => {
    expect(readChat({ role: 'coach', text: 'x', atMs: 1 })?.chart).toBeUndefined();
  });
  it('überspringt eine unbekannte Art, die Nachricht bleibt lesbar', () => {
    const m = readChat({ role: 'coach', text: 'x', atMs: 1, chart: { kind: 'herz', fromMs: 1, toMs: 2 } });
    expect(m).not.toBeNull();
    expect(m).not.toHaveProperty('chart');
  });
});

describe('Mehrere Diagramme an einer Nachricht', () => {
  const muscles = { kind: 'muskeln', fromMs: 1, toMs: 2, axes: [{ group: 'chest', sets: 3, min: 1, max: 2 }, { group: 'back', sets: 0, min: 1, max: 2 }, { group: 'abs', sets: 1, min: 0, max: 2 }] };
  const sport = { kind: 'sport', fromMs: 1, toMs: 2, parts: [{ sport: 'gym', minutes: 60, target: 0.5 }, { sport: 'bike', minutes: 60, target: 0.5 }] };
  it('liest das Sport-Diagramm als einzelnes Diagramm', () => {
    const m = readChat({ role: 'coach', text: 'x', atMs: 1, chart: sport })!;
    expect(m.chart).toEqual(sport);
    expect(chartsOf(m)).toEqual([sport]);
  });
  it('liest eine Liste und überspringt unbekannte Arten darin', () => {
    const m = readChat({ role: 'coach', text: 'x', atMs: 1, chart: muscles, charts: [muscles, { kind: 'herz' }, sport] })!;
    expect(chartsOf(m)).toEqual([muscles, sport]);
  });
  it('alte Nachrichten mit einem chart und ohne charts geben eine Liste mit einem Eintrag', () => {
    expect(chartsOf(readChat({ role: 'coach', text: 'x', atMs: 1, chart: muscles })!)).toEqual([muscles]);
    expect(chartsOf(readChat({ role: 'coach', text: 'x', atMs: 1 })!)).toEqual([]);
  });
  it('schreibt das erste Diagramm auch als chart, damit ältere Geräte es noch zeigen, die Liste nur bei mehreren', () => {
    expect(cardFields([])).toEqual({});
    expect(cardFields([muscles as never])).toEqual({ chart: muscles });
    expect(cardFields([muscles as never, sport as never])).toEqual({ chart: muscles, charts: [muscles, sport] });
  });
  it('eine Liste ohne lesbaren Eintrag lässt die Nachricht ohne Diagramm', () => {
    const m = readChat({ role: 'coach', text: 'x', atMs: 1, charts: [{ kind: 'herz' }], chart: { kind: 'herz' } })!;
    expect(chartsOf(m)).toEqual([]);
  });
});
