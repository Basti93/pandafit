# Milestone F: Planning is flexible

Brief and acceptance: `docs/roadmap.md`, section "Meilenstein F — Brief". Spec: `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md`:
- §5 l.64–73 (Rahmen, time limits);
- §6 l.75–87 (week vs spontaneous, combinations, no training debt);
- acceptance rows l.230–231.

## Global Constraints

- Before each task, check that no ride is open: the live file must be older than one hour, and no `ride-*/meta.json` may have status open.
- No npm install, no new dependencies, no push, no deploy.
- Public repo: no personal data.
- A workout is never lost.
- Light UI: one line "Heute: … – weil …"; the mode and time controls are compact selects. No number walls; durations are shown as "ca. N Min".
- General mechanisms only. Product values (warm-up minutes, seconds per set, change time, the 10 % slack) live in the policy register (`src/shared/training-policy/rules.ts`).
- Reuse:
  - the record pattern (`src/shared/personal.ts`, `validate.ts`, coach-side readers);
  - `gehtNicht`/wording;
  - `checkWeekPlan`;
  - `day-load.ts`.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task. Tests pinning replaced behaviour are deleted.

## Today (from exploration)

- **`PlanDay`:** `{ date, sport, hardness, fixed, legs?, long?, note? }`, one sport per day (`src/shared/week-plan.ts:7–13`).
  - `checkWeekPlan` is at l.33–46.
  - The chat coach proposes weeks (`chat-coach.ts:48–58, 193–196`).
- **Plan hint:** planners read the week only as a prompt hint (`src/coach/chat/plan-hint.ts:11–20`). Without a plan each planner plans as before; that is implicit spontaneous mode.
- **No time setting:**
  - `GYM_PLANNED_MINUTES = 45` (`src/coach/day-load.ts:15`);
  - `restS` per exercise (`guardrails.ts:65`);
  - no duration estimate.
- **Day load:**
  - `dayRatings` (`day-load.ts:60–91`) and `crossSportCut`;
  - readiness from resting HR (`src/coach/readiness.ts`);
  - `recentLegWork` in gym history.
- **UI:**
  - `TodayCard.tsx:10–41` shows "Heute: Sport, Härte", or nothing without a plan;
  - the start screen `src/web/App.tsx:143–156` shows "Noch kein Wochenplan …";
  - the week page is `CoachScreen.tsx`.
- **Rule fallback:** `ruleWorkout` (`src/coach/gym/rules.ts`) bypasses `checkWorkout`.

## Design

### Frame record (`src/shared/frame.ts`, new)

- Kind `frame`, one per profile, id `frame`. Body: `{ mode: 'week' | 'spontaneous', minutes: number | null, today?: { date: 'YYYY-MM-DD', minutes: number }, atMs }`.
  - `minutes` is the usual time per session. Allowed values come from `frame.minute-choices` in the register: 20, 30, 45, 60, 75, 90, 120. `null` means "keine Angabe".
  - `today` only counts on its date.
- `frameOf(records, todayDate)` returns defaults `{ mode: 'week', minutes: null }` and the effective minutes for today.
- Add the kind to `RECORD_KINDS` and validate it.

### Duration estimate (`src/shared/duration.ts`, new)

- `gymMinutes(workout)` = warm-up (`duration.gym-warmup-min`, 8) + Σ over sets of (work `duration.set-work-s`, 40 s + the exercise `restS`) + exercise changes (`duration.change-s`, 60 s each), rounded to 5.
- Run and bike use their existing minutes / step durations.
- A combination day sums both parts.
- `day-load.ts` uses `gymMinutes` of the planned workout when known, instead of `GYM_PLANNED_MINUTES`, and keeps the constant only as the fallback without a plan. Rename it to make that clear.

### Time budget in the gym coach

- The budget is the effective frame minutes for the planned day, if set.
- The prompt gets one line: "Zeit: höchstens N Min einschließlich Aufwärmen und Pausen".
- `checkWorkout` rejects plans whose `gymMinutes` exceeds budget × 1.1 (register `duration.slack-pct`, 10). The reason phrase is "zu lang für deine Zeit".
- **The rule fallback goes through the same check:**
  - `ruleWorkout` output is passed through `checkWorkout`;
  - if it is too long, it is trimmed deterministically: first remove sets beyond 2 per exercise from the last exercises, then drop the last exercises, until it fits;
  - if it still fails a guardrail, use the existing minimal plan, and log/test it.
- The plan reason and the plan card show "ca. N Min".
- Without a budget, nothing is cut and the estimate is shown.

### Combination days

- `PlanDay` gets an optional `also?: { sport: Sport; hardness: Hardness }`.
  - It is allowed only when at most one of the two parts is hard, and never rest + something.
- `parseProposal` and `checkWeekPlan` know the field:
  - for the day's hardness and legs, the harder part counts;
  - the existing day-after rules apply to the combined day;
  - a new message is "Zwei Einheiten an einem Tag nur, wenn höchstens eine davon hart ist."
- The chat prompt says: only on an explicit wish of the person ("Kombination nur, wenn die Person sie will").
- `dayRatings` counts both parts (minutes summed, legs if either).
- `plan-hint.ts` shows both.
- TodayCard shows "Kraft + Rad locker".

### "Was geht heute" (`src/shared/today.ts`, new, pure, no AI)

- `todayAdvice({ ratings (past days), planDay?, goal, rules/wishes, frame, readiness? })` returns `{ sport, hardness, also?, reason: string }`.
- **Rules, in order, each giving one German reason sentence:**
  1. Readiness flags raised resting HR → easy or rest: "weil dein Ruhepuls erhöht ist".
  2. Hard legs yesterday → no hard leg day today: "weil deine Beine gestern hart gearbeitet haben".
  3. Two hard days in a row → easy: "weil du zwei harte Tage hintereinander hattest".
  4. With a plan day that passes 1–3 → the plan day: "laut deinem Wochenplan".
  5. Spontaneous / no plan → the sport with priority `focus` that was done least recently, else the least recently done one, at moderate: "weil du <Sport> am längsten nicht gemacht hast".
  6. A day off when the last 6 days had no rest → rest: "weil du seit 6 Tagen ohne Pause trainierst".
- Thresholds live in the register (`today.*`).
- Missed plan days are never carried over: the advice only looks at today's plan day and the past load.
- The reason is phrased as one sentence: "<Sport, Härte> – <reason>".
- In week mode, show the reason only when the advice differs from the plan day, else nothing extra.
- **Coach side:**
  - in spontaneous mode, or without a plan, `plan-hint.ts` gives the advice as the hint ("Heute passt: …, weil …") instead of '';
  - in week mode it is as today, plus the advice line when it differs.

### UI

- **Week page:** one compact line above the week: "Planung: [Feste Woche | Spontan] · Zeit pro Einheit: [– | 30 | 45 | …] Min".
  - In spontaneous mode the week card is replaced by the today advice and the history. Proposing a week stays possible via the chat.
- **Start screen** (`src/web/App.tsx`) **and TodayCard** (also the Mac `src/ui/App.tsx`):
  - "Heute: <advice>" with the reason line;
  - "Heute nur [–|20|30|45|60] Min" as a small select that writes `frame.today`.

## Tasks

### Task 1: Frame, duration estimate and gym time budget

**Files:**
- `src/shared/frame.ts`, `src/shared/duration.ts` (new)
- `src/shared/records.ts`, `src/web/validate.ts`
- `src/shared/training-policy/rules.ts`
- `src/coach/day-load.ts`
- `src/coach/gym/{guardrails,rules,prompt,gym-coach}.ts`
- a coach-side frame reader
- tests

Acceptance tests:
- frame defaults and the `today` override only on its date;
- the `gymMinutes` example;
- a budget of 30 → the AI plan over 33 min is rejected with the phrase;
- the fallback is trimmed to fit and passes `checkWorkout`;
- without a budget nothing is trimmed;
- `dayRatings` uses the estimate.

Commit: `feat(planning): plans fit the time you have, the fallback is checked too`.

### Task 2: Combination days

**Files:** `src/shared/week-plan.ts`, `src/coach/chat/{chat-coach,plan-hint}.ts`, `src/coach/day-load.ts`, `src/tracking/ui/TodayCard.tsx` (+ the week display in `CoachScreen` if it renders days), tests.

Acceptance tests:
- parse and check gym+bike easy → ok;
- two hard parts → the message;
- day-after rules use the combined day;
- ratings sum the minutes;
- the hint shows both.

Commit: `feat(planning): a day can hold two sessions when you want it`.

### Task 3: What fits today

**Files:** `src/shared/today.ts` (new), `src/coach/chat/plan-hint.ts`, the coach-side readers for frame/readiness, `src/shared/training-policy/rules.ts`, tests.

Acceptance tests:
- one test per rule 1–6 with its reason sentence;
- a missed plan day is not carried over;
- week mode without a deviation gives no extra reason;
- the spontaneous hint goes to the planners.

Commit: `feat(planning): what fits today, with the reason in one sentence`.

### Task 4: Mode, time and today in the app

**Files:**
- `src/tracking/ui/CoachScreen.tsx`, `TodayCard.tsx`
- `src/web/App.tsx`, `src/ui/App.tsx`
- `tracking.css`
- `scripts/ui-shots/run.ts` (shot `today-advice`)
- tests

Acceptance tests:
- the mode and minutes selects write the frame;
- spontaneous mode shows the advice instead of the week;
- "heute nur" writes `frame.today`;
- the start screen without a plan shows the advice with its reason.

The shot must render.

Commit: `feat(planning): choose week or spontaneous and your time, see what fits today`.
