import { useState } from 'react';
import { applyGoalPatch, deleteRule, goalRecord, moveRule, rulesOf, storedGoalOf, type GoalBody, type RuleState } from '../../shared/personal';
import type { Exercise } from '../../shared/exercises';
import { familyLine } from '../../shared/families';
import type { TrackedRecord } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { dateKey } from '../../shared/day-rating';
import { DECLINE, DECLINED, TAKE, UNDO } from '../../shared/wording';

/**
 * The coach's proposal for a rule or a goal change: the text, for exclude rules what it affects, and Übernehmen / Nein danke.
 * After taking: "Gilt ab jetzt" with Rückgängig (deletes the rule). A goal change writes the goal record when taken.
 * The state lives in the `rule` record, so a reload or a second device shows the same.
 */
type Goal = Omit<GoalBody, 'atMs'>;
const same = (a: Goal, b: Goal): boolean => {
  const norm = (g: Goal) => JSON.stringify([g.strength, [...g.focus].sort(), Object.entries(g.sports).sort(([x], [y]) => (x < y ? -1 : 1)), g.push ?? 'normal', g.temporary ?? null]);
  return norm(a) === norm(b);
};
const readGoalField = (body: unknown, key: 'prior' | 'applied'): Goal | null => {
  const g = (body as Record<string, unknown> | null)?.[key];
  if (typeof g !== 'object' || g === null) return null;
  const o = g as { strength?: unknown; focus?: unknown; sports?: unknown };
  return typeof o.strength === 'string' && Array.isArray(o.focus) && typeof o.sports === 'object' && o.sports !== null ? (g as Goal) : null;
};

export function RuleCard({ port, ruleId, records, catalog, now, history }: { port: TrackingPort; ruleId: string; records: TrackedRecord[] | null; catalog: readonly Exercise[]; now: () => number; /** In the chat history: one line, no buttons except Rückgängig; a proposal still open is pinned elsewhere. */ history?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [undone, setUndone] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const rec = (records ?? []).find((r) => r.id === ruleId);
  const rule = rulesOf(records ?? []).find((r) => r.id === ruleId);
  if (!rule) return rec?.deleted ? <div className="tk-nextchange"><p className="muted">{undone ? 'Du hast das rückgängig gemacht.' : 'Die Regel ist gelöscht.'}</p></div> : null;
  const go = async (to: RuleState) => {
    try {
      const cur = (await port.list('rule')).find((r) => r.id === ruleId);
      const next = cur ? moveRule(cur, to, now()) : null;
      let stored = next;
      if (next && to === 'active' && rule.kind === 'goal' && rule.goal) {
        const goals = await port.list('goal');
        const prior = storedGoalOf(goals);
        const applied = applyGoalPatch(prior, rule.goal, dateKey(now()));
        await port.put(goalRecord(applied, now(), goals.find((g) => g.id === 'goal')));
        // The goal before and after are kept on the rule, so Rückgängig can restore it as long as nobody changed it since.
        stored = { ...next, body: { ...(next.body as object), prior, applied } };
      }
      if (stored) await port.put(stored);
      setFailed(false);
    } catch { setFailed(true); }
  };
  const undo = async () => {
    try {
      const cur = (await port.list('rule')).find((r) => r.id === ruleId);
      if (cur && rule.kind === 'goal') {
        const prior = readGoalField(cur.body, 'prior'), applied = readGoalField(cur.body, 'applied');
        const goals = await port.list('goal');
        if (!prior || !applied || !same(storedGoalOf(goals), applied)) { setBlocked(true); return; }
        await port.put(goalRecord(prior, now(), goals.find((g) => g.id === 'goal')));
      }
      if (cur) await port.put(deleteRule(cur, now()));
      setUndone(true);
      setFailed(false);
    } catch { setFailed(true); }
  };
  const family = familyLine(rule);
  const titles = [...(rule.exerciseIds ?? []).map((id) => catalog.find((e) => e.id === id)?.title ?? id), ...(family && !rule.text.toLowerCase().includes(family.toLowerCase()) ? [family] : [])];
  if (history) {
    if (rule.state === 'proposed') return null;
    const undoable = (rule.state === 'active' || rule.state === 'paused') && (rule.kind !== 'goal' || (rule.state === 'active' && !blocked && readGoalField(rec?.body, 'prior')));
    const line = rule.state === 'declined' ? DECLINED : `${rule.kind === 'goal' ? 'Ziel geändert' : rule.state === 'paused' ? 'Pausiert' : 'Übernommen'}: ${rule.text}`;
    return (
      <div className="tk-histline">
        <span className="muted">{line}</span>
        {undoable && <button type="button" className="link" onClick={() => void undo()}>{UNDO}</button>}
        {blocked && <span className="muted">Geht nicht mehr, weil das Ziel danach geändert wurde.</span>}
        {failed && <span role="status" className="tk-note">Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.</span>}
      </div>
    );
  }
  return (
    <div className="tk-nextchange">
      <p>{rule.state === 'proposed' ? (rule.kind === 'goal' ? `Neues Ziel: ${rule.text}` : `Neue Regel: ${rule.text}`) : rule.text}</p>
      {rule.kind === 'exclude' && titles.length > 0 && <p className="muted">Betrifft: {titles.join(', ')}</p>}
      {rule.state === 'proposed' && (
        <div className="tk-row">
          <button type="button" className="primary" onClick={() => void go('active')}>{TAKE}</button>
          <button type="button" className="secondary" onClick={() => void go('declined')}>{DECLINE}</button>
        </div>
      )}
      {(rule.state === 'active' || rule.state === 'paused') && (
        <div className="tk-row">
          <span className="muted">{rule.kind === 'goal' ? 'Dein Ziel ist geändert.' : rule.state === 'paused' ? 'Die Regel ist pausiert.' : 'Die Regel gilt ab jetzt.'}</span>
          {(rule.kind !== 'goal' || (rule.state === 'active' && !blocked && readGoalField(rec?.body, 'prior'))) && <button type="button" className="link" onClick={() => void undo()}>{UNDO}</button>}
        </div>
      )}
      {blocked && <p className="muted">Geht nicht mehr, weil das Ziel danach geändert wurde.</p>}
      {rule.state === 'declined' && <p className="muted">{DECLINED}.</p>}
      {failed && <p role="status" className="tk-note">Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.</p>}
    </div>
  );
}
