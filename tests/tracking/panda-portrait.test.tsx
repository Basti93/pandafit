// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { PandaPortrait, type PandaEvent } from '../../src/tracking/ui/PandaPortrait';

const m = vi.hoisted(() => ({
  factory: 0,
  mount: vi.fn(),
}));
vi.mock('../../src/tracking/ui/panda-rive', () => {
  m.factory++;
  return { mountPanda: (c: HTMLCanvasElement) => m.mount(c) };
});

type Fake = { play: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
const fake = (): Fake => ({ play: vi.fn(), dispose: vi.fn() });
const setReduced = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
};
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(0); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const ev = (kind: PandaEvent['kind'], id: string): PandaEvent => ({ kind, id });

beforeEach(() => { vi.useFakeTimers(); m.mount.mockReset(); setReduced(false); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('reduced motion never imports the runtime and keeps the still', async () => {
  setReduced(true);
  const { container } = render(<PandaPortrait gesture={ev('greet', 'a')} />);
  await settle();
  expect(m.factory).toBe(0);
  expect(m.mount).not.toHaveBeenCalled();
  expect(container.querySelector('canvas')).toBeNull();
  expect(container.querySelector('img')).not.toBeNull();
});

test('the still stays until the canvas has drawn', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { container } = render(<PandaPortrait />);
  expect(container.querySelector('.tk-panda')!.hasAttribute('data-drawn')).toBe(false);
  await settle();
  expect(container.querySelector('.tk-panda')!.getAttribute('data-drawn')).toBe('true');
});

test('a gesture id plays once, also over rerenders', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { rerender } = render(<PandaPortrait gesture={ev('greet', 'a')} />);
  await settle();
  expect(f.play.mock.calls).toEqual([['greet']]);
  rerender(<PandaPortrait gesture={ev('greet', 'a')} />);
  rerender(<PandaPortrait gesture={{ kind: 'greet', id: 'a' }} />);
  await settle();
  expect(f.play).toHaveBeenCalledTimes(1);
});

test('a newer id plays once; nod and listen may cut in, other clips are dropped while one plays', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { rerender } = render(<PandaPortrait gesture={ev('greet', 'a')} />);
  await settle();
  rerender(<PandaPortrait gesture={ev('flex', 'b')} />); // greet still plays: dropped
  expect(f.play.mock.calls).toEqual([['greet']]);
  rerender(<PandaPortrait gesture={ev('nod', 'c')} />);
  expect(f.play.mock.calls).toEqual([['greet'], ['nod']]);
  rerender(<PandaPortrait gesture={ev('nod', 'c')} />);
  expect(f.play).toHaveBeenCalledTimes(2);
  await wait(5000);
  rerender(<PandaPortrait gesture={ev('listen', 'd')} />);
  expect(f.play.mock.calls.at(-1)).toEqual(['listen']);
});

test('the day clip plays once after the greeting has ended, never together with it', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  render(<PandaPortrait gesture={ev('greet', 'a')} dayClip="bike" />);
  await settle();
  expect(f.play.mock.calls).toEqual([['greet']]);
  await wait(1500);
  expect(f.play).toHaveBeenCalledTimes(1);
  await wait(1500);
  expect(f.play.mock.calls).toEqual([['greet'], ['bike']]);
  await wait(20_000);
  expect(f.play).toHaveBeenCalledTimes(2);
});

test('no day clip without a greeting, and none when the day clip is null', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { rerender } = render(<PandaPortrait dayClip="run" />);
  await settle();
  await wait(5000);
  expect(f.play).not.toHaveBeenCalled();
  rerender(<PandaPortrait gesture={ev('greet', 'g')} dayClip={null} />);
  await wait(5000);
  expect(f.play.mock.calls).toEqual([['greet']]);
});

test('breathe comes only after 30 to 45 s of calm, not while hidden, and stops on unmount', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { unmount } = render(<PandaPortrait />);
  await settle();
  await wait(29_000);
  expect(f.play).not.toHaveBeenCalled();
  await wait(17_000);
  expect(f.play.mock.calls).toEqual([['breathe']]);
  // hidden: no more
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(120_000);
  expect(f.play).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(46_000);
  expect(f.play).toHaveBeenCalledTimes(2);
  unmount();
  await wait(120_000);
  expect(f.play).toHaveBeenCalledTimes(2);
});

test('a failed load keeps the still and nothing throws', async () => {
  m.mount.mockRejectedValue(new Error('no wasm'));
  const { container } = render(<PandaPortrait gesture={ev('greet', 'a')} />);
  await settle();
  expect(container.querySelector('.tk-panda')!.hasAttribute('data-drawn')).toBe(false);
  expect(container.querySelector('img')).not.toBeNull();
});

test('a runtime that resolves after unmount is disposed exactly once and never plays', async () => {
  const f = fake();
  let resolve!: (h: Fake) => void;
  m.mount.mockReturnValue(new Promise<Fake>((r) => { resolve = r; }));
  const { unmount } = render(<PandaPortrait gesture={ev('greet', 'a')} />);
  await settle();
  unmount();
  resolve(f);
  await settle();
  expect(f.dispose).toHaveBeenCalledTimes(1);
  expect(f.play).not.toHaveBeenCalled();
});

test('a mounted runtime is disposed once on unmount', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { unmount } = render(<PandaPortrait />);
  await settle();
  unmount();
  expect(f.dispose).toHaveBeenCalledTimes(1);
});
