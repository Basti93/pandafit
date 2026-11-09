import { afterEach, expect, test, vi } from 'vitest';
import { heldPoses, mountPanda, type PandaGesture } from '../../src/tracking/ui/panda-canvas';
import { pandaMotion } from '../../src/tracking/ui/panda-motion';
import { STILL_POSES } from '../../src/tracking/ui/panda-still-url';

function canvasFrames() {
  const painted: unknown[][][] = [];
  const scheduled = new Map<number, FrameRequestCallback>();
  let next = 0;
  const stack: { alpha: number; transforms: number[][] }[] = [];
  let transforms: number[][] = [];
  const paint = (kind: string, path: { data: string }) => {
    painted.at(-1)!.push([kind, path.data, context.globalAlpha, transforms]);
  };
  const context = {
    globalAlpha: 1,
    save() { stack.push({ alpha: this.globalAlpha, transforms }); },
    restore() {
      const state = stack.pop()!;
      this.globalAlpha = state.alpha;
      transforms = state.transforms;
    },
    setTransform: (...values: number[]) => { transforms = [values]; },
    translate: (...values: number[]) => { transforms = [...transforms, values]; },
    rotate: (...values: number[]) => { transforms = [...transforms, values]; },
    scale: (...values: number[]) => { transforms = [...transforms, values]; },
    clearRect: () => { painted.push([]); },
    fill: (path: { data: string }) => paint('fill', path),
    stroke: (path: { data: string }) => paint('stroke', path),
  };
  vi.stubGlobal('Path2D', class { constructor(readonly data: string) {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { scheduled.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => scheduled.delete(id));
  const canvas = { width: 396, height: 328, getContext: () => context } as unknown as HTMLCanvasElement;
  return {
    canvas,
    frame(at: number) {
      const queue = [...scheduled.values()];
      scheduled.clear();
      for (const callback of queue) callback(at);
    },
    snapshot: () => painted.at(-1),
    scheduled: () => scheduled.size,
  };
}

afterEach(() => vi.unstubAllGlobals());

test('all ten gestures draw a different pose and return to a still frame', async () => {
  const frames = canvasFrames();
  const panda = await mountPanda(frames.canvas);
  const rest = frames.snapshot();
  expect(rest?.length).toBeGreaterThan(10);
  expect(frames.scheduled()).toBe(0);

  const gestures: PandaGesture[] = ['greet', 'listen', 'nod', 'breathe', 'flex', 'bike', 'run', 'yoga', 'read', 'knit'];
  for (const [index, gesture] of gestures.entries()) {
    const start = index * 5000;
    panda.play(gesture);
    frames.frame(start);
    frames.frame(start + 450);
    expect(frames.snapshot(), gesture).not.toEqual(rest);
    frames.frame(start + 4000);
    expect(frames.snapshot(), gesture).toEqual(rest);
    expect(frames.scheduled()).toBe(0);
  }
  panda.dispose();
});

test('a second gesture replaces the first and dispose stops the pending frame', async () => {
  const frames = canvasFrames();
  const panda = await mountPanda(frames.canvas);
  panda.play('greet');
  panda.play('nod');
  expect(frames.scheduled()).toBe(1);
  frames.frame(0);
  panda.dispose();
  const last = frames.snapshot();
  expect(frames.scheduled()).toBe(0);
  panda.play('greet');
  frames.frame(500);
  expect(frames.snapshot()).toBe(last);
});

test('an unavailable 2D context leaves the caller free to show its still', async () => {
  canvasFrames();
  const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
  await expect(mountPanda(canvas)).rejects.toThrow();
});

test('every clip has a held pose inside the clip, away from the rest pose at its start', async () => {
  const { holdFrame } = await import('../../src/tracking/ui/panda-canvas');
  const { pandaMotion } = await import('../../src/tracking/ui/panda-motion');
  for (const [name, clip] of Object.entries(pandaMotion.clips)) {
    const f = holdFrame(clip as never, pandaMotion.nodes);
    expect(f, name).toBeGreaterThan(0);
    expect(f, name).toBeLessThan(clip.frames);
  }
});

test('a held activity (knitting, reading) keeps moving after the glide; a held gesture stays still', async () => {
  const frames = canvasFrames();
  const panda = await mountPanda(frames.canvas);
  panda.hold('greet', 1000);
  frames.frame(0);
  frames.frame(1000);
  expect(frames.scheduled()).toBe(0);

  for (const activity of ['knit', 'read'] as const) {
    panda.hold(activity, 1000);
    frames.frame(10_000);
    frames.frame(11_000);
    const seen = new Set<string>();
    for (let t = 11_000; t <= 16_000; t += 250) {
      frames.frame(t);
      seen.add(JSON.stringify(frames.snapshot()));
    }
    expect(frames.scheduled(), activity).toBe(1);
    expect(seen.size, activity).toBeGreaterThan(5);
  }
  panda.dispose();
  expect(frames.scheduled()).toBe(0);
});

test('an activity loop runs forth and back over its span, so it never jumps', async () => {
  const { ACTIVITY_SPANS, pingPong } = await import('../../src/tracking/ui/panda-canvas');
  const { pandaMotion } = await import('../../src/tracking/ui/panda-motion');
  for (const [name, [from, to]] of Object.entries(ACTIVITY_SPANS)) {
    const clip = pandaMotion.clips[name as PandaGesture];
    expect(from, name).toBeGreaterThan(0);
    expect(to, name).toBeLessThan(clip.frames);
  }
  expect(pingPong(0, 10, 20)).toBe(10);
  expect(pingPong(5, 10, 20)).toBe(15);
  expect(pingPong(10, 10, 20)).toBe(20);
  expect(pingPong(15, 10, 20)).toBe(15);
  expect(pingPong(20, 10, 20)).toBe(10);
});

test('every gesture has its own held pose', () => {
  const held = STILL_POSES.map((g) => JSON.stringify([...heldPoses(pandaMotion, g)]));
  for (const h of held) expect(h).not.toBe('[]');
  expect(new Set(held).size).toBe(STILL_POSES.length);
});
