import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { announceBlockEnd, blockEndDue, driftDue, PlannedWeeks, watchBlock } from '../../../src/coach/chat/block-watch';
import { blockRecord, type BlockBody } from '../../../src/shared/block';
import { frameRecord, readFrame } from '../../../src/shared/frame';
import type { TrackedRecord } from '../../../src/shared/records';
import { QUESTION_GAP_DAYS } from '../../../src/coach/motivation';

const RHYTHM: BlockBody['rhythm'] = [
  { sport: 'gym', hardness: 'hard', template: 0 }, { sport: 'bike', hardness: 'easy' }, { sport: 'gym', hardness: 'moderate', template: 1 },
  { sport: 'rest', hardness: 'easy' }, { sport: 'bike', hardness: 'hard' }, { sport: 'run', hardness: 'easy' }, { sport: 'rest', hardness: 'easy' },
];
const block: BlockBody = {
  state: 'active', atMs: 1, start: '2026-11-30', end: '2026-12-27', rhythm: RHYTHM, priorMode: 'spontaneous', frameMs: 10,
  templates: [{ name: 'A', core: ['a', 'b', 'c'] }, { name: 'B', core: ['d', 'e', 'f'] }],
};
// Today is Monday 2026-12-14: the full weeks before are 11-30 and 12-07.
const planned = (n: number | undefined) => () => n;
const base = { block, planned: planned(3), gymDates: ['2026-12-01', '2026-12-08'], sent: {}, today: '2026-12-14' };

describe('driftDue', () => {
  it('fragt nach zwei Wochen mit weniger als der Hälfte', () => {
    expect(driftDue(base)).toBe(true);
    expect(driftDue({ ...base, gymDates: ['2026-12-01', '2026-12-02', '2026-12-08'] })).toBe(false);
  });
  it('braucht in beiden Wochen weniger als die Hälfte und geplante Einheiten', () => {
    expect(driftDue({ ...base, gymDates: ['2026-12-01', '2026-12-02', '2026-12-08', '2026-12-09'] })).toBe(false);
    expect(driftDue({ ...base, planned: planned(0) })).toBe(false);
    expect(driftDue({ ...base, planned: planned(undefined) })).toBe(false);
  });
  it('zählt die laufende Woche nicht', () => {
    expect(driftDue({ ...base, gymDates: ['2026-12-01', '2026-12-08', '2026-12-14', '2026-12-15', '2026-12-16'] })).toBe(true);
  });
  it('zählt nur volle Wochen im Abschnitt', () => {
    expect(driftDue({ ...base, today: '2026-12-07' })).toBe(false);
    expect(driftDue({ ...base, block: { ...block, start: '2026-12-07' } })).toBe(false);
  });
  it('fragt frühestens nach zwei weiteren Wochen erneut', () => {
    expect(driftDue({ ...base, sent: { drift: '2026-12-08' } })).toBe(false);
    expect(driftDue({ ...base, sent: { drift: '2026-11-30' } })).toBe(true);
  });
  it('fragt nicht, wenn der Abschnitt vorbei oder nicht aktiv ist', () => {
    expect(driftDue({ ...base, block: { ...block, state: 'ended' } })).toBe(false);
    expect(driftDue({ ...base, today: '2026-12-28' })).toBe(false);
  });
});

describe('blockEndDue', () => {
  const o = { block: { ...block, id: 'block-m1' }, sent: {}, today: '2026-12-28' };
  it('meldet das Ende, wenn kein Rückblick kam', () => {
    expect(blockEndDue(o)).toBe(true);
    expect(blockEndDue({ ...o, today: '2026-12-27' })).toBe(false);
  });
  it('meldet es nur einmal', () => {
    expect(blockEndDue({ ...o, sent: { blockEnd: 'block-m1' } })).toBe(false);
  });
  it('meldet nichts für einen Abschnitt, der nicht aktiv ist', () => {
    expect(blockEndDue({ ...o, block: { ...o.block, state: 'ended' } })).toBe(false);
  });
});

describe('PlannedWeeks', () => {
  it('merkt sich die geplante Zahl nur beim ersten Mal', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), 'chat', 'planned-weeks.json');
    const w = new PlannedWeeks(file);
    expect(w.get('p', '2026-12-07')).toBeUndefined();
    w.note('p', '2026-12-07', 3);
    w.note('p', '2026-12-07', 1);
    expect(w.get('p', '2026-12-07')).toBe(3);
    expect(new PlannedWeeks(file).get('p', '2026-12-07')).toBe(3);
    expect(new PlannedWeeks(file).get('q', '2026-12-07')).toBeUndefined();
  });
});

describe('announceBlockEnd', () => {
  const rec = blockRecord('block-m1', block, 5);
  const run = (frame: TrackedRecord[], fail = false) => {
    const log: string[] = [];
    const sent = announceBlockEnd({
      block: rec, frame, nowMs: 100, message: true,
      put: (r) => { log.push(r.kind); if (fail && r.kind === 'block') throw new Error('x'); },
      say: (t) => { log.push('say'); expect(t).toBe('Dein fester Abschnitt ist vorbei. Ab jetzt plane ich wieder locker, dein Ziel bleibt.'); },
      mark: () => { log.push('mark'); },
    });
    return { log, sent };
  };
  it('stellt den Rahmen zurück, sagt es, setzt den Abschnitt auf beendet und merkt es sich erst danach', () => {
    const frame = [frameRecord({ mode: 'week', minutes: null }, 10)];
    const { log } = run(frame);
    expect(log).toEqual(['frame', 'say', 'block', 'mark']);
  });
  it('lässt einen geänderten Rahmen in Ruhe', () => {
    const { log } = run([frameRecord({ mode: 'week', minutes: null }, 11)]);
    expect(log).toEqual(['say', 'block', 'mark']);
  });
  it('schreibt den Rahmen mit dem früheren Modus', () => {
    const writes: TrackedRecord[] = [];
    announceBlockEnd({ block: rec, frame: [frameRecord({ mode: 'week', minutes: null }, 10)], nowMs: 100, message: true, put: (r) => { writes.push(r); }, say: () => {}, mark: () => {} });
    expect(readFrame(writes[0]!.body)?.mode).toBe('spontaneous');
    expect(writes[1]!.body).toMatchObject({ state: 'ended' });
  });
  it('merkt sich nichts, wenn der Abschnitt nicht gespeichert werden konnte', () => {
    const log: string[] = [];
    expect(() => announceBlockEnd({
      block: rec, frame: [], nowMs: 100, message: true, say: () => log.push('say'), mark: () => log.push('mark'),
      put: (r) => { if (r.kind === 'block') throw new Error('x'); },
    })).toThrow();
    expect(log).toEqual(['say']);
  });
  it('sagt nach einem Abschnitt aus dem Wochenmodus, dass wieder Woche für Woche geplant wird', () => {
    const texts: string[] = [];
    announceBlockEnd({ block: blockRecord('block-m1', { ...block, priorMode: 'week' }, 5), frame: [], nowMs: 100, message: true, put: () => {}, say: (t) => { texts.push(t); }, mark: () => {} });
    expect(texts).toEqual(['Dein fester Abschnitt ist vorbei. Ab jetzt planen wir wieder Woche für Woche, dein Ziel bleibt.']);
  });
});

describe('watchBlock', () => {
  const rec = blockRecord('block-m1', block, 5);
  const plan = (monday: string): TrackedRecord => ({
    kind: 'weekplan', id: monday, updatedMs: 1, deleted: false,
    body: { weekStart: monday, days: RHYTHM.map((d, i) => ({ date: addDay(monday, i), sport: d.sport, hardness: d.hardness, fixed: false })), fromMessage: 'm', acceptedMs: 1 },
  });
  const addDay = (key: string, n: number) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10); };
  const setup = (today: string, over: { gymDates?: string[]; sent?: Record<string, string>; frame?: TrackedRecord[]; askAllowed?: boolean } = {}) => {
    const marks: Record<string, string> = { ...over.sent };
    const log: string[] = [];
    const planned = new PlannedWeeks(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-')), 'p.json'));
    planned.note('p', '2026-11-30', 2); planned.note('p', '2026-12-07', 2);
    const run = () => watchBlock({
      today, nowMs: 100, askAllowed: over.askAllowed ?? true, blocks: [rec], weekplans: [plan('2026-12-14'), plan('2026-12-21')], frame: over.frame ?? [frameRecord({ mode: 'week', minutes: null }, 10)], gymDates: over.gymDates ?? [], id: 'p',
      sent: { get: () => marks, mark: (_i, k, v) => { marks[k] = v; } }, planned,
      ask: (b) => log.push(`ask:${b}`), say: () => log.push('say'), put: (r) => log.push(r.kind),
    });
    return { run, log, marks, planned };
  };
  it('merkt sich die Planung der Woche und fragt einmal bei Abweichung', () => {
    const s = setup('2026-12-14');
    expect(s.run()).toBe('drift');
    expect(s.log).toEqual(['ask:block-m1']);
    expect(s.marks.drift).toBe('2026-12-14');
    expect(s.planned.get('p', '2026-12-14')).toBe(2);
    expect(s.run()).toBeNull();
  });
  it('fragt nicht, wenn die Einheiten stattfanden', () => {
    const s = setup('2026-12-14', { gymDates: ['2026-12-01', '2026-12-03', '2026-12-08', '2026-12-09'] });
    expect(s.run()).toBeNull();
  });
  it('beendet den Abschnitt mit Nachricht, auch wenn am letzten Tag ein Rückblick kam', () => {
    const s = setup('2026-12-28', { sent: { review: '2026-12-27' } });
    expect(s.run()).toBe('end');
    expect(s.log).toEqual(['frame', 'say', 'block']);
    expect(s.marks.blockEnd).toBe('block-m1');
    expect(s.run()).toBeNull();
  });
  it('beendet den alten Abschnitt ohne Nachricht, wenn schon ein neuer läuft', () => {
    const next = blockRecord('block-m2', { ...block, start: '2026-12-28', end: '2027-01-31', frameMs: 20 }, 6);
    const marks: Record<string, string> = {};
    const log: string[] = [];
    const out = watchBlock({
      today: '2026-12-28', nowMs: 100, askAllowed: false, blocks: [rec, next], weekplans: [], frame: [frameRecord({ mode: 'week', minutes: null }, 20)], gymDates: [], id: 'p',
      sent: { get: () => marks, mark: (_i, k, v) => { marks[k] = v; } }, planned: new PlannedWeeks(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-')), 'p.json')),
      ask: () => log.push('ask'), say: () => log.push('say'), put: (r) => log.push(`${r.kind}:${r.id}`),
    });
    expect(out).toBe('end');
    expect(log).toEqual(['block:block-m1']);
  });
  it('fragt nicht, wenn die Frage nicht erlaubt ist, beendet aber trotzdem', () => {
    const s = setup('2026-12-14', { askAllowed: false });
    expect(s.run()).toBeNull();
    expect(s.log).toEqual([]);
    expect(s.marks.drift).toBeUndefined();
    const e = setup('2026-12-28', { askAllowed: false });
    expect(e.run()).toBe('end');
  });
  it('fragt nicht, während ein Rückblick geschrieben wird oder kurz nach Bos letzter Frage', () => {
    const run = (o: { reviewOpen?: boolean; lastQuestionMs?: number }) => {
      const marks: Record<string, string> = {};
      const planned = new PlannedWeeks(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-')), 'p.json'));
      planned.note('p', '2026-11-30', 2); planned.note('p', '2026-12-07', 2);
      return watchBlock({
        today: '2026-12-14', nowMs: Date.UTC(2026, 11, 14, 12), askAllowed: true, ...o, blocks: [rec], weekplans: [], frame: [], gymDates: [], id: 'p',
        sent: { get: () => marks, mark: (_i, k, v) => { marks[k] = v; } }, planned, ask: () => {}, say: () => {}, put: () => {},
      });
    };
    expect(run({ reviewOpen: true })).toBeNull();
    expect(run({ lastQuestionMs: Date.UTC(2026, 11, 14, 12) - 86_400_000 })).toBeNull();
    expect(run({ lastQuestionMs: Date.UTC(2026, 11, 14, 12) - (QUESTION_GAP_DAYS + 1) * 86_400_000 })).toBe('drift');
  });
  it('meldet das Ende einmal', () => {
    const s = setup('2026-12-28');
    expect(s.run()).toBe('end');
    expect(s.log).toEqual(['frame', 'say', 'block']);
    expect(s.marks.blockEnd).toBe('block-m1');
    expect(s.run()).toBeNull();
  });
});
