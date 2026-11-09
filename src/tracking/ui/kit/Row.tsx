import type { DOMAttributes, ReactNode } from 'react';

/** "⌄": this row opens in place; it turns over while open. ("›" means a new page.) */
export const ExpandMark = ({ open }: { open: boolean }) => <span className={`tk-chevron tk-chevron-down${open ? ' open' : ''}`} aria-hidden="true">⌄</span>;

/** The list of rows: thin dividers between them, no card around each. */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return <ul className="tk-rows" aria-label={label}>{children}</ul>;
}

/**
 * One list item: title left, a short muted value right. With `onClick` it is a button with a mark: "›" opens a new page or sheet,
 * "⌄" (with `expanded` given) opens the row in place and turns while open. `children` show below it once expanded (or always, when `expanded` is not given).
 */
export function Row({ title, value, onClick, expanded, press, children }: { title: ReactNode; value?: ReactNode; onClick?: () => void; expanded?: boolean; press?: DOMAttributes<HTMLElement>; children?: ReactNode }) {
  const inner = (
    <>
      <span className="tk-row-title">{title}</span>
      {value != null && <span className="tk-row-value muted">{value}</span>}
      {onClick && (expanded === undefined ? <span className="tk-chevron" aria-hidden="true">›</span> : <ExpandMark open={expanded} />)}
    </>
  );
  return (
    <li className="tk-rowitem">
      {onClick ? <button type="button" className={press ? 'tk-rowbtn tk-hold' : 'tk-rowbtn'} aria-expanded={expanded} {...press} onClick={onClick}>{inner}</button> : <div className="tk-rowbtn">{inner}</div>}
      {children && (expanded === undefined || expanded) && <div className="tk-row-more">{children}</div>}
    </li>
  );
}
