export type DayOffset = -1 | 0 | 1;
type Step = -1 | 0 | 1;

/** A sideways swipe: -1 (finger to the right, one day back), +1 (finger to the left, one day on), else 0. */
export function swipeStep(dx: number, dy: number): Step {
  if (Math.abs(dx) <= 50 || Math.abs(dx) <= 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export const shiftDay = (d: DayOffset, step: Step): DayOffset => Math.max(-1, Math.min(1, d + step)) as DayOffset;

const NAMES: Record<DayOffset, string> = { [-1]: 'Gestern', 0: 'Heute', 1: 'Morgen' };

/** "Heute" and the small date "So, 8. November". */
export function dayTitle(offset: DayOffset, nowMs: number): { name: string; date: string } {
  const d = new Date(nowMs);
  d.setDate(d.getDate() + offset);
  const weekday = d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
  return { name: NAMES[offset], date: `${weekday}, ${d.getDate()}. ${d.toLocaleDateString('de-DE', { month: 'long' })}` };
}

/** True where a swipe belongs to something else: a dialog, a field, or a sideways scroller. */
export function swipeIgnored(target: Element | null): boolean {
  for (let el: Element | null = target; el && el !== el.ownerDocument.body; el = el.parentElement) {
    if (el.matches('[role=dialog], input, textarea, select, .tk-hscroll')) return true;
    const ox = el.ownerDocument.defaultView?.getComputedStyle(el).overflowX;
    if (ox === 'auto' || ox === 'scroll') return true;
  }
  return false;
}
