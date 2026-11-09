import type { ReactNode } from 'react';
import { PageHead, useBackEntry } from '../../tracking/ui/kit';

/** The one frame of every Essen sub page (like SubPage in Training): the back pill, the browser's Back, then the page. */
export function EssenPage({ back, title, hidden = false, children }: { back: { label: string; onClick: () => void }; title?: string; /** Another page stands over this one: it stays mounted (and keeps its history entry) but is not shown. */ hidden?: boolean; children: ReactNode }) {
  useBackEntry(back.onClick);
  return (
    <div hidden={hidden}>
      <div className="tk-screen tk-headblock"><PageHead title={title} back={back} /></div>
      {children}
    </div>
  );
}
