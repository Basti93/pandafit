import { bodyOf } from '../../shared/record-bodies';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GymWorkout } from '../../shared/gym/types';

import { readStats, STATS_ID } from '../../shared/stats';

import { dateKey } from '../../shared/day-rating';

import { mergedActivities } from './done-days';
import { complaintsOpenIn } from './finisher';
import { planFor } from '../../shared/week-plan';

import type { TrackingPort } from '../ports';
import { startEmpty, isExcludedExercise, type TrackedWorkout } from '../session';
import { acquireStore } from '../registry';
import { createWorkoutStore } from '../store';

import { finishedWorkouts, useCatalog, useExcluded, usePortRecords, type WorkoutStore } from './hooks';

import { SyncNote } from './SyncNote';
import { StudioRow, StudioSheet } from './StudioSheet';
import { Sheet } from './kit';
import { WorkoutSummary, pendingSummary, setPendingSummary } from './WorkoutSummary';
import { defaultStudio, knownStudios, resolveStudio, studioStateOf } from '../../shared/studio';
import { hideStudio, rememberStudio, removeStudio, renameStudio } from '../studios';

import type { GymOutlook as Outlook } from '../../shared/gym-outlook';
import { clearDraft, deviceStorage, draftDropped, planKeyOf, readDraft, startFromDraft, writeDraft, type DraftStorage } from '../plan-draft';
import { PlanSheet } from './PlanSheet';

import { prepareStart } from './workout/prepareStart';
import { ActiveWorkout } from './workout/ActiveWorkout';
import { OpenCard } from './workout/OpenCard';
import { markUsedNow } from './workout/markUsed';
import { useLatest } from './workout/useLatest';
export { planLine, prepareStart } from './workout/prepareStart';

export function WorkoutScreen({ port, plan = null, planMeta = null, account = 'local', storage = deviceStorage(), openPlan = false, onOpened, routine = null, resume = false, onActive, onDone, now = Date.now, newId = () => crypto.randomUUID() }: {
  port: TrackingPort; plan?: GymWorkout | null; routine?: GymWorkout | null;
  /** The plan record around `plan`: its time (the draft's key) and the coach's words for the sheet "Nächstes Training". */
  planMeta?: { atMs: number; dateText?: string; reason: string | null; note: string | null; outlook: Outlook | null } | null;
  /** The draft of the next workout lives on this device, per account (see plan-draft). Null: only in memory. */
  account?: string; storage?: DraftStorage | null;
  /** Open the sheet "Nächstes Training" at once (from Heute), once. */
  openPlan?: boolean;
  /** Told when the sheet from `openPlan` has opened, so the page around it clears the request and a remount does not open it again. */
  onOpened?: () => void;
  /** Open the newest open workout at once (from "Weitermachen" on Heute), once. */
  resume?: boolean;
  /** Told whether a workout is running on this screen, so the page around it can drop its own navigation. */
  onActive?: (active: boolean) => void;
  /** "Fertig" on the summary of a saved workout: the page around it leads on (to Heute). */
  onDone?: () => void;
  now?: () => number; newId?: () => string;
}) {
  const workoutsQ = usePortRecords(port, 'workout');
  const routinesQ = usePortRecords(port, 'routine');
  const workouts = workoutsQ.records;
  const catalog = useCatalog(port);
  const excluded = useExcluded(port);
  const [store, setStore] = useState<{ s: WorkoutStore; autoEnd: boolean; notice?: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [summaryId, setSummaryId] = useState<string | null>(pendingSummary);
  const statsQ = usePortRecords(port, 'stats').records;
  const weekplansQ = usePortRecords(port, 'weekplan').records;
  const activitiesQ = usePortRecords(port, 'activities').records;
  const complaintsQ = usePortRecords(port, 'complaint').records;
  const starting = useRef(false);
  const started = useRef<GymWorkout | null>(null);
  const history = finishedWorkouts(workouts);
  const openRecs = useMemo(() => (workouts ?? []).filter((r) => bodyOf('workout', r).endMs === null).sort((a, b) => bodyOf('workout', b).startMs - bodyOf('workout', a).startMs), [workouts]);
  // What the effects below read when they fire; they fire on their own triggers, not when these change.
  const cur = useLatest({ store, openRecs, port, now, plan, routine, onOpened, onActive });

  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [studioOpen, setStudioOpen] = useState(false);
  const [others, setOthers] = useState(false);
  const resumed = useRef(false);
  const running = store !== null;
  useEffect(() => { cur.current.onActive?.(running); return () => cur.current.onActive?.(false); }, [running, cur]);
  useEffect(() => {
    const c = cur.current;
    if (!resume || resumed.current || c.store || !workouts || c.openRecs.length === 0) return;
    resumed.current = true;
    setStore({ s: acquireStore(c.port, c.openRecs[0]!, c.now), autoEnd: false });
  }, [resume, workouts, cur]);
  const logged = (workouts ?? []).filter((r) => !r.deleted).map((r) => bodyOf('workout', r));
  const studioRecords = usePortRecords(port, 'studio').records;
  const studios = useMemo(() => studioStateOf(studioRecords ?? []), [studioRecords]);
  const studio = chosen ?? defaultStudio(logged, studios.renames, studios.picks);
  const summary = summaryId ? logged.find((x) => x.id === summaryId && x.endMs !== null) ?? null : null;
  const nextSteps = useMemo(() => {
    const r = (statsQ ?? []).find((x) => x.id === STATS_ID && !x.deleted);
    return (r && readStats(r.body)?.next) || [];
  }, [statsQ]);
  const saveFailed = () => setMessage('Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.');
  // A studio with workouts is hidden (they keep it), one without is removed. Another known studio takes its place.
  const awayStudio = (name: string, used: boolean) => {
    const gone = resolveStudio(name, studios.renames).toLowerCase();
    const other = knownStudios(logged, studios.renames, studios.picks, studios.hidden).find((n) => n.toLowerCase() !== gone);
    setChosen(other);
    void (used ? hideStudio(port, name, now()) : removeStudio(port, name, now()))
      .then(() => (other ? rememberStudio(port, other, now() + 1) : undefined)).catch(saveFailed);
  };

  async function begin(w: TrackedWorkout, startNotice: string | null = null): Promise<boolean> {
    if (starting.current) return false; // a double tap makes one workout
    starting.current = true;
    try {
      const s = acquireStore(port, studio ? { ...w, studio } : w, now);
      await s.apply((x) => x); // saved (or flagged) before the screen shows it
      setMessage(null); setPendingSummary(null); setSummaryId(null);
      setStore({ s, autoEnd: false, notice: startNotice });
      return true;
    } finally { starting.current = false; }
  }
  // A start from a plan: prepareStart, then begin; a finished workout whose change mark got lost is made up here.
  const startPlan = async (g: GymWorkout): Promise<boolean> => {
    const { workout, notice } = await prepareStart(port, g, { now, newId, catalog, studio, studios });
    if (!(await begin(workout, notice))) return false;
    await markUsedNow(port, now);
    return true;
  };

  // The next workout, changed before it starts: kept per plan (a new coach plan drops it), in memory as well, so a storage that
  // throws only loses it when the screen goes. Starting with a draft takes the draft; without one the start is as above.
  const planKey = plan ? planKeyOf({ atMs: planMeta?.atMs ?? 0, workout: plan }) : null;
  const [mem, setMem] = useState<{ key: string; w: TrackedWorkout | null } | null>(null);
  const storedDraft = useMemo(() => (planKey && storage ? readDraft(storage, account, planKey) : null), [planKey, storage, account]);
  const kept = planKey === null ? null : mem?.key === planKey ? mem.w : storedDraft;
  // A draft holds the weights of the studio it was made for: in another studio it never starts (it is dropped once all is read).
  const sameStudio = (a?: string, b?: string): boolean => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
  const draft = kept && sameStudio(kept.studio, studio) ? kept : null;
  const [dropped, setDropped] = useState(false);
  useEffect(() => { if (planKey && storage && draftDropped(storage, account, planKey)) setDropped(true); }, [planKey, storage, account]);
  const [sheet, setSheet] = useState<{ key: string; base: TrackedWorkout; notice: string | null; also: string | null } | null>(null);
  const changeDraft = (w: TrackedWorkout) => {
    if (!planKey) return;
    setMem({ key: planKey, w });
    if (storage) writeDraft(storage, account, planKey, w);
  };
  const dropDraft = useCallback(() => {
    if (!planKey) return;
    setMem({ key: planKey, w: null });
    if (storage) clearDraft(storage, account);
  }, [planKey, storage, account]);
  useEffect(() => {
    if (!kept || draft || workouts === null || studioRecords === null) return; // still reading: the studio is not known yet
    dropDraft();
    setDropped(true);
  }, [kept, draft, workouts, studioRecords, dropDraft]);
  const lookAt = async (g: GymWorkout) => {
    if (!planKey) return;
    const key = planKey;
    const { workout, notice, also } = await prepareStart(port, g, { now, newId, catalog, studio, studios });
    setSheet({ key, base: workout, notice, also });
  };
  // A draft without exercises never starts (the sheet's button is off then): the plan starts instead, and the draft goes.
  const startNext = async (g: GymWorkout, also?: string | null) => {
    const d = draft;
    if (!d || d.exercises.length === 0) { if ((await startPlan(g)) && d) dropDraft(); return; }
    const said = also !== undefined ? also : (await prepareStart(port, g, { now, newId, catalog, studio, studios })).also;
    if (!(await begin(startFromDraft(d, now(), newId()), said))) return;
    setSheet(null);
    dropDraft();
    await markUsedNow(port, now);
  };
  const actions = useLatest({ lookAt, startPlan });
  const openedPlan = useRef(false);
  useEffect(() => {
    const c = cur.current;
    if (!openPlan || openedPlan.current || !c.plan || !workouts || c.openRecs.length > 0 || c.store) return;
    openedPlan.current = true;
    void actions.current.lookAt(c.plan).then(() => cur.current.onOpened?.());
  }, [openPlan, workouts, planKey, cur, actions]);

  useEffect(() => {
    const c = cur.current;
    if (routine && workouts && c.openRecs.length === 0 && !c.store && started.current !== routine) { started.current = routine; void actions.current.startPlan(routine); }
  }, [routine, workouts, cur, actions]);

  if (store) return <ActiveWorkout port={port} store={store.s} history={history} now={now} newId={newId} autoEnd={store.autoEnd} startNotice={store.notice} onLeave={(m, finishedId) => { setStore(null); if (finishedId) { setPendingSummary(finishedId); setSummaryId(finishedId); setMessage(null); } else setMessage(m); }} />;
  if (workoutsQ.failed) {
    return (
      <div className="tk-screen">
        <p role="status" className="tk-note">Deine Trainings konnten gerade nicht gelesen werden. Es ist nichts verloren, versuch es gleich nochmal.</p>
        <button type="button" onClick={workoutsQ.retry}>Nochmal versuchen</button>
      </div>
    );
  }
  if (workouts === null) return <div className="tk-screen"><p className="muted">Einen Moment …</p></div>;

  if (resume && !resumed.current && openRecs.length > 0) return <div className="tk-screen"><p className="muted">Einen Moment …</p></div>; // opening it at once, no card in between
  if (openRecs.length > 0) {
    return (
      <div className="tk-screen">
        {message && <p role="status" className="tk-note">{message}</p>}
        {openRecs.map((rec, i) => (
          <OpenCard key={rec.id} rec={rec} primary={i === 0}
            onResume={() => setStore({ s: acquireStore(port, rec, now), autoEnd: false })}
            onEnd={() => setStore({ s: acquireStore(port, rec, now), autoEnd: true })}
            onDiscard={async () => {
              // One-shot: a throwaway store, disposed at once, so a failed delete is never retried.
              const once = createWorkoutStore(port, rec, now);
              const ok = await once.remove().finally(() => once.dispose());
              if (!ok) setMessage('Das konnte gerade nicht gespeichert werden. Das Training bleibt offen. Versuch es gleich nochmal.');
            }} />
        ))}
      </div>
    );
  }

  const routines = routinesQ.records ?? [];
  const studioKnown = knownStudios(logged, studios.renames, studios.picks, studios.hidden);
  const manyStudios = studioKnown.length > 1;
  return (
    <div className="tk-screen">
      {message && <p role="status" className="tk-note">{message}</p>}
      {summary && <WorkoutSummary workout={summary} next={nextSteps} onDone={() => { setPendingSummary(null); setSummaryId(null); onDone?.(); }}
        nowMs={now()} today={planFor(weekplansQ ?? [], dateKey(now()))} activities={mergedActivities(activitiesQ, workouts).items} complaintsOpen={complaintsOpenIn(complaintsQ)} />}
      <SyncNote port={port} />
      {!summary && (
        <>
          {plan ? (
            <section className="card tk-plan-preview" aria-label="Heutiger Plan">
              <h2>Nächstes Training</h2>
              <p><strong>{plan.name}</strong></p>
              <p className="muted tk-clamp">{draft ? draft.exercises.map((e) => e.title).join(', ') : plan.exercises.filter((e) => !isExcludedExercise(e, catalog, excluded)).map((e) => e.title).join(', ')}</p>
              {manyStudios && <button type="button" className="secondary tk-studio-line" aria-label={`Studio ${studio ?? 'wählen'}`} onClick={() => setStudioOpen(true)}>{studio ?? 'Studio wählen'} ›</button>}
              <button type="button" aria-label={`${plan.name} starten`} onClick={() => void startNext(plan)}>Training starten</button>
              <button type="button" className="secondary" onClick={() => void lookAt(plan)}>Ansehen und anpassen</button>
              {draft && <div className="tk-links"><span className="muted">Angepasst</span><button type="button" className="link" onClick={dropDraft}>Änderungen verwerfen</button></div>}
              {dropped && !draft && <p className="muted">Deine Anpassungen passen nicht mehr zum aktuellen Plan oder Studio. Darum gilt wieder der Plan des Coaches.</p>}
            </section>
          ) : (
            <>
              <button type="button" onClick={() => void begin(startEmpty(now(), newId()))}>Leeres Training starten</button>
              {routines.length === 0 && <p className="muted">Oder leg unter Routinen einen Ablauf an.</p>}
            </>
          )}
          <div className="tk-rows">
            {!(plan && manyStudios) && <StudioRow value={studio} onOpen={() => setStudioOpen(true)} />}
            {(plan || routines.length > 0) && (
              <button type="button" className="tk-rowbtn tk-choice" onClick={() => setOthers(true)}>
                <span className="tk-row-title">Routine oder leeres Training</span><span className="tk-chevron" aria-hidden="true">›</span>
              </button>
            )}
          </div>
        </>
      )}
      {studioOpen && (
        <StudioSheet value={studio} known={studioKnown} onClose={() => setStudioOpen(false)}
          onAway={studio ? { used: logged.some((x) => x.studio && resolveStudio(x.studio, studios.renames).toLowerCase() === resolveStudio(studio, studios.renames).toLowerCase()), run: awayStudio } : undefined}
          onChange={(n) => { setChosen(n); if (n) void rememberStudio(port, n, now()).catch(saveFailed); }}
          onRename={(from, to) => { setChosen(to); void renameStudio(port, from, to, now()).catch(saveFailed); }} />
      )}
      {plan && sheet && sheet.key === planKey && (
        <PlanSheet port={port} workout={draft ?? sheet.base} dateText={planMeta?.dateText ?? null} reason={planMeta?.reason ?? null} note={planMeta?.note ?? null} notice={sheet.notice} outlook={planMeta?.outlook ?? null}
          history={history} studios={studios} catalog={catalog} now={now} newId={newId}
          onChange={changeDraft} onClose={() => setSheet(null)}
          onStart={() => { const d = draft; if (d) void startNext(plan, sheet.also); else { setSheet(null); void startPlan(plan); } }} />
      )}
      {others && (
        <Sheet size="small" title="Routine oder leeres Training" onClose={() => setOthers(false)}>
          <ul className="tk-rows">
            {routines.map((r) => {
              const body = bodyOf('routine', r);
              return <li key={r.id} className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { setOthers(false); void startPlan(body); }}><span className="tk-row-title">{body.name} starten</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>;
            })}
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { setOthers(false); void begin(startEmpty(now(), newId())); }}><span className="tk-row-title">Leeres Training starten</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}
