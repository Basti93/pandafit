import type { Pass } from '../../shared/passes';

/**
 * Where you are on the mountain. Only for the picture: the trainer keeps following the session and never feels this grade.
 * Physics values are our own round assumptions; the speed here says nothing about fitness.
 */
const MASS_KG = 83;
const CDA = 0.32;
const AIR = 1.2;
const ROLLING = 0.005;
const G = 9.81;
const MAX_MPS = 18;

export const speedMps = (powerW: number | null | undefined, gradePct: number): number => {
  if (!powerW || powerW <= 0) return 0;
  const slope = gradePct / 100;
  const resist = MASS_KG * G * (ROLLING + slope / Math.hypot(1, slope));
  let low = 0, high = MAX_MPS;
  for (let i = 0; i < 40; i++) {
    const v = (low + high) / 2;
    if ((resist + 0.5 * AIR * CDA * v * v) * v > powerW) high = v; else low = v;
  }
  return low;
};

export const heightAt = (p: Pass, distanceM: number): number => {
  const at = Math.max(0, Math.min(p.heights.length - 1, distanceM / p.stepM));
  const i = Math.min(p.heights.length - 2, Math.floor(at));
  return p.heights[i] + (p.heights[i + 1] - p.heights[i]) * (at - i);
};

export const gradeAt = (p: Pass, distanceM: number): number => {
  const from = Math.max(0, distanceM - p.stepM / 2);
  const to = Math.min(p.lengthM, from + p.stepM);
  return to > from ? ((heightAt(p, to) - heightAt(p, from)) / (to - from)) * 100 : 0;
};

export const topOf = (p: Pass): number => Math.max(...p.heights);

export const nextPosition = (p: Pass, distanceM: number, powerW: number | null | undefined, seconds: number): { distanceM: number; arrived: boolean } => {
  const moved = distanceM + speedMps(powerW, gradeAt(p, distanceM)) * seconds;
  return moved >= p.lengthM ? { distanceM: p.lengthM, arrived: true } : { distanceM: moved, arrived: false };
};

const SUB_STEP_S = 2;

/**
 * Moves over a longer gap in small steps, so that grade changes count. Needed because a hidden window
 * delivers its timer late: the full time since the last tick must count. Power stays at the last known value.
 */
export const advance = (p: Pass, distanceM: number, powerW: number | null | undefined, seconds: number): { distanceM: number; arrived: boolean } => {
  let pos = { distanceM, arrived: false };
  for (let left = Math.max(0, seconds); left > 0 && !pos.arrived; left -= SUB_STEP_S) pos = nextPosition(p, pos.distanceM, powerW, Math.min(SUB_STEP_S, left));
  return pos;
};
