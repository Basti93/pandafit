import { clampTargetW } from '../../src/shared/target-power';
test('clamp keeps target within 30-150% FTP', () => {
  expect(clampTargetW(1000, 200)).toBe(300);
  expect(clampTargetW(10, 200)).toBe(60);
  expect(clampTargetW(150, 200)).toBe(150);
});
test('a non-finite request never yields NaN', () => {
  expect(clampTargetW(NaN, 200)).toBe(200);
  expect(clampTargetW(Infinity, 200)).toBe(200);
  expect(clampTargetW(-Infinity, 200)).toBe(200);
});
