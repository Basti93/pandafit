import { useState } from 'react';
import { chatThread, proposalAnswer, waitingMessage } from '../../shared/chat';
import { mondayOf, planOfWeek, addDays, SPORT_LABEL } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { readStats, STATS_ID } from '../../shared/stats';
import { newestNotes } from '../../shared/change-notes';
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
import { LookBack } from './StatsScreen';
import { WaitingProposal } from './WaitingProposal';

/** Woche is the week: seven days, what changed lately, rows that open the goal, the rules and the chat with the coach, and the Rückblick. */
/** `openChat`: the page opens with the chat already open ("Bo fragen" on Heute leads straight there). */
export function CoachScreen({ port, now, newId, showPrefs = true, openChat = false }: { port: TrackingPort; now: () => number; newId: () => string; showPrefs?: boolean; openChat?: boolean }) {
  const chat = usePortRecords(port, 'chat').all;
  const plans = usePortRecords(port, 'weekplan').all;
  const changeRecs = usePortRecords(port, 'change').all;
  const ruleRecs = usePortRecords(port, 'rule').all;
  const runRecords = usePortRecords(port, 'run').all;
  const activityRecords = usePortRecords(port, 'activities').all;
  const workoutRecords = usePortRecords(port, 'workout').all;
  const statsRecords = usePortRecords(port, 'stats').all;
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'goal' | 'rules' | 'chat' | 'history' | null>(openChat ? 'chat' : null);
  const [open, setOpen] = useState(false);
  const goal = useGoal(port, now());
  // Until a goal was picked (or the coach changed it) the shown one is only the default.
  const goalChosen = (usePortRecords(port, 'goal').records ?? []).length > 0;
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
  const merged = mergedActivities(activityRecords, workoutRecords, true);
  const dayRows = doneDays(rowDates, today, spontaneous ? null : current?.days ?? null, merged);
  const newestActivity = merged.items[0];
  const recent = Object.values(fr.ratings).filter((r) => r.sports?.length).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4)
    .map((r) => `${dayName(r.date).slice(0, 2)} ${r.sports!.map((k) => SPORT_LABEL[k]).join(' + ')}`).join(' · ');

  const stats = (statsRecords ?? []).find((x) => x.id === STATS_ID && !x.deleted);
  const notes = newestNotes((stats && readStats(stats.body)?.changes) || [], 1);
  const waiting = openProposals(thread, plans ?? [], changeRecs ?? [], ruleRecs ?? [], monday).length > 0;
  const visible = thread.filter((m) => !(m.takes || m.declines || m.undoes));
  const last = visible[visible.length - 1];
  const asking = waitingMessage(thread) !== null;
  // While a proposal waits, the card above says so; the row then shows no second "waiting".
  const preview = asking ? 'Der Coach denkt nach …' : last ? <>{last.text} <small>{timeLabel(last.atMs)}</small></> : 'Schreib dem Coach';
  // Fixed order: Nächste Woche, Ziel und Planung, Was der Coach beachtet, Coach. The last change is the Coach row's second line.
  const changed = notes[0] ? <small className="tk-row-sub muted tk-clip">Zuletzt geändert: {notes[0].text}{notes[0].reason ? `, ${notes[0].reason}` : ''}</small> : null;
  const coachRow = <Row key="coach" title={<>Coach{changed}</>} value={<span className="tk-ellipsis">{preview}</span>} onClick={() => setSheet('chat')} />;
  const ruleCount = rules.length + tasks.length;
  const rest = [
    next && fr.frame.mode !== 'spontaneous' && (
      <Row key="next" title="Nächste Woche" expanded={open} onClick={() => setOpen(!open)}>
        <Week rows={planRows(next.days)} label="Wochenplan nächste Woche" runs={runs} />
      </Row>
    ),
    <Row key="goal" title="Ziel und Planung" value={<span className="tk-ellipsis">{goalChosen ? goalSummary(goal) : `Vorschlag: ${goalSummary(goal)}`}</span>} onClick={() => setSheet('goal')} />,
    <Row key="rules" title="Was der Coach beachtet" value={ruleCount === 0 ? 'nichts' : String(ruleCount)} onClick={() => setSheet('rules')} />,
  ];
  // Empty week and nothing said yet: the "Woche planen" button is the way to the coach, so no second row for it.
  // (Only once the records are read: no flash of the empty state while they load.)
  const loaded = plans !== null && chat !== null;
  const bare = loaded && !current && !spontaneous && !last && !waiting && !asking && notes.length === 0;
  const rows = bare ? rest : [...rest, coachRow];
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
          {/* Without a plan seven empty days say nothing: one button instead. */}
          {current || !loaded ? <Week rows={dayRows} label="Wochenplan diese Woche" today={today} runs={runs} /> : (
            <>
              <p className="muted">Es gibt noch keinen Wochenplan.</p>
              <button type="button" onClick={() => setSheet('chat')}>Woche planen</button>
            </>
          )}
          {!current && runs.length > 0 && (
            <ul className="tk-week" aria-label="Läufe diese Woche">
              {runs.map((r) => <li key={r.date + r.kind}><b>{runDay(r.date)}</b> <span>{runText(r)}</span></li>)}
            </ul>
          )}
        </section>
      )}
      {waiting && <WaitingProposal onOpen={() => setSheet('chat')} />}
      <RowList>{rows}</RowList>
      {error && <p role="alert" className="tk-note">{error}</p>}
      <LookBack port={port} now={now} latest={newestActivity ? `${dayName(localDayKey(newestActivity.startMs)).slice(0, 2)} · ${activityText(newestActivity)}` : undefined} onHistory={() => setSheet('history')} />
      {showPrefs && <section className="card"><CoachPrefs port={port} now={now} /></section>}
      {sheet === 'goal' && <GoalSheet port={port} now={now} onClose={() => setSheet(null)} frame={fr.frame}
        onMode={(m) => void fr.setMode(m).catch(saveFailed)} onMinutes={(m) => void fr.setMinutes(m).catch(saveFailed)} />}
      {sheet === 'rules' && <RulesSheet port={port} now={now} newId={newId} onClose={() => setSheet(null)} />}
      {sheet === 'history' && <ActivityHistory port={port} now={now} onClose={() => setSheet(null)} />}
      {sheet === 'chat' && <CoachChat port={port} now={now} newId={newId} onClose={() => setSheet(null)} />}
    </div>
  );
}
