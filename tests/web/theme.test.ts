// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { themeChoice } from '../../src/web/theme-css';
import { applyTheme, readTheme, saveTheme, THEME_KEY } from '../../src/web/theme';

const run = async (css: string) => (await postcss([themeChoice()]).process(css, { from: undefined })).css.replace(/\s+/g, ' ');

describe('theme choice in CSS', () => {
  it('keeps light rules for the system, skips them on a forced dark page and copies them for a forced light page', async () => {
    const out = await run('@media (prefers-color-scheme: light) { :root { --bg: #fff; } .a, .b { color: red; } }');
    expect(out).toContain('@media (prefers-color-scheme: light) { :root:where(:not([data-theme="dark"])) { --bg: #fff; }');
    expect(out).toContain(':where(:root:not([data-theme="dark"])) .a, :where(:root:not([data-theme="dark"])) .b { color: red; }');
    expect(out).toContain(':root:where([data-theme="light"]) { --bg: #fff; }');
    expect(out).toContain(':where(:root[data-theme="light"]) .a, :where(:root[data-theme="light"]) .b { color: red; }');
  });

  it('leaves other media queries alone and refuses a combined colour-scheme query', async () => {
    expect(await run('@media (max-width: 400px) { .a { color: red; } }')).toBe('@media (max-width: 400px) { .a { color: red; } }');
    await expect(run('@media (prefers-color-scheme: light) and (max-width: 400px) { .a { color: red; } }')).rejects.toThrow();
  });
});

describe('theme choice on the device', () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

  it('defaults to the system and remembers light or dark', () => {
    const s = store();
    expect(readTheme(s)).toBe('system');
    saveTheme(s, 'dark');
    expect(s.m.get(THEME_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readTheme(s)).toBe('dark');
    saveTheme(s, 'system');
    expect(s.m.has(THEME_KEY)).toBe(false);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('falls back to the system for an unknown value or a blocked storage', () => {
    expect(readTheme({ getItem: () => 'blau' })).toBe('system');
    expect(readTheme({ getItem: () => { throw new Error('blocked'); } })).toBe('system');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyTheme('system');
  });
});
