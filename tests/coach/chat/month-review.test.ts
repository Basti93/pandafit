import { pushAskDue, reviewDue, sportsKeyOf } from '../../../src/coach/chat/month-review';
import { QUESTION_GAP_DAYS } from '../../../src/coach/motivation';
import { DEFAULT_PREFS } from '../../../src/shared/chat';
import { lastSundayOf } from '../../../src/shared/dates';

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
const four = ['2026-10-05', '2026-10-15', '2026-11-02', '2026-11-08'];
const base = { prefs: DEFAULT_PREFS, sportsKey: 'bike:high', gymDates: four, sent: {}, nowMs: at(29, 18) };

test('lastSundayOf finds the last Sunday of the month', () => {
  expect(lastSundayOf('2026-11-10')).toBe('2026-11-29');
  expect(lastSundayOf('2026-02-03')).toBe('2026-02-22');
});

it('ist am letzten Sonntag ab der Uhrzeit fällig', () => {
  expect(reviewDue({ ...base, nowMs: at(29, 17) })).toBeNull();
  expect(reviewDue(base)).toBe('month');
  expect(reviewDue({ ...base, sent: { review: '2026-11-29' } })).toBeNull();
  expect(reviewDue({ ...base, nowMs: at(28, 18) })).toBeNull();
});

it('braucht vier Krafttrainings in 90 Tagen', () => {
  expect(reviewDue({ ...base, gymDates: four.slice(0, 3) })).toBeNull();
  expect(reviewDue({ ...base, gymDates: ['2026-07-01', ...four.slice(0, 3)] })).toBeNull();
});

it('lässt 14 Tage Abstand', () => {
  expect(reviewDue({ ...base, sent: { review: '2026-11-20' } })).toBeNull();
  expect(reviewDue({ ...base, sent: { review: '2026-11-10' } })).toBe('month');
});

it('kommt nach einer Pause außer der Reihe', () => {
  expect(reviewDue({ ...base, gymDates: ['2026-10-01', '2026-11-10'], nowMs: at(10, 9) })).toBe('pause');
  expect(reviewDue({ ...base, gymDates: ['2026-10-01', '2026-11-10'], nowMs: at(14, 9) })).toBeNull();
  expect(reviewDue({ ...base, gymDates: ['2026-10-25', '2026-11-10'], nowMs: at(10, 9) })).toBeNull();
});

it('kommt bei neuem Schwerpunkt', () => {
  const o = { ...base, nowMs: at(12, 9) };
  expect(reviewDue({ ...o, sent: { reviewSports: 'run:high' } })).toBe('sports');
  expect(reviewDue({ ...o, sent: { reviewSports: 'bike:high' } })).toBeNull();
  expect(reviewDue({ ...o, gymDates: four.slice(0, 3), sent: { reviewSports: 'run:high' } })).toBeNull();
});

it('kommt auch beim Standard-Schwerpunkt, dessen Schlüssel leer ist', () => {
  expect(reviewDue({ ...base, sportsKey: 'bike:high', nowMs: at(12, 9), sent: { reviewSports: '' } })).toBe('sports');
});

it('nutzt ohne Wochengespräch die Standard-Uhrzeit statt der gespeicherten', () => {
  const prefs = { ...DEFAULT_PREFS, week: { on: false, day: 6, hour: 7 } };
  expect(reviewDue({ ...base, prefs, nowMs: at(29, 17) })).toBeNull();
  expect(reviewDue({ ...base, prefs, nowMs: at(29, DEFAULT_PREFS.week.hour) })).toBe('month');
  expect(reviewDue({ ...base, prefs: { ...prefs, week: { ...prefs.week, on: true } }, nowMs: at(29, 7) })).toBe('month');
});

it('schweigt, wenn abgeschaltet', () => {
  expect(reviewDue({ ...base, prefs: { ...DEFAULT_PREFS, review: { on: false } } })).toBeNull();
});

it('sportsKeyOf ist unabhängig von der Reihenfolge', () => {
  expect(sportsKeyOf({ sports: { run: 'high', bike: 'low' } as never })).toBe(sportsKeyOf({ sports: { bike: 'low', run: 'high' } as never }));
});

describe('pushAskDue', () => {
  const DAY = 86_400_000;
  const now = at(12, 9);
  const three = ['2026-11-02', '2026-11-05', '2026-11-09'];
  const ask = { goal: {}, complaints: [], gymDates: three, sent: {}, prefs: DEFAULT_PREFS, retryMs: 30 * 60_000, reviewOpen: false, nowMs: now };

  it('fragt nach dem dritten Krafttraining', () => {
    expect(pushAskDue(ask)).toBe(true);
    expect(pushAskDue({ ...ask, gymDates: three.slice(0, 2) })).toBe(false);
    // Two workouts on the same day count as one strength day; a day in the future does not count yet.
    expect(pushAskDue({ ...ask, gymDates: ['2026-11-02', '2026-11-02', '2026-11-05'] })).toBe(false);
    expect(pushAskDue({ ...ask, gymDates: [...three.slice(0, 2), '2026-11-20'] })).toBe(false);
  });

  it('fragt nicht bei Beschwerde oder zweimal, aber auch nach einem Rückblick ohne Frage', () => {
    expect(pushAskDue({ ...ask, complaints: [{ status: 'active' }] })).toBe(false);
    expect(pushAskDue({ ...ask, complaints: [{ status: 'healing' }] })).toBe(false);
    expect(pushAskDue({ ...ask, complaints: [{ status: 'over' }] })).toBe(true);
    // Only pushAsk says that Bo asked; a review that skipped the question leaves it open.
    expect(pushAskDue({ ...ask, sent: { review: '2026-10-25' } })).toBe(true);
    expect(pushAskDue({ ...ask, sent: { pushAsk: '2026-11-09' } })).toBe(false);
    expect(pushAskDue({ ...ask, goal: { push: 'normal' } })).toBe(false);
  });

  it('hält drei Tage Abstand zur letzten Frage', () => {
    expect(QUESTION_GAP_DAYS).toBe(3);
    expect(pushAskDue({ ...ask, lastQuestionMs: now - 2 * DAY })).toBe(false);
    expect(pushAskDue({ ...ask, lastQuestionMs: now - QUESTION_GAP_DAYS * DAY })).toBe(true);
  });

  it('fragt nicht, solange ein Rückblick läuft oder gerade versucht wurde', () => {
    expect(pushAskDue({ ...ask, reviewOpen: true })).toBe(false);
    expect(pushAskDue({ ...ask, reviewTriedMs: now - 29 * 60_000 })).toBe(false);
    expect(pushAskDue({ ...ask, reviewTriedMs: now - 30 * 60_000 })).toBe(true);
  });

  it('wartet drei Stunden nach der letzten Nachricht, die Bo von sich aus geschickt hat', () => {
    expect(pushAskDue({ ...ask, lastPushMs: now - 2 * 3600_000 })).toBe(false);
    expect(pushAskDue({ ...ask, lastPushMs: now - 3 * 3600_000 })).toBe(true);
  });

  it('fragt nur zwischen 8 Uhr und der Abendstunde', () => {
    expect(pushAskDue({ ...ask, nowMs: at(12, 7) })).toBe(false);
    expect(pushAskDue({ ...ask, nowMs: at(12, 8) })).toBe(true);
    expect(pushAskDue({ ...ask, nowMs: at(12, DEFAULT_PREFS.evening.hour - 1) })).toBe(true);
    expect(pushAskDue({ ...ask, nowMs: at(12, DEFAULT_PREFS.evening.hour) })).toBe(false);
    const evening = (on: boolean, hour: number) => ({ ...DEFAULT_PREFS, evening: { on, hour } });
    expect(pushAskDue({ ...ask, prefs: evening(true, 21), nowMs: at(12, 20) })).toBe(true);
    expect(pushAskDue({ ...ask, prefs: evening(true, 21), nowMs: at(12, 21) })).toBe(false);
    // Without the evening message the default hour applies, not the stored one.
    expect(pushAskDue({ ...ask, prefs: evening(false, 21), nowMs: at(12, 20) })).toBe(false);
  });
});
