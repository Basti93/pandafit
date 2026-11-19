// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PASSES, passById, type Pass } from '../../src/shared/passes';
import { PassCard } from '../../src/ui/pass/PassCard';
import { PassView } from '../../src/ui/pass/PassView';
import { advance, gradeAt, heightAt, nextPosition, speedMps } from '../../src/ui/pass/riding';

const climb: Pass = { id: 'c', name: 'Testberg', country: 'x', lengthM: 1000, gainM: 80, stepM: 500, heights: [100, 180, 180] };
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the mountains', () => {
  test.each(PASSES.map((p) => [p.name, p] as const))('%s has a believable profile', (_n, p) => {
    expect(p.heights.length).toBeGreaterThan(50);
    expect(Math.abs(p.heights.length - p.lengthM / p.stepM)).toBeLessThanOrEqual(2);
    expect(Math.max(...p.heights) - Math.min(...p.heights)).toBeGreaterThan(p.gainM * 0.7);
  });
  test('unknown ids fall back to the default mountain', () => {
    expect(passById('gibt-es-nicht').id).toBe('alpe-dhuez');
  });
});

describe('speed from power', () => {
  test('about 35 km/h at 200 W on the flat', () => { expect(speedMps(200, 0) * 3.6).toBeGreaterThan(30); expect(speedMps(200, 0) * 3.6).toBeLessThan(38); });
  test('slow but moving at 130 W on 8 %', () => { expect(speedMps(130, 8) * 3.6).toBeGreaterThan(6); expect(speedMps(130, 8) * 3.6).toBeLessThan(11); });
  test('no power means no movement', () => { expect(speedMps(0, 0)).toBe(0); expect(speedMps(null, 5)).toBe(0); });
});

test('reads height and grade along the route', () => {
  expect(heightAt(climb, 250)).toBeCloseTo(140);
  expect(gradeAt(climb, 250)).toBeCloseTo(16);
  expect(gradeAt(climb, 800)).toBeCloseTo(0);
});
test('stops at the top and says so', () => {
  expect(nextPosition(climb, 999, 300, 10)).toEqual({ distanceM: 1000, arrived: true });
  expect(nextPosition(climb, 500, null, 5).distanceM).toBe(500);
});

describe('on the bike', () => {
  const ride = (over = {}) => { const send = vi.fn(); const r = render(<PassView pass={climb} profileId="A" startM={0} powerW={200} paused={false} send={send} {...over} />); return { send, ...r }; };

  test('climbs while you pedal and shows what is left', () => {
    vi.useFakeTimers();
    ride();
    expect(screen.getByTestId('pass-left').textContent).toContain('noch 80 Höhenmeter');
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('pass-left').textContent).not.toContain('noch 80 Höhenmeter');
  });
  test('stands still in a pause', () => {
    vi.useFakeTimers();
    ride({ paused: true });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('pass-left').textContent).toContain('noch 80 Höhenmeter');
  });
  test('continues where you stopped and saves when the ride ends', () => {
    const { send, unmount } = ride({ startM: 250, paused: true });
    expect(screen.getByTestId('pass-left').textContent).toContain('140 m');
    unmount();
    expect(send).toHaveBeenCalledWith({ type: 'pass-progress', profileId: 'A', passId: 'c', distanceM: 250 });
  });
  test('reports the top exactly once', () => {
    vi.useFakeTimers();
    const { send, unmount } = ride({ startM: 995 });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByTestId('pass-summit').textContent).toContain('Testberg');
    unmount();
    expect(send.mock.calls.filter(([m]) => m.type === 'pass-summit')).toHaveLength(1);
    expect(send.mock.calls.filter(([m]) => m.type === 'pass-progress')).toHaveLength(0);
  });
});

describe('choosing', () => {
  test('sends the chosen mountain', () => {
    const send = vi.fn();
    render(<PassCard profileId="A" send={send} />);
    fireEvent.change(screen.getByLabelText('Berg wählen'), { target: { value: 'brocken' } });
    expect(send).toHaveBeenCalledWith({ type: 'pass-select', profileId: 'A', passId: 'brocken' });
  });
  test('shows how far you are and how often you were up there', () => {
    render(<PassCard profileId="A" send={vi.fn()} pass={{ selectedId: 'brocken', distanceM: { brocken: 4000 }, summits: [{ passId: 'alpe-dhuez', atMs: 1 }] }} />);
    expect(screen.getByTestId('pass-card').textContent).toContain('Du bist auf');
    expect(screen.getByRole('option', { name: /Alpe d’Huez.*1× oben/ })).toBeTruthy();
  });
});

describe('advance after a late tick', () => {
  const steady = { ...climb, lengthM: 100_000, heights: Array.from({ length: 201 }, (_, i) => 100 + i * 2), stepM: 500 };
  test('a gap of two minutes counts as much riding as two minutes of one-second ticks', () => {
    let ticks = { distanceM: 0, arrived: false };
    for (let i = 0; i < 120; i++) ticks = nextPosition(steady, ticks.distanceM, 200, 1);
    const gap = advance(steady, 0, 200, 120);
    expect(gap.distanceM).toBeGreaterThan(ticks.distanceM * 0.97);
    expect(gap.distanceM).toBeLessThan(ticks.distanceM * 1.03);
    expect(gap.distanceM).toBeGreaterThan(5 * nextPosition(steady, 0, 200, 1).distanceM * 10);
  });
  test('stops at the summit and does nothing without power or time', () => {
    expect(advance(climb, 0, 300, 3600)).toEqual({ distanceM: 1000, arrived: true });
    expect(advance(climb, 500, null, 120)).toEqual({ distanceM: 500, arrived: false });
    expect(advance(climb, 500, 300, 0)).toEqual({ distanceM: 500, arrived: false });
  });
});
