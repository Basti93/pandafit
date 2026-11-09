# Milestone A: Every Exercise Is Known — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every exercise logged or imported is a real PandaFit exercise with muscle, equipment and a fitting German instruction; unknown ones are classified once by an AI proposal, confirmed or auto-applied, stored, and then used everywhere without AI.

**Architecture:** The catalog = code built-ins (`EXERCISES`) + a bundled free-exercise-db base (`FEDB_EXERCISES`) + `exercise` records. A record with the id of a built-in or base entry is an *overlay* (adds aliases, a German description); any other record is an own exercise. One pure function `mergeCatalog` builds the catalog for UI, statistics and coach alike. `exercise` records are mirrored between the profiles of a household, so both share one catalog. On the coach side an `ExerciseMapper` finds unresolved exercises, asks Claude once per title, validates, and writes overlays or proposals; the UI shows proposals with Bestätigen / Ändern / Rückgängig.

**Tech Stack:** TypeScript, React 19, Vitest, Claude via the existing `ask` function of the coach runtime, zod.

**Spec:** `docs/roadmap.md` (Leitsätze, Meilenstein A brief and decisions), `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md` §8, §17.

## Global Constraints

- No ride open before each task (`rides/live/current.jsonl` untouched for an hour); this plan touches `src/shared/**`. No `npm install`, no new dependency. No deploy, no push.
- Public repo: no personal data. Exercise names are generic. Tests use invented titles.
- Logged workouts are never rewritten. Identity stays read-time (`resolveExercise`).
- Light UI: German, calm, no numbers beyond what is needed, no gamification.
- General mechanisms only: no hand-written per-exercise special cases in code.
- `src/shared/exercises.ts` ids and `resolveExercise` behaviour from milestone 0 stay; tests from milestone 0 keep passing unless a task says otherwise.
- Every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Two profiles edit the same overlay at nearly the same time → newest `updatedMs` wins on both, nothing is duplicated (Task 2 test).
2. AI answer names an exercise id that does not exist, or invalid muscle/equipment → nothing is written, title stays unknown, retried at most once per day (Task 4 test).
3. Offline / no AI: mapper does nothing, logging and the picker work unchanged (Task 4 test).
4. Undo of an auto-applied link restores the previous resolution and the mapper does not immediately re-apply the same link (Task 4/5 test).
5. A base entry and a built-in describing the same exercise must not both appear in the picker (Task 3 test).

---

### Task 1: One catalog with overlays

**Files:**
- Modify: `src/shared/exercises.ts` (type), `src/tracking/ui/hooks.ts` (`useCatalog`), `src/tracking/stats.ts` (uses `EXERCISES`)
- Create: `src/shared/catalog.ts`
- Test: `tests/shared/catalog.test.ts`

**Interfaces:**
- `Exercise` gains optional fields: `secondaryMuscles?: string[]`, `description?: string` (German, own text), `source?: 'pandafit' | 'fedb' | 'ai' | 'user'`, `fedbId?: string`, `proposal?: ExerciseProposal`.
- `type ExerciseProposal = { forTitle: string; kind: 'same' | 'new'; targetId?: string; reason: string; atMs: number }`
- `mergeCatalog(builtIns: Exercise[], base: Exercise[], records: TrackedRecord[]): Exercise[]` in `src/shared/catalog.ts`. Order: built-ins, base, own. A non-deleted record whose id equals a built-in/base id merges `aliases` (union, keeps order, no duplicates) and `description` (record wins) into that entry; all other fields of the built-in win. Any other non-deleted record is appended as an own exercise if it has `id`, `title`, `primaryMuscle`, `equipment`, `type` strings. Records with a `proposal` are excluded from the catalog (they are not exercises yet). Deleted records are ignored.
- `exerciseDescription` callers: the UI shows `e.description` when present, else the existing `exerciseDescription(id)`.

- [ ] Step 1: tests — overlay adds alias to `pf-cable-curl` and `resolveExercise({exerciseId:'h',title:'My Cable Curl'}, merged)` finds it; overlay cannot change `primaryMuscle` of a built-in; own record appended; deleted and proposal records ignored; malformed record body (missing title) ignored.
- [ ] Step 2: run, see FAIL. Step 3: implement; switch `useCatalog` to `mergeCatalog(EXERCISES, [], records)` (base is added in Task 3) and `stats.ts` to accept the catalog from its caller (pass `mergeCatalog(EXERCISES, [], exerciseRecords)`; find the caller in `StatsScreen.tsx`).
- [ ] Step 4: `npx vitest run tests/shared tests/tracking && npm run typecheck` green. Step 5: commit `feat(gym): one exercise catalog with overlays from records`.

### Task 2: Shared catalog for the household

**Files:**
- Create: `src/coach/tracking/mirror-exercises.ts`
- Modify: `src/coach/runtime.ts` (call after records of kind `exercise` change for a coached profile), `src/coach/server/household.ts` (same, across accounts, following the store composition in `openMeals()`)
- Test: `tests/coach/tracking/mirror-exercises.test.ts`

**Interfaces:**
- `mirrorExercises(store: Pick<RecordStore, 'all' | 'putMany'>, profileIds: string[]): string[]` — for every `exercise` record id over all given profiles, the record with the highest `updatedMs` (tie: `applyRecord` order) is put to every profile that lacks it or has an older one; deletions mirror too. Returns the profile ids that received records (caller notifies/syncs them like `mealsChanged`).
- Trigger: after a put of kind `exercise` from any profile, and once at runtime start. Must not loop (a mirrored put does not trigger another mirror when nothing changes).

- [ ] Step 1: tests — record created in A appears in B; newer edit in B wins in A; deletion in A deletes in B; second run is a no-op (returns `[]`); single profile is a no-op.
- [ ] Step 2–4: FAIL → implement → `npx vitest run tests/coach && npm run typecheck` green. Step 5: commit `feat(gym): both profiles share one exercise catalog`.

### Task 3: free-exercise-db as base catalog

**Files:**
- Create: `scripts/fedb-import.ts`, `scripts/fedb-names-de.json`, `src/shared/fedb-exercises.json`, `src/shared/fedb.ts`
- Modify: `src/shared/exercises.ts` (add `fedbId` to built-ins that are the same exercise), `NOTICE.md`, `src/tracking/ui/hooks.ts`, `src/tracking/ui/ExercisePicker.tsx` (search over German + English names)
- Test: `tests/shared/fedb.test.ts`

**Decisions:**
- Source: local clone at `~/Projects/pandafit-references/free-exercise-db` (commit `f00c92c`), `dist/exercises.json`, Unlicense. The script takes the path as argument and writes `src/shared/fedb-exercises.json`; the JSON is committed, the script is not run in tests.
- Keep categories `strength`, `powerlifting`, `olympic weightlifting`, `strongman`, `plyometrics`; drop `stretching` (mobility is separate) and `cardio`.
- Mapping: id `fedb-<dataset id lowercased, non-alnum → '-'>`; muscles `middle back`→`upper_back`, `lower back`→`lower_back`, `neck`→`traps`, others as in `MUSCLES` labels; equipment `body only`→`none`, `cable`→`machine`, `e-z curl bar`→`barbell`, `kettlebells`→`kettlebell`, `bands|medicine ball|exercise ball|foam roll|null`→`other`; type `reps_only` for `none`, else `weight_reps`; English name becomes an alias; `source: 'fedb'`.
- German names: `scripts/fedb-names-de.json` maps fedb id → short German name in the style of the built-ins ("Kurzhantelcurl", "Rudern am Kabel sitzend"). The implementer writes them (it is a translation task); names must be unique and must not equal a built-in title.
- A built-in that is the same exercise as a base entry gets `fedbId`; that base entry is then left out of the catalog (built-in wins). Only exact equivalents (same movement and equipment); when unsure, leave both.
- Images: none in this task (parking lot).
- `NOTICE.md`: add a section "Exercise base: public domain" naming free-exercise-db, its URL and the Unlicense.

- [ ] Step 1: tests — every base entry has a German title, valid muscle from `MUSCLES`, equipment from `EQUIPMENT`; no title/alias collides with a built-in (use `exerciseTitles`); a base entry referenced by a built-in `fedbId` is not in `mergeCatalog(EXERCISES, FEDB_EXERCISES, [])`; catalog size > 500.
- [ ] Step 2–4: FAIL → run the script, write names, implement → `npm test && npm run typecheck` green. Step 5: commit `feat(gym): free-exercise-db as base exercise catalog with German names`.

### Task 4: AI classifies unknown exercises once

**Files:**
- Create: `src/coach/gym/exercise-mapper.ts`, `src/coach/gym/exercise-mapper-prompt.ts`
- Modify: `src/coach/runtime.ts` (run the mapper for coached profiles on the existing gym schedule, after history refresh)
- Test: `tests/coach/gym/exercise-mapper.test.ts`

**Interfaces:**
- `class ExerciseMapper` with deps `{ store, ask, nowMs, catalog: (profileId) => Exercise[] }` and `run(profileId): Promise<void>`.
- Unresolved = titles of the profile's `workout` records (last 180 days) where `resolveExercise(e, catalog, statsMuscles?)` has no `exercise`. Dedupe by trimmed title. At most 20 titles per run.
- Candidates per title: the 12 catalog entries with the highest word overlap between title and their `exerciseTitles` (lowercased words, length ≥ 3), deterministic.
- Prompt answer (zod, one item per title): `{ title, decision: 'same', exerciseId, confidence: 'high' | 'medium', reason }` | `{ title, decision: 'new', name, primaryMuscle, secondaryMuscles, equipment, type, description, reason }` | `{ title, decision: 'unsure', reason }`. German `name`, `description` (2–3 calm sentences, no weights), `reason` (one sentence).
- Validation: `exerciseId` must be in the candidates; muscles in `MUSCLES`, equipment in `EQUIPMENT`, type in `TYPES`. Invalid item → dropped. Unparseable answer → retry once with the error, then give up for this run.
- Writes:
  - `same` + `high` → overlay record on the target id adding the title to `aliases`, `source` stays, plus `lastAutoLink: { title, atMs }` on the overlay body so the UI can offer Rückgängig.
  - `same` + `medium` → proposal record id `prop-<hash(title)>` with `proposal: { forTitle, kind: 'same', targetId, reason, atMs }`.
  - `new` → proposal record (same id scheme) carrying the full new exercise fields and `proposal.kind: 'new'`.
  - `unsure` → nothing; remembered in mapper state.
- Memory: mapper state file per household dir `exercise-mapper.json`: `{ asked: { [title]: atMs }, undone: string[] }`. A title is asked at most once per 24 h; titles in `undone` (user undid an auto link) are only ever proposed, never auto-applied.
- No AI (ask throws) → return quietly, nothing written.

- [ ] Step 1: tests with a fake `ask` — high same → overlay alias written and resolves; medium same → proposal record; new → proposal record with fields; unknown `exerciseId` → nothing written; invalid JSON twice → nothing, no throw; `ask` throws → nothing; same title not asked twice within 24 h; undone title gets a proposal, not an auto link.
- [ ] Step 2–4: FAIL → implement → `npx vitest run tests/coach && npm run typecheck` green. Step 5: commit `feat(gym): coach classifies unknown exercises once and stores the result`.

### Task 5: Confirm, change, undo in the app

**Files:**
- Create: `src/tracking/ui/ExerciseProposals.tsx`, `src/tracking/exercise-proposals.ts` (pure actions)
- Modify: the strength home screen that shows `GymOutlook` (find it via `GymOutlook` usage in `src/ui/views/GymView.tsx` and `src/web/App.tsx`), `src/tracking/ui/tracking.css`
- Test: `tests/tracking/exercise-proposals.test.tsx`

**Interfaces (pure, return records to put):**
- `confirmProposal(p: TrackedRecord, catalog: Exercise[], nowMs): TrackedRecord[]` — `same`: overlay on target with alias + proposal record deleted; `new`: the proposal record rewritten without `proposal`, `source: 'ai'`.
- `changeProposal(p, targetId, catalog, nowMs)` — like confirm `same` but to the chosen target.
- `undoAutoLink(overlay: TrackedRecord, nowMs): TrackedRecord[]` — removes `lastAutoLink.title` from aliases, clears `lastAutoLink`; the mapper must learn the title is undone (write it into the overlay as `undoneTitles` so the coach side reads it; the mapper merges these into its `undone` list).
- UI card „Übungen einordnen“, only shown when there is something: one row per proposal („‚Cable Row Custom‘ ist vermutlich Rudern am Kabel sitzend“ / „Neue Übung: …, Rücken“) with Bestätigen, Ändern (opens `ExercisePicker` in pick mode), and one row per recent auto link (last 14 days) „‚Cable Curl‘ als Curl am Kabel eingeordnet“ with Rückgängig. No numbers, no confidence shown.

- [ ] Step 1: tests for the three pure actions and the card (renders nothing without proposals; Bestätigen writes records via fake port; Rückgängig removes alias and the exercise shows „Muskel unbekannt“ again in the workout screen).
- [ ] Step 2–4: FAIL → implement → `npm test && npm run typecheck` green; `npm run ui:shots -- <scratch> tracking-workout` still renders. Step 5: commit `feat(gym): confirm, change or undo exercise classifications`.

### Task 6: Coach side uses the same catalog; old special forms removed

**Files:**
- Modify: `src/coach/gym/gym-coach.ts` (`linkHevyTemplates` and `own` list over the merged catalog incl. records), `src/coach/stats/stats-content.ts` (if it resolves names), `src/shared/exercises.ts` (keep the 7 milestone-0 entries; remove nothing users may have logged), `docs/roadmap.md` (A status, parking lot)
- Test: `tests/coach/gym/gym-coach.test.ts` (extend)

**Interfaces:** `linkHevyTemplates(templates, catalog?: Exercise[])` — optional catalog defaults to `EXERCISES`; gym coach passes `mergeCatalog(EXERCISES, FEDB_EXERCISES, records.all(id,'exercise'))`.

- [ ] Step 1: test — an overlay alias „Cable Row Custom“ on `pf-seated-row-cable` makes a Hevy template with that title link to the own id and merge its history.
- [ ] Step 2–4: FAIL → implement → `npm test && npm run typecheck` green. Update `docs/roadmap.md`: Meilenstein A ✅ with remaining parking items. Step 5: commit `feat(gym): coach uses the shared catalog for Hevy links and history`.
