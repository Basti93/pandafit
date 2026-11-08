import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
const WEB = 'src/web/web.css';
const TRACKING = 'src/tracking/ui/tracking.css';
const TOKENS = 'src/web/tokens.css';

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// Custom properties that a component or a rule sets for its own children (not design tokens).
const LOCAL = new Set(['--slot', '--rc-hue']);

describe('style tokens', () => {
  it('has no literal colour in web.css or tracking.css', () => {
    for (const f of [WEB, TRACKING]) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? [], f).toEqual([]);
    }
  });

  it('defines every var(--name) it reads', () => {
    const tokens = read(TOKENS);
    const tk = [...read(TRACKING).matchAll(/(--tk-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const defined = new Set([...[...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]), ...tk, ...LOCAL]);
    const used = new Set<string>();
    const sources = [read(WEB), read(TRACKING), ...tsxFiles('src/web').map(read), ...tsxFiles('src/tracking').map(read)];
    for (const s of sources) for (const m of s.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) used.add(m[1]);
    expect([...used].filter((n) => !defined.has(n))).toEqual([]);
  });

  it('gives every colour token on :root a light value, or marks it shared', () => {
    const css = read(TOKENS).replace(/\/\*(?!\s*shared)[\s\S]*?\*\//g, '');
    const lightAt = css.indexOf('prefers-color-scheme: light');
    expect(lightAt).toBeGreaterThan(0);
    const light = css.slice(lightAt);
    const missing: string[] = [];
    for (const line of css.slice(0, lightAt).split('\n')) {
      for (const m of line.matchAll(/(--[a-z0-9-]+)\s*:\s*(#|rgba?\(|hsl)[^;]*;/g)) {
        const defined = new RegExp(`${m[1]}\\s*:`).test(light);
        if (!defined && !/\/\*\s*shared\s*\*\//.test(line)) missing.push(m[1]);
      }
    }
    expect(missing).toEqual([]);
  });
});
