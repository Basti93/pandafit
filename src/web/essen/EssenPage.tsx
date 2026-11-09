import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { PageHead, useBackEntry } from '../../tracking/ui/kit';

const scrollTo = (y: number) => { try { window.scrollTo(0, y); } catch { /* no scrolling here (jsdom) */ } };

/**
 * The one frame of every Essen sub page (like SubPage in Training): the back pill, the browser's Back, then the page.
 * A page starts at the top. An outer page that another page stands over (`hidden`) remembers its scroll position and the
 * element that opened the inner page, and restores both when it is shown again.
 */
export function EssenPage({ back, title, hidden = false, children }: { back: { label: string; onClick: () => void }; title?: string; /** Another page stands over this one: it stays mounted (and keeps its history entry) but is not shown. */ hidden?: boolean; children: ReactNode }) {
  useBackEntry(back.onClick);
  const root = useRef<HTMLDivElement>(null);
  const saved = useRef<{ y: number; focus: Element | null } | null>(null);
  useEffect(() => { scrollTo(0); }, []);
  // Before the page is hidden (the layout effect runs before the browser drops the focus): note scroll and focus.
  useLayoutEffect(() => {
    if (hidden) saved.current = { y: window.scrollY, focus: document.activeElement };
  }, [hidden]);
  useEffect(() => {
    if (hidden || !saved.current) return;
    const { y, focus } = saved.current;
    saved.current = null;
    scrollTo(y);
    const target = focus instanceof HTMLElement && root.current?.contains(focus) ? focus : root.current?.querySelector<HTMLElement>('.tk-pill');
    target?.focus({ preventScroll: true });
  }, [hidden]);
  return (
    <div hidden={hidden} ref={root}>
      <div className="tk-screen tk-headblock"><PageHead title={title} back={back} /></div>
      {children}
    </div>
  );
}
