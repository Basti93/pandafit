import { pickTip, type TipContext } from '../../src/ui/ride-tips';
import type { Session } from '../../src/shared/session';

const TIP = 'Denk an lockere Schultern wegen deines Nackens.';
const calm: Session = { id: 's', name: 's', tips: [TIP], steps: [{ kind: 'erg', durationS: 3600, ftpFraction: 0.5, label: 'Locker' }] };
const hard: Session = { ...calm, steps: [{ kind: 'erg', durationS: 3600, ftpFraction: 0.9, label: 'Hart' }] };
const engine = (t: number): TipContext['engine'] => ({ stepIndex: 0, stepRemainingS: 3600 - t, rideElapsedS: t, targetW: 100, gradePct: null, gear: null, label: 'x', nextLabel: null, secondsToNext: 100, autoReducedPct: 0, paused: false });
const ctx = (session: Session, t: number, over: Partial<TipContext> = {}): TipContext => ({ session, engine: engine(t), cadences: [], zones: [], ...over });

test('a personal tip comes after body tips and before encouragement', () => {
  expect(pickTip(ctx(calm, 700), new Set())?.text).toBe(TIP);
  expect(pickTip(ctx(calm, 700, { zones: [5, 5] }), new Set())?.id).toBe('hr-0');
});
test('a personal tip is not given early, in a hard section or twice', () => {
  expect(pickTip(ctx(calm, 300), new Set())?.id).not.toBe('coach-0');
  expect(pickTip(ctx(hard, 700), new Set())?.text).not.toBe(TIP);
  expect(pickTip(ctx(calm, 700), new Set(['coach-0']))?.id).not.toBe('coach-0');
});
test('a session without tips gives no personal tip', () => {
  expect(pickTip(ctx({ ...calm, tips: undefined }, 700), new Set())?.id).toMatch(/^relax-/);
});
