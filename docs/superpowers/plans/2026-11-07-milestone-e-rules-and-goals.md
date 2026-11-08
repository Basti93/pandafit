# Milestone E: My rules and goals take effect

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein E — Brief". Spec: `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md` §5 (goals, l.65–73) and §13 (rules, l.153–175).

## Global Constraints

- Before each task, check that no ride is open: the live file `rides/live/current.jsonl` must be older than one hour, and no `rides/ride-*/meta.json` may have status open.
- No npm install, no new dependencies, no push, no deploy.
- Public repo: no personal data. Tests use invented rule texts.
- A workout is never lost. Rules never change logged workouts.
- Light UI: one card "Meine Regeln und Ziele" on the week page, one line per rule, plain German, and no ids or numbers beyond what is needed.
- General mechanisms only: no exercise names in code, and examples only in tests.
- Reuse the milestone D pieces:
  - `src/shared/changes.ts` pattern (record + state moves + rank merge in `applyRecord`);
  - `src/shared/wording.ts` (Übernehmen / Nein danke / Rückgängig / gehtNicht);
  - the `NextChangeCard` style.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task. Tests pinning replaced behaviour are deleted.

## Today (from exploration)

- **Goal:** hard-coded `GymState.goal = 'muscle'` (`src/coach/gym/state.ts:9,44`).
  - Readers: `muscleVolume`/`weeklySetRange` (`src/shared/muscle-targets.ts:62`), the gym prompt, the chat coach `dataBlock('ziel')` (`chat-coach.ts:311`), and stats (`src/shared/stats.ts`, `src/tracking/stats.ts:143`).
  - The run coach reads no goal. The bike coach has its own free-text phase goal and motives, which stay.
- **Rules:** free text kept in Mac-side JSON and not synced.
  - Gym: `GymState.rules` (`gym-coach.ts:405,473–487`, prompt `dataBlock('regeln')`, Mac UI `src/ui/views/GymView.tsx:173`).
  - Bike: `s.rules` (`coach.ts:358,640`, Mac UI `CoachView.tsx:152`).
  - Complaints are separate and stay as they are.
  - Coach tasks `lasting` (`src/coach/coach-tasks.ts`) stay; that is H.
- **Enforcement points for an excluded exercise:**
  - `guardrails.ts` `GymContext` (l.9–12) and `checkWorkout` (l.107), with `reasonPhrase` (l.150);
  - `rules.ts` `ruleWorkout` `allowed()` (l.~28);
  - gym `prompt.ts` exercise lists (l.99–109);
  - `src/tracking/similar.ts:25`;
  - `startFromPlan` / `startFromRoutine` (`src/tracking/session.ts:104–134`);
  - chat workout `checkOps` (`chat-coach.ts` ~210 and `src/tracking/workout-change.ts`), and next-change ops (`src/shared/changes.ts`).

## Design

### Records (`src/shared/personal.ts`, new)

- **`goal`** (one per profile, id `goal`):
  - Body: `{ strength: 'muscle' | 'strength' | 'fitness', focus: MuscleGroup[] (≤3), sports: { gym?: Prio, bike?: Prio, run?: Prio }, atMs }`, where `Prio = 'focus' | 'equal' | 'keep'`.
  - Missing record → `{ strength: 'muscle', focus: [], sports: {} }`, so today's behaviour holds.
  - Written directly by the person in the UI. A chat proposal for a goal change uses the rule proposal flow with `kind: 'goal'` (below).
- **`rule`** (many per profile, id `rule-<id>`):
  - Body: `{ kind: 'exclude' | 'wish' | 'goal', text: string (≤120), sport: 'gym' | 'bike' | 'run' | 'all', exerciseIds?: string[] (exclude, 1–30), goal?: Partial<GoalBody> (kind goal), state: 'proposed' | 'active' | 'paused' | 'declined', source: 'chat' | 'person' | 'migrated', atMs }`.
  - Deleting writes a tombstone.
  - Proposals of kind `goal` turn into a write of the goal record on take. The rule record then becomes state `active` and is hidden from the list, as a log.
- **State moves:**
  - `proposed` → `active` | `declined`;
  - `active` ↔ `paused`.
  - A tombstone wins every merge.
  - In `applyRecord`, a `rule` uses the rank of `declined` / tombstone like `change` does. `active` and `paused` have equal rank, so the stamp decides between them (a toggle).
- **Pure helpers:**
  - `goalOf(records)`;
  - `activeRules(records, sport, nowMs)`;
  - `excludedIds(records)` (the union of active exclude rules);
  - `wishes(records, sport)`.
- Add both kinds to `RECORD_KINDS`, `validate.ts`, and the zod parsers.

### Enforcement (one excluded set, everywhere a plan or suggestion is made)

- **Gym coach:**
  - `GymContext.excluded: Set<string>`, built where the context is built (`gym-coach.ts` ~334), from the profile's records. Read them like `loadStepsOf` reads loadstep records.
  - The prompt lists leave the excluded exercises out and add one line: "Ausgeschlossen (Regel der Person): <titles>".
  - `checkWorkout` rejects them with the reason phrase "eine Übung, die du ausgeschlossen hast".
  - `ruleWorkout` filters them out.
  - The goal replaces `state.goal` everywhere: `weeklySetRange`, the prompt, the chat `ziel` block, and stats. Remove `GymState.goal`.
  - Focus groups go to the prompt as "Schwerpunkt: …". The sport priorities go to all planners' prompts as one line each.
- **Tracking:**
  - `similarExercises` takes an optional excluded set and filters it.
  - `startFromPlan` / `startFromRoutine` drop excluded exercises and report them through the existing `onSkipped`-style notice: "Ohne <Titel> – deine Regel."
  - The ExercisePicker shows everything; the person's own choice is not blocked.
- **Chat:** workout ops and next-change ops that swap in or add an excluded exercise are refused with `gehtNicht(['du <Titel> ausgeschlossen hast'])`. Wishes for this sport go into the chat prompt as "Wünsche (nicht prüfbar): …".
- **Run and bike coach:** active wishes for their sport (and for 'all') go into their prompts as "Wünsche der Person (nicht prüfbar): …". Exclude rules are gym-only.
- **Migration** (once, coach side): existing `GymState.rules` and bike `s.rules` texts become `rule` records `{ kind: 'wish', state: 'active', source: 'migrated', sport }`. Then remove the old fields, their prompt blocks, the Mac UI rule lists and the remove-rule protocol messages.
  - Ids are deterministic (hash of sport + text), so a rerun creates no duplicates.
  - The gym coach's AI-created rule (`gym-coach.ts:405`) and `keepComplaint`-created rules stop writing rules; complaints stay complaints.

### Chat proposals

- The chat coach schema gets `ruleDraft?: { kind, text, sport, exerciseIds?, goal? }`, gated to rider messages (like the next-change draft).
- The prompt explains the difference between a one-time "nächstes Mal ohne X" (next change), "künftig/immer/nie" (a rule), and a goal change.
  - For exclude rules, the coach lists all catalog ids of the matching exercise and its variants. The validator drops unknown ids. An exclude rule without any valid id becomes a wish with the reason line.
- The coach writes the `rule` record with state `proposed` before the message (same as the change pattern). The message refers to it.

### UI

- **`RuleCard`** (in the chat, like `NextChangeCard`): the text, and for exclude rules "Betrifft: <Titel>, <Titel> …".
  - Buttons: Übernehmen / Nein danke. After taking, it shows "Gilt ab jetzt" with a Rückgängig button, which tombstones the rule.
- **Card "Meine Regeln und Ziele"** on the week page (`CoachScreen.tsx`, near `PrefsCard`):
  - **Goal line:** a select for the strength goal; up to three focus muscles as small toggles from the B groups; per sport a select Schwerpunkt / gleichrangig / erhalten (only sports the profile uses; when unsure, show all three).
  - **Rules:** one line per active or paused rule (the text, plus "Wunsch" for wishes), with "Pausieren"/"Fortsetzen" and "Löschen".
  - **"Regel hinzufügen":** a text field. It creates a wish directly (source person). An exclude rule needs the exercise picker: "Übung ausschließen" opens the existing ExercisePicker and creates an exclude rule with that one id.

## Tasks

### Task 1: Records, helpers and migration

**Files:**
- `src/shared/personal.ts` (new)
- `src/shared/records.ts`, `src/web/validate.ts`
- `src/coach/tracking/personal.ts` (new reader)
- migration on the coach side (`src/coach/gym/*`, `src/coach/coach.ts`, `runtime.ts`)
- removal of the old rule paths (incl. `src/ui/views/GymView.tsx`, `CoachView.tsx`, `src/shared/coach-protocol.ts` messages)
- tests

Acceptance tests:
- default goal without a record;
- state moves and the merge (a tombstone wins in both orders, paused/active toggle by stamp);
- `excludedIds` covers only active exclude rules;
- migration turns old texts into wish records once (a rerun adds nothing), and the old fields are gone.

Commit: `feat(rules): personal rules and goals are synced records`.

### Task 2: Enforcement and goal effect

**Files:**
- `src/coach/gym/{guardrails,rules,prompt,gym-coach,state}.ts`
- `src/shared/muscle-targets.ts` + the callers of `weeklySetRange` / goal
- `src/tracking/similar.ts`, `src/tracking/session.ts`, `src/tracking/ui/WorkoutScreen.tsx`
- `src/tracking/workout-change.ts`, `src/shared/changes.ts`
- `src/coach/chat/chat-coach.ts` (ops refusal)
- `src/coach/run/*`, `src/coach/coach.ts` (wishes into prompts)
- tests

Acceptance tests:
- an excluded id never appears in the gym prompt list, the ruleWorkout output, a similar-exercise suggestion, or a workout started from a plan or routine (with a notice);
- `checkWorkout` rejects it with the phrase;
- a chat swap into it is refused with "Das geht nicht, weil …";
- a paused or deleted rule has no effect;
- goal 'strength' changes the weekly ranges as `weeklySetRange` defines for non-muscle goals;
- wishes appear in the gym, run, bike and chat prompts for their sport.

Commit: `feat(rules): excluded exercises never come back, goals steer every planner`.

### Task 3: Chat proposals

**Files:** `src/coach/chat/chat-coach.ts` (+ schema/prompt), `src/shared/chat.ts`, `src/tracking/ui/RuleCard.tsx` (new), `CoachScreen.tsx` / `WorkoutCoach.tsx` (render the card), tests.

Acceptance tests:
- a rider message "künftig keine Kniebeugen" (mocked AI) → a proposed exclude rule with valid ids; Übernehmen → active, and the enforcement from Task 2 holds;
- unknown ids are dropped, and no valid id gives a wish with a reason;
- coach-initiated messages cannot create drafts;
- a goal proposal on take writes the goal record;
- reload keeps the state.

Commit: `feat(rules): the coach proposes rules and goals in the chat`.

### Task 4: "Meine Regeln und Ziele" card

**Files:**
- `src/tracking/ui/RulesCard.tsx` (new)
- `CoachScreen.tsx`, `tracking.css`
- `scripts/ui-shots/run.ts` (shot `week-rules`)
- tests

Acceptance tests:
- the card lists active and paused rules;
- pause, continue and delete write the right records;
- "Übung ausschließen" via the picker creates an exclude rule;
- the goal selects write the goal record;
- at most three focus muscles.

`npm run build && npm run ui:shots -- /private/tmp/claude-501/ui-shots-e week-rules` must render.

Commit: `feat(rules): see and manage my rules and goals on the week page`.
