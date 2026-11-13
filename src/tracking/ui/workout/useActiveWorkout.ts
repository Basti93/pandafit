import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { bodyOf } from '../../../shared/record-bodies';
import type { LoggedWorkout } from '../../../shared/records';
import { readStats, STATS_ID } from '../../../shared/stats';
import { loadStepOverrides } from '../../../shared/loads';
import { knownStudios, studioStateOf } from '../../../shared/studio';
import type { TrackingPort } from '../../ports';
import { confirmSet, currentSet, type FinishChoice, type TrackedWorkout } from '../../session';
import { closeStore, releaseStore } from '../../registry';
import { hereKey, stepChange } from '../../steps';
import { useCatalog, useExcluded, usePortRecords, useStoreView, useWakeLock, type WorkoutStore } from '../hooks';
import { effortQuestionsOn } from '../EffortQuestion';
import type { DragStart } from '../ReorderSheet';
import { markUsed } from './markUsed';
import { buzz } from './feedback';
import { useHold } from './useHold';
import { useLatest } from './useLatest';

export type Picker = { mode: 'add' } | { mode: 'swap'; ex: string } | null;
export type Ask = { question: 'nothing-confirmed' } | { question: 'open-sets'; open: number } | null;

export type UiState = {
  picker: Picker; ask: Ask;
  /** The exercise whose menu is open. */
  menu: string | null;
  topMenu: boolean; studioOpen: boolean; coachAsk: number;
  reorder: DragStart | null;
  notesOpen: ReadonlySet<string>;
  /** The exercise whose Anleitung sheet is open. */
  infoRid: string | null;
  /** The exercise whose sets sheet (the set table) is open. */
  setsRid: string | null;
  /** The small sheet "Geschafft" (the done exercises) is open. */
  doneOpen: boolean;
  /** The exercise whose effort answer is thanked for, until the next confirmed set. */
  thanked: string | null;
  notice: string | null; effortOn: boolean;
  /** The focus exercise: it follows the next open set; a row under "Danach" makes another one the focus. */
  openRid: string | null;
  /** The set confirmed last: its circle pops once. */
  justDone: string | null;
  /** Exercises whose "restliche Sätze leichter" offer was declined. */
  lighterNo: ReadonlySet<string>;
  /** The adopted lighter weights of an exercise, with the old ones: shown with "Rückgängig" until the next confirmed set. */
  lighterUndo: { rid: string; prior: { rid: string; kg: number }[] } | null;
  /** The exercise whose effort question is asked again ("Doch anders"). */
  reask: string | null;
};

type Action = { t: 'set'; patch: Partial<UiState> } | { t: 'toggleNote'; rid: string } | { t: 'askCoach' };

const toggled = (s: ReadonlySet<string>, rid: string): ReadonlySet<string> => { const n = new Set(s); if (!n.delete(rid)) n.add(rid); return n; };

export function uiReducer(s: UiState, a: Action): UiState {
  switch (a.t) {
    case 'set': return { ...s, ...a.patch };
    case 'toggleNote': return { ...s, notesOpen: toggled(s.notesOpen, a.rid) };
    case 'askCoach': return { ...s, coachAsk: s.coachAsk + 1 };
  }
}

/** Two taps of the same big button closer than this are one tap. */
export const TAP_GUARD_MS = 700;
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
    picker: null, ask: null, menu: null, topMenu: false, studioOpen: false, coachAsk: 0, reorder: null,
    notesOpen: new Set(), infoRid: null, setsRid: null, doneOpen: false, thanked: null, notice: startNotice ?? null, effortOn: effortQuestionsOn(), openRid: currentRid, justDone: null, lighterNo: new Set(), lighterUndo: null, reask: null,
  }));
  const set = useCallback((patch: Partial<UiState>) => dispatch({ t: 'set', patch }), []);
  const toggleNote = useCallback((rid: string) => dispatch({ t: 'toggleNote', rid }), []);
  const askCoach = useCallback(() => dispatch({ t: 'askCoach' }), []);
  const setNotice = useCallback((notice: string | null) => dispatch({ t: 'set', patch: { notice } }), []);
  // Holding an exercise opens Reihenfolge with that exercise lifted; the same finger drags on.
  const { holdProps, wasHeld, release: releaseHold } = useHold((reorder) => set({ reorder }));

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
  // Leaving the screen: a clean store is let go, a dirty one keeps retrying in the registry until it is clean.
  useEffect(() => () => releaseStore(port, store), [store, port]);

  // The focus follows the next open set (in a superset from round to round).
  useEffect(() => { if (currentRid) set({ openRid: currentRid }); }, [currentRid, set]);

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

  // A double tap on a big button lands on what the first tap just put in its place (the next set, a second new set).
  // So a second tap of the same kind within a moment is ignored. Wall clock on purpose: the injected `now` may stand still.
  const lastTap = useRef<Record<'confirm' | 'add', number>>({ confirm: -Infinity, add: -Infinity });
  const tapOnce = useCallback((kind: 'confirm' | 'add'): boolean => {
    const t = performance.now();
    if (t - lastTap.current[kind] < TAP_GUARD_MS) return false;
    lastTap.current[kind] = t;
    return true;
  }, []);

  /**
   * Confirms exactly this set, and only while it is still open in the newest state. When it was the last open set of its
   * exercise, the focus moves on to the next open set of the workout (the same exercise when none is left).
   */
  const confirmShown = useCallback((exRid: string, setRid: string) => {
    buzz();
    set({ thanked: null, justDone: setRid, lighterUndo: null });
    let finished = false;
    act((x) => {
      if (x.exercises.find((y) => y.rid === exRid)?.sets.find((y) => y.rid === setRid)?.doneMs !== null) return x;
      const next = confirmSet(x, exRid, setRid, latest.current.now(), catalog);
      finished = next.exercises.find((y) => y.rid === exRid)?.sets.every((y) => y.doneMs !== null) ?? false;
      return next;
    });
    if (finished) set({ openRid: currentSet(store.current())?.ex ?? exRid });
  }, [act, set, store, latest, catalog]);

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
    port, store, history, now, newId, w, save, ui, set, toggleNote, askCoach, setNotice, tapOnce, confirmShown, holdProps, wasHeld, releaseHold,
    catalog, excluded, studios, overrides, studioHere, statsMuscles, chooseStep, currentRid, known, act, end, discard,
  };
}

export type ActiveWorkoutApi = ReturnType<typeof useActiveWorkout>;
