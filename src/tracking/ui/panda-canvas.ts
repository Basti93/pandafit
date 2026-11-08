import { pandaMotion } from './panda-motion';

export type PandaGesture = 'greet' | 'listen' | 'nod' | 'breathe' | 'flex' | 'bike' | 'run' | 'yoga' | 'read' | 'knit';
export type PandaHandle = {
  play(gesture: PandaGesture): void;
  /** Glide from the rest pose into the clip's strongest pose over `ms`, then keep it until dispose. */
  hold(gesture: PandaGesture, ms: number): void;
  dispose(): void;
};

type Pose = [x: number, y: number, rotation: number, scaleX: number, scaleY: number, opacity: number];
type Key = [frame: number, value: number, easing: 0 | 1 | 2];
type Track = [node: number, property: 0 | 1 | 2 | 3 | 4 | 5, keys: Key[]];
type Clip = { frames: number; fps: number; tracks: Track[] };
type Paint = { path: string; fill?: string; stroke?: [string, number, CanvasLineCap, CanvasLineJoin] };

export type PandaMotion = {
  width: number;
  height: number;
  roots: number[];
  nodes: { pose: Pose; paint?: Paint; children?: number[] }[];
  clips: Record<PandaGesture, Clip>;
};

// CSS ease-in-out: invert the x coordinate of cubic-bezier(.42, 0, .58, 1).
function ease(progress: number): number {
  let left = 0;
  let right = 1;
  for (let i = 0; i < 12; i++) {
    const t = (left + right) / 2;
    const x = 3 * (1 - t) * t * (.42 * (1 - t) + .58 * t) + t ** 3;
    if (x < progress) left = t;
    else right = t;
  }
  const t = (left + right) / 2;
  return t * t * (3 - 2 * t);
}

function valueAt(keys: Key[], frame: number): number {
  const next = keys.findIndex(([at]) => at > frame);
  if (next === -1) return keys.at(-1)![1];
  if (next === 0) return keys[0]![1];
  const [at, value, easing] = keys[next - 1]!;
  if (easing === 0) return value;
  const [end, target] = keys[next]!;
  const progress = (frame - at) / (end - at);
  return value + (target - value) * (easing === 1 ? progress : ease(progress));
}

// How far a pose is from rest: positions in px, rotation, scale and opacity weighted so that each counts.
const WEIGHT = [1, 40, 60, 60, 30];

/** The frame where the clip is furthest from the rest pose: the pose Panda keeps. */
export function holdFrame(clip: Clip, nodes: PandaMotion['nodes']): number {
  let best = 0;
  let bestScore = -1;
  for (let frame = 0; frame <= clip.frames; frame++) {
    let score = 0;
    for (const [index, prop, keys] of clip.tracks) score += Math.abs(valueAt(keys, frame) - nodes[index]!.pose[prop]) * (prop === 0 ? 1 : WEIGHT[prop - 1]!);
    if (score > bestScore) { bestScore = score; best = frame; }
  }
  return best;
}

/** Draw the rest pose immediately, then ask the browser for frames only while a gesture plays. */
export async function mountPanda(canvas: HTMLCanvasElement): Promise<PandaHandle> {
  if (typeof Path2D === 'undefined') throw new Error('Panda needs vector paths');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panda needs a 2D canvas');
  const ctx = context;
  const { width, height, roots, nodes, clips } = pandaMotion;
  const paths = nodes.map(({ paint }) => paint && new Path2D(paint.path));
  let pending: number | null = null;
  let disposed = false;

  function posesAt(clip: Clip | undefined, frame: number): Map<number, Pose> {
    const poses = new Map<number, Pose>();
    for (const [index, prop, keys] of clip?.tracks ?? []) {
      const pose: Pose = poses.get(index) ?? [...nodes[index]!.pose];
      pose[prop] = valueAt(keys, frame);
      poses.set(index, pose);
    }
    return poses;
  }

  function draw(clip?: Clip, frame = 0): void {
    paint(posesAt(clip, frame));
  }

  function paint(poses: Map<number, Pose>): void {

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fit = Math.min(canvas.width / width, canvas.height / height);
    ctx.setTransform(fit, 0, 0, fit, (canvas.width - width * fit) / 2, (canvas.height - height * fit) / 2);

    function drawNode(index: number): void {
      const node = nodes[index]!;
      const [x, y, rotation, sx, sy, opacity] = poses.get(index) ?? node.pose;
      if (opacity <= 0) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.scale(sx, sy);
      ctx.globalAlpha *= opacity;
      const path = paths[index];
      if (node.paint && path) {
        const { fill, stroke } = node.paint;
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill(path);
        }
        if (stroke) {
          [ctx.strokeStyle, ctx.lineWidth, ctx.lineCap, ctx.lineJoin] = stroke;
          ctx.stroke(path);
        }
      }
      for (const child of node.children ?? []) drawNode(child);
      ctx.restore();
    }

    for (const root of roots) drawNode(root);
  }

  function cancel(): void {
    if (pending !== null) cancelAnimationFrame(pending);
    pending = null;
  }

  draw();
  return {
    play(gesture) {
      if (disposed) return;
      cancel();
      const clip = clips[gesture];
      let start: number | undefined;
      function advance(now: number): void {
        start ??= now;
        const frame = (now - start) * clip.fps / 1000;
        if (frame >= clip.frames) {
          pending = null;
          draw();
          return;
        }
        draw(clip, frame);
        pending = requestAnimationFrame(advance);
      }
      pending = requestAnimationFrame(advance);
    },
    hold(gesture, ms) {
      if (disposed) return;
      cancel();
      const target = posesAt(clips[gesture], holdFrame(clips[gesture], nodes));
      let start: number | undefined;
      function advance(now: number): void {
        start ??= now;
        const k = ease(Math.min(1, (now - start) / ms));
        const poses = new Map<number, Pose>();
        for (const [index, to] of target) {
          const from = nodes[index]!.pose;
          poses.set(index, from.map((v, i) => v + (to[i]! - v) * k) as Pose);
        }
        paint(poses);
        pending = k < 1 ? requestAnimationFrame(advance) : null;
      }
      pending = requestAnimationFrame(advance);
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
