// Parallax for the background bamboo: the grove drifts down a little while the page scrolls up,
// so it moves slower than the cards in front of it. One CSS variable carries the offset; web.css uses it.

/** Share of the scroll the bamboo drifts back. 0 scrolls with the page, 1 stands still. */
export const BAMBOO_DRIFT = 0.35;

/** The offset for a scroll position; none when the person asked for less motion. */
export function bambooDrift(scrollY: number, reducedMotion: boolean): string {
  return reducedMotion ? '0px' : `${Math.round(Math.max(0, scrollY) * BAMBOO_DRIFT)}px`;
}

/** Keeps --bamboo-drift on <html> up to date, at most once per frame. Returns a stop function. */
export function startBambooParallax(win: Window = window): () => void {
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const root = win.document.documentElement;
  let frame = 0;
  const paint = () => { frame = 0; root.style.setProperty('--bamboo-drift', bambooDrift(win.scrollY, reduced.matches)); };
  const onScroll = () => { if (!frame) frame = win.requestAnimationFrame(paint); };
  win.addEventListener('scroll', onScroll, { passive: true });
  reduced.addEventListener?.('change', paint);
  paint();
  return () => {
    win.removeEventListener('scroll', onScroll);
    reduced.removeEventListener?.('change', paint);
    if (frame) win.cancelAnimationFrame(frame);
  };
}
