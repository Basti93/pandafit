# Pandafit: training statistics

Status: approved by the riders on 2026-11-03. "[Rider]" marks what the riders decided, "[Builder's call]" what was settled on their behalf and can be overruled.

## Why

Pandafit plans bike rides, strength, mobility and runs, each with its own coach. Nobody sees the whole picture: is the training as a whole in balance, and are the muscles trained evenly [Rider: "ob das gesamte Training in Balance ist und auch die Muskeln gleichmäßig trainiert werden"]? A rider who lifts twice a week and rides for heart health wants to see at a glance whether the rides fall away, whether hard days pile up, and whether pushing outweighs pulling.

## Goals

- One statistics page per profile, on the phone and on the Mac.
- Both at once [Rider: "Beides"]: the current week at a glance on top, the trend of the last weeks below.
- **Overall balance:** minutes per week per sport (bike, strength, run, mobility), and how hard the days were (easy, moderate, hard; the day ratings the coaches already share in `src/coach/day-load.ts`).
- **Muscle balance:** working sets per muscle group per week, against a target range, with antagonist pairs side by side: push against pull (chest against back), front against back of the thigh (quadriceps against hamstrings and glutes), front against rear shoulder.
- A short plain-language verdict per section, for example "Rücken 8 Sätze, Brust 14: Ziehen kommt zu kurz." or "Drei Wochen in Folge kein Rad."
- The gym coach uses the same muscle numbers when it plans, so the page shows what the coach sees and not a second truth.
- Works for anyone: a profile that only rides or only lifts sees only its part. Hevy and Garmin stay optional.

## Non-goals

- No comparison between people, no rankings.
- No body measurements, no weight tracking, no nutrition numbers on this page.
- No medical advice.

## Anti-goals

- Guilt and streaks: a light week is shown as it is, never as a failure. No red alarms for a week of rest.
- Fake precision: no score out of 100, no single "balance index". Counts and plain sentences.
- A page that disagrees with the coach.

## What counts

- **Working set** [Builder's call]: a set marked done that is not a warm-up. Drop sets and failure sets count. Sets of logged workouts from Pandafit and from Hevy count alike (both are `workout` records).
- **Muscle of an exercise** [Builder's call]: the primary muscle only, one set counts once. Own exercises carry `primaryMuscle` (`src/shared/exercises.ts`); Hevy exercises are matched to own exercises by id link, exact title, or the same movement (`describeExercise` / `similarExercises` in `src/tracking/similar.ts` show the matching). An exercise with no known muscle counts under "Sonstiges" and is listed, so the rider sees what is missing.
- **Target range** [Rider: "das hängt vom Muskel ab"]: per muscle group, from `src/shared/muscle-targets.ts` (sets after the RP volume landmarks, the building range for a muscle goal and the minimum effective range otherwise; rep ranges per group, higher for small muscles). The gym coach gets the same numbers. Shown as a band, not as a must.
- **Groups shown**: the groups of `src/shared/muscle-targets.ts`: Brust, Rücken (lats and upper back together), Schultern vorn, Schultern seitlich und hinten, Bizeps, Trizeps, Oberschenkel vorn, Oberschenkel hinten und Gesäß, Waden, Bauch. Smaller groups (forearms, traps, abductors…) appear only when trained.
- **Pairs**: Brust : Rücken, Oberschenkel vorn : Oberschenkel hinten und Gesäß, Schultern vorn : Schultern hinten. Front and rear shoulder need the exercise to say which; where it cannot be told, the pair is not shown [Builder's call].
- **Imbalance verdict** [Builder's call]: a pair is called out when one side has less than two thirds of the other over the last 4 weeks and at least 6 sets were done on the larger side. A single week is never enough to call it.
- **Week**: Monday to Sunday in the profile's time zone, as the run coach and the meal plan do.
- **Trend window**: the last 8 weeks [Builder's call].

## Overall balance

- Minutes per sport per week: bike rides, strength workouts (start to end), runs (from the run records), mobility sessions.
- Day hardness per week: count of easy, moderate and hard days, from the same day ratings the coaches use. Rest days are shown as rest days, not as gaps.
- Verdicts [Builder's call]: more than two hard days in a week; a sport the profile has set up that had no session for 3 weeks; a week with more than 1.5 times the minutes of the 4-week average.

## Where the numbers come from

The phone has workouts, runs and mobility as records, but bike rides live on the Mac (or on the server coach). The phone sees ride minutes only through the household `together` record today. Bike minutes and the day ratings must reach the phone as a record; whoever builds this chooses the record shape (a new record kind or an extension of an existing one) and keeps it free of health details beyond minutes and hardness per day. The muscle numbers are computed from workout records on whichever device shows the page, with shared code, so the phone and the Mac show the same.

## Screens

- Phone: a new tab or an entry in the existing training area; Mac: a menu item next to "Laufen". The builder picks the exact place.
- Top: "Diese Woche": minutes per sport, hard days so far, sets per muscle group so far against the band, the verdicts.
- Below: "Letzte 8 Wochen": minutes per sport per week (stacked bars), hard days per week, sets per muscle group per week, the pairs over 4 weeks.
- Charts follow the dataviz rules of the project; text stays readable without colour.

## The coach

The gym coach gets the 4-week sets per muscle group and the pair verdicts in its input and prefers an under-trained group when it chooses exercises. This is a hint to the coach, not a hard rule.

## Settled after the builder check

- **Day ratings cover every sport, and the coach side publishes them** [Builder's call]. `dayRatings` in `src/coach/day-load.ts` already rates rides and gym workouts (with legs); runs and mobility are added there. Whoever runs the coach for the profile (the Mac, or the server coach once the profile moved) writes one record per profile with, per day of the last 8 weeks: minutes per sport and the day's hardness. The phone and the Mac page both read that record and trust it; neither recomputes hardness. The muscle numbers are not in it: they are computed from workout records with shared code on the device that shows the page.
- **One writer** [Builder's call]: the record is written only by the side that currently coaches the profile, the same rule the server-coach move already uses for the other coach outputs. A phone that sees bike minutes a little late (until the Mac or the server next runs) is acceptable.
- **"Set up" sports** [Builder's call]: a sport counts as set up for the 3-week verdict when the profile had at least one session of it in the 8-week window before those 3 weeks. A sport never done is never mentioned.
- **Muscle groups** [Builder's call]: `primaryMuscle` values map to the display groups as named above (lats and upper_back → Rücken; hamstrings and glutes → Oberschenkel hinten und Gesäß; abdominals → Bauch; calves → Waden). `primaryMuscle` has only `shoulders`; the front/rear split comes from a short list of rear-shoulder exercises in shared code (`pf-rear-delt-fly`, `pf-face-pull` and their Hevy titles, plus titles containing "Rear Delt" or "Reverse Fly"). Other shoulder exercises count as front. No data-model change.
- **Gym goal**: the gym coach state has `goal` (`"muscle"`); other or missing goals use the minimum effective range.
- **Sonstiges** [Builder's call]: counted in weekly totals and listed with the exercise names, so the rider sees what has no muscle yet.
- **The coach** reads the same workout records and imports the same shared muscle code, on the Mac and on the server.

## Open for later

- Secondary muscles counted as half sets.
- A weekly summary push.
- Linking the verdicts to the weekly plan conversation (separate design).
