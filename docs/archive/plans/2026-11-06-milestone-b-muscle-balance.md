# Milestone B: The muscle balance is right

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein B — Brief". Science: `docs/research/2026-11-06-training-science-foundation.md` (H1, S03). Rules: `src/shared/training-policy/rules.ts` (`muscle.direct-weight`, `muscle.indirect-weight`, scenario F04).

## Global Constraints

- Check before each task that no ride is open: `~/Library/Application Support/bike-coach/rides/live/current.jsonl` must be older than one hour.
- No npm install, no new dependencies, no push, no deploy (`npm run app`).
- Public repo: no personal data. Tests use invented titles.
- Workouts are never rewritten. Old workouts count correctly through the catalog.
- Light UI: four words, no number walls. Numbers only one tap away.
- General mechanisms only. Which muscle an exercise trains lives in exercise data, never in name lists or regexes.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `npm test` and `npm run typecheck` are green after each task.

## Design

- **Muscle vocabulary** (`MUSCLES` in `src/tracking/ui/labels.ts`; move it to `src/shared/muscles.ts` and re-export from labels, which fixes the parked layering item):
  - Add `front_delts` ("Schulter vorn"), `side_delts` ("Schulter seitlich") and `rear_delts` ("Schulter hinten").
  - Keep `shoulders` ("Schultern") as a legacy value. Counted as `front_delts`.
- **Groups** (`MuscleGroup` in `src/shared/muscle-targets.ts`): `chest, back, front_delts, side_delts, rear_delts, biceps, triceps, quads, hamstrings, glutes, calves, abs, traps, forearms, other`.
  - `hams_glutes` and `side_rear_delts` disappear.
  - The mapping is by muscle only; the regex and the id list go.
- **Targets** (weekly sets, `muscle` / `other`), as product rules in the register, rule ids `muscle.target.<group>`. Existing groups keep their values. New:
  - `hamstrings` 10–16 / 4–6
  - `glutes` 6–12 / 0–4
  - `front_delts` 6–10 / 2–4 (unchanged)
  - `side_delts` 12–20 / 6–8
  - `rear_delts` 8–16 / 4–6
  - Reps:
    - hamstrings 6–12
    - glutes 8–15
    - side_delts 12–25
    - rear_delts 12–25
- **Effective sets** = direct sets × `muscle.direct-weight` (1) + sets of exercises where the group is a secondary muscle × `muscle.indirect-weight` (0.5).
  - A group counts at most once per exercise.
  - The primary muscle wins over the secondaries.
  - A secondary that maps to the same group as the primary is ignored.
- **State per group** from the last 7 days of effective sets against `weeklySetRange(group, goal)`:
  - `none`: 0
  - `low`: < min
  - `good`: min..max
  - `high`: > max
  - Labels: "Noch nichts", "Wenig", "Im Ziel", "Viel".
  - Groups with target max 0 (`other`) have no state.
- **Pairs:**
  - chest : back
  - quads : hamstrings+glutes
  - front_delts : side_delts+rear_delts
  - Computed on effective sets, same 2/3 rule.

## Tasks

### Task 1: Vocabulary, groups and targets

**Files:** `src/shared/muscles.ts` (new), `src/tracking/ui/labels.ts`, `src/shared/muscle-targets.ts`, `src/shared/training-policy/rules.ts` (+ tests), every consumer of `hams_glutes` / `side_rear_delts` (`grep -rn "hams_glutes\|side_rear_delts" src tests`), `src/tracking/ui/MuscleIcon.tsx` (icons for the new groups: reuse the existing shapes, no new art).

- Activate `muscle.direct-weight` and `muscle.indirect-weight` (status active) and add the target rules.
- `muscleGroupOf(e)` maps by `primaryMuscle` only. Legacy `shoulders` → `front_delts`.
- Tests:
  - every `MUSCLES` key except `full_body`, `cardio`, `other`, `abductors` and `adductors` maps to a group (abductors → glutes, adductors → quads is fine: decide and test);
  - the new targets come from the register;
  - no regex or id list is left in muscle-targets.ts.
- Commit `feat(muscles): separate glutes, hamstrings and the three shoulder parts`.

### Task 2: Exercise data for the new muscles

**Files:** `src/shared/exercises.ts`, `scripts/fedb-import.ts`, `scripts/fedb-shoulder-parts.json` (new), `src/shared/fedb-exercises.json`, `src/coach/gym/exercise-mapper*.ts` (schema/prompt), tests in `tests/shared/`.

- Built-ins:
  - every built-in gets `secondaryMuscles`;
  - with a `fedbId`, start from that base entry's secondaries, else write them;
  - shoulder built-ins get `front_delts`, `side_delts` or `rear_delts` as their primary (or secondary) instead of `shoulders`;
  - lateral raises → `side_delts`; rear-delt flies and face pulls → `rear_delts`; overhead presses → `front_delts`;
  - bench/push presses get secondaries `triceps` and `front_delts`; rows and pulldowns get `biceps` and `rear_delts`; squats and lunges get `glutes`; hinges get `glutes` and `lower_back` as fits.
- Base list: `scripts/fedb-shoulder-parts.json` maps every fedb id that has `shoulders` as primary or secondary to the part(s). The implementer classifies them once from name and instructions in the source dataset. The import maps `shoulders` through it and fails loudly when an entry with `shoulders` has no mapping. Regenerate the JSON.
- Mapper: the AI schema's muscle enum comes from `MUSCLES`, so the parts appear automatically. The prompt says to use the parts instead of `shoulders`.
- Tests:
  - no catalog entry (built-in or base) has `shoulders` as primary or secondary;
  - every built-in has `secondaryMuscles`;
  - acceptance spot checks: bench press has triceps; a row has biceps; lateral raise primary is side_delts.
- Commit `feat(muscles): every exercise knows its secondary muscles and shoulder part`.

### Task 3: One balance function

**Files:** `src/shared/muscle-balance.ts` (new), `src/tracking/stats.ts`, `src/coach/gym/muscle-volume.ts` (replace its counting with the shared function or delete it), `src/coach/gym/prompt.ts`, `src/tracking/progress.ts`, tests.

- `muscleBalance(items: { exercise: Exercise | null; sets: number; ageMs: number }[], goal): GroupBalance[]`, where `GroupBalance = { group, label, direct7, indirect7, effective7, perWeek4, state, target }`.
  - The callers resolve exercises through the catalog: `resolveExercise` on the UI side, and the gym coach's `catalog(id)` on the coach side.
  - Unresolved exercises count as `other`, direct only.
- `pairVerdicts` works on effective sets with the new pairs.
- The coach prompt gets one line per group: the label and the German state word. The direct/indirect split is given only as words ("vor allem mittrainiert" when indirect > direct). No set numbers in the prompt beyond what it shows today.
- Tests (acceptance):
  - 3 rows sets → back 3 and biceps 1.5;
  - bench 4 → chest 4, triceps 2, front_delts 2;
  - the state thresholds;
  - the same input gives the same states in stats and coach.
- Commit `feat(muscles): one balance for app, statistics and coach, counting secondary work half`.

### Task 4: Four states in the statistics

**Files:** `src/tracking/ui/StatsScreen.tsx`, `src/tracking/ui/tracking.css`, tests in `tests/tracking/`.

- The main view shows trained groups (and groups below target) as one row each: muscle name and state word.
  - The four states get a calm color scale from the existing tokens.
  - A small "mittrainiert" note appears when indirect > direct.
- Tapping a row shows the numbers: this week's direct/indirect sets and the target range.
- The 4-week table stays behind the existing "Alle"/details toggle.
- Remove the "n von min–max Sätzen" bar text from the main view.
- `npm run build && npm run ui:shots -- /private/tmp/claude-501/ui-shots-b <stats shot name>` renders; add a fixture if needed.
- Commit `feat(muscles): statistics show four calm states instead of set counts`.
