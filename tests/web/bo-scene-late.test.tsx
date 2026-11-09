// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { BoBubble } from '../../src/tracking/ui/kit';

const m = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock('../../src/tracking/ui/panda-canvas', () => ({ mountPanda: (c: HTMLCanvasElement) => m.mount(c) }));

const fake = () => ({ play: vi.fn(), hold: vi.fn(), dispose: vi.fn() });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(0); });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const placeNow = () => document.querySelector('.tk-scene')!.getAttribute('data-place');

beforeEach(() => {
  vi.useFakeTimers();
  m.mount.mockReset();
  m.mount.mockResolvedValue(fake());
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('keeps place and pose together when the day arrives after Bo took his pose', async () => {
  const { rerender } = render(<BoBubble place="own" pose="greet">Guten Morgen.</BoBubble>);
  await settle(); await wait(800); // Bo glides into greet
  rerender(<BoBubble place="own" pose="bike">Guten Morgen.</BoBubble>);
  await wait(5000);
  expect(placeNow()).toBe('nest');
});

test('stays in the nest when there was no pose to take', async () => {
  const { rerender } = render(<BoBubble place="own">Guten Morgen.</BoBubble>);
  await settle(); await wait(800);
  rerender(<BoBubble place="own" pose="run">Guten Morgen.</BoBubble>);
  await wait(5000);
  expect(placeNow()).toBe('nest');
});
