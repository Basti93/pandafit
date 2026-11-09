import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { PageHead, useBackEntry } from '../../tracking/ui/kit';

const scrollTo = (y: number) => { try { window.scrollTo(0, y); } catch { /* no scrolling here (jsdom) */ } };

/**
 * For a page that stays mounted while another page stands over it (`hidden`): it follows the scroll position while it is shown,
 * notes the element that opened the other page, and restores both when it is shown again.
 * The position is followed by scroll events, not read when the page is hidden: by then the browser has already shortened the document.
 */
function useKeepWhenHidden(hidden: boolean, root: RefObject<HTMLElement | null>) {
  const y = useRef(0);
  const shown = useRef(!hidden);
  const focus = useRef<Element | null>(null);
  const restore = useRef(false);
  useEffect(() => {
    const onScroll = () => { if (shown.current) y.current = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Before the page is hidden (the layout effect runs before the browser drops the focus): note the focus.
  useLayoutEffect(() => {
    shown.current = !hidden;
    if (hidden) { focus.current = document.activeElement; restore.current = true; }
  }, [hidden]);
  useEffect(() => {
    if (hidden || !restore.current) return;
    restore.current = false;
    const frame = requestAnimationFrame(() => scrollTo(y.current));
    const target = focus.current instanceof HTMLElement && root.current?.contains(focus.current) ? focus.current : root.current?.querySelector<HTMLElement>('.tk-pill');
    target?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frame);
  }, [hidden, root]);
}

/** A page that another page stands over: it stays mounted and hidden, and gets its scroll position and focus back. */
export function KeptPage({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useKeepWhenHidden(hidden, root);
  return <div hidden={hidden} ref={root}>{children}</div>;
}

/**
 * The one frame of every Essen sub page (like SubPage in Training): the back pill, the browser's Back, then the page.
 * A page starts at the top. An outer page that another page stands over (`hidden`) is kept like a KeptPage.
 */
export function EssenPage({ back, title, hidden = false, children }: { back: { label: string; onClick: () => void }; title?: string; /** Another page stands over this one: it stays mounted (and keeps its history entry) but is not shown. */ hidden?: boolean; children: ReactNode }) {
  useBackEntry(back.onClick);
  useEffect(() => { scrollTo(0); }, []);
  return (
    <KeptPage hidden={hidden}>
      <div className="tk-screen tk-headblock"><PageHead title={title} back={back} /></div>
      {children}
    </KeptPage>
  );
}
