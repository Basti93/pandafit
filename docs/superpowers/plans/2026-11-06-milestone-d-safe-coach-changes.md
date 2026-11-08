# Milestone D: Coach changes are safe

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein D — Brief". Spec: `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md` around lines 165 and 176–180 (durable changes) and 237 (acceptance "Haltbarkeit").

## Global Constraints

- Before each task, check that no ride is open: `~/Library/Application Support/bike-coach/rides/live/current.jsonl` must be older than one hour, and no `rides/ride-*/meta.json` may have status open.
- No npm install, no new dependencies, no push, no deploy.
- Public repo: no personal data. Tests use invented titles.
- Top rule: a workout is never lost. Done sets are never changed by a coach change or by an undo.
- Light UI: one reason sentence, the buttons "Übernehmen" / "Nein" / "Rückgängig", and at most one short "geht nicht, weil …" line. No version numbers or ids are visible.
- General mechanisms only.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `npm test` and `npm run typecheck` are green after each task. Tests that pin replaced behaviour are deleted, not adapted.

## Today (from exploration)

- **Workout changes:**
  - The in-workout chat coach proposes `workoutChange` ops (drop / swap / sets / lighter, `src/shared/chat.ts:14`).
  - `validOps` (`src/tracking/workout-change.ts:11`) drops invalid ops silently.
  - `WorkoutCoach.tsx` applies ops via `applyWorkoutChange` inside `WorkoutScreen.act`.
  - "Already applied" is a component-local Set, and the chat `takes` record is written afterwards in a separate write. There is no undo.
- **Week plan:**
  - `CoachScreen.take` (`src/tracking/ui/CoachScreen.tsx:112`) writes the `weekplan` record (id = weekStart), then a chat "Übernommen." with `takes`.
  - There is no undo and no check against a newer plan.
- **Next workout:**
  - The gym coach writes `plan/current` directly and regenerates it whenever it is dirty (`src/coach/gym/gym-coach.ts` ~138–147, ~330–386).
  - There is no way to ask for a change "for next time".
- **Rejections:**
  - The gym coach falls back to the rule plan with the neutral reason "Das passt zu deinem aktuellen Stand." (`gym-coach.ts` ~384, `prompt.ts:23`).
  - The week proposal is dropped with a generic sentence (`src/coach/chat/chat-coach.ts:152–165`).
  - Invalid workout ops are dropped without a word (`chat-coach.ts:192`).

## Design

### A. Workout changes: atomic with the workout

- `LoggedWorkout` gets an optional `changes?: { id: string; atMs: number; prior: LoggedExercise[] }[]`.
  - `id` is the proposal id (the chat message id plus the proposal index, deterministic).
  - `prior` holds the exercises as they were before the change, restricted to the touched rows (by `rid` / position, whatever the existing ops use).
  - Taking a change is ONE workout write that applies the ops and appends the entry. That makes it atomic and survive reload.
- **Taken** = the open workout lists the id. Taking again is a no-op (idempotent).
  - The UI derives "taken" from the workout, never from component state. The chat `takes` record stays as a log only.
- **Undo** ("Rückgängig" on the coach message while the workout is open): restore the `prior` rows and remove the entry, in one write.
  - Allowed only when none of the touched rows has a set confirmed after `atMs` and the rows were not edited since.
  - "Edited since" means the touched rows' current state differs from what the change produced. Store a `after` hash or a copy of the produced rows to compare.
  - Otherwise show "Geht nicht mehr, weil du in dieser Übung schon weitertrainiert hast." or "… weil du sie inzwischen selbst geändert hast."
- **Ops that cannot apply** (validOps rejects) are not dropped silently.
  - Each rejected op becomes one reason in words: "Satz schon erledigt", "Übung nicht im Katalog" or "Training schon beendet".
  - The coach side (`chat-coach.ts` ~192) puts them into the answer as one line "Geht nicht: …".
  - The client re-validates at take time and shows the same line for ops that became invalid since.

### B. Changes for the next workout

- New record kind `change` (per profile, add it to `RECORD_KINDS` and `src/web/validate.ts`).
  - Id: `chg-<proposal id>`.
  - Body: `{ target: 'next', ops: NextOp[], reason: string, state: 'proposed' | 'taken' | 'declined' | 'undone' | 'used', atMs, usedBy?: workoutId }`.
  - `NextOp` mirrors the workout ops but names exercises by `exerciseId`:
    - `drop {exerciseId}`
    - `swap {exerciseId, toId}`
    - `sets {exerciseId, sets}`
    - `lighter {exerciseId}`
- **Proposing:** the in-workout chat coach and the week chat coach may propose next-workout changes.
  - Extend their schemas and prompts minimally: "für das nächste Training" → target next.
  - The coach writes the `change` record with state `proposed`. The chat message refers to it by id.
- **UI:** the coach message shows the proposal with "Übernehmen" / "Nein".
  - Take sets the state to `taken`, Nein sets it to `declined`, and Rückgängig (while not yet `used`) sets it to `undone`.
  - The state lives in the record, so it survives reload and is synced. A state only moves forward:
    - `proposed` → `taken` / `declined`;
    - `taken` → `undone` / `used`;
    - nothing else.
  - Writes stamp above the stored `updatedMs`.
- **Applying:**
  - `startFromPlan` (`src/tracking/session.ts`) applies all `taken` next-changes, oldest first, to the plan when a workout starts. Ops whose exercise is not in the plan are skipped, with a short note in the workout.
  - It then marks them `used` with `usedBy`. The new workout's `changes` list records them with an empty `prior` (no undo after start).
  - Marking `used` happens after the workout record is saved. If the app dies in between, the workout already lists the change id, so a second start skips ids that any workout lists. That keeps it idempotent.
- **Coach side:**
  - `GymCoach` reads `taken` changes, like `loadStepsOf` reads loadstep records.
  - It shows them in the plan reason only as a short "Berücksichtigt: …" so the preview matches.
  - It never writes or clears them. Regenerating `plan/current` therefore cannot lose them.

### C. Week plan: undo and no silent overwrite

- On take, the `weekplan` body gets `{ …plan, takenFrom: changeId, prior?: previous body, baseMs: updatedMs of the stored record read just before }`.
  - Before writing, re-read the stored weekplan. If its `updatedMs` is newer than the one the proposal was shown against (`shownMs`, kept in UI state when the proposal is rendered), do not write.
  - Show instead: "Geht gerade nicht, weil der Wochenplan inzwischen geändert wurde. Frag den Coach nochmal."
- **Undo** ("Rückgängig" on the taken message) restores `prior`, or deletes the record if there was none.
  - It works only while the stored weekplan is still the one this take wrote (same `takenFrom` and no newer `updatedMs`).
  - Otherwise show "Geht nicht mehr, weil der Wochenplan danach geändert wurde."

### D. "Das geht nicht, weil …" from the planners

- **Gym coach:** when a Claude plan is rejected by the guardrails after the retry, the stored plan reason is a plain sentence. It says why, in words from the rejection reason, and that a simple plan follows instead. Example: "Mein Plan passte nicht zu deinen Grenzen (zu viele Sätze), deshalb gibt es heute einen einfachen Plan."
  - Map the guardrail reasons to short German phrases in one table next to the guardrails.
  - `NEUTRAL_REASON` stays only for plain rule plans when no Claude plan was attempted.
- **Week proposal dropped** (`chat-coach.ts` 152–165): name the broken rule(s) in words from `checkWeekPlan`'s result instead of the generic sentence.

## Tasks

### Task 1: Workout changes are atomic, idempotent and undoable (Design A)

**Files:**
- `src/shared/records.ts`
- `src/tracking/workout-change.ts`
- `src/tracking/ui/WorkoutCoach.tsx`, `src/tracking/ui/WorkoutScreen.tsx`
- `src/coach/chat/chat-coach.ts` (the "Geht nicht" line)
- `src/shared/chat.ts` (if the answer type needs a field)
- tests

Acceptance tests:
- take → the workout lists the change and the rows changed;
- reload (a new component from the stored record) shows it as taken, and take again changes nothing;
- undo restores the rows;
- undo after a set in that row was confirmed is refused with the reason;
- done sets are never touched by take or undo;
- an invalid op yields the "Geht nicht" line, not silence.

Commit: `feat(changes): coach changes to a workout are saved with it and can be undone`.

### Task 2: Changes for the next workout (Design B)

**Files:**
- `src/shared/records.ts`, `src/shared/changes.ts` (new: schema, state machine, applyNextChanges)
- `src/web/validate.ts`
- `src/tracking/session.ts` (startFromPlan)
- `src/tracking/ui/CoachScreen.tsx` / `WorkoutCoach.tsx` (proposal UI)
- `src/coach/chat/chat-coach.ts` + prompts/schemas
- `src/coach/gym/gym-coach.ts` (read and mention only)
- `src/coach/tracking/` (reader)
- tests

Acceptance tests (spec:237):
- propose → take → the plan regenerates → close and reopen → start: the change is in the new workout and marked used;
- starting twice does not apply it twice;
- a declined or undone change is never applied;
- the state only moves forward (an older device's `proposed` write cannot revive a `used` change: the merge keeps the furthest state; implement this in the reader: furthest state wins regardless of `updatedMs`).

Commit: `feat(changes): changes for the next workout survive replanning and restarts`.

### Task 3: Week plan undo and no silent overwrite (Design C)

**Files:** `src/tracking/ui/CoachScreen.tsx`, `src/shared/chat.ts` or a small `src/tracking/week-take.ts`, tests.

Acceptance tests:
- take, then undo restores the previous plan;
- take while the stored plan is newer than the shown one is refused with the reason;
- undo after a later change is refused.

Commit: `feat(changes): week plans can be undone and are not overwritten silently`.

### Task 4: The planners say why (Design D)

**Files:**
- `src/coach/gym/gym-coach.ts`, `src/coach/gym/guardrails.ts` (reason phrases), `src/coach/gym/prompt.ts`
- `src/coach/chat/chat-coach.ts`
- tests

Acceptance tests:
- a rejected Claude plan → the stored reason names the rejection in words;
- a dropped week proposal names the rule;
- `NEUTRAL_REASON` is used only without a Claude attempt.

Commit: `feat(changes): the coach says why it cannot do something`.
