import { describe, expect, it } from 'vitest';
import { mergeBlocks, readBike, readRideBody, thinSamples, MAX_CURVE_POINTS, type BikeBody, type RideBody } from '../../src/shared/bike';
import { validBody } from '../../src/web/validate';
import type { Step } from '../../src/shared/session';

const erg = (min: number, f: number): Step => ({ kind: 'erg', durationS: min * 60, ftpFraction: f, label: 'x' });

describe('mergeBlocks', () => {
  it('merges neighbours at the same level and names easy stretches', () => {
    expect(mergeBlocks([erg(5, 0.5), erg(5, 0.5), erg(20, 0.7)])).toEqual([
      { label: '10 Min locker', minutes: 10, pct: 50 },
      { label: '20 Min bei 70 %', minutes: 20, pct: 70 },
    ]);
  });
  it('collapses repeated work and rest into one block', () => {
    const steps = [erg(10, 0.5), erg(8, 0.95), erg(4, 0.5), erg(8, 0.95), erg(4, 0.5), erg(8, 0.95), erg(4, 0.5), erg(5, 0.5)];
    const blocks = mergeBlocks(steps);
    expect(blocks[0]!.label).toBe('10 Min locker');
    expect(blocks[1]!.label).toBe('3 × 8 Min bei 95 %, dazwischen 4 Min locker');
    // The last rest merged with the cool down, so it stays a stretch of its own.
    expect(blocks[1]!.minutes).toBe(32);
    expect(blocks[2]).toEqual({ label: '9 Min locker', minutes: 9, pct: 50 });
  });
  it('keeps a last work part without rest in the group', () => {
    const blocks = mergeBlocks([erg(6, 1), erg(3, 0.5), erg(6, 1), erg(3, 0.5), erg(6, 1)]);
    expect(blocks).toEqual([{ label: '3 × 6 Min bei 100 %, dazwischen 3 Min locker', minutes: 24, pct: 100 }]);
  });
});

describe('thinSamples', () => {
  it('keeps at most the wanted number of points', () => {
    const samples = Array.from({ length: 5000 }, (_, i) => ({ rideElapsedS: i + 1, powerW: 200, hrBpm: 140, cadenceRpm: 90 }));
    const pts = thinSamples(samples, MAX_CURVE_POINTS);
    expect(pts.length).toBeLessThanOrEqual(MAX_CURVE_POINTS);
    expect(pts.at(-1)!.t).toBe(5000);
  });
});

const bike = (): BikeBody => ({ type: 'bike', atMs: 1, ftpW: 200, ftpHistory: [], phase: null, next: { name: 'Grundlage', reason: 'r', minutes: 45, hardness: 'easy', blocks: [{ label: '45 Min locker', minutes: 45, pct: 60 }] }, alternatives: [], weekHours: [{ week: '2026-11-02', hours: 2.5 }] });
const ride = (): RideBody => ({ type: 'ride', startedAtMs: 1, durationS: 3000, hardness: 'easy', avgPowerW: 150, normalizedPowerW: 160, avgHrBpm: 130, maxHrBpm: 150, tss: 40, completedFraction: 1, curve: [{ t: 1, powerW: 150, hrBpm: 130 }] });

describe('validation', () => {
  it('accepts whole bodies and drops broken list entries', () => {
    expect(validBody('bike', bike())).toBe(true);
    expect(validBody('ride', ride())).toBe(true);
    const b = { ...bike(), alternatives: [{ name: 5 }], weekHours: [{ week: 'x', hours: 1 }] };
    expect(readBike(b)!.alternatives).toEqual([]);
    expect(readBike(b)!.weekHours).toEqual([]);
  });
  it('refuses wrong shapes and bodies over 64 KiB', () => {
    expect(validBody('bike', { ...bike(), ftpW: 'x' })).toBe(false);
    expect(validBody('ride', { ...ride(), hardness: 'wild' })).toBe(false);
    expect(readRideBody({ ...ride(), sessionName: 'x'.repeat(70_000) })).toBeNull();
  });
  it('limits the curve to 150 points', () => {
    const curve = Array.from({ length: 400 }, (_, i) => ({ t: i, powerW: 1, hrBpm: 1 }));
    expect(readRideBody({ ...ride(), curve })!.curve).toHaveLength(MAX_CURVE_POINTS);
  });
});
