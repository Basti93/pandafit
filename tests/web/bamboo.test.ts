import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';

it('ships seamless bamboo tiles for both schemes', () => {
  for (const s of ['dark', 'light']) {
    expect(readFileSync(`src/web/public/brand/bamboo-tile-${s}.svg`, 'utf8')).toMatch(/viewBox="0 0 390 900"/);
    expect(readFileSync(`src/web/public/brand/bamboo-shoot-${s}.svg`, 'utf8')).toContain('<svg');
  }
  const [dark, light] = readFileSync('src/design/tokens.css', 'utf8').split('@media (prefers-color-scheme: light)');
  expect(dark).toContain("--bamboo-tile: url('/brand/bamboo-tile-dark.svg')");
  expect(light).toContain("--bamboo-tile: url('/brand/bamboo-tile-light.svg')");
});
it('paints the grove as one layer behind the cards and the shoot at the page end', () => {
  const css = readFileSync('src/web/web.css', 'utf8');
  expect(css.match(/\.web-main\s*\{[^}]*\}/g)!.join(' ')).toMatch(/background:[^;]*var\(--bamboo-shoot\)[^;]*no-repeat/);
  const layer = css.match(/\.web-main::before\s*\{[^}]*\}/)![0];
  expect(layer).toMatch(/background:[^;]*var\(--bamboo-tile\)[^;]*repeat-y/);
  expect(layer).toMatch(/z-index: -1/);
  expect(layer).toMatch(/pointer-events: none/);
});
it('lets the grove lag behind with a scroll-driven animation, only with support and without reduced motion', () => {
  const css = readFileSync('src/web/web.css', 'utf8');
  expect(css).toMatch(/@keyframes bamboo-parallax\s*\{[^}]*translateY\(calc\(.*var\(--bamboo-parallax\)/);
  expect(css).toMatch(/@supports \(animation-timeline: scroll\(\)\)\s*\{\s*@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.web-main::before\s*\{[^}]*animation-timeline: scroll\(root block\)/);
  expect(readFileSync('src/design/tokens.css', 'utf8')).toMatch(/--bamboo-parallax: \.35;/);
});
it('mixes the bamboo colours opaque, so front stems cover the back ones and leaves match their stem', () => {
  for (const f of ['tile', 'shoot']) for (const s of ['dark', 'light'])
    expect(readFileSync(`src/web/public/brand/bamboo-${f}-${s}.svg`, 'utf8')).not.toMatch(/opacity/);
});
it('draws every shape of the bamboo art as an element, so the leaves render', () => {
  for (const f of ['tile', 'shoot']) for (const s of ['dark', 'light']) {
    const svg = readFileSync(`src/web/public/brand/bamboo-${f}-${s}.svg`, 'utf8');
    // Path data loose between tags is text, not a shape; the browser skips it silently.
    expect(svg).not.toMatch(/>\s*M[\d.]/);
  }
});
