import type { ReactNode } from 'react';
import type { ChatEntry } from '../../shared/chat';
import { timeLabel } from '../../shared/dates';
import { Bubble, BoBubble } from './kit';

/** One message of a chat with Bo: Bo speaks left with his still picture, you speak right; the time sits under the text. What hangs on it (a change, a rule, a plan) comes as children. */
export function ChatBubble({ m, children }: { m: ChatEntry; children?: ReactNode }) {
  const foot = <time>{timeLabel(m.atMs)}</time>;
  const body = (
    <>
      <p className="tk-msgtext">{m.text}</p>
      {children}
    </>
  );
  return m.role === 'rider'
    ? <Bubble tail="right" foot={foot}>{body}</Bubble>
    : <BoBubble portrait="mini" foot={foot}>{body}</BoBubble>;
}

/** "Bo denkt nach …" and its slower variants as a message from Bo, with three quiet dots. */
export function ChatNote({ children }: { children: ReactNode }) {
  return (
    <div role="status">
      <BoBubble portrait="mini"><p className="tk-msgtext muted tk-noteline"><span className="tk-typing" aria-hidden="true"><i /><i /><i /></span>{children}</p></BoBubble>
    </div>
  );
}
