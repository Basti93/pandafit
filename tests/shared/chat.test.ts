import { readCoachPrefs, chatThread, proposalAnswer, readChat, waitingMessage } from '../../src/shared/chat';
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
