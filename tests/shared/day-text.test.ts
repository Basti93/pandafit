import { describe, expect, it } from 'vitest';
import { DAYTEXT_ID, DAY_TEXT_MAX, PRESSURE_WORDS, SAYINGS, dayLine, readDayText, sayingFor } from '../../src/shared/day-text';
import { RECORD_KINDS, type TrackedRecord } from '../../src/shared/records';
import { readable } from '../../src/web/validate';

const ok = { type: 'daytext', date: '2026-11-08', text: 'Schön, dass du da bist.', atMs: 5 };
const rec = (body: unknown): TrackedRecord => ({ kind: 'daytext', id: DAYTEXT_ID, updatedMs: 1, deleted: false, body });

describe('readDayText', () => {
  it('reads a whole body', () => { expect(readDayText({ ...ok, about: 'kraft-1' })).toEqual({ ...ok, about: 'kraft-1' }); });
  it('rejects over-long text, a bad date and missing fields', () => {
    expect(readDayText({ ...ok, text: 'x'.repeat(DAY_TEXT_MAX + 1) })).toBeNull();
    expect(readDayText({ ...ok, text: 'x'.repeat(DAY_TEXT_MAX) })).not.toBeNull();
    expect(readDayText({ ...ok, text: '' })).toBeNull();
    expect(readDayText({ ...ok, date: '8.11.2026' })).toBeNull();
    expect(readDayText({ ...ok, about: 'a'.repeat(201) })).toBeNull();
    for (const k of ['type', 'date', 'text', 'atMs']) expect(readDayText({ ...ok, [k]: undefined })).toBeNull();
    expect(readDayText(null)).toBeNull();
  });
  it('is a known kind the web reads', () => {
    expect(RECORD_KINDS).toContain('daytext');
    expect(readable(rec(ok))).toBe(true);
    expect(readable(rec({ ...ok, date: 'x' }))).toBe(false);
  });
});

describe('sayings', () => {
  it('has 30, none with a digit or a pressure word', () => {
    expect(SAYINGS).toHaveLength(30);
    for (const s of SAYINGS) {
      expect(s).not.toMatch(/\d/);
      for (const w of PRESSURE_WORDS) expect(s.toLowerCase()).not.toContain(w);
    }
  });
  it('is stable for the same input and changes with the date', () => {
    expect(sayingFor('p1', '2026-11-08')).toBe(sayingFor('p1', '2026-11-08'));
    const days = Array.from({ length: 30 }, (_, i) => sayingFor('p1', `2026-11-${String(i + 1).padStart(2, '0')}`));
    expect(new Set(days).size).toBeGreaterThanOrEqual(20);
  });
});

describe('dayLine', () => {
  it('uses the coach text for today and the saying for an older record', () => {
    expect(dayLine([rec(ok)], 'p1', '2026-11-08')).toEqual({ text: ok.text, fromCoach: true });
    expect(dayLine([rec(ok)], 'p1', '2026-11-09')).toEqual({ text: sayingFor('p1', '2026-11-09'), fromCoach: false });
    expect(dayLine(null, 'p1', '2026-11-08').fromCoach).toBe(false);
    expect(dayLine([rec({ nonsense: true })], 'p1', '2026-11-08').fromCoach).toBe(false);
  });
});
