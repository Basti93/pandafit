# Pandafit: Do the gym rules fit beginners?

Status: 14.11.2026. Read-only review of `main` plus the branch `neue-uebungen` (spec only). No files changed.

## Summary

The register and the foundation are mostly written for a person who already trains. The foundation itself says this several times:
- §4 (research doc line 55): "Keine verpflichtenden ≥80 % 1RM für Einsteiger".
- §5 H1 (line 75): no beginner group "sofort zehn direkte Sätze".
- §5 H3 (line 85): "Einstieg … kann mehr Reserve rechtfertigen".
- §4 (line 65): "Der Einstieg kann bewusst leichter und mit mehr Wiederholungen erfolgen".

None of these sentences reaches code. No rule, prompt line or data block knows the training age of a person. A beginner gets the same defaults as an experienced lifter:
- goal "Muskelaufbau" (`DEFAULT_GOAL`, `src/shared/personal.ts:31`),
- hardness "Normal" (`effectivePush`, `src/shared/personal.ts:42-43`),
- the old-school persona that invites failure sets (`src/coach/gym/prompt.ts:57`),
- the full weekly set targets (`rules.ts:95-108`) and session caps (`rules.ts:41-45`).

The strongest single proposal is one general rule: an **entry phase (Einstieg)** derived from data, for example "fewer than about 12 logged strength workouts, or less than about 6 weeks since the first one". It ends automatically and has no visible numbers. During it, a few existing values change (see the areas). It is no per-person special case: it applies to every profile with little history, and the person's explicit hardness choice "Fordere mich" still wins.

Verdicts at a glance:

| # | Area | Verdict |
|---|---|---|
| 1 | Weekly volume, session caps | Adjust for beginners |
| 2 | Failure, RIR, effort question | Adjust (failure); fits (question wording) |
| 3 | Rep ranges and load | Adjust slightly |
| 4 | Progression | Adjust (too slow for novices; machine step too big) |
| 5 | Frequency | Fits |
| 6 | Exercise selection, warm-up | Fits, with small gaps |
| 7 | Start weight, ±1 step | Fits in principle; adjust step size and timing |
| 8 | Risks | See list |

---

## 1. Weekly volume per muscle and per-session caps

**Current rule**
- `muscle.target.*` (`src/shared/training-policy/rules.ts:95-108`): for the default goal "Muskelaufbau", for example chest 12–18, back 14–20, quads 12–18, side delts 12–20 sets per week. The sum of all minimums is about 130 fractional sets per week. Status: active, but `muscle.weekly-set-targets` (line 47) is marked "to-replace" (task 2).
- `gym.max-session-fractional-sets` (line 45): up to 11 fractional sets per muscle per session (preprint S39).
- `gym.max-sets` (line 41): up to 30 work sets per session. `gym.max-exercises` (line 39): up to 10 exercises.
- Prompt: "Mehr Wochensätze pro Muskel … das ist der wichtigste Hebel" (`src/coach/gym/prompt.ts:58`); the block `muskelvolumen` shows the state ("Wenig") against these targets (`prompt.ts:145-148`, `STATE_LABELS` in `src/shared/muscle-balance.ts:13`).
- Rule planner: 6 exercises × 3 sets = 18 work sets (`src/coach/gym/rules.ts:18-19`).

**Verdict: adjust for beginners.**

**Evidence**
- Rhea et al. 2003, MSSE, meta-analysis of 140 studies: in untrained people, about 4 sets per muscle per session, about 60 % 1RM and 3 days per week gave the largest strength gains; trained people needed more load. Old, strength only, but the clearest trained/untrained split.
- ACSM progression models 2009 (Ratamess et al.): novices 1–3 sets per exercise, 8–12 RM, 2–3 full-body days. The ACSM 2026 position stand (Currier et al., S01) gives about ≥10 weekly sets per muscle as a hypertrophy orientation. It draws largely on less-trained adults, but it frames the number as "more growth", not as a minimum for a start. The foundation already says this (H1).
- Iversen et al. 2021, Sports Med, narrative review "No Time to Lift?": single sets 2–3× per week work, especially for novices and older adults.
- Pelland et al. 2026 (S03): dose-response with diminishing returns, mostly young men. I found no clear statement on training status as a moderator. The curve shows that the first sets give the most return per set; this matters most for a beginner.
- Strength of evidence: moderate that beginners gain well on low volume. Low for exact beginner numbers.
- Practical side (not from a meta-analysis): high volume and many eccentric sets in the first sessions cause strong muscle soreness. Case reports of exertional rhabdomyolysis exist for untrained people after a first hard session. It is rare, but it is the one real safety risk of a high start dose.

**Problem for a beginner**
- 1–2 sessions per week cannot reach 130 sets. The UI and the coach will show "Wenig" for almost every group for weeks. This pushes the AI to add sets and gives the person a feeling of falling short. This conflicts with "keep it light".
- 11 fractional sets per muscle and 30 sets per session are a ceiling for experienced lifters, not a sensible first-session dose.

**Proposal (general)**
- Entry phase: per-session cap about 6 fractional sets per muscle and about 12–15 work sets in total. Weekly targets use the lower range (`other`) instead of the hypertrophy range.
- Within the entry phase, the balance shows no "Wenig" state; it shows only "Noch nichts" or a neutral state. This keeps the UI free of numbers and of guilt.
- Independent of beginners, task 2 (shared volume budget instead of simultaneous minimums) solves most of this. Give it priority.

---

## 2. Proximity to failure, failure sets, RIR accuracy, effort question

**Current rule**
- Persona: "im Herzen ein Old-Schooler … ‚Letzter Satz heute: bis nichts mehr geht.‘" (`src/coach/gym/prompt.ts:57`).
- `push.rir` (`rules.ts:246`): Vorsichtig 2–3, Normal 1–3, Fordere mich 0–2 RIR. Default is Normal (`personal.ts:43`). Bo asks for the hardness only after 3 strength workouts (`push.ask-after-workouts`, line 248).
- Normal allows a failure set on the last set at safe equipment (`prompt.ts:102`); up to 4 failure sets and 1 widowmaker per session (`rules.ts:42, 44`). Only "Vorsichtig" excludes failure, drop sets and widowmakers (line 247).
- Safety: failure only on machines, cables and isolation, never on heavy free lifts without a safety (`prompt.ts:60`). Good.
- Effort question (`src/tracking/effort.ts:17-38`, text in `src/tracking/ui/EffortQuestion.tsx:5,13`): "Wie liefen die letzten Wiederholungen bei …?" with "So schnell wie die ersten" (stored as 3+ RIR), "Langsamer, aber sauber" (1–2), "Die letzte ging kaum noch hoch" (0).

**Verdict: adjust (failure for beginners); the question wording fits.**

**Evidence**
- Grgic et al. 2022, J Sport Health Sci, meta-analysis: failure vs. non-failure gives no significant difference for strength or hypertrophy overall. Only a small hypertrophy advantage in trained people (few studies). When volume was not equated, non-failure gave larger strength gains. Refalo et al. 2023 (already cited): failure itself gives no clear extra growth over stopping just short.
- Robinson et al. 2024 (S05): closer to failure tends to give more growth, without a sharp limit. For a beginner, 2–3 RIR is already a strong stimulus.
- RIR accuracy:
  - Halperin et al. 2022, Sports Med, exploratory meta-analysis (12 studies, 414 people): people underpredict reps to failure by about 1 rep on average. Accuracy is better close to failure and in short sets. Training status had no clear effect. Very high heterogeneity.
  - Steele et al. 2017, PeerJ (141 people): prediction is not accurate; there is only a tendency to improve with experience.
  - Zourdos et al. 2016, JSCR: experienced lifters were more accurate in RPE near 1RM than novices.
  - Taken together: novices are probably somewhat worse, and everyone is imprecise. Strength: low to moderate.
- Velocity: rep speed falls as a set approaches failure (Sánchez-Medina & González-Badillo 2011, velocity loss). Asking how the last reps "moved" is concrete and does not ask for a number. I found no study that validates perceived speed in novices. The wording is a sensible translation, not a validated scale.
- Technique: beginners have a less stable technique. Form breaks down near failure, and in free-weight lifts this creates the risk. This is expert consensus (ACSM 2009, NSCA), not RCT evidence.

**Problem for a beginner**
- Default "Normal" and the persona invite failure sets and widowmakers from the first workouts on. A beginner cannot yet tell real failure from discomfort. They get no extra benefit (Grgic 2022) but more soreness and a higher risk of bad form.
- Beginners often stop far from failure (see area 7: they choose light loads). The effort question then gives "So schnell wie die ersten" → progression. This works in the right direction.

**Proposal (general)**
- Entry phase: plan with 2–3 RIR (like "Vorsichtig"), no failure sets, no drop sets, no widowmaker. An explicit "Fordere mich" from the person still wins. Ask for the hardness at the end of the entry phase, not after 3 workouts.
- Add one sentence to the prompt: with little history, technique and a good feeling come first, and hard sets stay just short of failure.
- Keep the effort question wording. It is better for novices than asking for a number of reps in reserve. Optional: the progression could weight the answer "So schnell wie die ersten" a bit less for the first answers of an exercise, but this is not necessary.

---

## 3. Rep ranges and load

**Current rule**
- Rep range per muscle group (`rules.ts:95-108`, `repRangeOf` in `src/shared/muscle-targets.ts:59`): 6–12 for chest, back, quads, hamstrings; 8–15 for arms and glutes; 10–20 or 12–25 for small muscles.
- Prompt: big compounds tend to use the lower part of the range; growth occurs from about 5 to 30 reps when the set is close to failure (`prompt.ts:64`).
- Rule planner start without history: 10 reps inside the range (`src/coach/gym/rules.ts:20, 26`).
- Planned register values (not active): compounds 6–15, isolation 10–20 (`rules.ts:88-89`).

**Verdict: fits mostly; adjust the lower end for beginners.**

**Evidence**
- Lopez et al. 2021 (S04) and Schoenfeld et al. 2021 (re-examination of the repetition continuum): similar hypertrophy over a wide load range when sets are hard. The "5 to 30" statement is supported for people who train close to failure.
- ACSM 2009: novices 8–12 RM at about 60–70 % 1RM. Rhea 2003: about 60 % 1RM was best in untrained people. ACSM 2026: heavier loads (about ≥80 % 1RM) mainly for strength, and the foundation itself says not mandatory for beginners.
- Strength: moderate. Higher reps help beginners to learn the movement and to judge effort (the error in Halperin 2022 grows with long sets, so very long sets near 30 are worse for effort judgment).

**Problem for a beginner**
- The prompt tells the AI to put big compounds at the low end, for example 6 reps on a barbell squat. For a beginner, this is a heavy load with an unstable technique.

**Proposal (general)**
- Entry phase: compounds start at the middle of the range (about 8–12), and the prompt's "unteren Bereich" applies only after it. Isolation stays as it is.
- Keep the 5–30 statement. Add "for sets close to failure".

---

## 4. Progression

**Current rule**
- Double progression (`src/shared/gym/progression.ts:117-158`): +1 rep per session (line 155); at the top of the range, one ladder step up and reps go back to the start of the range (line 157).
- `gym.min-comparable` (`rules.ts:37`): 2 comparable sessions within 56 days before anything changes (`progression.ts:149`), unless the person answered "So schnell wie die ersten" (`progression.ts:148`).
- `load.default-step` (`rules.ts:66`): machine 5 kg, dumbbell 2 kg, barbell 2.5 kg, kettlebell 4 kg (later learned per exercise and studio).
- `block.stagnation-sessions` (`rules.ts:254`): a core exercise changes after 2 sessions without progress.
- Step back: two drops at the same weight or a break of more than 28 days → 90 % (lines 27-28, 35).

**Verdict: adjust. Progression is too slow in reps and the first weight steps can be too big relative to the weight.**

**Evidence**
- ACSM 2009 progression models: increase the load by about 2–10 % when the person does 1–2 reps above the target on two sessions in a row ("2-for-2"); novices progress fastest.
- Beginner gains: early strength gains are large and mostly neural (Moritani & deVries 1979; Seynnes et al. 2007: measurable hypertrophy after about 3–4 weeks; Damas et al. 2016: early size changes partly swelling). In practice, novices can add load in almost every session for weeks. This is well supported as a tendency, not as a number.
- Plotkin et al. 2022 (S12): load and rep progression both work, in trained people.
- Strength: moderate that novices progress fast; low for exact step rules.

**Problem for a beginner**
- With a range of 6–12 and +1 rep per session, one weight step takes up to 6 sessions. With 1 workout per week, this is 6 weeks per step while the beginner gets stronger every week. The first change also waits for the third session (min-comparable).
- A machine step of 5 kg on a 15 kg machine is +33 %, a dumbbell step of 2 kg on 4 kg is +50 %. After the step, reps go back to the start of the range, which the person often cannot reach. Then the "two drops" rule can step back again. The result is a zig-zag.
- 2 sessions without progress before a core exercise changes is short for a beginner. For a beginner, a stall is more often a technique, sleep or load-choice issue, and technique gains need the same exercise (foundation K1).

**Proposal (general, no person-specific rule)**
- The rep jump follows the reserve: with "So schnell wie die ersten", or reps clearly above the plan (for example +2), raise reps by 2–3 or go straight to the next weight step. This applies to everyone. In practice it mostly affects beginners.
- Relative step rule: when one ladder step is more than about 10–15 % of the working weight, reps after the step start where the new load allows (simple estimate from the last reps, at least the bottom of the range minus a few). Alternatively the range top is extended until the step is about 10 % or less. Keep it invisible: the person sees only the next weight and reps.
- Entry phase: `block.stagnation-sessions` waits for 3 sessions, or does not change a core exercise during the entry phase.

---

## 5. Frequency

**Current rule**
- Prompt: frequency matters little at equal volume; one or two sessions can work and are never a flaw (`prompt.ts:58`).
- `gym.isolation-sessions-per-week` (`rules.ts:46`): isolation per muscle in at most 2 sessions per week; compounds are not limited.
- Rule planner default is a full-body workout (`src/coach/gym/rules.ts:56, 114`).
- Health finding: muscle strengthening on at least 2 days (WHO, `rules.ts:137`).

**Verdict: fits.**

**Evidence**
- Schoenfeld et al. 2019: at equal volume, frequency has little effect on hypertrophy. Pelland 2026: frequency has an effect for strength. ACSM 2009: novices 2–3 full-body days. ACSM 2026: train every major muscle group at least 2× per week (secondary sources; check the primary text). Rhea 2003: untrained 3×/week per muscle best for strength.
- For a beginner, more frequent practice of the same movement also helps skill learning (consensus, little direct data).

**Proposal**
- No change in the rules. For a beginner, the outlook text may prefer 2 full-body sessions per week when the week plan allows it. It must never blame 1 session.

---

## 6. Exercise selection and warm-up

**Current rule**
- AI planner: only exercises from the history or with equipment that occurs in the history (`prompt.ts:63`, filter `prompt.ts:143`). Without history, the block `vorlagen` is empty, because the equipment set comes from the history (`prompt.ts:124`).
- Rule planner without history: simple machine exercises for 8 muscle groups, no weights, text "Taste dich in Ruhe heran" (`src/coach/gym/rules.ts:104-117`).
- Warm-up ramp (`rules.ts:120`, `src/shared/warmup.ts:13-27`): bar ×10, then 40/60/80 % with 5/3/2 reps, before the first exercise of a muscle group (`warmup.ts:42-54`). No ramp without a working weight.

**Verdict: fits; small gaps.**

**Evidence**
- Haugen et al. 2023, BMC Sports Sci Med Rehabil, meta-analysis of 13 studies: no difference in hypertrophy between free weights and machines; strength gains are specific to the trained mode. So machines are a full-value start for beginners. They are easier to learn and safer near failure (consensus).
- Ribeiro et al. 2021 (S11): no single warm-up scheme is better; no proof of injury prevention. A specific ramp before the work sets is sensible. For a beginner, it also serves as technique practice.

**Problem for a beginner**
- A beginner with no history gets an AI plan with almost nothing to choose from. The rule planner then gives the machine plan, which is good.
- The prompt does not say that a person with little history should get simple, guided exercises first.
- With very light working weights (for example 15 kg on a machine with 5 kg steps), the ramp gives sets at 5 and 10 kg. This is harmless but uses time. A new exercise without a weight gets no warm-up at all.

**Proposal (general)**
- Prompt, for little history: prefer machines, cables and simple dumbbell exercises; add free barbell lifts when the person wants them, without failure.
- Warm-up: when the estimated weight is used (area 7), build the ramp from the estimate. The ramp sets then also check the weight (see area 7).
- Optional: skip ramp steps that are only one ladder step below the working weight.

---

## 7. Start weight estimate and "Wie war das Gewicht?" (branch neue-uebungen)

**Spec** (`.worktrees/neue-uebungen/docs/superpowers/specs/2026-11-14-neue-uebungen-design.md:8-12`)
- A new exercise starts with 3 work sets (`gym.new-exercise-sets`), weight empty.
- Bo (AI) gives a cautious start weight ("lieber zu leicht"), marked as estimated and rounded to the ladder.
- After the first confirmed work set: "Wie war das Gewicht?" with "Zu leicht", "Passt", "Zu schwer", "Überspringen". The answer moves the open sets by one ladder step. Once per exercise.

**Verdict: fits in principle; adjust the step size and the timing.**

**Evidence**
- Steele et al. 2022, Sports Med, meta-analysis (18 studies, 368 people): self-selected loads average about 53 % 1RM, and untrained and trained people are similar. Glass & Stanton 2004: novices chose 42–57 % 1RM. Focht 2007: untrained women self-selected loads too light for a strong stimulus. So beginners err toward "too light". "Lieber zu leicht" plus a "Zu leicht" button corrects in the right direction.
- A 3-point perceived difficulty is a coarse RPE. RPE scales such as OMNI-RES are validated in untrained men and women (Robertson et al. 2003). A simple felt-difficulty check is suitable for novices. Strength: moderate for RPE scales, low for this exact 3-step form.
- Rep-based autoregulation (for example "do reps until they slow down" and estimate from the reps) is more precise in theory. But it needs counting and near-failure sets, which are exactly what novices do worst (Halperin 2022, Steele 2017). For a light app, the felt check is the better first step.

**Problem**
- An AI estimate for a new person can be wrong by 30–50 %. One ladder step (for example 2.5 kg on 40 kg = 6 %, or 5 kg on 20 kg = 25 %) is either too small or too large, depending on the weight.
- The check comes after the first work set. When the estimate is far off, one of three work sets is already lost.
- After a "Zu leicht" the person cannot correct again, because the question comes once.

**Proposal (general)**
- Step size relative to the weight: "Zu leicht" / "Zu schwer" moves about 10–20 % of the weight, rounded to the ladder, at least one step. No new button and no new numbers in the UI.
- When the estimated weight has a ramp (area 6), ask after the last warm-up set instead of after the first work set. If there is no ramp, keep the current timing.
- Ask again once on the next set if the answer was "Zu leicht" or "Zu schwer" (at most 2 times per exercise), so that a large error can converge.
- Optional: use the reps of the first set. If the person did clearly more reps than the plan, treat it as "Zu leicht" without a question.

---

## 8. Rules that are risky or counterproductive for beginners

Ranked by impact:

1. **Default hardness "Normal" plus the old-school persona plus up to 4 failure sets and a widowmaker** (`personal.ts:43`, `prompt.ts:57, 102`, `rules.ts:42, 44, 246`). No benefit for novices (Grgic 2022), more soreness, worse form. → Entry phase without failure, drop sets and widowmaker; hardness question at the end of the entry phase.
2. **Full hypertrophy weekly targets as the default goal** (`personal.ts:31`, `rules.ts:95-108`). Permanent "Wenig", pressure to add sets. → Entry phase on the lower targets; task 2 first.
3. **Per-session ceilings for experienced lifters** (`rules.ts:41, 45`): 30 sets and 11 fractional sets per muscle in a first session cause strong soreness and, rarely, rhabdomyolysis. → Entry phase caps about 12–15 sets and about 6 per muscle.
4. **Slow progression** (`progression.ts:149, 155`): +1 rep per session and waiting for 3 sessions do not match the fast beginner gains. → Rep jump follows the reserve.
5. **Large relative load steps** (`rules.ts:66`, `progression.ts:157`): 5 kg on light machines → zig-zag and a step back. → Relative step rule.
6. **Compounds at the low end of the range** (`prompt.ts:64`). → Entry phase starts compounds at about 8–12.
7. **Core exercise changes after 2 stalled sessions** (`rules.ts:254`): technique needs the same exercise. → Wait longer in the entry phase.
8. **The AI does not know the training age.** No data block or line says "little history". → Add one line with the number of strength workouts and weeks since the first one, plus the entry-phase rules.

Not risky, keep as it is: the effort question wording, the machine fallback plan, "1–2 sessions are no flaw", the safety rule for failure on free weights, the step back after a break, and "lieber zu leicht" for the start weight.

## Sources checked for this review (beyond S01–S39)

- Rhea MR et al. 2003, Med Sci Sports Exerc 35:456, PMID 12618576 (meta-analysis, abstract).
- Ratamess NA et al. 2009, ACSM Position Stand: Progression models in resistance training for healthy adults, Med Sci Sports Exerc 41:687 (from knowledge, not re-read).
- Grgic J et al. 2022, J Sport Health Sci, DOI 10.1016/j.jshs.2021.01.007 (meta-analysis, abstract).
- Halperin I et al. 2022, Sports Med, PMID 34542869 (exploratory meta-analysis, abstract).
- Steele J et al. 2017, PeerJ 5:e4105 (cross-sectional, abstract).
- Zourdos MC et al. 2016, J Strength Cond Res 30:267 (from knowledge).
- Steele J et al. 2022, Sports Med, PMID 35790622 (meta-analysis of self-selected loads, abstract and summary).
- Glass SC & Stanton DR 2004, J Strength Cond Res, PMID 15142014.
- Haugen ME et al. 2023, BMC Sports Sci Med Rehabil (meta-analysis, abstract).
- Iversen VM et al. 2021, Sports Med 51:2079, PMC8449772 (narrative review).
- Robertson RJ et al. 2003, OMNI-RES validation, Med Sci Sports Exerc 35:333 (from knowledge).
- Schoenfeld BJ et al. 2021, Sports 9:32, repetition continuum (from knowledge).
- Seynnes OR et al. 2007; Damas F et al. 2016; Moritani & deVries 1979 (early neural and muscular adaptation, from knowledge).
- ACSM 2026 (S01): novice-specific statements checked only in secondary sources; check the full text before quoting a novice number.
