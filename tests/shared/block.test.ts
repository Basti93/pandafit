import { describe, it, expect } from 'vitest';
import { activeBlock, blockDates, blockId, blockRecord, blockWeek, blockWeeks, readBlock, templateFor, type BlockBody, type BlockDay } from '../../src/shared/block';
import { validBody } from '../../src/web/validate';

const day = (sport: BlockDay['sport'], hardness: BlockDay['hardness'], extra: Partial<BlockDay> = {}): BlockDay => ({ sport, hardness, ...extra });
const RHYTHM: BlockDay[] = [
  day('gym', 'hard', { template: 0 }), day('bike', 'easy'), day('gym', 'moderate', { template: 1 }), day('rest', 'easy'),
  day('bike', 'hard'), day('run', 'easy'), day('rest', 'easy'),
];
const core = (...ids: string[]): string[] => ids;
const block = (over: Partial<BlockBody> = {}): BlockBody => ({
  state: 'active', atMs: 1,
  templates: [{ name: 'Oberkörper A', core: core('pf-a', 'pf-b', 'pf-c') }, { name: 'Unterkörper B', core: core('pf-d', 'pf-e', 'pf-f', 'pf-g') }],
  rhythm: RHYTHM, start: '2026-11-30', end: '2026-12-27', ...over,
});

describe('blockDates', () => {
  it('starts on the Monday after the day and ends on the last Sunday of the next month when it is far enough away', () => {
    expect(blockDates('2026-11-29')).toEqual({ start: '2026-11-30', end: '2026-12-27' });
    expect(blockDates('2026-11-10')).toEqual({ start: '2026-11-16', end: '2026-12-27' });
  });
  it('starts today on a Monday and caps the length at six weeks', () => {
    expect(blockDates('2026-12-07')).toEqual({ start: '2026-12-07', end: '2027-01-17' });
  });
  it('counts the minimum length from the start: four full weeks keep this month end', () => {
    expect(blockDates('2026-11-02')).toEqual({ start: '2026-11-02', end: '2026-11-29' });
    expect(blockDates('2026-11-01')).toEqual({ start: '2026-11-02', end: '2026-11-29' });
  });
});

describe('blockWeek', () => {
  it('counts the weeks and marks the last one light', () => {
    const b = block();
    expect(blockWeek(b, '2026-11-30')).toEqual({ n: 1, of: 4, light: false });
    expect(blockWeek(b, '2026-12-13')).toEqual({ n: 2, of: 4, light: false });
    expect(blockWeek(b, '2026-12-21')).toEqual({ n: 4, of: 4, light: true });
    expect(blockWeek(b, '2026-12-27')).toEqual({ n: 4, of: 4, light: true });
  });
});

describe('activeBlock', () => {
  const rec = (b: BlockBody, id = 'block-x') => blockRecord(id, b, 5);
  it('finds the active block inside its dates only', () => {
    expect(activeBlock([rec(block())], '2026-12-01')?.id).toBe('block-x');
    expect(activeBlock([rec(block())], '2026-12-28')).toBeNull();
    expect(activeBlock([rec(block())], '2026-11-29')).toBeNull();
    expect(activeBlock([rec(block({ state: 'proposed' }))], '2026-12-01')).toBeNull();
  });
});

describe('readBlock', () => {
  it('reads a valid block', () => { expect(readBlock(block())).toEqual(block()); });
  it('refuses five core exercises, two core exercises and a missing template', () => {
    expect(readBlock(block({ templates: [{ name: 'A', core: core('1', '2', '3', '4', '5') }] }))).toBeNull();
    expect(readBlock(block({ templates: [{ name: 'A', core: core('1', '2') }] }))).toBeNull();
    expect(readBlock(block({ rhythm: RHYTHM.map((d, i) => (i === 0 ? { ...d, template: 5 } : d)) }))).toBeNull();
  });
  it('refuses three hard days, a short rhythm and an unknown state', () => {
    expect(readBlock(block({ rhythm: RHYTHM.map((d, i) => (i === 6 ? day('bike', 'hard') : d)) }))).toBeNull();
    expect(readBlock(block({ rhythm: RHYTHM.slice(0, 6) }))).toBeNull();
    expect(readBlock({ ...block(), state: 'x' })).toBeNull();
    expect(readBlock(null)).toBeNull();
  });
});

describe('readBlock rhythm and templates fit', () => {
  it('refuses a template index on a day that is not a gym day', () => {
    expect(readBlock(block({ rhythm: RHYTHM.map((d, i) => (i === 1 ? { ...d, template: 0 } : d)) }))).toBeNull();
  });
  it('refuses a gym day without a template', () => {
    expect(readBlock(block({ rhythm: RHYTHM.map((d, i) => (i === 2 ? day('gym', 'moderate') : d)) }))).toBeNull();
  });
  it('refuses a template that no day uses', () => {
    expect(readBlock(block({ rhythm: RHYTHM.map((d, i) => (i === 2 ? day('gym', 'moderate', { template: 0 }) : d)) }))).toBeNull();
  });
});

describe('readBlock dates and weekly turn', () => {
  it('checks the Sunday to Monday turn', () => {
    const r = RHYTHM.map((d) => ({ ...d }));
    r[6] = day('gym', 'hard', { template: 0, legs: true });
    r[0] = day('bike', 'hard');
    r[4] = day('bike', 'easy');
    expect(readBlock(block({ rhythm: r.map((d, i) => (i === 0 ? day('bike', 'easy') : d)) }))).not.toBeNull();
    expect(readBlock(block({ rhythm: r }))).toBeNull();
  });
  it('wants both dates or none, a Sunday end, dates for active and ended, and real dates', () => {
    const { start: _s, end: _e, ...bare } = block();
    expect(readBlock({ ...bare, start: '2026-11-30' })).toBeNull();
    expect(readBlock({ ...bare, end: '2026-12-27' })).toBeNull();
    expect(readBlock(block({ end: '2026-12-26' }))).toBeNull();
    expect(readBlock(bare)).toBeNull();
    expect(readBlock({ ...bare, state: 'ended' })).toBeNull();
    expect(readBlock({ ...bare, state: 'proposed' })).not.toBeNull();
    expect(readBlock(block({ start: '2026-02-30', end: '2026-12-27' }))).toBeNull();
    expect(readBlock(block({ end: '2026-02-31' }))).toBeNull();
  });
});

describe('templateFor', () => {
  it('gives the template of the rhythm day, else of the next strength day', () => {
    const b = block();
    expect(templateFor(b, '2026-12-02')?.name).toBe('Unterkörper B'); // Wednesday
    expect(templateFor(b, '2026-12-03')?.name).toBe('Oberkörper A'); // Thursday, rest: next template is Monday, wraps
    expect(templateFor(b, '2026-12-01')?.name).toBe('Unterkörper B'); // Tuesday, bike
  });
  it('is null without any template', () => {
    expect(templateFor(block({ rhythm: RHYTHM.map(({ template: _t, ...d }) => d) }), '2026-12-02')).toBeNull();
  });
});

describe('blockWeeks and ids', () => {
  it('gives one week proposal per week from the Monday', () => {
    const w = blockWeeks(block());
    expect(w.map((x) => x.weekStart)).toEqual(['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
    expect(w[0]!.days.map((d) => d.sport)).toEqual(RHYTHM.map((d) => d.sport));
    expect(w[1]!.days[0]!.date).toBe('2026-12-07');
  });
  it('names the record and validates its body', () => {
    expect(blockId('m1')).toBe('block-m1');
    expect(validBody('block', block())).toBe(true);
    expect(validBody('block', { state: 'active' })).toBe(false);
  });
});
