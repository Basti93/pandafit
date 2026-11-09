import type { ReactNode } from 'react';
import { PageHead, useBackEntry } from '../../tracking/ui/kit';

/** The one frame of every Essen sub page (like SubPage in Training): the back pill, the browser's Back, then the page. */
export function EssenPage({ back, title, children }: { back: { label: string; onClick: () => void }; title?: string; children: ReactNode }) {
  useBackEntry(back.onClick);
  return (
    <>
      <div className="tk-screen tk-headblock"><PageHead title={title} back={back} /></div>
      {children}
    </>
  );
}
