# Pandafit: talking to the coach (week plan, in-workout changes, effort questions)

Status: approved by the riders on 2026-11-03. "[Rider]" marks what the riders decided, "[Builder's call]" what was settled on their behalf and can be overruled.

## Why

Each coach (bike, strength, run, mobility) plans its own next session from data. Nobody can talk to them: "Freitag bin ich sicher im Studio", "die Smith-Maschine ist belegt", "mein Knie zwickt", "diese Woche nur zweimal laufen". And nobody plans the week across the sports. One rider trains on changing days, lifts once or twice a week and rides for heart health; the other runs and wants to get fit again. Both want a week that fits their life and changes when life does [Rider: "Wochenplan, der aber auch dynamisch sein sollte"].

## Goals

1. **One chat with the coach per profile, for all sports** [Builder's call, confirmed by the riders' answers]: on the phone and on the Mac. The coach answers in German, short and warm, like the existing coaches.
2. **A week plan across the sports, made in dialog** [Rider: "Beides, selbst und Vorschläge. Im Dialog"]:
   - The rider can give numbers and days ("4 Tage, Freitag Studio"), or let the coach propose from the goals; usually a mix.
   - Two ways to plan, per profile, mixable [Rider: "Wochenplan ist auch ok wenn Benutzer lieber fest plant"]: **amounts** (2× Kraft, 3× Rad, one longer) or **fixed days** (Mo Kraft, Mi Rad …), or fixed days for some and amounts for the rest.
   - **Rest days are part of the plan** [Rider: "natürlich nicht jeden Tag Training"]. On a rest day nothing is suggested.
   - The coaches keep deciding the content of a session (exercises, watts, pace, minutes). The week plan only decides which sport on which day and how hard the day may be.
3. **The weekly conversation on Sunday** [Rider: "wahrscheinlich Sonntag"]: off by default; when switched on, the coach opens the week conversation on Sunday at 18:00 local time with a proposal ("Für deine Ziele: 2× Kraft, 3× Rad, eine Fahrt länger. Passt das?"). Day and time can be changed. The rider can start it any time. No answer means the coach's proposal stands, without any nagging.
4. **A suggestion the evening before, only on request** [Rider: "Vorschlag am Tag davor ist gut aber nur wenn gewünscht vom Nutzer"]: off by default; when on, a push the evening before a planned training day only ("Morgen: Rad 55 Minuten locker. Passt das, oder lieber Kraft?"). Answering opens the chat.
5. **Changes during the week, in the same chat**: "Morgen klappt nicht" → the coach proposes how the rest of the week looks; nothing changes until the rider confirms [Builder's call: the coach never changes the plan silently].
6. **Chat during a workout** [Rider: "Ein Chat im Training für den Coach um das Training dynamisch anzupassen"]: from the workout screen, "Gerät belegt", "Schulter zwickt", "nur noch 30 Minuten" → the coach proposes a change to the rest of this workout (swap, drop, fewer sets, lighter). Done sets are never touched. The rider confirms the proposal before it applies.
7. **Effort questions after an exercise** [Rider: "einzelne Übungen abfragen wie schwer sie waren … Reps in Reserve aber dynamisch"]: after the last set of an exercise, one tap "Wie viele hättest du noch geschafft? 0 · 1–2 · 3+", skippable. Asked only where the numbers do not already tell (target reps exactly hit; exercise swapped; first time at a new weight), never when reps clearly dropped or clearly exceeded the target; at most 4 per workout, main lifts first. The gym coach uses the answers for progression: 3+ → more next time, 1–2 → normal pace, 0 → hold, and hold or step back when repeated.

## Non-goals

- No human coach, no sharing chats between people, no group chat.
- No medical advice; complaints go into the existing complaint records and the coaches react carefully, as today.
- No calendar integration in this version.

## Anti-goals

- Guilt: no "you missed", no streaks, no catching up missed sessions by doubling up. A light week is fine.
- A coach that changes things silently.
- A chat that asks too much: one question at a time, and only when the answer changes the plan.
- Pushes nobody asked for.

## Shared rules for the week (checked by code, not by Claude) [Builder's call]

- At most two hard days per week.
- No hard bike or run day the day after a hard leg day.
- The long session (long ride, long run) not the day after a leg day.
- Never two sessions planned on one day unless the rider asks for it.
These use the day ratings the coaches already share (`src/coach/day-load.ts`). A proposal of the coach that breaks a rule is corrected before the rider sees it, as the bike guardrails do today.

**When the rider explicitly wants more than the rules allow** [Rider: "warnen und zulassen"]: the coach says once, clearly and without drama, what it thinks of it, and applies it when the rider confirms anyway. This never applies to open complaints or pain: there the existing careful behaviour of the coaches stays a hard limit.

## How it runs

- The chat needs Claude, so it runs where the coach runs: on the server coach for a profile that moved there, on the Mac otherwise. The phone reaches it through the api's `/coach` proxy (exists). **Dependency:** on the phone the chat works only once the server coach is rolled out; until then it works on the Mac. [Builder's call]
- The chat itself is text; on the iPhone the keyboard's dictation works as voice input. No own speech feature [Builder's call].
- Messages and the week plan are records (synced like the rest), so phone and Mac show the same. The plan record carries per day: sport (or rest), how hard it may be, fixed or flexible.
- The coaches read the week plan: a coach plans its next session for the day the week plan gives it, and respects the day's hardness.
- Offline in the gym: the chat says it needs a connection; the workout itself keeps working offline as today. Effort answers are stored locally and sync later.
- Hevy and Garmin stay optional; a profile with one sport gets a week plan with that sport only.

## Settings (per profile)

- Week conversation: off / on, day, time.
- Evening-before suggestion: off / on, time.
- Effort questions: on by default, can be switched off [Builder's call].

## Order of building [Builder's call]

1. Effort questions (no chat needed, works offline, feeds the gym coach right away).
2. The chat with the week plan on the Mac; then on the phone after the server-coach rollout.
3. In-workout chat.
4. Sunday conversation and evening-before push.

## Settled after the builder check [all Builder's call]

- **One writer for the plan and the coach's messages:** the side that coaches the profile (the Mac, or the server coach once the profile moved), the same rule as the other coach outputs. The rider's messages and confirmations are their own records, written by any device. Before the server rollout, the phone shows the week plan and the chat history read-only and says the chat runs on the Mac for now.
- **Proposals are structured:** the coach answers with text plus, when it proposes a change, a structured proposal (week plan or workout change) validated by code against the shared rules and the existing gym/run/bike guardrails. The rider gets "Übernehmen" and "Nein danke" buttons; only "Übernehmen" applies it. Free text never changes anything by itself.
- **"Hard":** from `dayRatings` in `src/coach/day-load.ts`, extended to runs (the run coach's own rating: test and long runs hard, easy runs easy) and mobility (always easy). A "hard leg day" is a day rated hard with `legs: true`.
- **The plan feeds the coaches as a strong hint:** a coach plans its next session for the day the plan gives its sport and keeps within that day's hardness. A session on an unplanned day is simply what happened: the rest of the week is re-proposed (not silently changed). A day without a plan entry: the coach behaves as today. If a coach's own load logic (complaints, a hard day before) says less, less wins.
- **Effort questions:** asked when the done reps of the last normal set equal the planned reps exactly, when the exercise was swapped in, or when the weight is higher than the last time this exercise was done (also when the coach raised it). Not asked when the last set has 2 or more reps fewer than planned, or 2 or more more. Repeated 0: two 0-answers in a row for the same exercise → hold; three → the coach steps back one step. The gym coach gets the answers per exercise in its prompt data, and its progression suggestion (`suggestNext` in `src/coach/gym/history.ts`) takes them as input.
- **In-workout changes** are applied to the open workout record like a swap today (`swapExercise` and friends), so they are what happened; done sets are never changed. A workout already sent to Hevy is not changed in Hevy; what was really done is logged as usual.
- **Pushes** use the existing web push of the api (`web-server/push.ts`), sent by whoever coaches the profile. For a profile coached on the Mac, the Sunday conversation and the evening-before push go out only while the Mac runs; after the server rollout they always go out. The settings say so.
- **One chat thread per profile**, no per-sport threads. Kept 90 days. The coach sees the last 30 messages plus the current week plan and the coaches' data, not the whole history.

## Open for later

- A weekly summary that links to the statistics page (separate design).
- Calendar import.
