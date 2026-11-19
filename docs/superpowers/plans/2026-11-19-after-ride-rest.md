# After-Ride Rest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the open items from `docs/after-ride.md` that need no real device, no real Garmin export and no real weeks: vocabulary hints, no empty change notes, cadence in the ride summary, rides by heart rate planned by the coach, an automatic end of the ramp test, and personal tips from the coach during the ride.

**Architecture:** Every change follows the existing paths. The coach (`src/coach/coach.ts`) writes more into its answer and the session. The engine (`src/service/engine.ts`) gets one new rule for the ramp test. The ride screen (`src/ui`) only shows what the session and the engine already carry. Nothing needs a live AI call during the ride.

**Tech Stack:** TypeScript, React, zod, vitest, Electron (Mac app), Node service.

**Spec:** `docs/after-ride.md` (entries listed per task), top rule from `docs/superpowers/specs/2026-10-31-bike-coach-design.md`: a ride is never lost. Heart rate rules: `docs/hr-zones.md`.

## Global Constraints

- Execute in a git worktree on a branch (for example `fix/after-ride-rest`). Merge into `main` only when no ride is open: Tasks 3–6 change `src/shared/**` and `src/service/**`, which are off-limits while a ride is open. Never run `npm run app`, never restart the service during a ride, never touch `~/Library/Application Support/bike-coach`.
- Another branch (`fix/after-ride`) changes `src/service/ble/noble-adapter.ts`, `src/ui/pass/PassView.tsx` and `src/main/index.ts`. Do not touch these files.
- Tests per task: `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run <file>`.
- Module rules (`tests/architecture/boundaries.test.ts`): `src/shared` imports only `src/shared` and `src/ride-format`. `src/coach` never imports `src/web`, `src/ui`, `src/service`, `src/main`.
- UI copy: natural German, whole sentences, "du", no fragments joined by a dash. Bo is "Sensai" where the coach is named.
- Keep it light: no new numbers on screens unless a task says so. No gaming.
- General rules, no special cases by name. Every own threshold gets a comment "own setting" and a line in the matching doc.
- One commit per task, prefix `feat(rad):` or `fix(rad):`, ending with the session attribution lines.

## Review Focus

- Ramp test with a short deliberate stop (drinking) in the first 8 minutes: the test must not end. Pinned in Task 5 (`ramp test does not end before 8 minutes`).
- Ramp test while the rider pressed pause in the app: the service does not tick, so the counter must not run. Pinned in Task 5 (`a paused ride does not end the ramp test`, service test).
- Coach sets `hrHold` on a hard or short section: the hold must be dropped, the session stays valid. Pinned in Task 4 (`hrHold only stays on easy long erg sections`).
- Coach answer without `change` or with only spaces: no change note, no crash. Pinned in Task 2.
- Session files of old rides without `tips`, summaries without `avgCadenceRpm`: they still parse and the prompt still builds. Pinned in Tasks 3 and 6 (`old session without tips still parses`).

---

### Task 1: Vocabulary hints on the word card

Entry: "Hints on what Plus and Minus do".

**Files:**
- Modify: `src/ui/views/WordCard.tsx`
- Modify: `src/ui/App.tsx` (pass `clicker` prop only)
- Test: `tests/ui/word-card.test.tsx` (create)

**Interfaces:**
- Produces: `WordCard` gets a new optional prop `clicker?: boolean` (true when `state.devices.clicker === 'connected'`).

- [ ] **Step 1: Write the failing tests**

```tsx
test('before the reveal the card says that the answer comes soon', () => {
  render(<WordCard calm state={coachState} send={vi.fn()} click={null} />);
  expect(screen.getByText('Gleich kannst du antworten.')).toBeInTheDocument();
});
test('after the reveal with a clicker the card explains plus and minus', () => {
  vi.useFakeTimers();
  render(<WordCard calm state={coachState} send={vi.fn()} click={null} clicker />);
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.getByText('Mit Plus sagst du „Wusste ich“, mit Minus „Nochmal“.')).toBeInTheDocument();
});
test('without a clicker there is no plus and minus hint', () => {
  vi.useFakeTimers();
  render(<WordCard calm state={coachState} send={vi.fn()} click={null} />);
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.queryByText(/Mit Plus/)).toBeNull();
});
```

`coachState` is a minimal `CoachState` with `profileId` and empty `wordProgress` (copy the shape from `tests/ui/language-toggle.test.tsx`). Stub `window.speechSynthesis` with `{ cancel: vi.fn(), speak: vi.fn() }`.

- [ ] **Step 2: Run** `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/ui/word-card.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** In phase `ask`, show `<span className="muted">Gleich kannst du antworten.</span>` under the covered word. In phase `reveal` with `clicker`, show `<p className="muted">Mit Plus sagst du „Wusste ich“, mit Minus „Nochmal“.</p>` under the buttons. In `App.tsx` pass `clicker={state.devices.clicker === 'connected'}`.
- [ ] **Step 4: Run** the test. Expected: PASS. Also run `tests/ui/language-toggle.test.tsx`.
- [ ] **Step 5: Commit** `feat(rad): Vokabelkarte erklärt Plus und Minus`.

### Task 2: No change note when nothing changed

Entry: "Coach assessment", note on "Keine Änderung".

**Files:**
- Modify: `src/coach/coach.ts` (`answerSchema.change`, `SYSTEM_PROMPT`, the `addChange` call after a valid answer, around line 504)
- Test: `tests/coach/coach.test.ts`

**Interfaces:**
- Produces: `answerSchema.change` becomes `z.string().optional()`.

- [ ] **Step 1: Write the failing tests**

```ts
test('an answer without change adds no change note', async () => {
  const c = make(); afterRamp(c);
  const before = c.state('pa').changes.length;
  claudeAnswers(answer({ change: undefined }));
  await c.refresh('pa');
  expect(c.state('pa').changes.length).toBe(before);
});
test('an answer with a blank change adds no change note', async () => {
  // same with change: '   '
});
test('the prompt asks to leave change out when nothing changes', () => {
  expect(SYSTEM_PROMPT).toContain('Lass change weg, wenn sich an der Einheit nichts ändert.');
});
```

Use the file's existing helpers for the fake claude answer (as in `valid answer becomes next session with reason and change`).

- [ ] **Step 2: Run** `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/coach/coach.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Make `change` optional. Add the prompt sentence above. Call `addChange` only when `a.change?.trim()` is not empty. Guardrail and FTP notes stay unchanged.
- [ ] **Step 4: Run** `tests/coach`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(rad): keine Änderungsnotiz, wenn sich nichts ändert`.

### Task 3: Cadence in the ride summary

Entry: "Cadence (suggestion, not a firm task)".

**Files:**
- Modify: `src/shared/ride-summary.ts` (new optional field)
- Modify: `src/coach/metrics.ts` (`summarizeRide`)
- Modify: `src/coach/coach.ts` (one sentence in `SYSTEM_PROMPT`), `src/coach/debrief.ts` (one sentence in its prompt)
- Test: `tests/coach/metrics.test.ts`, `tests/coach/coach.test.ts`

**Interfaces:**
- Produces: `RideSummary.avgCadenceRpm?: number` — mean of the cleaned samples with `cadenceRpm > 0`, rounded; absent when there are none.

- [ ] **Step 1: Write the failing tests**

```ts
test('average cadence counts only pedalling seconds', () => {
  // samples with cadence 90, 90, 0, null → avgCadenceRpm 90
});
test('a ride without cadence has no average cadence', () => {
  // all cadence null → summary has no avgCadenceRpm key
});
test('the prompt explains the cadence value', () => {
  expect(SYSTEM_PROMPT).toContain('avgCadenceRpm');
});
```

- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Field in `RideSummary`. In `summarizeRide` spread `...(cad === null ? {} : { avgCadenceRpm: cad })`. Prompt sentence for both prompts: `In fahrten steht avgCadenceRpm (mittlere Trittfrequenz beim Treten). Gib dazu höchstens einen Tipp, wenn sie über mehrere Fahrten unter 70 liegt, und mache keine Vorgabe daraus.` No per-section cadence targets and no new number on any screen.
- [ ] **Step 4: Run** `tests/coach`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rad): Trittfrequenz in der Zusammenfassung für den Coach`.

### Task 4: The coach can plan rides by heart rate

Entry: "Heart rate as part of training", open part "the coach can steer easy sessions entirely by heart rate". The engine (`applyHold`) and the starter session "Puls halten" exist already.

**Files:**
- Modify: `src/coach/session-limits.ts` (new `holdFits`)
- Modify: `src/coach/coach.ts` (`answerSession` step gets `hrHold: z.boolean().optional()`, `stripSession`, `SYSTEM_PROMPT` hrZone paragraph)
- Modify: `src/ui/views/TrainingCard.tsx` (text for a hold section)
- Modify: `docs/hr-zones.md` (replace "The coach cannot plan such sections yet.")
- Test: `tests/coach/session-limits.test.ts`, `tests/coach/coach.test.ts`, `tests/ui/coach-view.test.tsx` (TrainingCard is rendered there; else create `tests/ui/training-card.test.tsx`)

**Interfaces:**
- Produces: `export const holdFits = (s: Step): boolean` in `src/coach/session-limits.ts`. True only for `kind === 'erg'`, `hrZone` set and `<= 3`, `durationS >= 600`, `ftpFraction <= 0.7` (own settings, same spirit as `docs/hr-zones.md`).

- [ ] **Step 1: Write the failing tests**

```ts
test('hrHold only stays on easy long erg sections', () => {
  expect(holdFits({ kind: 'erg', durationS: 1200, ftpFraction: 0.6, label: 'x', hrZone: 2, hrHold: true })).toBe(true);
  expect(holdFits({ kind: 'erg', durationS: 300, ftpFraction: 0.6, label: 'x', hrZone: 2, hrHold: true })).toBe(false);
  expect(holdFits({ kind: 'erg', durationS: 1200, ftpFraction: 0.9, label: 'x', hrZone: 2, hrHold: true })).toBe(false);
  expect(holdFits({ kind: 'erg', durationS: 1200, ftpFraction: 0.6, label: 'x', hrZone: 4, hrHold: true })).toBe(false);
  expect(holdFits({ kind: 'erg', durationS: 1200, ftpFraction: 0.6, label: 'x', hrHold: true })).toBe(false);
});
test('a coach session with a fitting hold keeps it, an unfitting hold is dropped', async () => {
  // answer({ session: { ...good, steps: [warmup, { ...locker 1200 s 0.6, hrZone: 2, hrHold: true }, { kind: 'erg', durationS: 300, ftpFraction: 0.6, label: 'kurz', hrZone: 2, hrHold: true }] } })
  // next.session.steps[1].hrHold === true, steps[2].hrHold undefined, source 'claude'
});
```

UI test: a session step with `hrHold: true, hrZone: 2` shows `Die Watt folgen deinem Puls in` and the zone chip; without `hrHold` it still shows `Puls bis`.

- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** In `stripSession`, keep `hrHold: true` for an erg step only when `holdFits` is true for the stripped step. Extend the prompt paragraph with: `Für lockere Fahrten kannst du mit hrHold: true bei einem erg-Abschnitt ab 10 Minuten, höchstens 70 % FTP und hrZone 1 bis 3 die Watt dem Puls folgen lassen. Ohne Pulsgurt fährt die App dann einfach nach Watt.` In `TrainingCard` show `Die Watt folgen deinem Puls in <ZoneChip>Zone n</ZoneChip>` for a hold step. Update `docs/hr-zones.md`: the coach can plan such sections within these limits.
- [ ] **Step 4: Run** `tests/coach tests/ui`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rad): Coach kann lockere Fahrten nach Puls planen`.

### Task 5: The ramp test ends by itself

Entry: "Comparison with established projects", open "automatic end of the ramp test (wattroom)".

**Files:**
- Modify: `src/service/engine.ts`
- Modify: `src/shared/sample.ts` (`RideEvent.type` gets `'ramp-end'`)
- Modify: `src/ui/views/RideView.tsx` (one hint line during the ramp test)
- Modify: `docs/progress.md` (short section "Ende des Rampentests" with the own settings)
- Test: `tests/service/engine.test.ts`, `tests/service/ride-service.test.ts`, `tests/ui/ride-view.test.tsx`

**Interfaces:**
- Produces: `RideEngine.isDone()` is also true after the ramp ended. Event `{ type: 'ramp-end' }` once.
- Rule (own settings): only in the session with `RAMP_ID`; only from session second 480 (5 min warmup plus 3 min ramp, same as `MIN_RAMP_S` in `src/coach/coach.ts`); power below 80 % of the current target, or `null`, for 15 ticks in a row. Each engine tick counts, also while the engine auto-paused at 0 W. A pause the rider set in the app stops ticking, so it never ends the test.

- [ ] **Step 1: Write the failing tests** (engine, with `rampTest(200)` from `src/shared/ramp.ts`)

```ts
test('ramp test ends after 15 s below 80 % of the target', () => {
  // ride 600 ticks at the target power, then 15 ticks at 0 W → isDone() true, one 'ramp-end' event
});
test('ramp test does not end before 8 minutes', () => {
  // 300 ticks at target, 20 ticks at 0 W, then target again → isDone() false, no 'ramp-end'
});
test('14 s below the target do not end the ramp test', () => {});
test('a normal session never ends early from low power', () => {});
```

Service test in `tests/service/ride-service.test.ts`: a ramp ride that fails ends with status `finished` and its samples are on disk; a ride paused in the app for 60 s at 0 W after minute 8 stays open (`a paused ride does not end the ramp test`).

UI test: during a ramp test `RideView` shows `Fahr, so lange du kannst. Wenn du nicht mehr mithältst, endet der Test von selbst.`

- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Counter `rampLowS` and flag `rampEnded` in the engine, updated in `tick()` before the pause check. `isDone()` returns `rampEnded || sessionS() >= totalS()`. The ride service already ends a done ride as `finished` and saves it; do not change that path. FTP comes from the best minute as before (`ftpFromRamp`), the early end changes nothing there.
- [ ] **Step 4: Run** `tests/service tests/ui/ride-view.test.tsx tests/coach`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rad): Rampentest endet von selbst`.

### Task 6: Personal tips from the coach during the ride

Entry: "Coach tips during the ride".

**Files:**
- Modify: `src/shared/session.ts` (`sessionSchema` gets `tips: z.array(z.string()).max(2).optional()`)
- Modify: `src/coach/coach.ts` (`answerSchema.rideTips: z.array(z.string()).optional()`, prompt, attach tips to `next.session` and to each alternative)
- Modify: `src/ui/ride-tips.ts` (`pickTip` uses `session.tips`)
- Test: `tests/shared/session.test.ts`, `tests/coach/coach.test.ts`, `tests/ui/ride-tips.test.ts` (create)

**Interfaces:**
- Produces: `Session.tips?: string[]` (at most 2, each cut to 120 characters by the coach). Rule-based sessions have none.
- Consumes in `pickTip`: `session.tips`.

- [ ] **Step 1: Write the failing tests**

```ts
test('old session without tips still parses', () => {
  expect(parseSession({ id: 'a', name: 'b', steps: [{ kind: 'erg', durationS: 60, ftpFraction: 0.5, label: 'x' }] }).tips).toBeUndefined();
});
test('the coach puts at most two short tips on the session and the alternatives', async () => {
  // answer({ rideTips: ['a', 'b', 'c'], alternatives: [...] }) → next.session.tips toEqual ['a', 'b']; alternatives[0].session.tips toEqual ['a', 'b']
});
test('without tips from the coach the session has no tips', async () => {});
// ride-tips.test.ts
test('a personal tip comes after body tips and before encouragement', () => {
  // t = 700 s, calm step, session.tips ['Denk an lockere Schultern wegen deines Nackens.'] → that tip; with hr above zone → hr tip first
});
test('a personal tip is not given in a hard section and only once', () => {});
```

- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Prompt: `Schreibe in rideTips höchstens zwei kurze Sätze, die dir während der Fahrt helfen, passend zu Beschwerden, Beweggründen und den letzten Fahrten. Nur, was aus den Daten folgt; sonst lass rideTips weg. Keine Zahlen außer Trittfrequenz.` In `pickTip`, insert after the `prepare-` candidate: personal tips with ids `coach-0`, `coach-1`, only when `t >= 600` and the step is not hard. Ride-tip spacing (`TIP_GAP_S`) stays.
- [ ] **Step 4: Run** `tests/shared tests/coach tests/ui tests/service`. Expected: PASS (the service must accept sessions with `tips`).
- [ ] **Step 5: Commit** `feat(rad): persönliche Tipps vom Coach während der Fahrt`.

### Task 7: Final check

- [ ] Run `npm run typecheck`. Expected: no errors.
- [ ] Run `npm run lint`. Expected: no errors.
- [ ] Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npm test`. Expected: all green, including `tests/architecture/boundaries.test.ts`.
- [ ] Run `PANDAFIT_UNSAFE_NO_FSYNC=1 npx vitest run tests/architecture`. Expected: PASS.
- [ ] Remove the built entries from `docs/after-ride.md` (section "Built by the plan 2026-11-19-after-ride-rest"). Commit `docs(after-ride): erledigte Punkte entfernt`.
- [ ] Merge into `main` only when no ride is open. Test on the bike with `npm run dev:sim` first.

## Von Claude entschieden

- Vocabulary: the plus/minus hint shows only with a connected clicker; the keyboard keys J/N get no hint.
- Change notes: an empty or missing `change` means "nothing changed" and adds no note. Old notes stay.
- Cadence: one average value for the coach and the debrief. No target ranges per section and no new number on screens (keep it light). The coach may give at most one tip and only across several rides.
- Heart rate: the coach may plan `hrHold` only on erg sections of 10 minutes or more, at most 70 % FTP, zone 1 to 3. A hold that does not fit is dropped quietly; the session stays a valid power session. Suggested zones from Garmin stay as they are (from the maximum heart rate in the Garmin review).
- Ramp test: ends by itself after 15 s below 80 % of the target, not before minute 8. The ride is saved as finished. The rider sees one sentence about this during the test.
- Personal tips: written by the coach together with the next session, not live. At most two, shown once each after minute 10, never in a hard section. Without the AI only the rule tips run.
- Not built here: per-coach token use and the AI login name (needs the home server AI service to report tokens per answer; the overall use is already in the home server overview).
