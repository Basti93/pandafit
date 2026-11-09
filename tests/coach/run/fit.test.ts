import { avgTemp, bestWindowDistance, easyPace, looksComplete, readRunFit, unzipFit, type RunSample } from '../../../src/coach/run/fit';
import { buildFit, zipOf } from './fixtures';

const band = { fromBpm: 114, toBpm: 143 };
const pace = (sPerKm: number) => 1000 / sPerKm;
const samplesOf = (seconds: number, at: Parameters<typeof buildFit>[1]): RunSample[] => readRunFit(buildFit(seconds, at))!;
const isFit = (b: Uint8Array | null) => b !== null && Buffer.from(b.subarray(8, 12)).toString() === '.FIT';

describe('unzipFit', () => {
  const fit = buildFit(20, () => ({ hr: 120, speed: 3 }));
  test('unzipFit reads a stored and a deflated entry and passes a bare FIT through', () => {
    expect(isFit(unzipFit(zipOf('a.fit', fit, 0)))).toBe(true);
    expect(isFit(unzipFit(zipOf('A.FIT', fit, 8)))).toBe(true);
    expect(isFit(unzipFit(fit))).toBe(true);
  });
  test('a truncated zip gives null', () => {
    const z = zipOf('a.fit', fit, 8);
    expect(unzipFit(z.subarray(0, z.length - 40))).toBeNull();
    expect(unzipFit(z.subarray(0, 20))).toBeNull();
    expect(unzipFit(new Uint8Array(0))).toBeNull();
  });
  test('a zip without a .fit entry gives null', () => {
    expect(unzipFit(zipOf('a.txt', fit, 0))).toBeNull();
  });
});

test('readRunFit returns per-second hr, speed, distance and altitude', () => {
  const samples = samplesOf(600, (s) => ({ hr: 100 + (s % 50), speed: 3, alt: 200 + s * 0.1, temp: 12 }));
  expect(samples.length).toBe(600);
  const s = samples[100];
  expect(s.t).toBe(100);
  expect(s.hr).toBe(100);
  expect(s.speed).toBeCloseTo(3, 2);
  expect(s.distM).toBeCloseTo(303, 0);
  expect(s.altM).toBeCloseTo(210, 0);
  expect(s.tempC).toBe(12);
});
test('readRunFit gives null for garbage', () => {
  expect(readRunFit(new Uint8Array([1, 2, 3]))).toBeNull();
});

describe('easyPace', () => {
  test('easyPace skips the first 5 minutes', () => {
    const p = easyPace(samplesOf(900, (s) => ({ hr: 130, speed: pace(s < 300 ? 240 : 360) })), band);
    // 599 s, not 600: the last sample has no successor to weigh it
    expect(p).toEqual({ sPerKm: 360, seconds: 599 });
  });
  test('easyPace leaves out seconds outside the band and on steep stretches', () => {
    // 600 s flat at 6:00, then 120 s of HR 160 at 4:00 on the flat, then a 4 % climb at 8:00.
    const at = (s: number) => {
      if (s < 300) return { hr: 130, speed: pace(360), alt: 100 };
      if (s < 600) return { hr: 130, speed: pace(360), alt: 100 };
      if (s < 720) return { hr: 160, speed: pace(240), alt: 100 };
      return { hr: 130, speed: pace(480), alt: 100 + (s - 720) * 0.04 * pace(480) };
    };
    const p = easyPace(samplesOf(1000, at), band);
    // 300..599 are flat; the HR-160 part is out of the band; the climb is out from its first second
    expect(p).toEqual({ sPerKm: 360, seconds: 300 });
  });
  test('a climb is left out from its first second, even at a pace unlike the flat', () => {
    const at = (s: number) => (s < 700 ? { hr: 130, speed: pace(360), alt: 100 } : { hr: 130, speed: pace(480), alt: 100 + (s - 700) * 0.04 * pace(480) });
    const p = easyPace(samplesOf(900, at), band)!;
    expect(p.sPerKm).toBe(360);
    expect(p.seconds).toBeLessThanOrEqual(400);
    expect(p.seconds).toBeGreaterThanOrEqual(395);
  });
  test('gaps over 5 s are not counted', () => {
    const at = (s: number) => (s >= 400 && s < 700 ? null : { hr: 130, speed: pace(360) });
    const p = easyPace(samplesOf(1000, at), band)!;
    // 300..399 before the gap (the last second spans the gap), 700..999 after
    expect(p.seconds).toBe(99 + 299);
  });
  test('zero speed seconds are not counted', () => {
    const at = (s: number) => ({ hr: 130, speed: s >= 400 && s < 500 ? 0 : pace(360) });
    const p = easyPace(samplesOf(900, at), band)!;
    expect(p.seconds).toBe(599 - 100);
    expect(p.sPerKm).toBe(360);
  });
  test('easyPace is null without heart rate or with under 5 easy minutes', () => {
    expect(easyPace(samplesOf(900, () => ({ speed: pace(360) })), band)).toBeNull();
    expect(easyPace(samplesOf(550, () => ({ hr: 130, speed: pace(360) })), band)).toBeNull();
    expect(easyPace([], band)).toBeNull();
  });
});

test('bestWindowDistance tolerates one second for a recording of exactly the window', () => {
  const samples = samplesOf(1800, () => ({ hr: 140, speed: 3 }));
  expect(samples.at(-1)!.t).toBe(1799);
  expect(bestWindowDistance(samples, 1800)!).toBeCloseTo(1799 * 3, -1);
});
test('readRunFit treats a heart rate of 0 as none', () => {
  expect(samplesOf(10, () => ({ hr: 0, speed: 3 })).every((s) => s.hr === null)).toBe(true);
});
test('unzipFit refuses an entry that inflates beyond 64 MiB', () => {
  const big = Buffer.alloc(70 * 1024 * 1024);
  big.write('.FIT', 8);
  expect(unzipFit(zipOf('a.fit', big, 8))).toBeNull();
}, 30_000); // deflating 70 MiB is slow when the whole suite runs in parallel
describe('looksComplete', () => {
  const fit = buildFit(20, () => ({ hr: 120, speed: 3 }));
  test('a whole FIT and a whole zip are complete, a cut one is not', () => {
    expect(looksComplete(fit)).toBe(true);
    expect(looksComplete(fit.subarray(0, fit.length - 5))).toBe(false);
    const z = zipOf('a.fit', fit, 8);
    expect(looksComplete(z)).toBe(true);
    expect(looksComplete(z.subarray(0, z.length - 30))).toBe(false);
    expect(looksComplete(new Uint8Array(3))).toBe(false);
  });
});
test('bestWindowDistance finds the best 1800 s', () => {
  // 3000 s: 2 m/s, except a fast stretch 1000..2200 at 4 m/s
  const samples = samplesOf(3000, (s) => ({ hr: 140, speed: s >= 1000 && s < 2200 ? 4 : 2 }));
  // best window: 1200 s fast + 600 s slow
  expect(bestWindowDistance(samples, 1800)!).toBeCloseTo(1200 * 4 + 600 * 2, -1);
  expect(Math.abs(bestWindowDistance(samples, 1800)! - 6000)).toBeLessThanOrEqual(5);
  expect(bestWindowDistance(samples.slice(0, 100), 1800)).toBeNull();
  expect(bestWindowDistance(samples.map((s) => ({ ...s, distM: null })), 1800)).toBeNull();
});

test('avgTemp is the mean or null', () => {
  expect(avgTemp(samplesOf(10, (s) => ({ speed: 3, temp: s < 5 ? 10 : 20 })))).toBe(15);
  expect(avgTemp(samplesOf(10, () => ({ speed: 3 })))).toBeNull();
});
