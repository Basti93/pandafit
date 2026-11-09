import { pandaMotion } from './panda-motion';

export type PandaGesture = 'greet' | 'listen' | 'nod' | 'breathe' | 'flex' | 'bike' | 'run' | 'yoga' | 'read' | 'knit';
export type PandaHandle = {
  play(gesture: PandaGesture): void;
  /** Glide from the rest pose into the clip's strongest pose over `ms`, then keep it until dispose. An activity (ACTIVITY_SPANS) glides into the start of its span and then keeps doing it. */
  hold(gesture: PandaGesture, ms: number): void;
  dispose(): void;
};

export type Pose = [x: number, y: number, rotation: number, scaleX: number, scaleY: number, opacity: number];
type Key = [frame: number, value: number, easing: 0 | 1 | 2];
type Track = [node: number, property: 0 | 1 | 2 | 3 | 4 | 5, keys: Key[]];
type Clip = { frames: number; fps: number; tracks: Track[] };
export type Paint = { path: string; fill?: string; stroke?: [string, number, CanvasLineCap, CanvasLineJoin] };

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

/** Activities Bo keeps doing while he holds them: the clip frames between settling in and letting go. Gestures (greet, nod …) stay still. */
export const ACTIVITY_SPANS: Partial<Record<PandaGesture, readonly [from: number, to: number]>> = { knit: [16, 139], read: [15, 139] };

/** Forth and back over [from, to]: `elapsed` frames after the start, so the loop never jumps back to its first frame. */
export function pingPong(elapsed: number, from: number, to: number): number {
  const length = to - from;
  const phase = elapsed % (2 * length);
  return phase <= length ? from + phase : to - (phase - length);
}

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

/** The poses of the nodes a clip moves at `frame`; nodes it does not move are left out and keep their rest pose. */
export function posesAt(motion: PandaMotion, clip: Clip | undefined, frame: number): Map<number, Pose> {
  const poses = new Map<number, Pose>();
  for (const [index, prop, keys] of clip?.tracks ?? []) {
    const pose: Pose = poses.get(index) ?? [...motion.nodes[index]!.pose];
    pose[prop] = valueAt(keys, frame);
    poses.set(index, pose);
  }
  return poses;
}

/** The pose `hold` glides into: the clip's strongest moment, or the start of the span for an activity. */
export function heldPoses(motion: PandaMotion, gesture: PandaGesture): Map<number, Pose> {
  const clip = motion.clips[gesture];
  const span = ACTIVITY_SPANS[gesture];
  return posesAt(motion, clip, span ? span[0] : holdFrame(clip, motion.nodes));
}

export type NodeVisit = {
  enter(x: number, y: number, rotation: number, sx: number, sy: number): void;
  /** `alpha` is the product of the opacities down to this node. */
  shape(paint: Paint, alpha: number): void;
  leave(): void;
};

/** Visit the node tree in drawing order. A node with opacity 0 or less is skipped with its children. One walk for the canvas and the stills. */
export function walkNodes(motion: PandaMotion, poses: Map<number, Pose>, visit: NodeVisit): void {
  function walk(index: number, parentAlpha: number): void {
    const node = motion.nodes[index]!;
    const [x, y, rotation, sx, sy, opacity] = poses.get(index) ?? node.pose;
    if (opacity <= 0) return;
    const alpha = parentAlpha * opacity;
    visit.enter(x, y, rotation, sx, sy);
    if (node.paint) visit.shape(node.paint, alpha);
    for (const child of node.children ?? []) walk(child, alpha);
    visit.leave();
  }
  for (const root of motion.roots) walk(root, 1);
}

/** Draw the rest pose immediately, then ask the browser for frames only while a gesture plays. */
export async function mountPanda(canvas: HTMLCanvasElement): Promise<PandaHandle> {
  if (typeof Path2D === 'undefined') throw new Error('Panda needs vector paths');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panda needs a 2D canvas');
  const ctx = context;
  const { width, height, nodes, clips } = pandaMotion;
  const paths = new Map<Paint, Path2D>(nodes.flatMap(({ paint }) => (paint ? [[paint, new Path2D(paint.path)] as const] : [])));
  let pending: number | null = null;
  let disposed = false;

  function draw(clip?: Clip, frame = 0): void {
    paint(posesAt(pandaMotion, clip, frame));
  }

  function paint(poses: Map<number, Pose>): void {

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fit = Math.min(canvas.width / width, canvas.height / height);
    ctx.setTransform(fit, 0, 0, fit, (canvas.width - width * fit) / 2, (canvas.height - height * fit) / 2);

    walkNodes(pandaMotion, poses, {
      enter(x, y, rotation, sx, sy) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.scale(sx, sy);
      },
      shape(paint, alpha) {
        const path = paths.get(paint);
        if (!path) return;
        const { fill, stroke } = paint;
        ctx.globalAlpha = alpha;
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill(path);
        }
        if (stroke) {
          [ctx.strokeStyle, ctx.lineWidth, ctx.lineCap, ctx.lineJoin] = stroke;
          ctx.stroke(path);
        }
      },
      leave: () => ctx.restore(),
    });
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
      const clip = clips[gesture];
      const span = ACTIVITY_SPANS[gesture];
      const target = heldPoses(pandaMotion, gesture);
      let start: number | undefined;
      function advance(now: number): void {
        start ??= now;
        const done = now - start >= ms;
        const k = done ? 1 : ease((now - start) / ms);
        const poses = new Map<number, Pose>();
        for (const [index, to] of target) {
          const from = nodes[index]!.pose;
          poses.set(index, from.map((v, i) => v + (to[i]! - v) * k) as Pose);
        }
        paint(poses);
        if (!done) pending = requestAnimationFrame(advance);
        else if (span) pending = requestAnimationFrame((now) => keepDoing(span, now));
        else pending = null;
      }
      function keepDoing([from, to]: readonly [number, number], begin: number): void {
        function step(now: number): void {
          draw(clip, pingPong((now - begin) * clip.fps / 1000, from, to));
          pending = requestAnimationFrame(step);
        }
        step(begin);
      }
      pending = requestAnimationFrame(advance);
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
