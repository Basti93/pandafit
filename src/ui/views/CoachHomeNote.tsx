import type { CoachHome } from '../../coach/protocol';

const hhmm = (ms: number): string => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export const MOVING_PROBLEM = {
  'other-profile': 'Dieses Konto gehört schon zu einem anderen Profil.',
  offline: 'Server nicht erreichbar. Der Umzug versucht es später wieder.',
  unreadable: 'Eine Datei konnte nicht gelesen werden. Der Umzug wartet.',
  missing: 'Dem Server fehlt noch etwas. Der Umzug versucht es später wieder.',
  'too-large': 'Eine Fahrt ist zu groß für den Server.',
  refused: 'Der Server hat den Umzug abgelehnt.',
} as const;

/** Where the coach of a moved profile runs and what is waiting. Nothing for a local profile. */
export const CoachHomeNote = ({ coachHome }: { coachHome: CoachHome }) => {
  if (coachHome.where !== 'server') return null;
  const c = coachHome;
  return (
    <div className="coach-home">
      {!c.online && <p className="notice" role="status">Server nicht erreichbar.{c.sinceMs !== null ? ` Stand von ${hhmm(c.sinceMs)}.` : ''}</p>}
      {c.session !== 'server' && <p className="muted">{c.session === 'rules' ? 'Einheit nach Regeln' : 'Gespeicherte Einheit vom Server'}</p>}
      {c.queued > 0 && <p className="muted">{c.queued} Änderungen werden gesendet, sobald der Server erreichbar ist.</p>}
      {c.full && <p className="notice" role="status">Warteschlange voll. Neue Änderungen werden erst gespeichert, wenn der Server wieder erreichbar ist.</p>}
      {c.drift && c.drift.length > 0 && <p className="muted">Ein paar Änderungen kurz vor dem Umzug sind nur auf diesem Mac.</p>}
    </div>
  );
};

/** The move's progress and problem, for the account card. */
export const MovingNote = ({ coachHome }: { coachHome: CoachHome }) => {
  if (coachHome.where !== 'moving') return null;
  return (
    <>
      <p className="muted" role="status">Umzug zum Server: {coachHome.done} von {coachHome.total}</p>
      {coachHome.problem && <p className="notice" role="status">{MOVING_PROBLEM[coachHome.problem]}</p>}
    </>
  );
};
