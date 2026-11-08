# Meilenstein V „Absprachen halten“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agreements reach the workout. No coach treats a planned session as done. Recovery hints are current and dated. Tasks live exactly as long as they are meant to. Runs count without a run plan.

**Architecture:** The changes are mostly in the coach server (`src/coach/**`) and shared logic (`src/shared/**`), with small web changes (`src/tracking/ui/**`). No new record kinds. Some existing records get optional fields (`AlsoPart.minutes`, `CoachTask.forDate`, `coachText.atMs`). Validators accept old bodies without the fields.

**Tech Stack:** TypeScript, React, vitest (`npm test`), Node coach server.

**Spec:** `docs/roadmap.md`, section „Meilenstein V — Brief (Entwurf 08.11.2026)“, acceptance 1–5.

## Global Constraints

- A ride is never lost. Logging a workout works without network and without AI.
- No personal data, names or tokens in the repo, tests included. Use neutral example data.
- UI text is German, calm and short. No extra numbers in the UI beyond what a task names (Leitsatz „keine Zahlenflut“).
- General mechanisms, no special cases for named exercises or people.
- Optional new fields: old records without them stay valid. Never reject an old body.
- Tests by purpose: the acceptance cases are new tests. Tests for a replaced heuristic are deleted, not bent.
- Run `npm test` and `npx tsc --noEmit -p .` (or the project typecheck script in `package.json`) before each commit.

## Review Focus

1. A plan day „ohne Beine“ for a later day than today. Expected: the gym plan made today for that day has no leg exercises (Task 1).
2. A confirmed swap whose original exercise is missing after a replan. Expected: the swap still applies to an exercise of the same main muscle, or it stays open for the next workout with a visible note. It is never marked used without being applied (Task 3).
3. A plan day in the past or today without an activity. Expected: every coach prompt marks it as not done (Task 5).
4. Health findings change mid-week. Expected: the weekly text is rebuilt (at most one AI call per day) and shows its date (Task 6).
5. A task „am Montag …“ created on Friday. Expected: it is open until Monday ends, then gone. A task for the next session ends when that sport's next session exists (Task 7).

---

### Task 1: „Ohne Beine“ applies to the day the gym coach plans for

**Files:**
- Modify: `src/coach/tracking/frame.ts` (extract the plan date)
- Modify: `src/coach/runtime.ts:228` (`avoidLegsToday`)
- Modify: `src/coach/gym/gym-coach.ts` (dependency name, plan key)
- Modify: `src/coach/chat/plan-hint.ts:24` (send `beine`)
- Test: the existing test files next to these modules (`*.test.ts`)

**Interfaces:**
- Produces: `gymPlanDateOf(store: Reader, profileId: string, todayDate: string): string` in `frame.ts`. It returns today in spontaneous mode; otherwise the next gym plan day without a finished workout; otherwise today. `gymBudgetOf` uses it.
- Produces: the gym coach dependency `avoidLegs(id: string): boolean` replaces `avoidLegsToday`. It is true when the plan day at `gymPlanDateOf` has `legs === false` and holds gym (`hasSport`), or when that date is today and today's advice has `legs === false` for gym (the current rule).

- [ ] **Step 1: Write the failing tests.**
  - `gymPlanDateOf`: week plan with gym on Thursday, today is Tuesday → Thursday. Gym on Tuesday with a finished workout on Tuesday → Thursday. Spontaneous frame → today.
  - `avoidLegs`: plan Thursday gym `legs:false`, today Tuesday, no gym before Thursday → `true`. Same plan with `legs` unset → `false`.
  - `planHint`: a plan day with `legs:false` yields `"beine":false` in the `wochenplan` block. A day without `legs` has no `beine` key.
  - The gym plan key changes when the `legs` value of the target plan day changes, so a new agreement makes the coach plan again.
- [ ] **Step 2: Run the tests. Expect FAIL.**
- [ ] **Step 3: Implement.** Find where the gym coach builds its plan key (look for `personalKeyOf` and `adviceKey` in `runtime.ts` and `gym-coach.ts`). Add `${date}:${legs}` of the target plan day to the key. In the `planHint` prompt sentence, add one short sentence: `beine false heißt: an diesem Tag keine Beinübungen.`
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `fix(gym): no legs on the planned day, not only today`.

### Task 2: The start checks „ohne Beine“ of today

**Files:**
- Modify: `src/tracking/session.ts:167` (`startFromPlan`)
- Modify: `src/tracking/ui/WorkoutScreen.tsx:487-499` (pass today's plan day)
- Create if needed: `src/shared/legs.ts` with `LEG_MUSCLES` moved from `src/coach/gym/history.ts:11` (the coach re-imports it)
- Test: `src/tracking/session.test.ts` (or the existing test file of `startFromPlan`)

**Interfaces:**
- Consumes: `planFor(records, date)` from `src/shared/week-plan.ts`, the `weekplan` records on the device.
- Produces: a new option of `startFromPlan`: `noLegs?: boolean`. When it is true, exercises whose main muscle is in `LEG_MUSCLES` are dropped. The start notice says `Ohne Beine, wie abgesprochen.` Muscles come from the catalog the start already gets.

- [ ] **Step 1: Write the failing test.** A plan with a squat-type exercise (muscle `quadriceps`) and a bench-type exercise, `noLegs: true` → only the bench-type exercise remains, and `onSkipped` or the notice contains `Ohne Beine, wie abgesprochen.` With `noLegs` unset, both stay.
- [ ] **Step 2: Run. Expect FAIL.**
- [ ] **Step 3: Implement.** `WorkoutScreen` sets `noLegs` when today's plan day has `legs === false` and holds gym. Never drop all exercises: if every exercise is a leg exercise, keep the plan and show the notice `Heute war ohne Beine abgesprochen.`
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `fix(workout): start without legs when the day says so`.

### Task 3: A confirmed swap is never lost silently

**Files:**
- Modify: `src/shared/changes.ts:78-103` (`applyNextChanges`)
- Modify: the place where `startFromPlan` lists the changes on the new workout (only applied ones)
- Modify: `src/coach/gym/gym-coach.ts` near `withTaken` (line ~154): the gym prompt names taken swaps
- Test: `src/shared/changes.test.ts`

**Interfaces:**
- `applyNextChanges` keeps its signature. New behavior for `swap` when `o.exerciseId` is not in the plan:
  1. If `o.toId` is already in the plan, the change counts as applied.
  2. Else take the first plan exercise with the same main muscle as the original (catalog lookup), which is not excluded, and swap it.
  3. Else push the note `Ein Tausch passte nicht zu diesem Training und bleibt fürs nächste.` and do not add the change id to `applied`.
- The workout lists only `applied` change ids, so `usedMarks` marks only those. Unapplied changes stay `taken`.
- The gym planner prompt gets the taken swaps as data: `tausch: [{statt: <title>, nimm: <title>}]`, with the sentence `Bestätigte Tausche gelten: plane die Übung aus nimm statt der aus statt.`

- [ ] **Step 1: Write the failing tests** for cases 1–3 above, and one test that a change not applied is absent from the listed changes.
- [ ] **Step 2: Run. Expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `fix(changes): a confirmed swap survives a replan`.

### Task 4: A second session with minutes („Kraft + 15 Min. Rad locker“)

**Files:**
- Modify: `src/shared/week-plan.ts:10` (`AlsoPart`), its reader (around line 76-79), `dayLabel` / `planDayText`
- Modify: `src/coach/chat/chat-coach.ts:133` (schema of `also`) and the chat guide text that explains `also`
- Modify: `src/coach/chat/plan-hint.ts` (`auch` carries `minuten`)
- Modify: `src/coach/tracking/frame.ts` `gymBudgetOf`: subtract the `also` minutes when the plan day holds gym and has `also.minutes`
- Modify: `src/tracking/ui/WorkoutScreen.tsx`: the start notice adds `Dazu heute: 15 Min. Rad locker.` from today's plan day
- Test: `src/shared/week-plan.test.ts`, `frame` tests

**Interfaces:**
- `AlsoPart = { sport: Sport; hardness: Hardness; minutes?: number }`. Valid minutes: integer 5–90. Other values are dropped (the part stays without minutes).
- Chat schema: `also.minutes` is `{ type: ['integer', 'null'] }` and required with `null` for none, if the schema uses strict mode; follow the existing pattern of the file.

- [ ] **Step 1: Write the failing tests.** Reader keeps `minutes: 15`, drops `minutes: 500` and `minutes: '15'`. Label of a gym day with `also {bike, easy, 15}` is `Kraft + 15 Min. Rad locker` (check the existing label format first and keep its style). `gymBudgetOf` with frame 60 minutes and `also.minutes 15` on the gym day → 45.
- [ ] **Step 2: Run. Expect FAIL.**
- [ ] **Step 3: Implement.** Tell the chat in its guide: a wish like „15–20 Min. Ausdauer im Gym“ is `also` with `minutes` (the lower value), not a note.
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `feat(plan): a second session with minutes`.

### Task 5: Planned and done are separate for every coach

**Files:**
- Modify: `src/shared/day-rating.ts:7-39` (`RatingEntry`, `DayRating`, `ratingsFromEntries`)
- Modify: `src/coach/day-load.ts:51-73` (planned entries flagged)
- Modify: `src/coach/chat/plan-hint.ts` (`erledigt` per past/today day)
- Modify: `src/coach/runtime.ts` (pass done sports per date into `planHint`; `sessionsOf` lines ~327-345 mark `kraft`/`rad` as `geplant: true`)
- Modify: `src/coach/activity-feed.ts:50-55` and `src/coach/chat/chat-coach.ts:401-412` wording
- Modify: `src/coach/strength.ts:10-17` (`strengthPromptData`: only `startMs <= now`)
- Test: tests next to each module

**Interfaces:**
- `RatingEntry` gets `planned?: true`. `DayRating.sports` holds only done sports. New `DayRating.plannedSports?: SportKey[]`. Hardness, legs and minutes still combine both (planning needs them).
- `planHint(records, nowMs, sport, ctx?, done?: Record<string, Sport[]>)`. For each listed day with `date <= today`, add `erledigt: [<sport>…]` (empty array if nothing). Add the sentence: `erledigt nennt, was an dem Tag wirklich gemacht wurde. Ein vergangener Plantag oder heute ohne den geplanten Sport in erledigt ist nicht gemacht.`
- Runtime builds `done` from `allActivities` (the same merge as milestone U, each activity once) mapped to `Sport` (`kraft→gym`, `rad→bike`, `lauf→run`, others ignored).
- Wording: replace „geplant oder nicht“ with „auch ohne Plan“.

- [ ] **Step 1: Write the failing tests.** `dayRatings` with a planned gym session on Sunday and no done workout → `sports` lacks gym, `plannedSports` has gym. `planHint` on Sunday with a gym plan day and empty done → the block has `"erledigt":[]` for Sunday; Monday (future) has no `erledigt`. `strengthPromptData` drops an item with `startMs > now`.
- [ ] **Step 2: Run. Expect FAIL.**
- [ ] **Step 3: Implement.** Check every reader of `DayRating.sports` (grep) and keep its meaning „done“. Where a reader needed planned sports too, use both lists.
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `fix(coach): planned is never done`.

### Task 6: The weekly health text is current and dated

**Files:**
- Modify: `src/coach/health/coach-text.ts` (`HealthCoachText.tick`, `CoachTexts`)
- Modify: `src/shared/health.ts:23,47-50` (`coachText` shape and reader)
- Modify: `src/tracking/ui/health-view.ts:25` and the view that shows `firstLine`
- Test: `src/coach/health/coach-text.test.ts`, `src/shared/health.test.ts`, health-view tests

**Interfaces:**
- `coachText?: { week: string; text: string; atMs?: number; key?: string }`. `key` is a stable string of the current findings (rule ids and texts, sorted). Old bodies without `atMs`/`key` stay valid.
- Rebuild rule in `tick`: rebuild when the week changed or when `key` differs from the stored one. At most one AI call per profile and local day. If the AI was already asked today, use `fallbackCoachText(findings)` at once.
- UI: under the first line, a muted line `Stand: <Wochentag kurz>, <Datum>` (e.g. „Stand: Mo., 3.11.“) from `atMs`; nothing without `atMs`.

- [ ] **Step 1: Write the failing tests.** Same week, changed findings → new text and new `atMs`. Same week, same findings → no rebuild. Two changes on the same day → the second uses the fallback, with no second AI call. Reader accepts old body `{week, text}`. View shows the „Stand“ line only with `atMs`.
- [ ] **Step 2: Run. Expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `fix(health): weekly text follows new findings and shows its date`.

### Task 7: Tasks live as long as they are meant

**Files:**
- Modify: `src/shared/tasks.ts` (`CoachTask`, `readTask`, `taskAlive`, constants)
- Modify: `src/coach/coach-tasks.ts` (`readTasks`, `zTasks`, `tasksJsonSchema`, `TASKS_GUIDE`, `hint`, new `settle`)
- Modify: `src/coach/chat/chat-coach.ts:~198` (lasting wish from the person → proposed personal rule)
- Modify: `src/coach/runtime.ts` (call `settle` in the scan loop)
- Modify: `src/tracking/ui/GoalRules.tsx` (show `bis <Wochentag>` for dated tasks, „bis zur nächsten Einheit“ for the rest)
- Test: `src/shared/tasks.test.ts`, `src/coach/coach-tasks.test.ts`

**Interfaces:**
- `CoachTask` gets `forDate?: string` (`YYYY-MM-DD`). `taskId` stays unchanged (do not hash `forDate`).
- `taskAlive(t, nowMs)`: lasting → 60 days (`LASTING_MS`). With `forDate` → until the end of that local day. Otherwise a safety cap `ONE_OFF_CAP_MS = 28 days`. Remove `ONE_OFF_MS`.
- `CoachTasks.settle(profileId: string, sessions: { sport: CoachId; startMs: number }[], nowMs: number): void`. It sets `doneMs = nowMs` on every open, not lasting task without `forDate` whose target sport has a session with `startMs > atMs`. Dated tasks are not settled by sessions; they expire.
- Runtime maps `allActivities` to sessions (`kraft→gym`, `rad→bike`, `lauf→run`).
- Task schema item: `{ coach, text, lasting, forDate }` with `forDate` a `YYYY-MM-DD` string or `null`. `readTasks` drops an invalid date (no `forDate`).
- `TASKS_GUIDE` and the chat guide: set `forDate` when the wish names a day; leave it null for „das nächste Training“.
- Chat, from the person, `lasting: true`: write a proposed wish rule (the `rule` record of `src/shared/personal.ts`, state `proposed`, kind `wish`) instead of a task. Read `personal.ts` for the record helper and the sport field. Coach-to-coach lasting tasks stay tasks.

- [ ] **Step 1: Write the failing tests.**
  - A task with `forDate` Monday, created Friday: alive Monday 23:00, not alive Tuesday 00:30.
  - A one-off without `forDate`: alive after 10 days, not alive after 29 days.
  - `settle`: a gym task from Monday, a gym session on Tuesday → `doneMs` set. A bike session does not settle it. A session before `atMs` does not settle it.
  - `readTasks` keeps `forDate: '2026-11-10'`, drops `forDate: 'Montag'`.
  - Chat lasting wish → one `rule` record with state `proposed`, no `task` record.
- [ ] **Step 2: Run. Expect FAIL.**
- [ ] **Step 3: Implement.** Delete tests that pin the old 7-day rule.
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `feat(tasks): dated tasks, done after the next session`.

### Task 8: Runs count without a run plan

**Files:**
- Modify: `src/coach/runtime.ts:250-259` (`ratingsOf`) and its callers at ~410
- Modify: `src/coach/run/run-coach.ts:201` (`lastRuns`)
- Modify: `src/tracking/ui/RunSettingsCard.tsx:34` (hint when off)
- Test: runtime/day-load tests, run-coach tests

**Interfaces:**
- `ratingsOf(id, dates, mode: 'plan' | 'done')`. Both modes include the done runs from `run.runsFor(id)`. `'plan'` also adds the next bike and gym sessions as planned entries (Task 5 flag). The bike, gym and run planners use `'plan'`; today advice and stats use `'done'`.
- `run.runs(id)` returns the runs also when running is off (mobility after a run works).
- Hint text when the switch is off: `Deine Läufe zählen trotzdem bei der Belastung mit.`

- [ ] **Step 1: Write the failing tests.** Planning ratings for the bike coach include a hard run from yesterday while the run coach is off. `run.runs(id)` is not empty with `on:false` and a Garmin run. The card shows the hint when off.
- [ ] **Step 2: Run. Expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`. Expect PASS.**
- [ ] **Step 5: Commit** `fix(run): runs count while the run plan is off`.

### Task 9: Close the milestone

- [ ] Mark V ✅ in `docs/roadmap.md`. Rename the brief heading to „(umgesetzt 08.11.2026)“. Replace „noch zu prüfen“ in „Stand vorher“ with the found causes in one sentence each. Add parking-lot items found during the work under „Aus Meilenstein V“.
- [ ] Run `npm test`. Commit `docs(roadmap): V done`.
