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
it('paints the bamboo as backgrounds of .web-main, scrolling with the content, without new layers', () => {
  const rule = readFileSync('src/web/web.css', 'utf8').match(/\.web-main\s*\{[^}]*\}/g)!.join(' ');
  expect(rule).toMatch(/background:[^;]*var\(--bamboo-shoot\)[^;]*no-repeat[^;]*var\(--bamboo-tile\)[^;]*repeat-y/);
  expect(rule).not.toMatch(/z-index|isolation/);
  expect(readFileSync('src/web/web.css', 'utf8')).not.toMatch(/\.web-main::(before|after)/);
});
