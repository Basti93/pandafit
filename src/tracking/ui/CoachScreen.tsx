import { useState } from 'react';
import { chatThread, proposalAnswer, waitingMessage } from '../../shared/chat';
import { mondayOf, planOfWeek, addDays, SPORT_LABEL } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { readStats, STATS_ID } from '../../shared/stats';
import { newestNotes } from '../../shared/change-notes';
import { dateLabel } from './labels';
import { localDayKey, timeLabel } from '../../shared/dates';
import { useTodayAdvice } from './frame-hooks';
import { CoachPrefs } from './CoachPrefs';
import { CoachChat } from './CoachChat';
import { GoalSheet, goalSummary, RulesSheet, useRuleList } from './GoalRules';
import { ActivityHistory } from './ActivityHistory';
import { activityText, doneDays, mergedActivities, planRows } from './done-days';
import { Week, dayName, runText } from './WeekList';
import { openProposals } from './chat-open';
import { useGoal, usePortRecords } from './hooks';
import { dayText as runDay, runView } from './run-view';
import { PageHead, Row, RowList } from './kit';

/** Woche is the week: seven days, what changed lately, and three rows that open the goal, the rules and the chat with the coach. */
export function CoachScreen({ port, now, newId, showPrefs = true }: { port: TrackingPort; now: () => number; newId: () => string; showPrefs?: boolean }) {
  const chat = usePortRecords(port, 'chat').all;
  const plans = usePortRecords(port, 'weekplan').all;
  const changeRecs = usePortRecords(port, 'change').all;
  const ruleRecs = usePortRecords(port, 'rule').all;
  const runRecords = usePortRecords(port, 'run').all;
  const activityRecords = usePortRecords(port, 'activities').all;
  const workoutRecords = usePortRecords(port, 'workout').all;
  const statsRecords = usePortRecords(port, 'stats').all;
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'goal' | 'rules' | 'chat' | 'history' | null>(null);
  const [open, setOpen] = useState<'changed' | 'next' | null>(null);
  const goal = useGoal(port, now());
  const { rules, tasks } = useRuleList(port, now());
  const fr = useTodayAdvice(port, now());
  const thread = chatThread(chat ?? []);

  const today = localDayKey(now());
  const monday = mondayOf(today);
  const current = planOfWeek(plans ?? [], monday);
  const next = planOfWeek(plans ?? [], addDays(monday, 7));
  // The run coach's runs sit on their days; without a week plan they are listed on their own.
  const runs = runView(runRecords ?? [], now()).week?.runs ?? [];
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Without a week plan (or in Spontan) the week still shows Monday to today, from what was done.
  const spontaneous = fr.frame.mode === 'spontaneous';
  const rowDates = current && !spontaneous ? weekDates : weekDates.filter((d) => d <= today);
  const merged = mergedActivities(activityRecords, workoutRecords);
  const dayRows = doneDays(rowDates, today, spontaneous ? null : current?.days ?? null, merged);
  const newestActivity = merged.items[0];
  const recent = Object.values(fr.ratings).filter((r) => r.sports?.length).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4)
    .map((r) => `${dayName(r.date).slice(0, 2)} ${r.sports!.map((k) => SPORT_LABEL[k]).join(' + ')}`).join(' · ');

  const stats = (statsRecords ?? []).find((x) => x.id === STATS_ID && !x.deleted);
  const notes = newestNotes((stats && readStats(stats.body)?.changes) || [], 5);
  const waiting = openProposals(thread, plans ?? [], changeRecs ?? [], ruleRecs ?? [], monday).length > 0;
  const visible = thread.filter((m) => !(m.takes || m.declines || m.undoes));
  const last = visible[visible.length - 1];
  const asking = waitingMessage(thread) !== null;
  const preview = waiting ? 'Vorschlag wartet' : asking ? 'Der Coach denkt nach …' : last ? <>{last.text} <small>{timeLabel(last.atMs)}</small></> : 'Schreib dem Coach';
  const coachRow = <Row key="coach" title="Coach" value={<span className={waiting ? 'tk-ellipsis tk-waiting' : 'tk-ellipsis'}>{preview}</span>} onClick={() => setSheet('chat')} />;
  const ruleCount = rules.length + tasks.length;
  // Keyed, so the Coach row moves to the top when a proposal waits instead of being rebuilt under the finger.
  const rest = [
    notes.length > 0 && (
      <Row key="changed" title="Zuletzt geändert" value={<span className="tk-ellipsis">{notes[0]!.text}</span>} expanded={open === 'changed'} onClick={() => setOpen(open === 'changed' ? null : 'changed')}>
        <ul className="tk-changes" aria-label="Zuletzt geändert">
          {notes.map((n, i) => <li key={`${n.atMs}-${i}`}>{dateLabel(n.atMs)} · {n.text}{n.reason ? ` – ${n.reason}` : ''}</li>)}
        </ul>
      </Row>
    ),
    next && fr.frame.mode !== 'spontaneous' && (
      <Row key="next" title="Nächste Woche" expanded={open === 'next'} onClick={() => setOpen(open === 'next' ? null : 'next')}>
        <Week rows={planRows(next.days)} label="Wochenplan nächste Woche" runs={runs} />
      </Row>
    ),
    <Row key="goal" title="Mein Ziel" value={<span className="tk-ellipsis">{goalSummary(goal)}</span>} onClick={() => setSheet('goal')} />,
    <Row key="rules" title="Regeln" value={ruleCount === 0 ? 'keine' : ruleCount === 1 ? '1 Regel' : `${ruleCount} Regeln`} onClick={() => setSheet('rules')} />,
  ];
  const rows = waiting ? [coachRow, ...rest] : [...rest, coachRow];
  const saveFailed = () => setError('Die Einstellung konnte nicht gespeichert werden.');

  return (
    <div className="tk-screen tk-coach">
      <PageHead title="Woche" />
      {fr.frame.mode === 'spontaneous' ? (
        <>
          <section className="card" aria-label="Heute">
            <h2>Heute: {fr.advice.line}</h2>
            <p className="muted">Zuletzt: {recent || 'noch nichts'}</p>
          </section>
          <section className="card" aria-label="Wochenübersicht"><Week rows={dayRows} label="Diese Woche" today={today} /></section>
        </>
      ) : (
        <section className="card" aria-label="Wochenplan">
          <Week rows={dayRows} label="Wochenplan diese Woche" today={today} runs={runs} />
          {!current && <p className="muted">Noch kein Wochenplan. Schreib dem Coach, wie deine Woche aussehen soll.</p>}
          {!current && runs.length > 0 && (
            <ul className="tk-week" aria-label="Läufe diese Woche">
              {runs.map((r) => <li key={r.date + r.kind}><b>{runDay(r.date)}</b> <span>{runText(r)}</span></li>)}
            </ul>
          )}
        </section>
      )}
      <RowList>
        <Row key="history" title="Verlauf" value={newestActivity ? <span className="tk-ellipsis">{activityText(newestActivity)}</span> : undefined} onClick={() => setSheet('history')} />
        {rows}
      </RowList>
      {error && <p role="alert" className="tk-note">{error}</p>}
      {showPrefs && <section className="card"><CoachPrefs port={port} now={now} /></section>}
      {sheet === 'goal' && <GoalSheet port={port} now={now} onClose={() => setSheet(null)} frame={fr.frame}
        onMode={(m) => void fr.setMode(m).catch(saveFailed)} onMinutes={(m) => void fr.setMinutes(m).catch(saveFailed)} />}
      {sheet === 'rules' && <RulesSheet port={port} now={now} newId={newId} onClose={() => setSheet(null)} />}
      {sheet === 'history' && <ActivityHistory port={port} now={now} onClose={() => setSheet(null)} />}
      {sheet === 'chat' && <CoachChat port={port} now={now} newId={newId} onClose={() => setSheet(null)} />}
    </div>
  );
}
