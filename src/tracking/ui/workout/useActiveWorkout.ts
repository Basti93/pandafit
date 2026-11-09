import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { bodyOf } from '../../../shared/record-bodies';
import type { LoggedWorkout } from '../../../shared/records';
import { readStats, STATS_ID } from '../../../shared/stats';
import { loadStepOverrides } from '../../../shared/loads';
import { knownStudios, studioStateOf } from '../../../shared/studio';
import type { TrackingPort } from '../../ports';
import { currentSet, restRemainingS, type FinishChoice, type TrackedWorkout } from '../../session';
import { closeStore, releaseStore } from '../../registry';
import { hereKey, stepChange } from '../../steps';
import { useCatalog, useExcluded, usePortRecords, useStoreView, useTick, useWakeLock, type WorkoutStore } from '../hooks';
import { effortQuestionsOn } from '../EffortQuestion';
import type { DragStart } from '../ReorderSheet';
import { markUsed } from './markUsed';
import { useHold } from './useHold';
import { useLatest } from './useLatest';

export type Picker = { mode: 'add' } | { mode: 'swap'; ex: string } | null;
export type Ask = { question: 'nothing-confirmed' } | { question: 'open-sets'; open: number } | null;

export type UiState = {
  picker: Picker; ask: Ask;
  /** The exercise whose menu is open, and whether it shows the "Mehr" half. */
  menu: string | null; menuMore: boolean;
  topMenu: boolean; studioOpen: boolean; coachAsk: number;
  reorder: DragStart | null; editing: string | null;
  notesOpen: ReadonlySet<string>; info: ReadonlySet<string>;
  notice: string | null; effortOn: boolean;
  /** Only the current exercise is open; tapping another opens it and closes the previous one. The open one follows the next open set. */
  openRid: string | null;
};

type Action = { t: 'set'; patch: Partial<UiState> } | { t: 'toggleNote'; rid: string } | { t: 'toggleInfo'; rid: string } | { t: 'askCoach' };

const toggled = (s: ReadonlySet<string>, rid: string): ReadonlySet<string> => { const n = new Set(s); if (!n.delete(rid)) n.add(rid); return n; };

export function uiReducer(s: UiState, a: Action): UiState {
  switch (a.t) {
    case 'set': return { ...s, ...a.patch };
    case 'toggleNote': return { ...s, notesOpen: toggled(s.notesOpen, a.rid) };
    case 'toggleInfo': return { ...s, info: toggled(s.info, a.rid) };
    case 'askCoach': return { ...s, coachAsk: s.coachAsk + 1 };
  }
}

export const FINISHED_MSG = 'Training gespeichert.';
export const NOT_SAVED = 'Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.';

export type ActiveWorkoutProps = {
  port: TrackingPort; store: WorkoutStore; history: LoggedWorkout[]; now: () => number; newId: () => string; autoEnd: boolean; startNotice?: string | null; onLeave: (message: string, finishedId?: string) => void;
};

/** All state, derived data, effects and actions of the running workout screen; the components only draw it. */
export function useActiveWorkout({ port, store, history, now, newId, autoEnd, startNotice, onLeave }: ActiveWorkoutProps) {
  const { workout: w, save } = useStoreView(store);
  const current = currentSet(w);
  const currentRid = current?.ex ?? null;
  const [ui, dispatch] = useReducer(uiReducer, undefined, (): UiState => ({
    picker: null, ask: null, menu: null, menuMore: false, topMenu: false, studioOpen: false, coachAsk: 0, reorder: null, editing: null,
    notesOpen: new Set(), info: new Set(), notice: startNotice ?? null, effortOn: effortQuestionsOn(), openRid: currentRid,
  }));
  const set = useCallback((patch: Partial<UiState>) => dispatch({ t: 'set', patch }), []);
  const toggleNote = useCallback((rid: string) => dispatch({ t: 'toggleNote', rid }), []);
  const toggleInfo = useCallback((rid: string) => dispatch({ t: 'toggleInfo', rid }), []);
  const askCoach = useCallback(() => dispatch({ t: 'askCoach' }), []);
  const setNotice = useCallback((notice: string | null) => dispatch({ t: 'set', patch: { notice } }), []);
  const { holdProps, held } = useHold((reorder) => set({ reorder }));

  const ending = useRef(false);
  const leaving = useRef(false);
  const pendingLeave = useRef<string | null>(null);
  const latest = useLatest({ w, now, onLeave });

  const remoteQ = usePortRecords(port, 'workout');
  const remote = remoteQ.all;
  // A list shared with other screens may be older than this workout's first save: only an answer read after the mount counts.
  const mountList = useRef(remote);
  const reloadRef = useLatest(remoteQ.reload);
  useEffect(() => { reloadRef.current(); }, [reloadRef]);

  const catalog = useCatalog(port);
  const excluded = useExcluded(port);
  const statsRecords = usePortRecords(port, 'stats').records;
  const loadSteps = usePortRecords(port, 'loadstep').records;
  const studioRecords = usePortRecords(port, 'studio').records;
  const studios = useMemo(() => studioStateOf(studioRecords ?? []), [studioRecords]);
  const overrides = useMemo(() => loadStepOverrides(loadSteps ?? [], studios.renames), [loadSteps, studios]);
  const studioHere = hereKey(w, [...history], studios);
  const chooseStep = (exerciseId: string, stepKg: number | null) => {
    void port.list('loadstep').then((stored) => port.put(stepChange(stored, exerciseId, studioHere, stepKg, now()))).catch(() => setNotice(NOT_SAVED));
  };
  const statsMuscles = useMemo(() => {
    const r = (statsRecords ?? []).find((x) => x.id === STATS_ID && !x.deleted);
    return (r && readStats(r.body)?.muscles) || null;
  }, [statsRecords]);
  useWakeLock(true);
  useTick(true); // the rest countdown and the total time
  // Leaving the screen: a clean store is let go, a dirty one keeps retrying in the registry until it is clean.
  useEffect(() => () => releaseStore(port, store), [store, port]);
  const remaining = restRemainingS(w, now());

  // Opening (or continuing) a workout scrolls once to the exercise with the next open set.
  useEffect(() => { if (currentRid) set({ openRid: currentRid }); }, [currentRid, set]);
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screenRef.current?.querySelector('[aria-current="step"]');
    if (el && el !== screenRef.current?.querySelector('.tk-ex')) el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []);

  // The rest end is armed once per rest (not per tick); skipping or leaving cancels it.
  const restEnd = w.rest ? w.rest.startMs + w.rest.durationS * 1000 : null;
  useEffect(() => { port.restAlarm?.(restEnd !== null && restEnd > latest.current.now() ? restEnd : null); }, [restEnd, port, latest]);
  useEffect(() => () => { port.restAlarm?.(null); }, [port]);

  // Unsaved work on this device always wins. Only a clean store steps aside for what happened elsewhere.
  useEffect(() => {
    if (!remote || remote === mountList.current || leaving.current) return;
    const { w: cur, onLeave: leave } = latest.current;
    const rec = remote.find((r) => r.id === cur.id);
    if (rec && rec.updatedMs <= store.updatedMs()) return; // ours, or older
    const copyNote = () => (remote.some((r) => !r.deleted && bodyOf('workout', r).keptCopyOf === cur.id) ? ' Die Fassung mit mehr Sätzen liegt als Kopie im Verlauf.' : '');
    const stepAside = (message: string, stay: string) => {
      store.flushDrafts(); // a note still being typed counts as unsaved work
      if (store.dirty()) { if (rec) store.reload(rec); setNotice(stay); return; }
      closeStore(port, store);
      leave(message);
    };
    if (!rec) {
      if (!store.everSaved()) return; // never saved yet: the list cannot know it, keep it open and keep retrying
      stepAside(`Dieses Training wurde auf einem anderen Gerät gelöscht. Die Ansicht wurde neu geladen.${copyNote()}`, 'Dieses Training wurde auf einem anderen Gerät gelöscht. Deine Änderungen hier bleiben offen und werden weitergeschrieben.');
    } else if (rec.deleted) {
      stepAside(`Dieses Training wurde auf einem anderen Gerät gelöscht. Die Ansicht wurde neu geladen.${copyNote()}`, 'Dieses Training wurde auf einem anderen Gerät gelöscht. Deine Änderungen hier bleiben offen und werden weitergeschrieben.');
    } else if (bodyOf('workout', rec).endMs !== null) {
      stepAside('Dieses Training wurde auf einem anderen Gerät beendet. Die Ansicht wurde neu geladen.', 'Dieses Training wurde auf einem anderen Gerät beendet. Deine ungespeicherten Änderungen hier bleiben offen und werden weitergeschrieben.');
    } else {
      store.reload(rec);
    }
  }, [remote, store, port, latest, setNotice]);

  // A finish that could not be saved at first leaves the screen once a retry succeeds.
  useEffect(() => {
    if (pendingLeave.current && save === 'saved' && w.endMs !== null) {
      const m = pendingLeave.current; pendingLeave.current = null;
      void markUsed(port, [w], latest.current.now()); closeStore(port, store);
      latest.current.onLeave(m, m === FINISHED_MSG ? w.id : undefined);
    }
  }, [save, w, port, store, latest]);

  const act = useCallback((fn: (x: TrackedWorkout) => TrackedWorkout) => void store.apply(fn), [store]);

  async function end(choice?: FinishChoice) {
    if (ending.current) return;
    ending.current = true; leaving.current = true;
    try {
      store.flushDrafts(); // a note still being typed is part of what gets finished
      const r = await store.finish(choice);
      if (r.status === 'ask') { leaving.current = false; set({ ask: r }); return; }
      set({ ask: null });
      const msg = r.status === 'discard' ? 'Das Training wurde verworfen.' : FINISHED_MSG;
      if (!r.saved) {
        if (r.status === 'finished') pendingLeave.current = msg; // stays here, calmly, until a retry works
        else leaving.current = false;
        return;
      }
      if (r.status === 'finished') await markUsed(port, [latest.current.w], now());
      closeStore(port, store);
      onLeave(msg, r.status === 'finished' ? w.id : undefined);
    } finally { ending.current = false; }
  }
  const endRef = useLatest(end);
  const autoEnded = useRef(false);
  useEffect(() => { if (autoEnd && !autoEnded.current) { autoEnded.current = true; void endRef.current(); } }, [autoEnd, endRef]);

  // Throw the workout away on purpose, after the confirm: the same one-shot delete as "Verwerfen" on the open card.
  async function discard() {
    if (ending.current) return;
    ending.current = true; leaving.current = true;
    try {
      store.flushDrafts();
      if (!(await store.remove())) { leaving.current = false; setNotice('Das konnte gerade nicht gespeichert werden. Das Training bleibt offen. Versuch es gleich nochmal.'); return; }
      closeStore(port, store);
      onLeave('Das Training wurde verworfen.');
    } finally { ending.current = false; }
  }

  const known = knownStudios([...history, w], studios.renames, studios.picks, studios.hidden);

  return {
    port, store, history, now, newId, w, save, ui, set, toggleNote, toggleInfo, askCoach, setNotice, holdProps, held, screenRef,
    catalog, excluded, studios, overrides, studioHere, statsMuscles, chooseStep, remaining, currentRid, known, act, end, discard,
  };
}

export type ActiveWorkoutApi = ReturnType<typeof useActiveWorkout>;
