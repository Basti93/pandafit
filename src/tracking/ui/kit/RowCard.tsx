import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * The row card with an icon tile (or a `picture` in the tile, e.g. a MealPicture): kicker, title, sub line, and "›" or a green check at the end. A button when it has `onClick`.
 * `tone` makes the title one word like a WordTile: green when calm, the accent colour for a note.
 */
export function RowCard({ icon, picture, kicker, title, sub, lead, end = 'chevron', flat = false, highlight = false, tone, onClick }: { icon?: IconName; picture?: ReactNode; kicker?: string; title: string; sub?: string; lead?: string; end?: 'chevron' | 'done' | 'none'; flat?: boolean; highlight?: boolean; tone?: 'calm' | 'note'; onClick?: () => void }) {
  const cls = `tk-rowcard${flat ? ' flat' : ''}${highlight ? ' highlight' : ''}${tone ? ` word ${tone}` : ''}`;
  const body = (
    <>
      {lead && <span className="tk-rowcard-lead">{lead}</span>}
      <span className="tk-rowcard-tile" aria-hidden="true">{picture ?? (icon && <Icon name={icon} size={24} />)}</span>
      <span className="tk-rowcard-text">
        {kicker && <span className="tk-rowcard-kicker">{kicker}</span>}
        <span className="tk-rowcard-title">{title}</span>
        {sub && <span className="tk-rowcard-sub">{sub}</span>}
      </span>
      {end === 'chevron' && <span className="tk-rowcard-end" aria-hidden="true">›</span>}
      {end === 'done' && <span className="tk-rowcard-end done" aria-hidden="true"><Icon name="haken" size={16} /></span>}
    </>
  );
  return onClick ? <button type="button" className={cls} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}

/** A tile with an icon, a small label in capitals and one word. `note` draws the word in the accent colour. */
export function WordTile({ icon, label, word, tone = 'calm' }: { icon: IconName; label: string; word: string; tone?: 'calm' | 'note' }) {
  return (
    <div className={`tk-wordtile ${tone}`}>
      <span className="tk-wordtile-icon" aria-hidden="true"><Icon name={icon} size={26} /></span>
      <span className="tk-wordtile-label">{label}</span>
      <span className="tk-wordtile-word">{word}</span>
    </div>
  );
}
