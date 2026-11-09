import type { ReactNode } from 'react';
import { BackButton, BrushTitle } from './Dojo';

/** The top of a page (without a title: only the back pill, for pages whose title is in their HeadCard): an optional back button, the title with its brush stroke, an optional muted subtitle, and room on the right for the round profile button. The next block starts 16 px below. */
export function PageHead({ title, subtitle, back }: { title?: string; subtitle?: ReactNode; back?: { label: string; onClick: () => void } }) {
  return (
    <header className="tk-pagehead">
      {back && <BackButton label={back.label} onClick={back.onClick} />}
      {title && <BrushTitle level={1}>{title}</BrushTitle>}
      {subtitle && <p className="tk-subtitle muted">{subtitle}</p>}
    </header>
  );
}
