import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('has the three meal pictures and paints theme colours only through meal tokens of both schemes', () => {
  const svg = readFileSync('src/web/public/brand/meals.svg', 'utf8');
  for (const s of ['fruehstueck', 'mittag', 'abend']) expect(svg).toContain(`<symbol id="${s}"`);
  const vars = [...new Set(svg.match(/var\((--[a-z-]+)\)/g)?.map((v) => v.slice(4, -1)))];
  expect(vars.sort()).toEqual(['--meal-shadow', '--meal-steam']);
  const [dark, light] = readFileSync('src/design/tokens.css', 'utf8').split('@media (prefers-color-scheme: light)');
  for (const t of vars) { expect(dark, t).toContain(`${t}:`); expect(light, t).toContain(`${t}:`); }
});
