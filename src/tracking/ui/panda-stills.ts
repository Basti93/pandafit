import { heldPoses, walkNodes } from './panda-canvas';
import { pandaMotion } from './panda-motion';
import type { PandaGesture } from './panda-canvas';

const num = (value: number): string => {
  const text = (Math.round(value * 1000) / 1000).toString();
  return text === '-0' ? '0' : text;
};

/** Bo's still picture of the pose he holds, drawn from the motion data by the same node walk as the canvas. The opacity sits on each shape, like the canvas globalAlpha. */
export function stillSvg(gesture: PandaGesture): string {
  const { width, height } = pandaMotion;
  const lines = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}">`];
  walkNodes(pandaMotion, heldPoses(pandaMotion, gesture), {
    enter: (x, y, rotation, sx, sy) => lines.push(`<g transform="translate(${num(x)} ${num(y)}) rotate(${num(rotation * 180 / Math.PI)}) scale(${num(sx)} ${num(sy)})">`),
    shape({ path, fill, stroke }, alpha) {
      if (num(alpha) === '0') return; // invisible once rounded
      const attributes = [`d="${path}"`, `fill="${fill ?? 'none'}"`];
      if (stroke) attributes.push(`stroke="${stroke[0]}"`, `stroke-width="${num(stroke[1])}"`, `stroke-linecap="${stroke[2]}"`, `stroke-linejoin="${stroke[3]}"`);
      if (alpha !== 1) attributes.push(`opacity="${num(alpha)}"`);
      lines.push(`<path ${attributes.join(' ')}/>`);
    },
    leave: () => lines.push('</g>'),
  });
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}
