# Training ansehen und anpassen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The person can look at the next strength workout in full detail and change it before starting it; „Training starten“ then starts the changed version.

**Architecture:** Web only. The start preparation in `WorkoutScreen` (`startPlan`) is split into a pure-ish `prepareStart` that returns the `TrackedWorkout` the start would create; the preview shows exactly that. Edits use the existing session functions (`editSet`, `addSet`, `removeSet`, `addExercise`, swap/remove from `workout-change.ts` or equivalents) on that draft. The draft lives in local storage per account, tied to the plan it was made from.

**Tech Stack:** TypeScript, React, vitest.

**Spec:** User wish 08.11.2026: „ich möchte das training im detail anschauen und bearbeiten können ohne es starten zu müssen“. Autonomy granted; the decisions below are mine:
- Entry: a `secondary` button „Ansehen und anpassen“ on the „Nächstes Training“ card in Kraft (and the strength part of the Heute card, replacing its „Details“ disclosure: reason, note and outlook move into the sheet's top).
- The sheet „Nächstes Training“: the coach's reason (muted), then per exercise: title, info icon as elsewhere, each set as a row with reps and kg fields (same inputs as in the running workout, no done-tick), a sets stepper, „Andere Übung“ (picker), remove (×); at the end „Übung hinzufügen“. Actions: primary „Training starten“, link „Fertig“ (closes; edits are kept).
- Weights and reps shown are exactly what the start would prefill (same history, studio, load steps, excluded exercises, no-legs rule).
- Changed plan: the card shows a muted „Angepasst“ and a link „Änderungen verwerfen“.
- The draft is local to the device: `pandafit.plandraft.<account>` = `{ planKey, workout }`; `planKey` = the plan record's `atMs` and workout name. A new coach plan (other key) drops the draft and the card says once, muted: „Deine Anpassungen passen nicht mehr zum aktuellen Plan oder Studio. Darum gilt wieder der Plan des Coaches.“
- Starting with a draft: new id and `startMs = now`, done sets none; everything else from the draft. Without a draft the start is exactly as today.

## Global Constraints

- Simpler, not more complex: the Heute card loses its „Details“ disclosure in exchange for the button; no new tab.
- One-tap set logging in the running workout is unchanged. Touch targets ≥ 44 px. Light/dark, 360 px. Kit button roles (primary / secondary / link / danger-link) and tokens only.
- A workout is never lost: a failed draft read or write never blocks a start; it starts from the plan.
- No server change, no new record kind.
- `npm test`, `npm run typecheck`, `npm run test:web-smoke` before each commit.

## Review Focus

1. The preview and the start show the same numbers (prefill parity) for a plan with history, a studio, a load step and an excluded exercise.
2. A draft from an older plan never starts.
3. Local storage throws (private mode): the sheet still opens, edits live until closed, the start works.
4. An open workout exists: the button is not shown (the open card is the thing to do), as today.
5. Editing a reps or kg field in the sheet and then starting: the running workout shows the edited value as the planned value.

---

### Task 1: prepareStart, draft store, logic tests

**Files:**
- Modify: `src/tracking/ui/WorkoutScreen.tsx` (extract `prepareStart`)
- Create: `src/tracking/plan-draft.ts`
- Test: `tests/tracking/plan-draft.test.ts`, `tests/ui/prepare-start.test.ts`

**Interfaces (Produces):**
- `prepareStart(port: TrackingPort, g: GymWorkout, ctx: { now: () => number; newId: () => string; catalog: Exercise[]; studio?: string; studios: StudioState }): Promise<{ workout: TrackedWorkout; notice: string | null }>` — everything `startPlan` computes before it begins the store; `startPlan` becomes `prepareStart` + begin.
- `planKeyOf(plan: { atMs: number; workout: { name: string } }): string`
- `readDraft(storage, account: string, planKey: string): TrackedWorkout | null` (null on a key mismatch, on parse failure, on a throwing storage); `writeDraft(storage, account, planKey, w): boolean`; `clearDraft(storage, account): void`; `draftDropped(storage, account, planKey): boolean` — true once when a stored draft belongs to another key (then removes it).
- `startFromDraft(d: TrackedWorkout, nowMs: number, id: string): TrackedWorkout` — new id, `startMs = nowMs`, `endMs: null`, every set `doneMs: null`.

- [ ] Tests: key mismatch → null and `draftDropped` true once; throwing storage → null / false, no throw; `startFromDraft` resets id, time and done marks and keeps edits; `prepareStart` parity: the workout it returns equals the one `startPlan` begins (spy on the begin path) for a fixture with history, studio and a load step.
- [ ] Implement; full suite, typecheck. Commit `feat(kraft): prepare the start once, keep a draft per plan`.

### Task 2: The sheet and the entry points

**Files:**
- Create: `src/tracking/ui/PlanSheet.tsx`
- Modify: `src/tracking/ui/WorkoutScreen.tsx` (card button, start with draft), `src/web/App.tsx` (Heute strength part: button instead of „Details“, opens Kraft with the sheet open, or the sheet in place — implementer's choice, one path), CSS if needed
- Test: `tests/ui/plan-sheet.test.tsx`

- [ ] Tests: the sheet lists every exercise with its sets and prefilled values; changing reps of a set, removing an exercise, adding a set and swapping an exercise change the draft; „Training starten“ in the sheet starts the edited workout (the running screen shows the edited reps as planned); the card shows „Angepasst“ and „Änderungen verwerfen“ restores the plan; a new plan key shows the dropped note once; with an open workout the button is absent.
- [ ] `scripts/web-shots.ts`: shots `kraft-plan-ansehen` and `kraft-plan-angepasst`; `scripts/web-smoke.ts`: open the sheet and close it.
- [ ] Full suite, typecheck, web-smoke. Commit `feat(kraft): look at and adjust the next workout before starting`.

### Task 3: Close (controller)

- [ ] Shots light/dark/360 of the new screens; look at them.
- [ ] Roadmap row and brief; mark the wish done in `.superpowers/next-after-v.md`.
