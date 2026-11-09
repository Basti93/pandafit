# Milestone H: Development over weeks

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein H — Brief". Spec `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md`:
- §5 l.65–69: a temporary focus does not override the base direction, and its end is visible;
- §16 l.205–211: chat date and time, older messages reachable, retention separate from display.

## Global Constraints

- Before each task, check that no ride is open: the live file must be older than one hour, and no `ride-*/meta.json` may have status open.
- No npm install, no new dependencies, no push, no deploy.
- Public repo: no personal data.
- A workout is never lost.
- Light UI: one line per item, dates as "Mo., 3. Nov.", times as "14:05", and no number walls.
- General mechanisms only. Product values go in the register.
- Reuse:
  - the record pattern (`src/shared/personal.ts`, `validate.ts`, coach readers in `src/coach/tracking/`);
  - the stats-record publishing from milestone F (advice);
  - wording.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task. Tests pinning replaced behaviour are deleted.

## Today (from exploration)

- **Goal record** (`src/shared/personal.ts:15–53`): `{ strength, focus ≤3, sports, atMs }`, with no time limit; the latest record wins.
  - Focus reaches only the prompts (`gym/prompt.ts:141,143`, chat `ziel`, run/bike `personalHint`).
  - `MUSCLE_TARGETS` are not scaled by focus.
- **Gym progression:** `suggestNext` in `src/coach/gym/history.ts` returns `why: 'keep' | 'progress' | 'step-back'`, but the person never sees it. The effort answers `none` / `some` / `plenty` come from `EffortQuestion`.
- **Bike changes:** they are visible only on the Mac (`state.changes` → `CoachLog`, `coach.ts:561–577,618`).
  - Run explains itself only through its weekly focus text.
  - Gym explains nothing.
- **Chat UI** (`src/tracking/ui/CoachScreen.tsx:186–197`): no times, no date separators, no paging.
  - `CHAT_KEEP_MS` is 90 days and stays.
  - `WorkoutCoach.tsx:81` shows only the last 6 messages, with no time.
- **Coach tasks** (`src/coach/coach-tasks.ts`): kept in the Mac-side `tasks.json`, not synced, with no UI.
  - One-off tasks expire after 7 days and lasting ones after 60.
  - Injected into `planHint` (`runtime.ts:184,201,354`).

## Design

### A. Temporary focus

- `GoalBody` gets an optional `temporary?: { focus?: MuscleGroup[]; sports?: Partial<…>; until: 'YYYY-MM-DD'; endedSeenMs?: number }`.
- **`goalOf(records, today)`:** the base goal, overlaid by `temporary` while `today ≤ until`. After `until` it returns the base again, plus `ended: { until, focus, sports }` for 14 days (register `focus.ended-notice-days`), so the UI can show the end once.
- **Focus effect:**
  - `weeklySetRange(group, goal)` multiplies min and max by `muscle.focus-factor` (register, 1.3) for focus groups, rounded;
  - the muscle balance and the coach both use it, so the states move and the planner plans more;
  - focus sports change only the prompt line, as today.
- **UI (`RulesCard`):** the focus line gets "für [unbefristet | 2 | 4 | 6 | 8 Wochen]". With a time limit, the line reads "Schwerpunkt: Rücken – bis Mo., 1. Dez.".
  - After the end, the card shows one line "Schwerpunkt Rücken ist am … ausgelaufen. Jetzt gilt wieder dein Grundziel." with an "OK" button. OK writes `endedSeenMs`, so the line disappears.
- **Chat goal proposals** can carry `weeks` (1–12). Taking one writes `temporary` instead of the base.

### B. Feedback that shows its effect (gym)

- `suggestNext` also returns `reason`, one German sentence built from the decision path, for example:
  - "alle Wiederholungen geschafft";
  - "noch nicht alle Wiederholungen";
  - "noch 0 übrig, Leistung hält";
  - "Leistung zweimal gesunken";
  - "lange Pause";
  - "noch 3+ übrig".
- The phrases live in one table next to `suggestNext`.
- The coach publishes per-exercise next steps for the exercises of the latest workout into the stats record (like milestone F's advice), as `next: { exerciseId, title, weightKg, reps, why, reason, forWorkoutId, atMs }[]`.
- **App:**
  - **Workout summary or history detail:** after finishing, and in the history detail of the latest workout, one line per exercise: "Nächstes Mal: 62,5 kg × 8 – weil du alle Wiederholungen geschafft hast."
  - **Before the publish arrives:** show "Kommt nach der Auswertung" in muted text.
  - **After an effort answer:** a small muted note "Danke! Das fließt in den nächsten Vorschlag ein." No local computation.

### C. "Zuletzt geändert"

- A shared type `ChangeNote = { atMs, coach: 'bike' | 'gym' | 'run' | 'chat', text, reason }` in `src/shared/change-notes.ts`.
- Each coach appends notes when it changes something lasting, with a cap of 20 per coach and 60 days:
  - **bike:** the existing `state.changes`, mapped;
  - **gym:** a weight increase or step-back on an exercise when a new plan is made ("Bankdrücken: 60 → 62,5 kg – alle Wiederholungen geschafft"), at most one note per exercise per plan;
  - **run:** a phase change, a light week, or a test week ("Lauf: Phase 2 – drei Läufe pro Woche in 4 von 5 Wochen").
- The notes are published in the stats record (the newest 8 across coaches).
- The week page card "Zuletzt geändert" shows up to 5 lines "Mo., 3. Nov. · Text – Grund", with no expansion.

### D. Chat with date and time

- `CoachScreen` chat:
  - **Grouping:** messages are grouped by local day with a separator line ("Heute", "Gestern", "Mo., 3. Nov.").
  - **Time:** each message has a small time ("14:05").
  - **Paging:** show the newest 30 messages and a "Ältere anzeigen" button that adds 30 more.
  - **Scroll:** keep the scroll position when older messages load. Scroll to the end only on a new message.
- `WorkoutCoach`: the time on each shown message.
- Put the date and time helpers in `src/shared/dates.ts` if not present, with German formatting, used by all.

### E. Forwarded requests visible and synced

- New record kind `task` (per profile): id `task-<hash(from,to,text,atMs)>`, body = `CoachTask` plus `doneMs?`. A tombstone means removed.
- `coach-tasks.ts` reads and writes records through the coach-side store instead of `tasks.json`.
  - Migrate once from `tasks.json`, idempotent (deterministic ids). Keep the old file until the migration succeeds, then remove it, the same as the E rule migration.
  - Expiry stays: 7 and 60 days.
- `RulesCard` gets a section "Weitergegeben" listing active tasks: "An Kraft-Coach: <text> · dauerhaft/bis …" with "Entfernen" (tombstone).
- A task change bumps the planners' plan key (like `personalKeyOf`).

## Tasks

### Task 1: Temporary focus (Design A)

**Files:**
- `src/shared/personal.ts`, `src/shared/muscle-targets.ts` (+ callers of `goalOf` and `weeklySetRange`)
- `src/shared/training-policy/rules.ts`
- `src/tracking/ui/RulesCard.tsx`
- `src/coach/chat/chat-coach.ts` (weeks in goal drafts)
- `RuleCard.tsx`
- tests

Acceptance tests:
- the overlay applies while active and the base returns after `until`;
- `ended` shows for 14 days until seen;
- the focus factor raises the range for focus groups only;
- the balance state changes accordingly;
- the UI "für 4 Wochen" writes `temporary`, and OK hides the notice;
- a chat goal with `weeks` writes `temporary`.

Commit: `feat(weeks): a focus can be temporary and ends visibly`.

### Task 2: Feedback that shows its effect (Design B)

**Files:**
- `src/coach/gym/history.ts` (`reason`)
- `src/coach/gym/gym-coach.ts` + stats publishing (`src/shared/stats.ts`, `validate.ts`)
- `src/tracking/ui/` (the finish summary or history detail, `EffortQuestion`)
- tests

Acceptance tests:
- one reason per decision path;
- the published `next` list for the latest workout;
- the app shows "Nächstes Mal: …" lines and "Kommt nach der Auswertung" before the publish arrives;
- the effort note.

Commit: `feat(weeks): see what happens next time and why`.

### Task 3: "Zuletzt geändert" (Design C)

**Files:**
- `src/shared/change-notes.ts` (new)
- `src/coach/coach.ts` (bike mapping), `src/coach/gym/gym-coach.ts`, `src/coach/run/run-coach.ts`
- stats publishing
- `CoachScreen.tsx` (card)
- tests

Acceptance tests:
- the bike FTP change, a gym increase and a run phase change each produce a note;
- the caps;
- the published newest 8;
- the card shows 5 lines with date and reason.

Commit: `feat(weeks): one place shows what the coaches changed and why`.

### Task 4: Chat with date and time, forwarded requests visible (Designs D and E)

**Files:**
- `src/tracking/ui/CoachScreen.tsx`, `WorkoutCoach.tsx`, `src/shared/dates.ts`
- `src/coach/coach-tasks.ts`, `src/shared/records.ts`, `validate.ts`
- `runtime.ts`
- `RulesCard.tsx`
- `scripts/ui-shots/run.ts` (shot `week-chat`)
- tests

Acceptance tests:
- day separators and times;
- "Ältere anzeigen" adds 30;
- task records are migrated once (idempotent), listed, removable, expire as before, and bump the plan key.

The shot must render.

Commit: `feat(weeks): chat with dates and times, forwarded requests visible`.
