// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { BoBubble } from '../../src/tracking/ui/kit';
import { poseIn } from '../../src/tracking/ui/kit/BoScene';

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
  it('paints the nest only through tokens that exist in both schemes', () => {
    const svg = readFileSync('src/web/public/brand/bo-nest.svg', 'utf8');
    expect(svg).toContain('<symbol id="back"');
    expect(svg).toContain('<symbol id="front"');
    expect(svg.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g) ?? []).toEqual([]);
    const [dark, light] = readFileSync('src/design/tokens.css', 'utf8').split('@media (prefers-color-scheme: light)');
    for (const t of new Set(svg.match(/--scene-[a-z-]+/g))) {
      expect(dark, t).toContain(`${t}:`);
      if (!new RegExp(`${t}:[^;]+;\\s*/\\* shared \\*/`).test(dark!)) expect(light, t).toContain(`${t}:`);
    }
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
  });
});
