import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { bambooDrift, BAMBOO_DRIFT, startBambooParallax } from '../../src/web/parallax';

it('lets the bamboo drift back by a share of the scroll, never above the page top', () => {
  expect(bambooDrift(0, false)).toBe('0px');
  expect(bambooDrift(1000, false)).toBe(`${Math.round(1000 * BAMBOO_DRIFT)}px`);
  expect(bambooDrift(-80, false)).toBe('0px'); // iOS rubber band at the top
});
it('keeps the bamboo still against the page for people who want less motion', () => {
  expect(bambooDrift(1000, true)).toBe('0px');
});
it('writes the offset to <html> on scroll, once per frame, and stops cleanly', () => {
  const listeners: Record<string, () => void> = {};
  const frames: (() => void)[] = [];
  const style = new Map<string, string>();
  const win = {
    scrollY: 0,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    document: { documentElement: { style: { setProperty: (k: string, v: string) => style.set(k, v) } } },
    addEventListener: (t: string, f: () => void) => { listeners[t] = f; },
    removeEventListener: (t: string) => { delete listeners[t]; },
    requestAnimationFrame: (f: () => void) => frames.push(f),
    cancelAnimationFrame() {},
  } as unknown as Window & { scrollY: number };
  const stop = startBambooParallax(win);
  expect(style.get('--bamboo-drift')).toBe('0px');
  (win as { scrollY: number }).scrollY = 400;
  listeners.scroll!(); listeners.scroll!();
  expect(frames).toHaveLength(1);
  frames[0]!();
  expect(style.get('--bamboo-drift')).toBe(`${Math.round(400 * BAMBOO_DRIFT)}px`);
  stop();
  expect(listeners.scroll).toBeUndefined();
});
it('moves only the grove: the tile uses the drift, the shoot stays at the page end', () => {
  const rule = readFileSync('src/web/web.css', 'utf8').match(/\.web-main\s*\{[^}]*bamboo[^}]*\}/)![0];
  expect(rule).toMatch(/var\(--bamboo-tile\)[^;]*var\(--bamboo-drift, 0px\)/);
  expect(readFileSync('src/web/main.tsx', 'utf8')).toContain('startBambooParallax()');
});
