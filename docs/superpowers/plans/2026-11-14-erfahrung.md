# Plan: Erfahrung

Spec: `docs/superpowers/specs/2026-11-14-erfahrung-design.md`. Evidence: `docs/research/2026-11-14-beginner-science-review.md`.

Base rule for every part: a missing experience (`undefined`) behaves like `erfahren`. Only the gym coach, the scan and the statistics page pass a level. So all pure functions keep today's results when nobody passes a level.

## (a) Estimate and stored answer

- New `src/shared/experience.ts`:
  - `type Experience = 'neu' | 'einige' | 'erfahren'`, `EXPERIENCES`, `atLeast(e, level)`, `maxExperience(a, b)`.
  - `experienceFromData(dates: readonly string[], today: string): Experience`: distinct strength dates up to today. Thresholds from the rule `experience.levels`.
  - `experienceOf({ dates, answer, today })`: the maximum of the answer and the data.
  - `EXPERIENCE_QUESTION`, `EXPERIENCE_LABEL` (the three answers).
- Answer: field `experience?: Experience` in the `goal` record (like `push`). `readGoalParts`, `storedGoalOf`, `goalOf` carry it. Goal rules from the chat cannot set it.
- Rules: `experience.levels` (values), new sources for the review's studies.
- Tests: `tests/shared/experience.test.ts`, goal round trip in the personal tests.

## (b) The one question

- `ChatMessage.askExperience?: true` and `experienceChange?: { from; to }` (read and validated in `readChat`).
- `ChatCoach.askExperience(id)`: writes the question without AI.
- `experienceAskDue(...)` in `src/coach/chat/month-review.ts`: no answer, no earlier ask (`Sent.expAsk`), data below `erfahren` (only then can the answer change the estimate), the person trains strength (gym coach on or a strength date). Same quiet-time rules as the push question (shared helper).
- `pushAskDue` and the review's push question: only from `einige`.
- Scan: the experience question goes before the push question, never in the same scan.
- UI: `ExperienceCard` (three answers, "Später", Rückgängig), wired in `ProposalCard`, `CoachChat`, `openProposals`.
- Tests: due function, card, open proposals.

## (c) Effects

- Rules in `rules.ts` (values per level, `erfahren` = today's rule): `experience.failure-sets`, `experience.max-sets`, `experience.session-fractional-sets`, `experience.rir`, `experience.rep-floor`, `experience.rep-jump`, `experience.clear-margin`, `experience.stagnation-sessions`, `gym.large-step`.
- Getters in `src/shared/experience.ts` (`limitsFor(e)`), used by `limits.ts`.
- Guardrails (`GymContext.experience`): failure and drop sets per level, failure only in the last work set for `einige`, no widowmaker below `erfahren`, max sets, fractional sets per muscle, rep range with the raised floor.
- Rule planner: caps sets per session and per muscle by level.
- Progression (`Plan.experience`): rep floor, faster jump for `neu` (answer "plenty" or clearly more reps), no wait for a second session when the surplus is clear, the large-step rep start (all levels) with a lower floor while at a weight that came with a large step, stagnation waits longer for `neu`.
- Muscle balance: weekly targets of `neu` use the lower range; the state `low` is not shown for `neu`.
- Tests: guardrails, progression, rule planner, balance; the existing suites stay green.

## (d) AI planner

- `PromptInput.experience`: one line with the level in words and one general instruction per level, with the stricter limits as numbers from the rules.
- The system prompt says that the invitation to a set "bis nichts mehr geht" is not for a person who starts.
- Push line: reserve and failure text from the stricter of push and experience.
- Gym coach: computes the level (own + Hevy dates, plus Garmin strength dates through a new optional dep `strengthDates`) and passes it to the context, the plan and the prompt.
- Tests: prompt lines per level.
