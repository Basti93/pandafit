# Milestone G: Training is changeable

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein G — Brief".

Sources:
- Spec `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md`: §10 (l.127–133) and §12 (l.~145–150).
- Ironvellum notes: `docs/research/open-source-training/repstack-ironvellum.md`, I10 at l.190–196 and I11 at l.198–204.
- Register rules (all `planned` today, in `src/shared/training-policy/rules.ts`):
  - `prep.per-movement-block` and `superset.any-partner` (l.89–90);
  - `rest.*` (l.86–88).

## Global Constraints

- Before each task, check that no ride is open: the live file must be older than one hour, and no `ride-*/meta.json` may have status open.
- No npm install, no new dependencies, no push, no deploy.
- **A workout is never lost.**
  - Done sets are never changed, moved away from their exercise, or deleted by reorder, superset, warm-up or rest changes.
  - Every edit is a pure function over `TrackedWorkout` that keeps row objects intact, applied through `store.apply`.
- Light UI:
  - edits live in the existing per-exercise menu;
  - at most one small button "Aufwärmen hinzufügen" on a card;
  - the rest timer gets one "+30 s" button.
- General mechanisms only. Values go in the register; flip the used `planned` rules to `active`.
- Hevy routine export stays compatible:
  - group members are contiguous;
  - `superset_id` is one number per exercise;
  - `rest_seconds` is one per exercise (0..600);
  - warm-ups are `type: 'warmup'`.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task. Tests pinning replaced behaviour are deleted.

## Today (from exploration)

- **Order:** order is the array order, and there is no reorder.
  - `addExercise`, `removeExercise`, `swapExercise`, `linkSuperset` (next neighbour only), `unlinkSuperset` are in `src/tracking/session.ts:184–262`.
  - The current exercise is the first one with an open set (`WorkoutScreen.tsx` ~116).
- **Rest:**
  - `confirmSet` sets `rest = { startMs, durationS: e.restS ?? 90 }` and skips rest while a later superset member has an open set (`session.ts:170–176`). The rest survives a reload.
  - `duration.ts:10–18` uses `restS ?? 0` and counts warm-up sets as work.
  - The coach rule plan uses `REST_S = 90` (`src/coach/gym/rules.ts:12`).
  - The `rest.*` register values are unused.
- **Warm-up:** there is only the set type `warmup`; no ramp and no offer.
  - The ladder helpers are in `src/shared/loads.ts`: `ladderFrom`, `snapDown`, `platesPerSide`.
  - The pattern to copy is `session.ts:127–134`.
- **D changes:** undo puts `prior` rows back at the stored `pos` index (`src/tracking/workout-change.ts` ~75–102). After a reorder, that index can be wrong.

## Design

### Rest from one source (`src/shared/rest.ts`, new)

- `restOf(exercise: { restS?: number | null; exerciseId; reps? }, catalog)`:
  - an explicit `restS` (from the plan or the person's edit) wins;
  - otherwise use the register by kind: heavy (planned reps ≤ 5) → `rest.heavy` midpoint; compound → `rest.compound` midpoint; isolation → `rest.isolation` midpoint.
  - **Compound:** the primary group is chest, back, quads, hamstrings or glutes, and the equipment is barbell, dumbbell or machine with a multi-joint pattern. Keep it simple and data-driven: a group-based rule only. No name lists.
- `restAfterSet(workout, rid, setIndex)`:
  - in a superset, rest only after the last open member of the round;
  - the rest is the max `restOf` of the members.
- Users:
  - the timer in `confirmSet`;
  - `duration.ts`: warm-up sets count with `duration.warmup-set-s` (new, 30 s, work plus rest) instead of a full work set; a superset round counts rest once per round;
  - the coach rule plan, instead of `REST_S`;
  - the gym prompt: one line "Pausen: Grundübungen ca. X s, Isolation ca. Y s".
- `extendRest(w, s)` adds 30 s. `setRest(w, rid, s)` sets the exercise's `restS` (choices 30–300 in 15–30 s steps, from the register). The exercise menu gets "Pause: [select]".

### Reorder

- `moveExercise(w, rid, dir: -1 | 1)`:
  - a superset group moves as one block past the neighbouring block (a single exercise or a whole group);
  - row objects stay intact.
- The menu gets "Nach oben" / "Nach unten", disabled at the ends.
- **D undo robustness:** a taken change also stores `anchor` (the rid of the row before the first touched row, or null). Undo inserts after the anchor when it still exists, else falls back to `pos` (clamped). Old entries without `anchor` keep using `pos`. Test: take, then move, then undo → rows return next to their anchor.

### Supersets with any partner

- `linkWith(w, rid, partnerRid)`:
  - both must be exercises without done work sets, or the partner at least unstarted;
  - the partner (with its own group) moves directly after the rid's group;
  - the group id is shared. Group order equals array order.
- The menu: "Supersatz mit …" opens a small list of the other open exercises. The old next-neighbour link is replaced by this.
- `unlinkSuperset`: unchanged. `removeExercise` and `swapExercise` dissolve a group left with one member. The done-set copy row of a swap leaves the group.
- **Round navigation:** `currentSet(w)` = the next open set in round order.
  - Within a group: A set i, B set i, A set i+1, …; members whose sets are done or skipped are skipped.
  - The UI current marker and the auto-scroll use it.
  - The labels stay as they are. Optional: show "Runde n" next to the Superset label.

### Warm-up per movement block (`src/shared/warmup.ts`, new)

- `warmupRamp({ workingKg, equipment, ladder })`:
  - steps from the register `prep.ramp` (`[{ pct: 40, reps: 5 }, { pct: 60, reps: 3 }, { pct: 80, reps: 2 }]`);
  - for barbell, first the bar (`load.bar-kg`) × 10;
  - each step `snapDown` on the ladder;
  - drop duplicates, steps ≥ working weight, and barbell steps < bar.
  - No working weight → `[]`.
- **`needsWarmup(w, rid, catalog)`:** the exercise has no done set and no warm-up set, and no earlier exercise in this workout of the same muscle group (B groups) has a done set. "Earlier" means a done set exists.
- **UI:** an unstarted card where `needsWarmup` holds and the working weight is known shows a small "Aufwärmen hinzufügen" button.
  - It inserts the ramp as `warmup` sets before the first work set.
  - The button disappears once the exercise has a warm-up or done set.
  - Without a working weight there is no button; the existing plan line is enough. The plan stays honest: no invented kg.
- **Coach rule plan** (`src/coach/gym/rules.ts`): the first exercise of each muscle group in the plan gets the ramp when its working weight is known.
- The AI prompt says: "Aufwärmsätze nur vor der ersten Übung eines Bewegungsblocks, aus dem Arbeitsgewicht".

## Tasks

### Task 1: Rest from one source

**Files:**
- `src/shared/rest.ts` (new), `src/shared/duration.ts`
- `src/tracking/session.ts`, `src/tracking/ui/WorkoutScreen.tsx`
- `src/coach/gym/{rules,prompt}.ts`
- `src/shared/training-policy/rules.ts`
- tests

Acceptance tests:
- `restOf`: explicit wins, compound vs isolation vs heavy;
- the timer and `gymMinutes` use the same value;
- a superset rests once per round;
- warm-up sets count short;
- "+30 s" extends the rest and survives a reload;
- the per-exercise rest edit is used next.

Commit: `feat(training): rest times from one source, extendable`.

### Task 2: Reorder and robust undo

**Files:** `src/tracking/session.ts`, `src/tracking/workout-change.ts`, `src/tracking/ui/WorkoutScreen.tsx`, tests.

Acceptance tests:
- moving up and down;
- a group moves as a block;
- done sets stay with their exercise;
- an undo of a D change after a move restores rows at the anchor;
- old entries without an anchor still undo.

Commit: `feat(training): move exercises up and down`.

### Task 3: Supersets with any partner, round navigation

**Files:** `src/tracking/session.ts`, `src/tracking/ui/WorkoutScreen.tsx`, tests.

Acceptance tests:
- linking non-neighbours moves the partner behind;
- linking into an existing group;
- remove or swap dissolves single-member groups;
- round order A1 B1 A2 B2;
- done or skipped members are skipped;
- rest only after the round;
- the Hevy projection stays contiguous (a test on the routine body).

Commit: `feat(training): superset any two exercises, train them round by round`.

### Task 4: Warm-up per movement block

**Files:**
- `src/shared/warmup.ts` (new)
- `src/tracking/session.ts`, `src/tracking/ui/WorkoutScreen.tsx`
- `src/coach/gym/{rules,prompt}.ts`
- `src/shared/training-policy/rules.ts`
- `scripts/ui-shots/run.ts` (shot `workout-warmup`)
- tests

Acceptance tests:
- the ramp for 100 kg barbell on a 2.5 ladder = bar×10, 40×5, 60×3, 80×2;
- a 5 kg machine ladder snaps;
- duplicates and ≥ working weight are dropped;
- no working weight → none;
- `needsWarmup` is false after a same-group exercise was trained;
- insertion goes before the work sets;
- the rule plan adds the ramp only to the first exercise per group.

The shot must render.

Commit: `feat(training): warm up where a new movement starts`.
