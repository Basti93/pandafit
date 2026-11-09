// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { BoBubble } from '../../src/tracking/ui/kit';
import { PLACES, PLACE_POSES, placeOf, poseIn } from '../../src/tracking/ui/kit/BoScene';
import { STILL_POSES } from '../../src/tracking/ui/panda-still-url';

describe('Bo scene', () => {
  it('sets Bo into his nest, with the scene behind and the basket rim in front', () => {
    render(<BoBubble place="nest" pose="greet">Heute kommt das dritte Training.</BoBubble>);
    const scene = document.querySelector('.tk-scene[data-place="nest"]')!;
    const layers = [...scene.children];
    expect(layers[0]!.getAttribute('class')).toContain('tk-scene-back');
    expect(layers.at(-1)!.getAttribute('class')).toContain('tk-scene-front');
    expect(layers[0]!.querySelector('use')!.getAttribute('href')).toBe('/brand/bo-nest.svg#back');
    expect(scene.querySelector('.tk-panda')).toBeTruthy();
  });
  it('paints every place only through tokens that exist in both schemes', () => {
    const [dark, light] = readFileSync('src/design/tokens.css', 'utf8').split('@media (prefers-color-scheme: light)');
    for (const p of PLACES) {
      const svg = readFileSync(`src/web/public/brand/bo-${p}.svg`, 'utf8');
      expect(svg, p).toContain('<symbol id="back"'); expect(svg, p).toContain('<symbol id="front"');
      expect(svg.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? [], p).toEqual([]);
      for (const t of new Set(svg.match(/--[a-z0-9-]+/g))) {
        expect(dark, `${p} ${t}`).toContain(`${t}:`);
        if (!new RegExp(`${t}:[^;]+;\\s*/\\* shared \\*/`).test(dark!)) expect(light, `${p} ${t}`).toContain(`${t}:`);
      }
    }
  });
  it('gives each pose its own place, and every place its own pose first', () => {
    expect([placeOf('greet'), placeOf('flex'), placeOf('bike'), placeOf('run'), placeOf(null)]).toEqual(['nest', 'dojo', 'huegel', 'wald', 'nest']);
    for (const p of PLACES) expect(placeOf(PLACE_POSES[p][0]), p).toBe(p);
    // yoga has no place until Dojo 5 Task 5 adds the mat; it stays out of this check until then.
    for (const g of STILL_POSES.filter((g) => g !== 'yoga')) expect(PLACE_POSES[placeOf(g)], g).toContain(g);
    expect(poseIn('huegel', 'greet')).toBe('bike');
    expect(poseIn('nest', 'bike')).toBe('greet');
  });
  it('puts Bo where his pose belongs with place="own"', () => {
    render(<BoBubble place="own" pose="bike">Heute fährst du Rad.</BoBubble>);
    expect(document.querySelector('.tk-scene')!.getAttribute('data-place')).toBe('huegel');
    expect(document.querySelector('.tk-scene-back use')!.getAttribute('href')).toBe('/brand/bo-huegel.svg#back');
  });
  it('a mini Bo never stands in a place', () => {
    render(<BoBubble portrait="mini" place="dojo">Alles gut.</BoBubble>);
    expect(document.querySelector('.tk-scene')).toBeNull();
    expect(document.querySelector('.tk-bo img')!.getAttribute('src')).toBe('/brand/panda-still.svg');
  });
  it('draws a mini Bo as the still picture only', () => {
    render(<BoBubble portrait="mini">Alles gut.</BoBubble>);
    expect(document.querySelector('.tk-bo img')).toBeTruthy();
    expect(document.querySelector('canvas')).toBeNull();
  });
  it('lets Bo take only poses that fit his place: in the nest he sits, standing poses fall back to the greeting', () => {
    for (const p of ['greet', 'nod', 'flex', 'read', 'knit'] as const) expect(poseIn('nest', p)).toBe(p);
    for (const p of ['bike', 'run', 'yoga'] as const) expect(poseIn('nest', p)).toBe('greet');
    expect(poseIn('nest', null)).toBe('greet');
  });
  it('gives Bo his warm light everywhere: the scene glow and every portrait without a scene use the one --bo-glow token', () => {
    const css = readFileSync('src/tracking/ui/tracking.css', 'utf8');
    expect(css).toMatch(/\.tk-scene-glow \{[^}]*background: var\(--bo-glow\)/);
    expect(css).toMatch(/\.tk-bo-portrait:not\(:has\(\.tk-scene\)\), \.tk-pandahead-mini \{[^}]*background: var\(--bo-glow\)/);
    // No later rule takes the light away again (the chat once set its small portraits to none).
    expect(css).not.toMatch(/\.tk-bo-portrait \{[^}]*background: none/);
    // The scene is positioned, so it paints above the card below it: the glow must stay inside the scene.
    expect(css).toMatch(/\.tk-scene-glow \{[^}]*bottom: 0;/);
  });
});
