import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BackButton } from './Dojo';

/**
 * Full screen on the phone (size "small": a bottom sheet of auto height, at most 70 %, over a dimmed backdrop, for short option lists): title, × top right, the body, and a sticky bottom area for the primary button.
 * The page behind does not scroll. Escape, ×, and the browser's Back all call `onClose` (Escape calls `onBack` when given). Focus goes to the sheet and returns afterwards.
 * Render it only while it is open: `{open && <Sheet …/>}`.
 */
/** Open sheets, the newest last: Escape and Back only close the top one, so a sheet may open another (a picker inside a form). */
const stack: string[] = [];

/**
 * A sheet that closes gives its history entry back with history.back(), which finishes later. A sheet that opens in the same commit
 * must not push its own entry before that: the late "back" would then pop the new sheet. So a pending back is counted, the popstate
 * it causes is swallowed by every sheet, and a new sheet pushes its entry only after it.
 */
let pendingBacks = 0;
let swallowing = false;
const afterBacks: (() => void)[] = [];
const flushAfterBacks = () => { if (pendingBacks === 0) afterBacks.splice(0).forEach((f) => f()); };
const giveBack = () => {
  pendingBacks++;
  try { history.back(); } catch { pendingBacks--; return; }
  setTimeout(() => { if (pendingBacks > 0) { pendingBacks = 0; flushAfterBacks(); } }, 500); // no popstate came: do not wait forever
};
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { // registered first, so it runs before any sheet's own listener
    if (pendingBacks === 0) return;
    pendingBacks--;
    swallowing = true;
    setTimeout(() => { swallowing = false; flushAfterBacks(); }, 0);
  });
}

/**
 * One history entry for as long as something is shown: the browser's Back calls `onPop`. The returned function gives the entry back
 * (unless Back already used it). Shared by sheets and by `useBackEntry`.
 */
function takeEntry(id: string, onPop: () => void): () => void {
  const mark = { sheet: id };
  let popped = false;
  let pushed = false;
  let gone = false;
  const push = () => { if (gone) return; try { history.pushState(mark, ''); pushed = true; } catch { /* no history: Escape and × still work */ } };
  if (pendingBacks > 0) afterBacks.push(push); else push();
  const listener = () => { if (swallowing || !pushed || (history.state as { sheet?: string } | null)?.sheet === id) return; popped = true; onPop(); };
  window.addEventListener('popstate', listener);
  return () => {
    gone = true;
    window.removeEventListener('popstate', listener);
    if (!popped && pushed && (history.state as { sheet?: string } | null)?.sheet === id) giveBack();
  };
}

/** A page that is not a sheet (a sub-page of Woche) takes one history entry while it is shown, so the browser's Back leads out of it: `onBack` runs. */
export function useBackEntry(onBack: () => void) {
  const id = useId();
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => takeEntry(id, () => back.current()), [id]);
}

/**
 * One close pattern: × top right. A sub-page has "‹ Zurück" at the top left instead: a full sheet opened over another sheet
 * (it closes back to the one below), or a sheet given `onBack` (a page inside the same sheet).
 */
export function Sheet({ title, onClose, onBack, children, actions, size = 'full', lead, display, page, subtitle }: { title: string; onClose: () => void; onBack?: () => void; children: ReactNode; actions?: ReactNode; size?: 'full' | 'small'; /** A small decorative picture before the title (Panda in the coach chat). */ lead?: ReactNode; /** Set the (short) title in the display face. Only for titles without measures or user text. */ display?: boolean; /** A page like the chat: a round back button top left instead of ×. */ page?: boolean; /** A muted line below the title (the chat head). */ subtitle?: string }) {
  const id = useId();
  // Decided once, when it opens: is there a sheet below it?
  const [over] = useState(() => stack.length > 0);
  const back = page ? undefined : onBack ?? (over && size === 'full' ? onClose : undefined);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Escape goes one step back on a page inside the sheet; the browser's Back still closes the sheet (it owns one history entry).
  const escape = useRef(onClose);
  escape.current = onBack ?? onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!box.current?.contains(document.activeElement)) box.current?.focus(); // an autoFocus field inside keeps the focus
    // Back closes the sheet: it takes one history entry while open, and gives it back when closed by other means.
    stack.push(id);
    const release = takeEntry(id, () => close.current());
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && stack[stack.length - 1] === id) { e.stopPropagation(); escape.current(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      release();
      stack.splice(stack.indexOf(id), 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, [id]);

  return createPortal(
    <div className={`tk-screen tk-sheet${size === 'small' ? ' tk-sheet-small' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1} ref={box}>
      {size === 'small' && <div className="tk-sheet-backdrop" aria-hidden="true" onClick={onClose} />}
      <div className="tk-sheet-panel">
      <header className="tk-sheet-head">
        {page && <BackButton onClick={onBack ?? onClose} />}
        {back && <button type="button" className="link tk-sheet-back" onClick={back}>‹ Zurück</button>}
        {lead}
        {subtitle ? (
          <div className="tk-sheet-titles">
            <h2 id={`${id}-t`} className={display ? 'tk-display' : undefined}>{title}</h2>
            <p className="tk-sheet-sub">{subtitle}</p>
          </div>
        ) : <h2 id={`${id}-t`} className={display ? 'tk-display' : undefined}>{title}</h2>}
        {!back && !page && <button type="button" className="link tk-sheet-x" aria-label="Schließen" onClick={onClose}>×</button>}
      </header>
      <div className="tk-sheet-body">{children}</div>
      {actions && <footer className="tk-sheet-actions">{actions}</footer>}
      </div>
    </div>,
    document.body,
  );
}
