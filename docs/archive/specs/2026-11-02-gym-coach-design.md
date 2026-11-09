# Gym Coach Design

## Intent

Bike Coach gets a second, separate area for strength training. Endurance and health stay with the bike coach; gym and building muscle belong to a new gym coach. The rider should get a sensible next workout without having to plan it: what equipment is available, how much volume fits and which weights and reps to use all come from their own Hevy history. The rider trains in Hevy as usual.

Why: many riders train by feel, with changing exercises and few comparable sessions, so progress is hard to steer. The bike coach already shows that a coach with memory, follow-up questions and no guilt keeps people going.

## Goals

- A dedicated strength page with the next workout: exercises, sets, reps, weights and a short reason.
- Equipment is inferred from history. Nobody maintains a list.
- Volume follows what the rider actually does, not a fixed programme.
- Progressive overload per exercise, only where the data supports it.
- A coach that adapts: a short note after each workout, optional follow-up questions, things it remembers.
- A workout reaches Hevy as a routine, after the rider has seen a preview and confirmed it.
- The first version does muscle growth only, as the rider decided. The goal is stored so that bodybuilding-specific or strength goals can follow later.

## Non-goals

- Live tracking during a gym session. Hevy does that.
- Replacing Hevy, or a gym mode on the bike screens.
- Nutrition, body-composition or supplement advice.
- Support for strength apps other than Hevy in this stage.

## Anti-goals

These make it a failure even if it technically works:

- The bike coach creates strength workouts. It only reads strength data to judge recovery.
- Anything is written to Hevy without confirmation, or an existing routine or workout is changed or deleted.
- Weights are made up for exercises without history.
- Weight goes up although the rider trains too rarely for that to mean anything.
- Guilt: missed sessions, streaks, catching up, comparisons with others.
- A rider without Hevy sees errors, empty pages or dead buttons.

## Character

The gym coach knows evidence-based training and at heart is an old-schooler. It knows that volume per muscle, a suitable rep range and steady progression carry most of the result, and it also knows that sometimes it simply has to get hard, and that going to muscle failure has its place. It says so plainly and with some warmth: "Letzter Satz heute: bis nichts mehr geht." It never pressures or shames: pushing hard is an invitation about a set, not a judgement of the person.

It knows its craft like a real sports scientist and uses set and intensity techniques where they fit: widowmaker sets, pyramid sets, ramping sets, supersets, drop sets and warmup sets. It explains in a few words why a technique is there, and it never uses one for show: with few sessions per week the basics come first. These must survive the trip to Hevy, so a routine uses Hevy's own superset grouping and set types wherever they exist, and the rest goes into the exercise notes.

Failure is used deliberately: typically on the last set of safe exercises such as machines, cables and isolation work, and not on heavy free-weight lifts without a spotter, such as barbell squats or bench press. Open complaints take precedence over toughness; it makes no diagnoses and advises seeing a doctor for serious complaints.

## Training knowledge

Researched on 2026-11-02. The builder copies this into `docs/` as the coach's foundations and into its prompt in short form. Several findings come from secondary summaries or preprints, so the coach states them as tendencies and never as certainties.

- **Volume.** More weekly sets per muscle tend to bring more growth, with diminishing returns ([Pelland et al., preprint](https://sportrxiv.org/index.php/server/preprint/download/460/967/908), [summary](https://biolayne.com/reps/issue-31/the-king-of-volume-metas/)). This is the main lever.
- **Frequency.** With equal volume, frequency has little effect on growth ([Schoenfeld et al., 2019](https://pubmed.ncbi.nlm.nih.gov/30236847/)). So one or two sessions a week can work, and the coach never treats a low frequency as a flaw. Its limit is how much quality volume fits into those sessions.
- **Failure.** Getting closer to failure tends to bring more growth, non-linearly, but actually reaching momentary failure shows no clear advantage over stopping just short of it ([Refalo et al., 2023](https://dro.deakin.edu.au/articles/journal_contribution/Influence_of_Resistance_Training_Proximity-to-Failure_on_Skeletal_Muscle_Hypertrophy_A_Systematic_Review_with_Meta-analysis/22030796), [summary of Robinson et al.](https://biolayne.com/reps/issue-32/the-failure-factor-the-relationship-between-proximity-to-failure-and-strength-and-hypertrophy/)). This is where science and the old-schooler meet: sets must be truly hard, and failure is a tool and not a duty.
- **Drop sets.** Similar growth to conventional training in far less time, but from few and short studies ([Sødal et al., 2023](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10390395/)). They suit a short session.
- **Supersets.** Save time; no proven extra growth, according to a secondhand summary of a review, and no dedicated meta-analysis was found. Use them when time is short.
- **Pyramid sets.** No evidence of an advantage, and one non-peer-reviewed review advises against them ([Brookbush](https://brookbushinstitute.com/courses/set-strategies-supersets-pyramid-sets-and-drop-sets)). The coach offers them for variety or because the rider likes them, and does not claim more.
- **Ramping sets.** The stepping stones up to the working weight, with sparse research on any effect ([BarBend](https://barbend.com/?p=167498)). Treat them as preparation, mainly before heavy compound lifts.
- **Widowmaker.** One set of 20 reps at about a 10-rep maximum, with pauses between reps once the first set of reps is done ([Lift Vault](https://liftvault.com/resources/widowmaker-sets/)). It is not an everyday tool, and it is rare and deliberate here. It is an old-school method with no dedicated evidence that the coach knows of, which it may say openly. The safety rule below applies: not on a lift where failing is dangerous without a spotter or safeties.
- **Breaks.** Early losses are largely neural and muscle comes back quickly on retraining ([review](https://www2.mdpi.com/2813-0413/1/1/1)). After a break the coach goes back a little without drama.
- **Progression.** The research did not produce a specific study on double progression (reps first, then weight). It is a chosen method and the coach does not present it as proven.

**In Hevy** (official schema of `POST /v1/routines`, checked on 2026-11-02): set types are `warmup`, `normal`, `failure` and `dropset`. Exercises have `superset_id`, `rest_seconds` and `notes`; sets have `weight_kg`, `reps` and `rep_range`; routines have `folder_id` and `notes`. So ramping sets become warmup sets, pyramids become differing weights, supersets use `superset_id`, and a widowmaker has no type of its own and goes into the exercise notes. This schema does not specify whether updating a routine keeps it in its folder; the builder verifies it.

## How it works

1. **Before the gym.** The strength page shows the next workout and the reason. The rider can make it easier, harder or shorter.
2. **To Hevy.** A preview shows exactly what will be created. Only after confirmation does a routine appear in a Hevy folder of its own. Existing routines stay untouched. Repeating it updates only routines the coach created itself, or creates a new one.
3. **In the gym.** The rider trains in Hevy and may deviate freely.
4. **Afterwards.** The next pull shows what really happened, including skipped or changed exercises. The coach writes a short note, asks at most one or two optional questions and plans again. Durable preferences ("das Knie mag keine tiefen Kniebeugen") are remembered and can be removed by the rider.

The coach decides split, a recurring core of exercises and how much variety there is. With few sessions per week it will usually land on full-body workouts with a small recurring core, because repeated exercises are what makes progression measurable. This is its default thinking, not a fixed rule.

## Equipment and exercises

An exercise counts as available when it was done in recent months. Older ones no longer count, because the gym may have changed. The coach may also suggest exercises from Hevy's exercise list that use equipment already seen in that history. Exercises must map to a real Hevy exercise template, otherwise they cannot become a routine; anything that does not map is rejected.

## Progression

Decided per exercise from recent sessions:

- Reps reached at the same weight and regular training: small step up, in reps first and then weight.
- Too few comparable sessions: keep the last value.
- After a long break: step back a little.
- No history for the exercise: no weight is given, the rider feels their way in.

## Guardrails

The AI proposes and code checks, as with the bike coach. Hard limits it cannot exceed, including the maximum weight step, the maximum sets per workout and no weights without history. An answer outside the limits is corrected once, then replaced by the rule-based workout. Written figures must match the data, otherwise the text is dropped.

## Structure of the app

Per person there is one shared level, and the two coaches branch off from it. This came from the rider. The details below are the author's calls.

- **Overview per profile:** after picking a profile, a person with Hevy lands on a short overview with Rad, Kraft and Gesundheit. A person without Hevy goes straight to the bike page as today and never sees the extra level.
- **Gesundheit is shared:** it belongs to the person and not to a coach, and both areas link to it. It shows Hevy workouts next to the Garmin values: recent workouts with date, duration, sets and volume, plus workouts and volume per week. Each source appears only if connected, and it opens if at least one of them is.
- **Connections move up:** the Garmin and Hevy cards and complaints are about the person, so they stay reachable from the overview too. Their state does not move.

## Relationship between the coaches

- Separate state, prompts and text. The gym coach has its own memory and its own place in the data folder.
- Complaints are shared, because it is the same body.
- Each sees a compact summary of the other's load, only to judge recovery: no heavy legs right before a hard ride and the other way round.

## Decisions from the builder check

These are design calls by the author of this document, not stated by the rider. The rider reviews them with this document.

- **No calendar, so only reactive.** The rider never gives a training day, in keeping with the bike coach. Each plan reacts to what has already been done, so "not right before" means: after recent heavy leg work, the next plan of either coach is gentler on the legs. Neither coach has priority over the other. A coach replans only on new real workouts or rides, never because the other coach merely planned something, so they cannot keep triggering each other.
- **Thin history.** Exercises older than the recent window stop counting as available, but stay known. After a long break the coach may use them as a reduced starting point, and asks once whether the rider's gym is still the same. A connected rider with no usable history gets a simple rule-based full-body workout without weights, and a friendly note. While the first sync is loading, the page says so.
- **One rolling routine.** The coach keeps one routine, its "next workout", in its own Hevy folder and updates it on each confirmation. It creates a new one only if its own is gone. If the rider edited it in Hevy since the last write, the preview says so and overwriting needs the normal confirmation. Hevy history, not the routine, keeps what was done.
- **Complaints.** Complaints stay where they are today, and the gym coach reads them. The rider's own words in the gym area pass through the same detection, so "das Knie mag keine tiefen Kniebeugen" counts as a complaint for both coaches: caution over precision. Such a note can be closed from either area, and it is also kept as a gym preference.
- **Disconnecting Hevy.** The key and the copied workouts go. The gym coach's memory stays, in its own folder under the profile, and the card says so and offers to delete it too. On reconnecting, the coach finds its routine again through its folder name, also after a change of account.

## Constraints

- A ride is never lost: no Hevy call, AI call or write happens during an open ride, and none can affect recording.
- Everything is optional and per profile. The strength area appears only with a connected Hevy key. Without AI there is a simple rule-based workout.
- The Hevy card and its text change: until now the connection only reads, and the rider must be told plainly that it now can also create routines after confirmation.
- The public Hevy API has no delete endpoint according to third-party sources, so the coach's routines must not pile up: reuse its own routines by updating them.
- The repository is public: no personal data in commits, tests or docs. Tests use invented data.
- Hevy's API is labelled an early release and needs Hevy Pro. A failing call never blocks anything.
- Use what exists: `HevyLinks`, the `askClaude` client, the coach state pattern and the WebSocket protocol.
- All user-visible text is German.

## Left to the builder

- Module and file layout, and whether the gym coach runs in the coach process.
- Exact limits, rep ranges and the definition of "recent months", documented in `docs/` with their foundations as `docs/hr-zones.md` does.
- Page layout, following the existing home page.
- When exactly the coach replans, as long as it does not call the AI needlessly.
