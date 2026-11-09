# Milestone C: Weights fit the equipment

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein C — Brief". Spec: `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md` §9 and §11. Science: `docs/research/2026-11-06-training-science-foundation.md` (table "Gym: global 6–12 …"). Scenario F02 in `src/shared/training-policy/scenarios.ts`.

## Global Constraints

- Before each task, check that no ride is open: `~/Library/Application Support/bike-coach/rides/live/current.jsonl` must be older than one hour.
- No npm install, no new dependencies, no push, no deploy (`npm run app`).
- Public repo: no personal data. Tests use invented titles and studio names.
- Workouts are never rewritten. Old workouts without a studio keep counting (rule below).
- Light UI: one short line where needed, no tables, no new screens.
- General mechanisms only: no per-exercise or per-name special cases. Values that are product choices live in the policy register (`src/shared/training-policy/rules.ts`), read via `ruleNumber` / `ruleRange` / `policyRule`.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `npm test` and `npm run typecheck` are green after each task. Tests that pin the replaced global behaviour (6–12, 2.5 kg / 5 %, three "0 left" step back) are deleted, not adapted (roadmap rule 6).

## Design

### Studio

- `LoggedWorkout` gets an optional `studio?: string`: the trimmed name, max 40 characters. `TrackedWorkout` carries it too. Old records have none.
- **Main studio:** a profile's main studio is the studio of its earliest workout that has one. Workouts without a studio count for the main studio. This covers old workouts and Hevy imports. As long as no workout has a studio, everything is one bucket.
  - Implement this once as `studioKey(w, main)` plus `mainStudio(workouts)` in `src/shared/studio.ts`. Every caller uses it.
- **Picking:** the workout screen shows one small line before and during a workout: "Studio: <Name>" with a select. It offers known names (from this profile's own workouts, newest first) and "Neues Studio …", which opens a text input. The default is the studio of the newest own workout.
  - Changing it during a workout sets `studio` on the open workout.
  - No studio known yet: the line reads "Studio: –", and nothing is stored until a name is picked.
- `StrengthWorkout` (`src/coach/hevy.ts`) gets an optional `studio?: string`, and `toStrengthWorkout` copies it.
- The coach plans for the studio of the newest own workout. `GymCoach` and the prompt get that name: one line "Studio: <Name>", or nothing when none is known.

### Weight steps (`src/shared/loads.ts`, new)

- **Learned ladder** per exercise and studio: `learnLadder(weights: number[], equipment: string): { stepKg: number; anchorKg: number; learned: boolean }`.
  - **Input:** all set weights > 0 of this exercise in this studio, from the newest 10 sessions.
  - **Grid:** work on a 0.25 kg grid. `d` = gcd of the differences between distinct weights.
  - **Default:** `def` comes from the register rule `load.default-step`, by equipment (`ranges`/value map). The values are barbell 2.5, dumbbell 2, machine 5, kettlebell 4, none 2.5, other 2.5.
  - **Step:**
    - fewer than 2 distinct weights → `stepKg = def`, `learned = false`;
    - `d ≤ def` → `d`;
    - `d` is a multiple of `def` → `def`, because few data points overestimate the step;
    - otherwise → `d`, for stacks like 7 kg plates.
    - Clamp the result to ≥ 0.5.
  - **Anchor:**
    - normally the smallest observed weight;
    - barbell equipment with no observations: the bar weight;
    - otherwise, with no observations: 0.
- **Person override:** a new record kind `loadstep` (add it to `RECORD_KINDS`).
  - Id: `step-<hash(exerciseId + '|' + studioKey)>`. Body: `{ exerciseId, studio, stepKg }`. A tombstone means "learned again".
  - The override replaces `stepKg` and keeps the anchor.
  - Parse it with zod like the other records. `stepKg` must be one of `load.step-choices`: 0.5, 1, 1.25, 2, 2.5, 4, 5, 7, 10.
  - The coach side reads these records the same way it reads `exercise` records today (follow that path through `runtime.ts` / `household.ts`).
- **Reachable weights:** a weight is reachable when `anchor + k × step` holds for an integer k ≥ 0.
  - `nextUp(w, ladder)` gives the smallest reachable weight > w.
  - `snapDown(w, ladder)` gives the largest reachable weight ≤ w, but never below the anchor (it returns the anchor instead).
  - `nearestDown(w × share)` is used for step-back.
- **Plates** (barbell only): `platesPerSide(totalKg)` uses the bar `load.bar-kg` (20) and the plates `load.plates` [25, 20, 15, 10, 5, 2.5, 1.25] in unlimited pairs, filled greedily.
  - It returns `{ status: 'exact' | 'between' | 'below-bar', perSide: number[], lower?: number, upper?: number }`.
  - With 'between', it gives the two nearest exact totals.
- Rules are new in the register (product, active): `load.default-step`, `load.step-choices`, `load.bar-kg`, `load.plates`. Each has a short German text and `where: ['src/shared/loads.ts']`.

### Progression (`src/coach/gym/history.ts`)

- **Rep range per exercise:** `repRangeOf(exercise)` = `MUSCLE_TARGETS[muscleGroupOf(e)].reps` (already in the register via `muscle.target.<group>`). It lives in `src/shared/muscle-targets.ts`.
  - An unresolved exercise uses the `other` group's range.
  - `suggestNext` receives the exercise (through the catalog) instead of using global REP_MIN/REP_MAX.
- **Comparable sessions:** only sessions in the same studio key.
  - Several occurrences of an exercise in one workout are one session: merge their work sets.
- **Weight up:** when the reps reach the range max, the next weight is `nextUp(top, ladder)`, and the reps start at the range min. This replaces MAX_STEP_PCT, MIN_STEP_KG and `toHalf`.
- **Effort "none" (0 left):** it is no longer a reason to keep or lower the weight on its own. The numbers decide, as with unknown effort (scenario F02). "plenty" still allows the faster step as today.
- **Step back:**
  - after the long break (as today);
  - or when the top-weight reps dropped against the session before at the same or a higher weight, in `gym.drop-step-back-count` (new, 2) comparable sessions in a row.
  - The target is the nearest reachable weight at or below `top × STEP_BACK`.
- **Remove these rules:** `gym.rep-range`, `gym.min-step-kg`, `gym.max-step-pct`, `gym.effort-step-back-count`. Bump `POLICY_VERSION`.
- **Guardrails** (`guardrails.ts`):
  - planned weights are first snapped down to the exercise's ladder (`snapDown`), so nothing unreachable reaches the person;
  - the cap is `nextUp(suggestion)` instead of the percentage;
  - planned reps are checked against the exercise's rep range widened by today's slack (keep the existing slack logic, with the per-exercise range in place of REP_MIN/REP_MAX).
- **Prompt:** per exercise, the rep range and the step in words ("in 5-kg-Stufen"), plus the studio line. No other new numbers.

### Display (`src/tracking/ui`)

- **Set hint:** the rep range in the existing set hint comes from `repRangeOf`.
- **Barbell plates:** for exercises with equipment `barbell`, the next not-done set with a weight gets one extra muted line:
  - "Pro Seite: 20 + 2,5";
  - or "Nicht genau auflegbar – 60 oder 62,5";
  - or "Leichter als die Stange (20 kg)".
- **ExerciseInfo:** one line "Gewichtsstufen hier: 5 kg (gelernt)" or "… 5 kg (von dir)", with a small select that holds "gelernt" plus the `load.step-choices` values.
  - Choosing a value writes the `loadstep` record; choosing "gelernt" writes a tombstone.
  - "hier" is the studio of the open workout, else the default studio.

## Tasks

### Task 1: Studio

**Files:**
- `src/shared/records.ts`
- `src/shared/studio.ts` (new)
- `src/tracking/session.ts`, `src/tracking/store.ts` (if needed)
- `src/tracking/ui/WorkoutScreen.tsx`, `src/tracking/ui/tracking.css`
- `src/coach/hevy.ts`, `src/coach/tracking/merge.ts`
- tests in `tests/shared`, `tests/tracking`, `tests/coach`

Do:
- the studio field;
- `mainStudio` / `studioKey`;
- the picker line;
- carry-through to `StrengthWorkout`.

Tests:
- old workouts without a studio count for the main studio;
- the picker default is the newest workout's studio;
- a studio set during a workout is saved and synced like any field (round trip through `applyRecord` / the store);
- a Hevy workout gets the main studio key.

Commit: `feat(loads): every workout belongs to a studio`.

### Task 2: Ladder, plates and the step override

**Files:**
- `src/shared/loads.ts` (new)
- `src/shared/training-policy/rules.ts`
- `src/shared/records.ts` (`loadstep` kind + schema)
- the record plumbing that `exercise` records use on the coach side
- tests

Do: `learnLadder`, `nextUp`, `snapDown`, `platesPerSide`, the four register rules, and the record kind and parser.

Tests (acceptance):
- weights 40/45/50 on a machine → step 5;
- 7/14/21 → step 7, and nextUp(14) = 21;
- dumbbells 12.5/15 → 2.5;
- a single weight → the equipment default, `learned: false`;
- an override wins and a tombstone undoes it;
- plates: 62.5 → [20, 1.25] exact; 61 → between 60 and 62.5; 15 → below-bar.

Commit: `feat(loads): learn each exercise's weight steps per studio, plates per side`.

### Task 3: Progression per exercise

**Files:**
- `src/coach/gym/history.ts`, `limits.ts`, `guardrails.ts`, `prompt.ts`, `gym-coach.ts`, `rules.ts` (coach fallback)
- `src/shared/muscle-targets.ts` (`repRangeOf`)
- `src/shared/training-policy/rules.ts`
- tests in `tests/coach/gym`

Do everything under "Progression". Delete the old tests that pin the global range or step.

Tests (acceptance):
- F02: three sessions at 0 left with rising reps → the weight is not lowered, and it progresses at the range max;
- two drops in a row → step back onto a reachable weight;
- the range max reached on a 5-kg machine → +5, with reps at the range min;
- a lateral raise uses its group's range (12–25) and not 6–12;
- a guardrail snaps 47 on a 5-kg ladder down to 45;
- history in another studio is not used.

Commit: `feat(loads): progression per exercise on reachable steps, 0 left is not punished`.

### Task 4: Plates and steps in the app

**Files:**
- `src/tracking/ui/WorkoutScreen.tsx`, `SetRow.tsx` (hint), `ExerciseInfo.tsx`, `tracking.css`
- `scripts/ui-shots/run.ts` (a shot `workout-plates`)
- tests in `tests/tracking`

Do everything under "Display".
- `npm run build && npm run ui:shots -- /private/tmp/claude-501/ui-shots-c workout-plates` must render.
- Add a fixture if needed.

Commit: `feat(loads): plates per side and the weight step in the app`.
