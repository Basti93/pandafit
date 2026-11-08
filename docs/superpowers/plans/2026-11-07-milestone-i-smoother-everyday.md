# Milestone I: Smoother everyday

Brief and acceptance: `docs/roadmap.md`, "Meilenstein I — Brief".

## Global Constraints

- Before each task, check that no ride is open:
  - `~/Library/Application Support/bike-coach/rides/live/current.jsonl` is older than 1 h;
  - no `rides/ride-*/meta.json` has status open.
- No npm install, no new dependencies, no push, no deploy. Public repo: no personal data, tests use invented names.
- A workout is never lost. Done sets are never changed.
- Light UI: one line per item, no number walls, plain German, wording from `src/shared/wording.ts` where it fits.
- General mechanisms only. Product values go in the register `src/shared/training-policy/rules.ts`.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task. Tests pinning replaced behaviour are deleted.

## Today (from exploration)

- **Studio and plan weights:** `StudioLine` is at `src/tracking/ui/WorkoutScreen.tsx:43`; the start screen is at ~456.
  - `startPlan` (~408) calls `startFromPlan(..., studio, studios, ...)`.
  - `plannedExercise` (`src/tracking/session.ts:79`) sets `weightKg: p.weightKg ?? l?.weightKg`, so plan weights from the coach's (last-used) studio win.
  - `lastValues(exerciseId, history, catalog, studio, studios)` (:61) is studio-aware.
  - `setStudio` (:140) only sets `w.studio`.
  - The routine auto-start `useEffect` (~417) starts with the default studio.
- **Finish:** `ActiveWorkout.end` (WorkoutScreen ~162) calls `onLeave('Training gespeichert. Gut gemacht.')`, shown as a status note. There is no summary.
  - `nextLine(n)` is in `HistoryScreen.tsx:42`. The `next` list from `readStats(...)?.next` is filtered by `forWorkoutId`.
- **Next-change take:** `NextChangeCard` writes the `change` record only. `personalKeyOf` (`src/shared/personal.ts:195`) ignores changes, so the coach replans later.
  - The runtime wrapper `personalKey(id)` is at `src/coach/runtime.ts:290`.
- **Studios:**
  - `renameStudio` (`src/tracking/studios.ts`) writes a `renamedTo` record.
  - `loadstep` records (`src/shared/loads.ts:56–75`, id `step-<hash(exerciseId|studio)>`) are keyed by the stored studio name. `loadStepOverrides` does not resolve renames, so overrides are orphaned.
  - There is no delete or hide. `studioStateOf` (`src/shared/studio.ts`) already skips tombstones.
- **Rest:** `swapExercise` (session.ts:215) builds a fresh exercise without `restS`. `setRest` (:179) and the plan both write `restS`, with no provenance.
- **Today:** `todayAdvice` (`src/shared/today.ts:54`) has no time of day and ignores today's rating.
  - Callers: `runtime.ts:260`, `src/coach/chat/plan-hint.ts:19`, `src/tracking/ui/frame-hooks.ts:70`. The display is `TodayCard`.
- **Goal card sports:** `RulesCard.tsx:16` has the hard-coded `SPORTS`. `DayRating.sports` (`src/shared/day-rating.ts`) tells what was done per day.
- **Runs:**
  - `run` records have a `RunBody` union (`src/shared/run.ts:15–21`).
  - Manual runs come from `src/coach/run/runs.ts`, Garmin runs from `garmin-runs.ts`, merged by `mergeRuns`.
  - The run coach reads no feedback. The gym `EffortQuestion` is the pattern to copy.

## Tasks

### Task 1: Weights fit the chosen studio; studios can be managed

**Weights for the chosen studio:**
- The coach stamps the studio it planned for on the gym plan (`GymWorkout.studio?: string`, the resolved main/last studio it used). Validate it.
- In `plannedExercise`, when the plan's studio is set and its `studioKey` differs from the chosen one:
  - take the chosen studio's own last weight (`lastValues` restricted to that studio, no cross-studio fallback) when it exists;
  - else take the plan weight snapped down to the chosen studio's ladder (`ladderFrom` / `snapDown`, same as elsewhere).
  - Reps stay from the plan.
  - When the studio is the same, nothing changes.
- **Active workout:** `setStudio` re-prefills only exercises without any confirmed set, using the same rule. The pure function takes the original plan values from the tracked exercise.
  - Store `plannedKg?: number | null` on the tracked exercise at start, so the rule can use it.
  - Sets the person already edited (weight differs from the prefilled value) stay unchanged. Track that with a per-set `prefillKg` or by comparing with the old prefill.
- **The routine auto-start keeps working.** The person can change the studio in the active workout and the re-prefill applies.

**Studios:**
- `loadStepOverrides` resolves the studio through the renames, so a rename keeps the own step (`step` lookups use resolved keys).
- **"Entfernen" for a studio without workouts** writes a tombstone for its studio record(s).
- **"Ausblenden" for a studio with workouts** writes `hidden: true`. Hidden studios are not offered in the picker, but stay resolvable, so old workouts keep their studio.
- These are compact buttons next to "Umbenennen" in `StudioLine`'s edit mode.

**Tests:**
- a different studio takes its own weight;
- with no own history, the plan weight is snapped to its ladder;
- the same studio is unchanged;
- a studio change mid-workout re-prefills untouched exercises only;
- an override survives a rename;
- remove vs hide;
- a hidden studio is not in `knownStudios` but resolves.

Commit: `feat(everyday): weights fit the studio you chose, studios can be removed or hidden`.

### Task 2: Small fixes (rest on swap, immediate replan, done today, used sports)

- **Rest on swap:** `setRest` marks `restByUser: true`. `swapExercise` carries `restS` (and the flag) over only when it was set by the person.
- **Immediate replan:** `personalKeyOf` also gets the `change` records and adds `chg:<id>:<state>` for taken changes. The runtime wrapper passes them in, so taking a next-change replans at once and the reason shows "Berücksichtigt: …".
  - Make sure a `used` mark (at finish) does not cause a replan storm. Using it is fine: it is one replan.
- **Done today:** `todayAdvice` gets an optional `hour`. When `ratings[date]` exists (trained today) and `hour >= today.done-after-hour` (register, 18), it returns rest with `done: true` and the reason "weil du heute schon trainiert hast". `TodayCard` shows "Heute erledigt – gut gemacht." in one line.
  - The app passes the local hour. The coach callers pass the local hour too.
- **Used sports:**
  - `RulesCard` shows only the sports with activity in the last 90 days (register `goal.used-sports-days`, 90), from `DayRating.sports` or the records the card already has.
  - The others are behind a small "Weitere Sportarten" toggle.
  - With no activity at all, show all three.
  - A sport that has a non-default priority is always shown.

**Tests:** one per item.

Commit: `feat(everyday): own rest survives a swap, taken changes replan at once, done today, only used sports`.

### Task 3: Summary after the workout; how was the run

**Summary:**
- After a saved finish, the start screen shows a summary card instead of the plain note:
  - "Training gespeichert · ca. N Min · M Sätze";
  - then, per exercise, the `nextLine` for this workout from stats `next` (move `nextLine` to a shared UI helper);
  - before the publish: "Nächstes Mal: kommt nach der Auswertung" (muted);
  - one "Fertig" button.
- The card persists until dismissed, or until the next workout starts. Keep the dismissed id in localStorage via try/catch, so a reload still shows it until "Fertig".

**Run feeling:**
- New `RunBody` `{ type: 'feel', runId, feel: 'easy' | 'right' | 'hard', atMs }`, id `run-feel-<runId>`. Validate it.
- **App:** for the newest run of the last 3 days that has no feel record and no "skipped" mark (skip = the same record with `feel: null`), show one line "Wie war der Lauf am <Tag>?" with the buttons leicht / passend / schwer / Überspringen, then "Danke! Das fließt in den nächsten Laufplan ein."
  - Place it where runs are shown: the run screen or TodayCard area, wherever the run list or `RunCard` lives. Keep it to one card.
  - The runs the app knows come from the records the run screen already reads. If Garmin runs are only coach-side, the coach publishes `lastRun: { id, date, kind }` in the stats record, so the app can ask.
- **Run coach:**
  - It reads feel records.
  - If the last two counted runs with a feel are both `hard`, the next plan step does not increase volume or intensity: it holds the current week. The reason is "weil sich die letzten Läufe schwer angefühlt haben", which also goes into change notes and the focus text.
  - Two `easy` in a row may allow the planned step as usual; no extra jump.
  - The rule ids go in the register.

**Tests:**
- the summary shows the lines, or the pending note;
- dismissing it;
- a feel record is written once;
- the question disappears after answering or skipping;
- two hard runs hold the progression with the reason;
- otherwise nothing changes.

Shot: add `workout-summary` to `scripts/ui-shots/run.ts`. It must render (`npm run build && npm run ui:shots -- /private/tmp/claude-501/ui-shots-i workout-summary`).

Commit: `feat(everyday): a short summary after training, and the run plan asks how it went`.
