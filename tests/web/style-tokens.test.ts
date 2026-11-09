import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
const WEB = 'src/web/web.css';
const TRACKING = 'src/tracking/ui/tracking.css';
const MAC = 'src/ui/style.css';
const TOKENS = 'src/design/tokens.css';

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
  it('has no literal colour in the Mac, web or tracking stylesheets', () => {
    for (const f of [MAC, WEB, TRACKING]) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? [], f).toEqual([]);
    }
  });

  it('sizes text only with the type scale (display sizes from 2.5rem, viewport units and em are exempt)', () => {
    const scale = [...read(TOKENS).matchAll(/--text-[a-z0-9]+\s*:/g)];
    expect(scale.length).toBeGreaterThanOrEqual(6);
    expect(scale.length).toBeLessThanOrEqual(7);
    const bad: string[] = [];
    const web = readdirSync('src/web').filter((n) => n.endsWith('.css')).map((n) => join('src/web', n));
    for (const f of [MAC, TRACKING, ...web]) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
        const v = m[1].trim();
        if (/^var\(--text-/.test(v) || v === 'inherit' || /^(min|max|clamp)\(/.test(v) || /em$/.test(v) && !/rem$/.test(v)) continue;
        const rem = /^([\d.]+)rem$/.exec(v);
        if (rem && Number(rem[1]) >= 2.5) continue;
        bad.push(`${f}: ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps no own --tk-* alias of a real token and no --high or --fs-* name', () => {
    const css = [MAC, WEB, TRACKING, TOKENS].map(read).join('\n');
    expect(css.match(/--tk-(bg|text|ink|field|card|line|muted|accent|good|warm)\s*:/g) ?? []).toEqual([]);
    expect(css.match(/--high\b|--fs-/g) ?? []).toEqual([]);
  });

  it('keeps the Mac brand files equal to the web ones', () => {
    for (const f of ['shojumaru.ttf', 'panda-still.svg']) {
      expect(readFileSync(`src/ui/public/brand/${f}`).equals(readFileSync(`src/web/public/brand/${f}`)), f).toBe(true);
    }
  });

  it('defines every var(--name) it reads', () => {
    const tokens = read(TOKENS);
    const tk = [...read(TRACKING).matchAll(/(--tk-[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const defined = new Set([...[...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]), ...tk, ...LOCAL]);
    const used = new Set<string>();
    const sources = [read(MAC), read(WEB), read(TRACKING), ...tsxFiles('src/web').map(read), ...tsxFiles('src/tracking').map(read)];
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

describe('dojo fundament', () => {
  it('hosts Zen Kaku Gothic New itself and uses it for all web text', () => {
    const tokens = read(TOKENS);
    for (const w of [400, 500, 700]) {
      expect(tokens).toContain(`url('/brand/zen-kaku-gothic-new-${w}.woff2')`);
      // The latin subset is about 9.6 kB, so the floor only guards against an empty or error file.
      expect(statSync(`src/web/public/brand/zen-kaku-gothic-new-${w}.woff2`).size).toBeGreaterThan(5_000);
    }
    expect(tokens).toMatch(/--font-text:\s*'Zen Kaku Gothic New'/);
    expect(read(WEB)).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-text\)/);
    expect(read(TRACKING)).toMatch(/\.tk-screen\s*\{[^}]*font-family:\s*var\(--font-text\)/);
  });
  it('defines the Dojo tokens in both schemes, light only under the media query', () => {
    const css = read(TOKENS);
    const [dark, light] = css.split('@media (prefers-color-scheme: light)');
    for (const t of ['--bg-top', '--card-soft', '--kicker', '--brush', '--glow', '--bamboo-tile', '--bamboo-shoot']) {
      expect(dark).toContain(`${t}:`);
      expect(light).toContain(`${t}:`);
    }
    expect(css).not.toMatch(/\[data-theme="(light|dark)"\]\s*\{[^}]*--/);
  });
  it('keeps the page background in one token with a fixed-height glow', () => {
    expect(read(TOKENS)).toMatch(/--page-bg:\s*radial-gradient\([^;]*600px[^;]*\)[^;]*var\(--bg\)/);
    expect(read(WEB)).toMatch(/html\s*\{[^}]*background:\s*var\(--page-bg\)/);
  });
  it('uses one content width token instead of 640px literals', () => {
    for (const f of [WEB, TRACKING]) expect(read(f).replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('640px');
  });
});

describe('main button role', () => {
  it('gives the glow and 50 px height only to the filled role', () => {
    const css = readFileSync(join(__dirname, '../../src/tracking/ui/tracking.css'), 'utf8');
    const glow = css.split('\n').filter((l) => l.includes('box-shadow: 0 6px 20px var(--glow)'));
    expect(glow).toHaveLength(1);
    const selectors = glow[0].slice(0, glow[0].indexOf('{')).split(',').map((x) => x.trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel).toMatch(/^\.tk-(screen|picker) button\.primary$/);
    expect(css).not.toMatch(/\.tk-screen button, \.tk-picker button \{[^}]*(glow|min-height: 50px)/);
  });
});
