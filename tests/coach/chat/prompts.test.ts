import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { duePrompts, eveningText, SentPrompts } from '../../../src/coach/chat/prompts';
import type { TrackedRecord } from '../../../src/shared/records';
import { weekDates } from '../../../src/shared/week-plan';

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime(); // November 2026; the 8th is a Sunday
const prefs = (week: object, evening: object): TrackedRecord[] => [{ kind: 'coachprefs', id: 'prefs', updatedMs: 1, deleted: false, body: { week, evening } }];
const plan = (sports: string[]): TrackedRecord[] => [{ kind: 'weekplan', id: '2026-11-02', updatedMs: 1, deleted: false,
  body: { weekStart: '2026-11-02', fromMessage: 'm', acceptedMs: 1, days: weekDates('2026-11-02').map((date, i) => ({ date, sport: sports[i] ?? 'rest', hardness: 'easy', fixed: false })) } }];
const sent = () => new SentPrompts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sent-')), 'chat', 'sent.json'));
const detail = () => 'Grundlage 45';

test('off by default: nothing is ever due', () => {
  expect(duePrompts({ id: 'p', records: { prefs: [], weekplan: plan(['bike']) }, nowMs: at(8, 20), sent: sent(), detail })).toEqual({ week: false, evening: null });
});

test('the week conversation comes once on its day from its hour on', () => {
  const s = sent();
  const r = { prefs: prefs({ on: true, day: 6, hour: 18 }, { on: false }), weekplan: [] };
  expect(duePrompts({ id: 'p', records: r, nowMs: at(8, 17), sent: s, detail }).week).toBe(false);
  expect(duePrompts({ id: 'p', records: r, nowMs: at(8, 18), sent: s, detail }).week).toBe(true);
  // Still due until the caller marks it as written (a failing Claude tries again).
  expect(duePrompts({ id: 'p', records: r, nowMs: at(8, 19), sent: s, detail }).week).toBe(true);
  s.mark('p', 'week', '2026-11-02');
  expect(duePrompts({ id: 'p', records: r, nowMs: at(8, 21), sent: s, detail }).week).toBe(false);
  expect(duePrompts({ id: 'p', records: r, nowMs: at(7, 19), sent: s, detail }).week).toBe(false);
});

test('the evening suggestion names tomorrow, once a day, and never before a rest day', () => {
  const s = sent();
  const r = { prefs: prefs({ on: false }, { on: true, hour: 19 }), weekplan: plan(['rest', 'rest', 'rest', 'bike']) };
  expect(duePrompts({ id: 'p', records: r, nowMs: at(4, 18), sent: s, detail }).evening).toBeNull();
  expect(duePrompts({ id: 'p', records: r, nowMs: at(4, 19), sent: s, detail }).evening).toMatchObject({ role: 'coach', push: true, text: 'Morgen: Rad, locker (Grundlage 45). Passt das, oder lieber etwas anderes?' });
  expect(duePrompts({ id: 'p', records: r, nowMs: at(4, 20), sent: s, detail }).evening).toBeNull();
  expect(duePrompts({ id: 'p', records: r, nowMs: at(5, 19), sent: s, detail }).evening).toBeNull();
  expect(eveningText(null, null)).toBeNull();
});

test('the evening message names both sessions of a combination day', () => {
  expect(eveningText({ date: '2026-11-05', sport: 'gym', hardness: 'moderate', fixed: false, also: { sport: 'bike', hardness: 'easy' } }, null))
    .toBe('Morgen: Kraft, mittel + Rad, locker. Passt das, oder lieber etwas anderes?');
});

test('marking the review keeps week and evening', () => {
  const s = sent();
  s.mark('p', 'week', '2026-11-02');
  s.mark('p', 'evening', '2026-11-08');
  s.mark('p', 'review', '2026-11-29');
  expect(s.get('p')).toEqual({ week: '2026-11-02', evening: '2026-11-08', review: '2026-11-29' });
});
