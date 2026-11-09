import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { walkNodes, type PandaMotion, type Pose } from '../../src/tracking/ui/panda-canvas';
import { pandaMotion } from '../../src/tracking/ui/panda-motion';
import { stillSvg } from '../../src/tracking/ui/panda-stills';
import { STILL_POSES } from '../../src/tracking/ui/panda-still-url';

it('has one still per gesture, equal to what the motion data draws', () => {
  expect([...STILL_POSES].sort()).toEqual(Object.keys(pandaMotion.clips).sort());
  for (const g of STILL_POSES) expect(readFileSync(`src/web/public/brand/bo-pose-${g}.svg`, 'utf8'), `${g}: run npm run panda:stills`).toBe(stillSvg(g));
});
it('puts the opacity on each shape, never on a group', () => {
  for (const g of STILL_POSES) expect(stillSvg(g)).not.toMatch(/<g[^>]*opacity/);
});
it('draws each still in the canvas frame, and every gesture differently', () => {
  const all = STILL_POSES.map(stillSvg);
  for (const s of all) expect(s).toContain('viewBox="0 0 198 164"');
  expect(new Set(all).size).toBe(STILL_POSES.length);
});

it('gives a nested shape the product of the opacities of its ancestors', () => {
  const motion = {
    width: 10, height: 10, roots: [0],
    nodes: [
      { pose: [0, 0, 0, 1, 1, 0.5] as Pose, children: [1] },
      { pose: [0, 0, 0, 1, 1, 0.5] as Pose, children: [2] },
      { pose: [0, 0, 0, 1, 1, 0.8] as Pose, paint: { path: 'M0 0', fill: '#000' } },
    ],
    clips: {},
  } as unknown as PandaMotion;
  const alphas: number[] = [];
  walkNodes(motion, new Map(), { enter() {}, leave() {}, shape: (_paint, alpha) => alphas.push(alpha) });
  expect(alphas).toHaveLength(1);
  expect(alphas[0]).toBeCloseTo(0.2);
});
