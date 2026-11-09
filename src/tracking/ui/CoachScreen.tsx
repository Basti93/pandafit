import { useState } from 'react';
import { chatThread, waitingMessage } from '../../shared/chat';
import { localDayKey } from '../../shared/dates';
import { BO } from '../../shared/bo';
import type { TrackingPort } from '../ports';
import { useWeekDays } from './week-days';
import { CoachChat } from './CoachChat';
import { GoalSheet, goalSentence, RulesSheet } from './GoalRules';
import { ActivityHistory } from './ActivityHistory';
import { activityText, mergedActivities, planRows, type DayRow } from './done-days';
import { Week, dayName, runText } from './WeekList';
import { useGoal, usePortRecords } from './hooks';
import { planDayLabel } from './plan-text';
import { Card, BoBubble, Icon, PageHead, RowCard, Sheet, WeekPath } from './kit';
import { BO_LINES } from './bo';
import { LookBack } from './StatsScreen';
import { HealthCard, HealthPage } from './HealthPage';
import { healthOf } from './health-view';
import { DaySheet } from './DaySheet';
import { ProposalsSheet } from './ProposalCard';
import { useOpenProposals } from './proposals';
import { KIND_ICON, SPORT_ICON, restDaysText, weekCount, weekCountText, weekPathOf, weekRangeText, weekSentence } from './week-path';
import { TogetherPage, togetherOf } from './TogetherScreen';

const isRest = (r: DayRow): boolean => r.plan !== null && r.plan.sport === 'rest' && !r.plan.also;

/** Woche is the week: the week card, the days (Erledigt, Heute, Kommt noch), health, Bo's bubble and three quiet tiles. */
/** `openChat`: the page opens with the chat already open ("Bo fragen" on Heute leads straight there). */
export function CoachScreen({ port, now, newId, openChat = false }: { port: TrackingPort; now: () => number; newId: () => string; openChat?: boolean }) {
  const chat = usePortRecords(port, 'chat').all;
  const activityRecords = usePortRecords(port, 'activities').all;
  const workoutRecords = usePortRecords(port, 'workout').all;
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'goal' | 'rules' | 'chat' | 'history' | 'look' | 'proposals' | 'next' | null>(openChat ? 'chat' : null);
  const [dayDate, setDayDate] = useState<string | null>(null);
  const [page, setPage] = useState<'week' | 'health' | 'together'>('week');
  const health = healthOf(usePortRecords(port, 'health').records);
  const together = togetherOf(usePortRecords(port, 'together').records);
  const goal = useGoal(port, now());
  // Until a goal was picked (or the coach changed it) the shown one is only the default.
  const goalChosen = (usePortRecords(port, 'goal').records ?? []).length > 0;
  const thread = chatThread(chat ?? []);
  const proposals = useOpenProposals(port, now());

  const week = useWeekDays(port, now());
  const { today, monday, rows: dayRows, current, next, runs, spontaneous, frame: fr, loaded } = week;
  const merged = mergedActivities(activityRecords, workoutRecords, true);
  const newestActivity = merged.items[0];
  const asking = waitingMessage(thread) !== null;
  const saveFailed = () => setError('Die Einstellung konnte nicht gespeichert werden.');

  if (page === 'health' && health) return <HealthPage health={health} onBack={() => setPage('week')} />;
  if (page === 'together' && together) return <TogetherPage t={together} now={now()} onBack={() => setPage('week')} />;

  const path = weekPathOf(week.dates, dayRows, today);
  const count = weekCountText(weekCount(dayRows, current && !spontaneous ? current.days : null));
  const noPlan = !current && !spontaneous;

  // The days: Erledigt (past days with something done), Heute, Kommt noch. Rest days before today stay in the week path only.
  const runsOn = (date: string) => runs.filter((r) => r.date === date);
  const planTitle = (r: DayRow): string => {
    const own = r.plan!.sport === 'run' ? runsOn(r.date) : [];
    return own.length > 0 ? own.map(runText).join(' · ') : planDayLabel(r.plan!);
  };
  const extraRuns = (r: DayRow): string | undefined => {
    const list = r.plan && r.plan.sport === 'run' ? [] : runsOn(r.date);
    return list.length > 0 ? list.map(runText).join(' · ') : undefined;
  };
  const doneRows = dayRows.filter((r) => r.date < today && r.done.length > 0);
  const todayRow = dayRows.find((r) => r.date === today);
  const todayDone = todayRow && todayRow.done.length > 0;
  const todayOpen = todayRow?.plan ?? null;
  const coming = current && !spontaneous ? dayRows.filter((r) => r.date > today && r.plan && !isRest(r)) : [];
  const comingRuns = noPlan ? runs.filter((r) => r.date >= today) : [];
  const rest = current && !spontaneous ? restDaysText(dayRows, today) : null;
  const showToday = !!todayRow && (todayDone || todayOpen !== null);
  const anyDays = doneRows.length > 0 || showToday || coming.length > 0 || comingRuns.length > 0;
  const open = (date: string) => () => setDayDate(date);

  // Bo's bubble: the first line that fits. The main button is the next step, the secondary one always opens the chat.
  const main = asking ? null : proposals.length > 0 ? { label: 'Vorschlag ansehen', to: 'proposals' as const } : loaded && noPlan ? { label: 'Woche planen', to: 'chat' as const } : null;
  const boText = asking ? BO_LINES.thinking : proposals.length > 0 ? BO_LINES.proposal : loaded && noPlan ? BO_LINES.weekEmpty : BO_LINES.weekCalm;
  const boActions = (
    <>
      {main && <button key="main" type="button" className="primary" onClick={() => setSheet(main.to)}>{main.label}</button>}
      <button key="ask" type="button" className="secondary" onClick={() => setSheet('chat')}>{BO.ask}</button>
    </>
  );

  return (
    <div className="tk-screen tk-coach">
      <PageHead title="Deine Woche" />
      <Card label="Diese Woche">
        {loaded && <WeekPath days={path} kicker={weekRangeText(monday)} count={count} onPick={setDayDate} />}
        <p className="tk-weeksentence">
          {spontaneous ? `Heute: ${fr.advice.line}` : current ? weekSentence(dayRows, today) : loaded ? 'Für diese Woche gibt es noch keinen Plan.' : ''}
        </p>
        <div className="tk-weekgoal">
          <span className="tk-weekgoal-icon" aria-hidden="true"><Icon name="ziel" size={22} /></span>
          <p><b>Dein Ziel:</b> {goalSentence(goal)}{!goalChosen && <> <span className="muted">Das ist ein Vorschlag.</span></>}</p>
          <button type="button" className="tk-roundbtn" aria-label="Ziel und Planung" onClick={() => setSheet('goal')}><Icon name="stift" size={20} /></button>
        </div>
      </Card>
      {loaded && anyDays && (
        <Card label="Tage">
          {doneRows.length > 0 && (
            <div className="tk-daysection">
              <h3 className="tk-section">Erledigt</h3>
              {doneRows.map((r) => <RowCard key={r.date} flat lead={dayName(r.date).slice(0, 2)} icon={KIND_ICON[r.kinds[0] ?? 'andere']} title={r.done.join(' + ')} end="done" onClick={open(r.date)} />)}
            </div>
          )}
          {showToday && (
            <div className="tk-daysection">
              <h3 className="tk-section">Heute</h3>
              {todayDone && <RowCard flat highlight={!todayOpen} lead={dayName(today).slice(0, 2)} icon={KIND_ICON[todayRow!.kinds[0] ?? 'andere']} title={todayRow!.done.join(' + ')} end="done" onClick={open(today)} />}
              {todayOpen && <RowCard flat highlight lead={todayDone ? undefined : dayName(today).slice(0, 2)} icon={SPORT_ICON[todayOpen.sport]} title={isRest(todayRow!) ? 'Ruhetag' : planTitle(todayRow!)} sub={extraRuns(todayRow!)} onClick={open(today)} />}
            </div>
          )}
          {(coming.length > 0 || comingRuns.length > 0) && (
            <div className="tk-daysection">
              <h3 className="tk-section tk-daysection-head"><span>Kommt noch</span>{rest && <span className="muted tk-small">{rest}</span>}</h3>
              {coming.map((r) => <RowCard key={r.date} flat lead={dayName(r.date).slice(0, 2)} icon={SPORT_ICON[r.plan!.sport]} title={planTitle(r)} sub={extraRuns(r)} onClick={open(r.date)} />)}
              {comingRuns.map((r) => <RowCard key={r.date + r.kind} flat lead={dayName(r.date).slice(0, 2)} icon="lauf" title={runText(r)} onClick={open(r.date)} />)}
            </div>
          )}
          {next && !spontaneous && <RowCard flat icon="woche" title="Nächste Woche" onClick={() => setSheet('next')} />}
        </Card>
      )}
      {loaded && !anyDays && next && !spontaneous && <RowCard icon="woche" title="Nächste Woche" onClick={() => setSheet('next')} />}
      {health && <HealthCard health={health} onOpen={() => setPage('health')} />}
      <BoBubble portrait="mini" actions={boActions}>{boText}</BoBubble>
      {error && <p role="alert" className="tk-note">{error}</p>}
      <div className="tk-tiles">
        <RowCard icon="rueckblick" title="Rückblick" end="none" onClick={() => setSheet('look')} />
        <RowCard icon="regeln" title="Was Bo beachtet" end="none" onClick={() => setSheet('rules')} />
        {together && <RowCard icon="ausdauer" title="Gemeinsam" end="none" onClick={() => setPage('together')} />}
      </div>
      {dayDate && <DaySheet port={port} date={dayDate} now={now} onClose={() => setDayDate(null)} />}
      {sheet === 'next' && next && (
        <Sheet size="small" title="Nächste Woche" onClose={() => setSheet(null)}>
          <Week rows={planRows(next.days)} label="Wochenplan nächste Woche" runs={runs} />
        </Sheet>
      )}
      {sheet === 'goal' && <GoalSheet port={port} now={now} onClose={() => setSheet(null)} frame={fr.frame}
        onMode={(m) => void fr.setMode(m).catch(saveFailed)} onMinutes={(m) => void fr.setMinutes(m).catch(saveFailed)} />}
      {sheet === 'rules' && <RulesSheet port={port} now={now} newId={newId} onClose={() => setSheet(null)} />}
      {(sheet === 'look' || sheet === 'history') && (
        <Sheet title="Rückblick" onClose={() => setSheet(null)}>
          <LookBack port={port} now={now} latest={newestActivity ? `${dayName(localDayKey(newestActivity.startMs)).slice(0, 2)} · ${activityText(newestActivity)}` : undefined} onHistory={() => setSheet('history')} />
        </Sheet>
      )}
      {sheet === 'history' && <ActivityHistory port={port} now={now} onClose={() => setSheet('look')} />}
      {sheet === 'proposals' && <ProposalsSheet port={port} now={now} newId={newId} entries={proposals} onClose={() => setSheet(null)} />}
      {sheet === 'chat' && <CoachChat port={port} now={now} newId={newId} onClose={() => setSheet(null)} />}
    </div>
  );
}
