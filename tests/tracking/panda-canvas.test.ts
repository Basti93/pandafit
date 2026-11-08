import { afterEach, expect, test, vi } from 'vitest';
import { mountPanda, type PandaGesture } from '../../src/tracking/ui/panda-canvas';

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
