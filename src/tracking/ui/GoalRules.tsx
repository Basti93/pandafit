import { useState } from 'react';
import { deleteRule, excludeRuleRecord, FOCUS_GROUPS, goalRecord, MAX_FOCUS, moveRule, ruleId, ruleRecord, RULE_TEXT_MAX, rulesOf, storedGoalOf, type GoalBody, type Prio, type SportKey, type Strength } from '../../shared/personal';
import { MUSCLE_TARGETS } from '../../shared/muscle-targets';
import { addDays, SPORT_LABEL } from '../../shared/week-plan';
import { dateKey } from '../../shared/day-rating';
import { shortDateOfKey as dayLabel } from '../../shared/dates';
import { type COACH_LABEL, deleteTask, openTasks } from '../../shared/tasks';
import type { TrackedRecord } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { familyLabel, familyLine, familyOf } from '../../shared/families';
import type { Exercise } from '../../shared/exercises';
import { ExercisePicker } from './ExercisePicker';
import { ChoiceRow, ConfirmLink, ExpandMark, Row, RowList, Sheet } from './kit';
import { minuteChoices, type Frame } from '../../shared/frame';
import { finishedWorkouts, useCatalog, useGoal, usePortRecords } from './hooks';
import { usedSports } from './used-sports';
import { readStats } from '../../shared/stats';
import { ruleNumber } from '../../shared/training-policy';
import type { RunWeekBody } from '../../shared/run';

export const STRENGTH_LABEL: Record<Strength, string> = { muscle: 'Muskeln aufbauen', strength: 'Kraft steigern', fitness: 'Fit bleiben' };
const PRIO_LABEL: Record<Prio, string> = { focus: 'Hauptsache', equal: 'normal', keep: 'nebenbei' };
// With no activity at all the card shows all three sports; otherwise the used ones, the others behind a toggle.
const SPORTS: SportKey[] = ['gym', 'bike', 'run'];

const WEEK_CHOICES = [0, 2, 4, 6, 8];
const focusLabel = (focus: readonly string[]): string => focus.map((g) => MUSCLE_TARGETS[g as (typeof FOCUS_GROUPS)[number]]?.label ?? g).join(', ');

/** The exercise titles of an exclude rule that its text does not already name; '' when there is nothing to add. */
export const excludedTitles = (r: { text: string; exerciseIds?: string[]; families?: string[] }, catalog: readonly { id: string; title: string }[]): string => {
  const titles = (r.exerciseIds ?? []).flatMap((id) => { const t = catalog.find((e) => e.id === id)?.title; return t ? [t] : []; });
  const text = r.text.toLowerCase();
  const family = familyLine(r);
  return [...titles.filter((t) => !text.includes(t.toLowerCase())), ...(family && !text.includes(family.toLowerCase()) ? [family] : [])].join(', ');
};

/** "Muskeln aufbauen · Rücken": the value of the goal row. */
export function goalSummary(goal: { strength: Strength; focus: readonly string[] }): string {
  return [STRENGTH_LABEL[goal.strength], ...(goal.focus.length ? [focusLabel(goal.focus)] : [])].join(' · ');
}

const GOAL_SENTENCE: Record<Strength, string> = { muscle: 'Du baust Muskeln auf', strength: 'Du wirst stärker', fitness: 'Du bleibst fit' };

/** The goal as a sentence for Woche: "Du baust Muskeln auf, vor allem Rücken und Schultern." */
export function goalSentence(goal: { strength: Strength; focus: readonly string[] }): string {
  const groups = focusLabel(goal.focus).split(', ').filter(Boolean);
  const named = groups.length > 1 ? `${groups.slice(0, -1).join(', ')} und ${groups[groups.length - 1]}` : groups[0];
  return `${GOAL_SENTENCE[goal.strength]}${named ? `, vor allem ${named}` : ''}.`;
}

/** The rules the person keeps and what was passed on to the coaches and is still open. Proposed and declined rules and goal proposals stay out. */
export function useRuleList(port: TrackingPort, nowMs: number) {
  const rules = rulesOf(usePortRecords(port, 'rule').all ?? []).filter((r) => (r.state === 'active' || r.state === 'paused') && r.kind !== 'goal');
  const tasks = openTasks(usePortRecords(port, 'task').all ?? [], nowMs);
  return { rules, tasks };
}

/** The open complaints the coaches take into account ("Schulter"): shown as the first muted line of the Regeln sheet. */
export function useComplaints(port: TrackingPort): string[] {
  return (usePortRecords(port, 'complaint').all ?? []).flatMap((r) => {
    const b = r.body as { text?: unknown; status?: unknown } | null;
    return !r.deleted && b && typeof b.text === 'string' && b.status !== 'over' ? [b.text] : [];
  });
}

const FOR_LABEL: Record<keyof typeof COACH_LABEL, string> = { bike: 'Rad', gym: 'Kraft', run: 'Laufen' };
const sportOf = (s: string): string => (s === 'all' ? 'Alle Sportarten' : FOR_LABEL[s as keyof typeof FOR_LABEL] ?? 'Alle Sportarten');

const attemptWith = (setError: (e: string | null) => void) => async (f: () => Promise<unknown>) => {
  try { await f(); setError(null); } catch { setError('Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.'); }
};

/** The goal: what the training is for, the focus muscles (for good or for some weeks), sport priorities, and how the week is planned. Every write is stamped above what is stored. */
export function GoalSheet({ port, now, onClose, frame, onMode, onMinutes }: {
  port: TrackingPort; now: () => number; onClose: () => void;
  frame: Frame; onMode: (m: Frame['mode']) => void; onMinutes: (m: number | null) => void;
}) {
  const goal = useGoal(port, now());
  const stored = storedGoalOf(usePortRecords(port, 'goal').all ?? []);
  const today = dateKey(now());
  const [weeks, setWeeks] = useState(0);
  // Only the sports the person has used lately; one with a priority set always stays.
  const workouts = finishedWorkouts(usePortRecords(port, 'workout').records);
  const runWeeks = (usePortRecords(port, 'run').records ?? []).map((r) => r.body as RunWeekBody).filter((b) => b && b.type === 'week' && Array.isArray(b.runs));
  const statsRecord = (usePortRecords(port, 'stats').records ?? []).find((r) => r.id === 'stats');
  const used = usedSports(workouts, runWeeks, (statsRecord ? readStats(statsRecord.body)?.days : undefined) ?? [], today, ruleNumber('goal.used-sports-days'));
  const [moreSports, setMoreSports] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = attemptWith(setError);

  const saveGoal = (g: Omit<GoalBody, 'atMs'>) => attempt(async () => {
    const have = (await port.list('goal')).find((r) => r.id === 'goal');
    await port.put(goalRecord(g, now(), have));
  });
  const toggleFocus = (g: (typeof FOCUS_GROUPS)[number]) => {
    const on = goal.focus.includes(g);
    if (!on && goal.focus.length >= MAX_FOCUS) return;
    const focus = on ? goal.focus.filter((x) => x !== g) : [...goal.focus, g];
    const { temporary, ...base } = stored;
    if (goal.temporary && temporary) {
      // An active temporary focus is what is being edited; its end stays as it is.
      void saveGoal({ ...base, temporary: { ...temporary, focus } });
    } else if (weeks > 0) {
      // A time limit lies over the base goal and never changes it.
      void saveGoal({ ...stored, temporary: { focus, until: addDays(today, weeks * 7) } });
    } else {
      void saveGoal({ ...stored, focus });
    }
  };
  const setPrio = (s: SportKey, v: string) => {
    const { temporary, ...base } = stored;
    if (goal.temporary && temporary) {
      const sports = { ...temporary.sports };
      if (v === '') delete sports[s]; else sports[s] = v as Prio;
      const { sports: _old, ...rest } = temporary;
      const hasSports = Object.keys(sports).length > 0;
      void saveGoal({ ...base, ...(rest.focus !== undefined || hasSports ? { temporary: hasSports ? { ...rest, sports } : rest } : {}) });
      return;
    }
    const sports = { ...stored.sports };
    if (v === '') delete sports[s]; else sports[s] = v as Prio;
    void saveGoal({ ...stored, sports });
  };
  // The person picks a new duration for the running temporary focus.
  const pickWeeks = (w: number) => {
    setWeeks(w);
    const { temporary, ...base } = stored;
    if (w > 0 && goal.temporary && temporary) void saveGoal({ ...base, temporary: { ...temporary, until: addDays(today, w * 7) } });
  };
  const endTemporary = () => {
    const { temporary: _t, ...base } = stored;
    void saveGoal(base);
  };

  const shown = (s: SportKey): boolean => used.size === 0 || used.has(s) || goal.sports[s] !== undefined;
  const PRIO_OPTIONS = [{ value: '', label: '–' }, ...(Object.keys(PRIO_LABEL) as Prio[]).map((p) => ({ value: p as string, label: PRIO_LABEL[p] }))];
  const sportChoice = (s: SportKey) => <ChoiceRow key={s} label={SPORT_LABEL[s]} value={goal.sports[s] ?? ''} options={PRIO_OPTIONS} onChange={(v) => setPrio(s, v)} />;
  const focusText = goal.focus.length ? focusLabel(goal.focus) : 'keiner';

  return (
    <Sheet title="Ziel und Planung" onClose={onClose}>
      <ChoiceRow label="Ziel" value={goal.strength} options={(Object.keys(STRENGTH_LABEL) as Strength[]).map((s) => ({ value: s, label: STRENGTH_LABEL[s] }))}
        onChange={(strength) => void saveGoal({ ...stored, strength })} />
      {goal.ended && (
        <div className="tk-row">
          <span className="muted">{goal.ended.focus.length ? `Dein Fokus auf ${focusLabel(goal.ended.focus)}` : 'Dein befristeter Fokus'} ist am {dayLabel(goal.ended.until)} ausgelaufen. Jetzt gilt wieder dein Grundziel.</span>
          <button type="button" className="link tk-small" onClick={() => void attempt(async () => {
            const have = (await port.list('goal')).find((r) => r.id === 'goal');
            const cur = storedGoalOf(have ? [have] : []);
            if (cur.temporary) await port.put(goalRecord({ ...cur, temporary: { ...cur.temporary, endedSeenMs: now() } }, now(), have));
          })}>OK</button>
        </div>
      )}
      <button type="button" className="tk-rowbtn tk-choice" aria-expanded={focusOpen} onClick={() => setFocusOpen(!focusOpen)}>
        <span className="tk-row-title">Muskeln im Fokus</span>
        <span className="tk-row-value muted">{`${focusText}${goal.temporary?.focus && goal.focus.length ? ` bis ${dayLabel(goal.temporary.until)}` : ''}`}</span>
        <ExpandMark open={focusOpen} />
      </button>
      {focusOpen && (
        <>
          <div className="tk-chips" role="group" aria-label={`Muskeln im Fokus, bis zu ${MAX_FOCUS}`}>
            {FOCUS_GROUPS.map((g) => {
              const on = goal.focus.includes(g);
              return <button key={g} type="button" aria-pressed={on} disabled={!on && goal.focus.length >= MAX_FOCUS} onClick={() => toggleFocus(g)}>{MUSCLE_TARGETS[g].label}</button>;
            })}
          </div>
          <ChoiceRow label="Dauer" value={weeks} options={WEEK_CHOICES.map((w) => ({ value: w, label: w === 0 ? 'unbefristet' : `${w} Wochen` }))} onChange={pickWeeks} />
          {goal.temporary && <button type="button" className="link tk-small" onClick={endTemporary}>Jetzt beenden</button>}
        </>
      )}
      <h3 className="tk-section">Sportarten</h3>
      <p className="muted tk-sheet-note">Wie wichtig ist dir jede Sportart?</p>
      {SPORTS.filter(shown).map(sportChoice)}
      {SPORTS.some((s) => !shown(s)) && !moreSports && <button type="button" className="link tk-small" aria-expanded={moreSports} onClick={() => setMoreSports(true)}>Weitere Sportarten</button>}
      {moreSports && SPORTS.filter((s) => !shown(s)).map(sportChoice)}
      <h3 className="tk-section">Planung</h3>
      <p className="muted tk-sheet-note">Feste Woche: Bo plant die ganze Woche im Voraus. Spontan: er schlägt jeden Tag neu vor.</p>
      <ChoiceRow label="Wochenplan" value={frame.mode} options={[{ value: 'week', label: 'Feste Woche' }, { value: 'spontaneous', label: 'Spontan' }]} onChange={onMode} />
      <ChoiceRow label="Zeit pro Einheit" value={frame.minutes ?? 0} options={[{ value: 0, label: '–' }, ...minuteChoices().map((m) => ({ value: m, label: `${m} Min` }))]} onChange={(m) => onMinutes(m === 0 ? null : m)} />
      {error && <p role="alert" className="tk-note">{error}</p>}
      <div className="tk-scroll-pad" aria-hidden="true" />
    </Sheet>
  );
}

/** The rules and the requests passed on to other coaches, one list. A row opens to Pausieren / Fortsetzen and Löschen. */
export function RulesSheet({ port, now, newId, onClose }: { port: TrackingPort; now: () => number; newId: () => string; onClose: () => void }) {
  const catalog = useCatalog(port);
  const { rules, tasks } = useRuleList(port, now());
  const complaints = useComplaints(port);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Exercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = attemptWith(setError);
  const toggle = (id: string) => setOpen(open === id ? null : id);

  const current = async (id: string): Promise<TrackedRecord | undefined> => (await port.list('rule')).find((r) => r.id === id);
  const move = (id: string, to: 'active' | 'paused') => attempt(async () => {
    const cur = await current(id);
    const next = cur ? moveRule(cur, to, now()) : null;
    if (next) await port.put(next);
  });
  const remove = (id: string) => attempt(async () => {
    const cur = await current(id);
    if (cur) await port.put(deleteRule(cur, now()));
  });
  const removeTask = (id: string) => attempt(async () => {
    const cur = (await port.list('task')).find((r) => r.id === id);
    if (cur) await port.put(deleteTask(cur, now()));
  });
  const addWish = () => {
    const t = text.trim().slice(0, RULE_TEXT_MAX);
    if (!t) return;
    void attempt(async () => { await port.put(ruleRecord(ruleId(newId()), { kind: 'wish', text: t, sport: 'all' }, 'active', 'person', now())); setText(''); setAdding(false); });
  };
  const pick = (e: Exercise) => { setPicking(false); setChosen(catalog.find((c) => c.id === e.id) ?? e); };
  const exclude = (e: { id: string; title: string }, wholeFamily?: string) => {
    setChosen(null);
    void attempt(() => port.put(excludeRuleRecord(e, wholeFamily, newId(), now())));
  };

  const active = rules.filter((r) => r.state !== 'paused');
  const paused = rules.filter((r) => r.state === 'paused');
  const ruleRow = (r: (typeof rules)[number]) => {
    const what = r.kind === 'exclude' ? excludedTitles(r, catalog) : '';
    return (
      <Row key={r.id} title={<><span className={r.state === 'paused' ? 'muted' : undefined}>{r.text}</span><small className="tk-row-sub muted">{sportOf(r.sport)} · {r.state === 'paused' ? 'pausiert' : 'aktiv'}</small></>} expanded={open === r.id} onClick={() => toggle(r.id)}>
        {what && <p className="muted">{what}</p>}
        <div className="tk-row">
          <button type="button" className="secondary" aria-label={`${r.state === 'paused' ? 'Fortsetzen' : 'Pausieren'} ${r.text}`} onClick={() => void move(r.id, r.state === 'paused' ? 'active' : 'paused')}>{r.state === 'paused' ? 'Fortsetzen' : 'Pausieren'}</button>
          <ConfirmLink label="Löschen" onConfirm={() => void remove(r.id)} />
        </div>
      </Row>
    );
  };

  return (
    <Sheet title="Was Bo beachtet" onClose={onClose}>
      {rules.length === 0 && tasks.length === 0 && complaints.length === 0 ? <p className="muted">Noch keine Regeln. Schreib Bo „künftig …“ oder füge eine hinzu.</p> : (
        <RowList label="Regeln">
          {complaints.length > 0 && <Row title="Rücksicht" value={<span className="tk-ellipsis">{complaints.join(', ')}</span>} />}
          {active.map(ruleRow)}
          {tasks.map((t) => (
            <Row key={t.id} title={<>{t.text}<small className="tk-row-sub muted">{sportOf(t.to)} · aktiv</small></>} expanded={open === t.id} onClick={() => toggle(t.id)}>
              <p className="muted">{t.lasting ? 'dauerhaft' : t.forDate ? `bis ${dayLabel(t.forDate)}` : 'bis zur nächsten Einheit'}</p>
              <div className="tk-row"><ConfirmLink label="Entfernen" question="Wirklich entfernen?" onConfirm={() => void removeTask(t.id)} /></div>
            </Row>
          ))}
        </RowList>
      )}
      {paused.length > 0 && (
        <>
          <h3 className="tk-section">Pausiert</h3>
          <RowList label="Pausiert">{paused.map(ruleRow)}</RowList>
        </>
      )}
      {adding ? (
        <form className="tk-row" onSubmit={(e) => { e.preventDefault(); addWish(); }}>
          <input aria-label="Neue Regel" autoFocus value={text} maxLength={RULE_TEXT_MAX} placeholder="Neue Regel oder Wunsch" onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim()}>Speichern</button>
        </form>
      ) : (
        <>
          <button type="button" className="secondary" onClick={() => setAddMenu(true)}>+ Regel hinzufügen</button>
          <p className="muted tk-sheet-note">oder schreib sie Bo</p>
        </>
      )}
      {addMenu && (
        <Sheet size="small" title="Regel hinzufügen" onClose={() => setAddMenu(false)}>
          <RowList>
            <Row title="Regel schreiben" onClick={() => { setAddMenu(false); setAdding(true); }} />
            <Row title="Übung ausschließen" onClick={() => { setAddMenu(false); setPicking(true); }} />
          </RowList>
        </Sheet>
      )}
      {error && <p role="alert" className="tk-note">{error}</p>}
      {picking && <ExercisePicker port={port} title="Übung ausschließen" onPick={pick} onClose={() => setPicking(false)} now={now} newId={newId} />}
      {chosen && (
        <div className="tk-row" role="group" aria-label={`${chosen.title} ausschließen`}>
          <button type="button" className="secondary" onClick={() => exclude(chosen)}>Nur diese Übung</button>
          {familyOf(chosen) !== 'other' && <button type="button" className="secondary" onClick={() => exclude(chosen, familyOf(chosen))}>Alle Varianten ({familyLabel(familyOf(chosen))})</button>}
          <button type="button" className="link" onClick={() => setChosen(null)}>Abbrechen</button>
        </div>
      )}
    </Sheet>
  );
}
