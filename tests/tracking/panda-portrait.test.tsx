// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { PandaPortrait } from '../../src/tracking/ui/PandaPortrait';

const m = vi.hoisted(() => ({
  factory: 0,
  mount: vi.fn(),
}));
vi.mock('../../src/tracking/ui/panda-canvas', () => {
  m.factory++;
  return { mountPanda: (c: HTMLCanvasElement) => m.mount(c) };
});

type Fake = { play: ReturnType<typeof vi.fn>; hold: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
const fake = (): Fake => ({ play: vi.fn(), hold: vi.fn(), dispose: vi.fn() });
const setReduced = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
};
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(0); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers(); m.mount.mockReset(); setReduced(false); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('reduced motion never imports the player and keeps the still', async () => {
  setReduced(true);
  const { container } = render(<PandaPortrait pose="greet" />);
  await settle();
  expect(m.factory).toBe(0);
  expect(m.mount).not.toHaveBeenCalled();
  expect(container.querySelector('canvas')).toBeNull();
  expect(container.querySelector('img')).not.toBeNull();
});

test('the still stays until the canvas has drawn', async () => {
  m.mount.mockResolvedValue(fake());
  const { container } = render(<PandaPortrait />);
  expect(container.querySelector('.tk-panda')!.hasAttribute('data-drawn')).toBe(false);
  await settle();
  expect(container.querySelector('.tk-panda')!.getAttribute('data-drawn')).toBe('true');
});

test('Bo glides slowly into one pose and keeps it: later changes wait for the next opening', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { rerender } = render(<PandaPortrait pose="greet" />);
  await settle();
  rerender(<PandaPortrait pose="bike" />); // the day's data arrived before the pose was taken
  await wait(800);
  expect(f.hold.mock.calls).toEqual([['bike', 2400]]);
  rerender(<PandaPortrait pose="run" />);
  await wait(60_000);
  expect(f.hold).toHaveBeenCalledTimes(1);
  expect(f.play).not.toHaveBeenCalled();
});

test('no pose: Bo stays at rest', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  render(<PandaPortrait pose={null} />);
  await settle();
  await wait(5000);
  expect(f.hold).not.toHaveBeenCalled();
});

test('a failed load keeps the still', async () => {
  m.mount.mockRejectedValue(new Error('no canvas'));
  const { container } = render(<PandaPortrait pose="greet" />);
  await settle();
  expect(container.querySelector('.tk-panda')!.hasAttribute('data-drawn')).toBe(false);
  expect(container.querySelector('img')).not.toBeNull();
});

test('closing before the player is ready disposes it exactly once and holds nothing', async () => {
  const f = fake();
  let resolve!: (h: Fake) => void;
  m.mount.mockReturnValue(new Promise<Fake>((r) => { resolve = r; }));
  const { unmount } = render(<PandaPortrait pose="greet" />);
  await settle();
  unmount();
  resolve(f);
  await settle();
  await wait(5000);
  expect(f.dispose).toHaveBeenCalledTimes(1);
  expect(f.hold).not.toHaveBeenCalled();
});

test('closing during the settle pause disposes and holds nothing', async () => {
  const f = fake();
  m.mount.mockResolvedValue(f);
  const { unmount } = render(<PandaPortrait pose="greet" />);
  await settle();
  unmount();
  await wait(5000);
  expect(f.dispose).toHaveBeenCalledTimes(1);
  expect(f.hold).not.toHaveBeenCalled();
});

test('reduced motion shows the still of the pose and keeps it, telling which pose Bo took', async () => {
  setReduced(true);
  const took = vi.fn();
  const { container, rerender } = render(<PandaPortrait pose="bike" onTake={took} />);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/bo-pose-bike.svg');
  await wait(800);
  expect(took).toHaveBeenCalledWith('bike');
  rerender(<PandaPortrait pose="run" onTake={took} />);
  await wait(5000);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/bo-pose-bike.svg');
  expect(took).toHaveBeenCalledTimes(1);
  expect(m.mount).not.toHaveBeenCalled(); // the factory count is shared with earlier tests
});

test('when the player fails, Bo stands as the still of his pose', async () => {
  m.mount.mockRejectedValue(new Error('Panda needs vector paths'));
  const took = vi.fn();
  const { container } = render(<PandaPortrait pose="run" onTake={took} />);
  await settle(); await wait(800);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/bo-pose-run.svg');
  expect(took).toHaveBeenCalledWith('run');
});

test('with motion the rest still lies under the canvas and onTake comes with the glide', async () => {
  const f = fake(); m.mount.mockResolvedValue(f);
  const took = vi.fn();
  const { container } = render(<PandaPortrait pose="flex" onTake={took} />);
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/brand/panda-still.svg');
  await settle(); await wait(800);
  expect(f.hold).toHaveBeenCalledWith('flex', expect.any(Number));
  expect(took).toHaveBeenCalledWith('flex');
});

test('with no pose when it settles, Bo takes nothing', async () => {
  setReduced(true);
  const took = vi.fn();
  render(<PandaPortrait onTake={took} />);
  await wait(5000);
  expect(took).toHaveBeenCalledTimes(1);
  expect(took).toHaveBeenCalledWith(null);
});

test('closing before the still is taken calls onTake never', async () => {
  setReduced(true);
  const took = vi.fn();
  const { unmount } = render(<PandaPortrait pose="yoga" onTake={took} />);
  unmount();
  await wait(5000);
  expect(took).not.toHaveBeenCalled();
});
