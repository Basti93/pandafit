# Meilenstein Z „Zum Abschluss“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After a strength workout the app suggests a calm finish: 20 minutes of easy cardio and stretching, or only stretching when cardio does not fit today.

**Architecture:** Web only. One pure rule `finisherOf` in `src/tracking/ui/finisher.ts`, shown in two places: the workout summary and, for three hours after the workout, a card on Heute that also holds the existing mobility row.

**Tech Stack:** TypeScript, React, vitest.

**Spec:** User wish of 08.11.2026 (`.superpowers/next-after-v.md`): „Nach dem Krafttraining immer einen Abschluss vorschlagen: 20 Minuten Cardio oder Dehnen oder beides.“ The user gave autonomy for the details (08.11.2026, „mach danach selbstständig mit den anderen Punkten weiter“). The decisions below are mine.

## Global Constraints

- Offered, never owed: no ticks, no „erledigt“-pressure, no counts. Copy calm, du-form.
- Exact copy: heading „Zum Abschluss“; cardio line „20 Min locker Cardio: Rad, Crosstrainer oder Laufband. Du kannst dabei noch reden.“; stretch line without a mobility session „Ein paar Minuten dehnen, was sich fest anfühlt.“; only-stretch reason (muted) „Heute reicht Dehnen.“
- With a mobility session from the coach the stretch part is the existing `MobilityOffer` row („Beweglichkeit · N Min“, its sheet unchanged).
- No server change, no new record kind. Light and dark, 360 px. Existing tokens only.
- `npm test`, `npm run typecheck`, `npm run test:web-smoke` before the commit.

## Review Focus

1. A workout still open (`endMs === null`) shows no finisher.
2. A ride or run after the workout makes the cardio line disappear on Heute.
3. The summary still has its one „Fertig“ button and nothing else to tap except the optional mobility row.
4. Heute without a finished strength workout today looks exactly as before (mobility row where it was).
5. Three hours after the end the card is gone; the mobility row stays as before while its own window lasts.

---

### Task 1: The rule and both places

**Files:**
- Create: `src/tracking/ui/finisher.ts`, `src/tracking/ui/Finisher.tsx`
- Modify: `src/tracking/ui/WorkoutSummary.tsx`, `src/tracking/ui/WorkoutScreen.tsx` (pass the inputs), `src/web/App.tsx` (`Heute`, today block), CSS only if needed
- Test: `tests/ui/finisher.test.ts`, `tests/ui/finisher-view.test.tsx` (or next to the existing summary / heute tests)

**Interfaces (Produces):**
- `FINISHER_WINDOW_MS = 3 * 3_600_000`, `LONG_WORKOUT_MIN = 75`
- `type Finisher = { cardio: boolean; stretch: true; reason: string | null }`
- `finisherOf(i: { workout: LoggedWorkout; nowMs: number; today: PlanDay | null; activities: ActivityItem[]; complaintsOpen: boolean }): Finisher | null`
  - null when `workout.endMs === null` or `nowMs - workout.endMs > FINISHER_WINDOW_MS`.
  - `cardio` false when any of: an activity of kind `rad` or `lauf` started today (local date of `workout.endMs`), `today` has sport or `also.sport` `bike` or `run`, `complaintsOpen`, or the workout lasted ≥ `LONG_WORKOUT_MIN` minutes. Otherwise true.
  - `reason` = „Heute reicht Dehnen.“ when cardio is false, else null.
- `latestFinishedStrength(workouts: TrackedRecord[] | null, nowMs: number): LoggedWorkout | null` — the newest non-deleted workout with `endMs` on today's local date.
- `Finisher({ f, mobility }: { f: Finisher; mobility?: ReactNode })` — section with aria-label and heading „Zum Abschluss“; the cardio line when `f.cardio`; `f.reason` muted; then `mobility` if given, else the plain stretch line.

**Places:**
- `WorkoutSummary`: below the next-step rows and above „Fertig“, `<Finisher f={finisherOf(...)} />` (no mobility row there; the coach's session may not exist yet). `WorkoutScreen` passes `today`, `activities` and `complaintsOpen` from the records it already has or reads (`weekplan`, `activities`, `complaint`).
- Heute (offset 0): when `latestFinishedStrength` gives a workout and `finisherOf` is not null, render `<Finisher>` in the place of the mobility row, with the existing `MobilityOffer` element passed as `mobility`. Otherwise the mobility row stays as it is today.

- [ ] Tests for `finisherOf`: open workout → null; 3 h + 1 min after end → null; plain case → cardio true, reason null; a `rad` activity today → cardio false with the reason; today's plan `also.sport: 'run'` → false; complaint open → false; 80-minute workout → false; an activity yesterday does not count.
- [ ] Tests for `latestFinishedStrength`: newest of two finished today; ignores deleted, open and yesterday's.
- [ ] View tests: summary shows „Zum Abschluss“ with the cardio line and still exactly one button „Fertig“; Heute after a finished workout shows the card with the mobility row inside; Heute without a finished workout shows no „Zum Abschluss“.
- [ ] Implement, run focused tests, then full suite, typecheck, web-smoke.
- [ ] Commit `feat(web): a calm finish after strength training`.

### Task 2: Close

- [ ] Shots of the summary and Heute (390×844, dark 360×740) into the scratchpad; look at them; fix overflow.
- [ ] `docs/roadmap.md`: milestone Z row ✅ and a short brief; mark the wish done in `.superpowers/next-after-v.md`.
- [ ] Commit `docs(roadmap): Z done`.
