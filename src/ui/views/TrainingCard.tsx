import { ZoneChip } from '../hr-zone-style';
import { estimateTss } from '../../coach/session-limits';
import type { Session } from '../../shared/session';
import { WorkoutBar } from './WorkoutBar';

const fmtMin = (s: number) => `${Math.round(s / 60)} Min.`;

const effort = (session: Session): string => {
  const hard = session.steps.some((s) => (s.kind === 'erg' ? s.ftpFraction > 0.9 : s.gradePct > 7));
  const totalH = session.steps.reduce((a, s) => a + s.durationS, 0) / 3600;
  const intensity = Math.sqrt(estimateTss(session) / 100 / totalH);
  if (hard || intensity > 0.85) return 'hart';
  return intensity > 0.68 ? 'mittel' : 'locker';
};

/** The essentials at a glance: how long and how hard. */
export const SessionFacts = ({ session }: { session: Session; ftpW: number }) => {
  const totalS = session.steps.reduce((a, s) => a + s.durationS, 0);
  const grades = session.steps.flatMap((s) => (s.kind === 'grade' ? [s.gradePct] : []));
  return (
    <dl className="facts">
      <div><dt>Dauer</dt><dd>{fmtMin(totalS)}</dd></div>
      <div><dt>Anstrengung</dt><dd>{session.id === 'ramp-test' ? 'bis zum Limit' : effort(session)}</dd></div>
      {grades.length > 0 && <div><dt>Steilste Stelle</dt><dd>{Math.max(...grades).toLocaleString('de-DE')} %</dd></div>}
    </dl>
  );
};

export const StepList = ({ session, ftpW }: { session: Session; ftpW: number }) => (
  <details className="steps">
    <summary>Alle {session.steps.length} Abschnitte</summary>
    <ol>
      {session.steps.map((s, i) => (
        <li key={i}>
          <span>{s.label}</span>
          <span className="muted">{fmtMin(s.durationS)} · {s.kind === 'erg' ? `${Math.round(s.ftpFraction * ftpW)} W` : `${s.gradePct.toLocaleString('de-DE')} %`}{s.hrZone ? <> · Puls bis <ZoneChip zone={s.hrZone}>Zone {s.hrZone}</ZoneChip></> : ''}{s.kind === 'grade' && s.sudden ? ' · plötzlich' : ''}</span>
        </li>
      ))}
    </ol>
  </details>
);

export const TrainingCard = ({ session, ftpW, tag, why, selected, onPick }: { session: Session; ftpW: number; tag: string; why?: string; selected: boolean; onPick: () => void }) => (
  <article className={selected ? 'card training selected' : 'card training'}>
    <span className="tag">{tag}</span>
    <h4>{session.name}</h4>
    <WorkoutBar session={session} />
    <SessionFacts session={session} ftpW={ftpW} />
    {why && <p className="muted">{why}</p>}
    <button className="secondary" onClick={onPick}>{selected ? 'Ausgewählt' : 'Auswählen'}</button>
  </article>
);
