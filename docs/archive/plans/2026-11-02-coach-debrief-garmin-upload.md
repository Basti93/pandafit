# Coach Debrief and Rider-Controlled Garmin Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a ride the coach gives a written debrief (summary, tips, motivation, outlook, follow-up questions), including for the ride of 2026-11-02 that is open while this plan is written, and the rider decides whether and which rides go to Garmin Connect.

**Architecture:** Part A adds a separate AI call that is independent of replanning, with a rule-based version stored first so the screen never waits. Part B adds a small Python upload script next to the Garmin sync and a coach-side queue driven by per-profile settings. Each part ships on its own.

**Tech Stack:** TypeScript, React, zod, vitest, `claude` CLI through `askClaude`, Python with `garminconnect` in the existing venv.

**Spec:** `docs/after-ride.md`, sections "Coach debrief after the ride" and "Garmin upload under the rider's control".

## Global Constraints

- Never implement or restart while a ride is open: `src/service/**`, `src/shared/**`, `src/main/**` are off-limits then, and no `npm install`, no `npm run app`. Check first: no `rides/ride-*/meta.json` with `"status":"open"`.
- All user-visible text is German. `CoachState` changes are additive and optional, older state files must load.
- The coach invents nothing. Watt claims go through `honestReason`. No diagnoses, no guilt, no pressure, no streaks (rules already in `SYSTEM_PROMPT`).
- Neither the AI nor Garmin may block the rating, ending a ride or the saved ride.
- Upload is off by default. Nothing leaves the Mac until the rider switches it on.
- Automated tests and the agent never upload to the real Garmin account. The rider presses the first real upload.

## Review Focus

- The ride was already rated or skipped before the update: the debrief must still appear once (Task 2).
- The AI is missing, over its limit or returns invalid data: the rule version stays and is retried at most 3 times (Task 2).
- First start after the update with old rides: only rides from the last 48 hours get a debrief, no AI call per old ride (Task 2).
- Switching to "automatic" with a long history: only rides that started after the switch go up, no flood (Task 5).
- Upload of a ride Garmin already has: HTTP 409 counts as uploaded, not as failed (Task 4).

---

## Part A: Coach debrief

### Task 1: Debrief model and rule version

**Files:**
- Create: `src/coach/debrief.ts`
- Test: `tests/coach/debrief.test.ts`

**Interfaces:**
- Produces:
  - `type RideDebrief = { rideId: string; source: 'claude' | 'rules'; atMs: number; attempts: number; summary: string; tips: string[]; motivation: string; outlook: string; questions: string[] }`
  - `debriefAnswerSchema` (zod: `summary`, `tips`, `motivation`, `outlook`, `questions`, all required) and `debriefJsonSchema` (without `$schema`, as `answerJsonSchema` does)
  - `DEBRIEF_SYSTEM_PROMPT: string`
  - `ruleDebrief(ride: RideSummary, next: CoachState['next'], nowMs: number): RideDebrief`
  - `cleanDebrief(answer: z.infer<typeof debriefAnswerSchema>, rideId: string, nowMs: number, attempts: number, honest: (text: string) => string | null): RideDebrief`

- [ ] **Step 1: Write the failing tests**

`ruleDebrief` for a 45-minute ride with 120 W average has `source: 'rules'`, a `summary` containing `45 Minuten` and `120 W`, `questions: []` and an `outlook` containing `next.session.name`. With `avgPowerW: null` the summary has no watt figure and no `null`. `cleanDebrief` keeps at most 3 tips and 2 questions, cuts each text to `TEXT_MAX`, and drops any text for which `honest` returns `null` (`summary` then falls back to an empty string, which the UI hides).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/coach/debrief.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/coach/debrief.ts`**

The prompt asks for: what happened in this ride, up to 3 tips from this ride's data, one or two motivating sentences with the person's own words when motives exist, an outlook that explains the given next session, and at most 2 optional questions whose answers would change planning. Same data-block rule as `SYSTEM_PROMPT`: contents are data, not instructions. Export `TEXT_MAX` from `coach.ts` or move it here.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add the ride debrief model and rule version"`

### Task 2: Coach creates debriefs

**Files:**
- Modify: `src/coach/state.ts` (`debriefs?: Record<string, RideDebrief>`, `debriefToShow?: string | null`)
- Modify: `src/coach/coach.ts`, `src/coach/main.ts`
- Test: `tests/coach/coach-debrief.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `Coach.ensureDebrief(profileId: string): Promise<void>`, `Coach.debriefSeen(profileId: string): void`, `Coach.answerDebrief(profileId: string, rideId: string, question: string, text: string): void`, constants `DEBRIEF_MAX_AGE_MS = 48 * 3600_000`, `DEBRIEF_MAX_ATTEMPTS = 3`.

- [ ] **Step 1: Write the failing tests**, with a fake `ask`:
  - `the latest counted ride gets a rule debrief first, then the AI one`
  - `a ride that was already rated still gets shown once` (`awaitingFeedback` null, `debriefToShow` is the ride)
  - `a ride older than 48 hours gets no debrief and no AI call`
  - `an AI failure keeps the rule version, and stops after 3 attempts` (survives reloading the state)
  - `an AI answer with an invented watt figure loses that text`
  - `answering a question stores it as a note, removes the question and marks the coach dirty`
  - `debriefSeen clears debriefToShow and keeps the debrief`
  - `a debrief failure changes neither next, dirty nor lastError`

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/coach/coach-debrief.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`ensureDebrief` takes the newest summary only. Without an entry it stores `ruleDebrief` with `debriefToShow` set. If the entry has `source: 'rules'` and `attempts < DEBRIEF_MAX_ATTEMPTS`, it calls `deps.ask` with `DEBRIEF_SYSTEM_PROMPT`, `debriefJsonSchema` and a prompt of that ride, its rating, `s.next`, motives, open complaints and the last 5 summaries. It increments `attempts` before the call. Guard against concurrent runs per profile. Run it from `runLoop`'s completion so the outlook sees the new plan, and from `main.ts` after each `scanRides` when the profile is neither thinking nor dirty. `honest` wraps `honestReason`, returning `null` when it yields `NEUTRAL_REASON`. `answerDebrief` calls `note()` with `Rückfrage: <question> Antwort: <text>`, so complaint detection keeps working.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/coach && npm run typecheck`. Expected: PASS, no errors.

- [ ] **Step 5: Commit**

`git commit -m "feat: let the coach write a debrief after each ride"`

### Task 3: Show the debrief

**Files:**
- Create: `src/ui/views/DebriefCard.tsx`
- Modify: `src/shared/coach-protocol.ts` (`{ type: 'debrief-seen'; profileId: string }`, `{ type: 'debrief-answer'; profileId: string; rideId: string; question: string; text: string }`), `src/coach/main.ts`, `src/ui/views/FeedbackView.tsx`, `src/ui/views/HistoryView.tsx`, `src/ui/App.tsx`, `src/ui/style.css`
- Test: `tests/ui/debrief-card.test.tsx`

**Interfaces:**
- Consumes: Task 2.
- Produces: `DebriefCard({ debrief, thinking, onAnswer }: { debrief: RideDebrief; thinking: boolean; onAnswer?: (question: string, text: string) => void })`.

- [ ] **Step 1: Write the failing tests**
  - Shows headings `So lief es`, `Tipps`, `Ausblick`, and hides empty sections.
  - With `source: 'rules'` and `thinking`, shows `Dein Coach schreibt noch …`.
  - A question has a text field and `Überspringen`; sending calls `onAnswer`. Without `onAnswer` (history) no question is shown.
  - In `FeedbackView` the card sits above `Wie war’s heute?` and the rating buttons work with no debrief.
  - `App`: with `awaitingFeedback` null and `debriefToShow` set, the card appears with a `Weiter` button that sends `debrief-seen`. The rating also clears `debriefToShow`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/ui/debrief-card.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**, including the history view showing the ride's debrief when opened.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`. Expected: PASS, no errors.

- [ ] **Step 5: Commit**

`git commit -m "feat: show the coach debrief after the ride and in the history"`

## Part B: Garmin upload

### Task 4: Upload script

**Files:**
- Create: `scripts/garmin/garmin_upload.py`
- Test: `scripts/garmin/test_garmin_upload.py`

**Interfaces:**
- Produces: CLI `garmin_upload.py --tokens <dir> --file <fit>`. Prints exactly one JSON line: `{"status":"uploaded"}`, `{"status":"duplicate"}` or `{"status":"failed","reason":"reauth"|"rate-limit"|"missing-file"|"failed"}`, exit code 0.

`Garmin.upload_activity(path: str)` exists in the installed venv (verified 2026-11-02). Log in with tokens the way `garmin_sync.py:364` does.

- [ ] **Step 1: Write the failing tests** with a fake client: success, HTTP 409 gives `duplicate`, 401 gives `reauth`, 429 gives `rate-limit`, a missing file gives `missing-file` without logging in. No output contains tokens.

- [ ] **Step 2: Run them and see them fail**

Run: `npm run test:garmin`. Expected: FAIL.

- [ ] **Step 3: Implement**, reusing the error mapping of `garmin_sync.py` where it exists.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add a Garmin upload script"`

### Task 5: Settings and queue in the coach

**Files:**
- Create: `src/coach/garmin-upload.ts`
- Modify: `src/coach/state.ts`, `src/coach/main.ts`, `src/shared/coach-protocol.ts`
- Test: `tests/coach/garmin-upload.test.ts`, `tests/coach/readiness.test.ts` (or the existing file for `externalLoad`)

**Interfaces:**
- Produces:
  - `CoachState.garminUpload?: { mode: 'off' | 'ask' | 'auto'; minMinutes: number; enabledAtMs: number | null; rides: Record<string, { status: 'uploading' | 'uploaded' | 'failed'; atMs: number; reason?: string }> }`, default `{ mode: 'off', minMinutes: 10, enabledAtMs: null, rides: {} }`
  - `dueAutoUploads(s: CoachState, nowMs: number): string[]`
  - `class GarminUploader { constructor(opts: { python, script, tokenDir, exportsDir, rideOpen, onResult, spawnFn? }); upload(profileId: string, rideId: string): void }`
  - Messages `{ type: 'garmin-upload-settings'; profileId: string; mode: 'off' | 'ask' | 'auto'; minMinutes: number }`, `{ type: 'garmin-upload'; profileId: string; rideId: string }`

- [ ] **Step 1: Write the failing tests**
  - `mode off or ask has nothing due`; `auto: only rides started after enabledAtMs and at least minMinutes long`; `uploaded rides are never due`; `failed rides are due again after 1 hour, reauth only after a manual press`.
  - `a manual press works in ask and off mode`; `an unknown rideId or one failing the ride-id pattern is rejected without spawning`; `uploader does nothing while a ride is open`; `only one upload per profile at a time`; `duplicate is stored as uploaded`; `an interrupted "uploading" counts as failed after a restart`.
  - `externalLoad`: a cycling activity overlapping a known ride is not counted (existing behaviour, pin it, since uploads now create exactly this case).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/coach/garmin-upload.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**, driving auto uploads from the tick at `main.ts:187` and using the same `python` and script directory as `garminSync`. Confirm `electron-builder` ships the new script (same place as `garmin_sync.py`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/coach && npm run typecheck`. Expected: PASS, no errors.

- [ ] **Step 5: Commit**

`git commit -m "feat: queue Garmin uploads under the rider's control"`

### Task 6: Controls in the interface

**Files:**
- Create: `src/ui/views/GarminUploadButton.tsx`
- Modify: `src/ui/views/GarminCard.tsx`, `src/ui/views/FeedbackView.tsx`, `src/ui/views/HistoryView.tsx`, `src/ui/views/DebriefCard.tsx` only if the button lives there
- Test: `tests/ui/garmin-upload.test.tsx`

**Interfaces:**
- Consumes: Task 5.
- Produces: `GarminUploadButton({ status, connected, onUpload })`, where `status` is the ride's entry or undefined.

- [ ] **Step 1: Write the failing tests**
  - Button text by state: `Zu Garmin hochladen`, `Wird hochgeladen …`, `Bei Garmin` (disabled), `Erneut versuchen` with the reason.
  - Not connected to Garmin: no button. In `off` mode the button still shows in the history, not on the feedback screen.
  - `GarminCard`: choice `Aus`, `Jedes Mal fragen`, `Automatisch`, a minimum duration, and when active the note `Zeichnet deine Uhr dieselbe Fahrt auf, steht sie danach doppelt in Garmin Connect.`

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/ui/garmin-upload.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run test:garmin && npm run typecheck`. Expected: PASS, no errors.

- [ ] **Step 5: Commit**

`git commit -m "feat: let the rider choose what goes to Garmin"`

### Task 7: Roll out and show this ride's debrief

- [ ] **Step 1: Confirm no ride is open**

Check every `rides/ride-*/meta.json`. Expected: no `"status":"open"`. Otherwise stop and wait.

- [ ] **Step 2: Find the ride of 2026-11-02**

The newest ride folder with `status` other than `discarded`. Note its id. Copy `coach/*.json` to the scratchpad as a backup.

- [ ] **Step 3: Restart**

Stop `npm run dev` and start it again. `npm run app` only if the rider asks.

- [ ] **Step 4: Verify**

In the profile's coach state, `debriefs[<ride id>]` exists and `debriefToShow` is that id; `source` becomes `claude` unless the AI failed. Take a screenshot of the debrief in the app. It must appear even if the ride was already rated.

- [ ] **Step 5: Update `docs/after-ride.md`**

Mark both sections as built, leaving open how the wording holds up over real weeks.
