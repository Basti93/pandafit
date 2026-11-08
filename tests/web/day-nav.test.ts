// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { dayTitle, shiftDay, swipeIgnored, swipeStep } from '../../src/web/today/day-nav';

describe('day navigation', () => {
  it('swipeStep needs more than 50 px and a mostly sideways move', () => {
    expect(swipeStep(49, 0)).toBe(0);
    expect(swipeStep(-49, 0)).toBe(0);
    expect(swipeStep(-60, 10)).toBe(1);
    expect(swipeStep(60, 10)).toBe(-1);
    expect(swipeStep(60, 40)).toBe(0);
  });
  it('shiftDay stays between Gestern and Morgen', () => {
    expect(shiftDay(0, 1)).toBe(1);
    expect(shiftDay(1, 1)).toBe(1);
    expect(shiftDay(-1, -1)).toBe(-1);
    expect(shiftDay(1, -1)).toBe(0);
    expect(shiftDay(0, 0)).toBe(0);
  });
  it('dayTitle gives the name and the small date', () => {
    const now = new Date(2026, 10, 8, 12).getTime(); // Sunday
    expect(dayTitle(0, now)).toEqual({ name: 'Heute', date: 'So, 8. November' });
    expect(dayTitle(-1, now)).toEqual({ name: 'Gestern', date: 'Sa, 7. November' });
    expect(dayTitle(1, now)).toEqual({ name: 'Morgen', date: 'Mo, 9. November' });
  });
  it('swipeIgnored in a dialog, a field and a sideways scroller, not on plain content', () => {
    document.body.innerHTML = '<div role="dialog"><p id="a">x</p></div><input id="b"><div class="tk-hscroll"><span id="c">y</span></div><div style="overflow-x:auto"><span id="d">z</span></div><p id="e">plain</p><div style="overflow-x:auto"><span id="f">w</span></div>';
    const el = (id: string) => document.getElementById(id);
    Object.defineProperty(el('d')!.parentElement!, 'scrollWidth', { value: 500 }); // jsdom has no layout
    expect(swipeIgnored(el('f'))).toBe(false); // overflow auto, but it fits
    expect(swipeIgnored(el('a'))).toBe(true);
    expect(swipeIgnored(el('b'))).toBe(true);
    expect(swipeIgnored(el('c'))).toBe(true);
    expect(swipeIgnored(el('d'))).toBe(true);
    expect(swipeIgnored(el('e'))).toBe(false);
    expect(swipeIgnored(null)).toBe(false);
  });
});
