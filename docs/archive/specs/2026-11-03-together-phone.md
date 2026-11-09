# Gemeinsam on the phone

The Mac's together page ("Gemeinsam") also lives in the phone app: a compact card at the top of "Heute" (this week for each person, the two latest rides, the mountain, the data date) that opens the full page with the Mac page's sections. The bottom bar keeps its five tabs.

## Record

[Builder's call] A new record kind `together`, id `current`, one copy per linked account. Not a reuse of `mealplan` or `plan`:
- Its own life: it has nothing to do with meals or the gym plan, and the meal coach and push code read `mealplan` ids by prefix; a foreign id there is one more thing every reader has to skip.
- The server-coach branch will compute it on the server and write the same record; a kind of its own keeps that move a drop-in.
- Deploy order needs nothing new: the Mac already holds a record an older server refuses as `unknown kind` and offers it again later; an older phone drops unknown kinds when it fetches and keeps syncing the rest (`tests/shared/mealplan-records.test.ts`). The server, the Mac and the phone all list the kind now (`tests/shared/together-records.test.ts`).

## What is in it

`src/shared/together.ts` (`TogetherBody`) is picked field by field from `computeTogether` in `src/coach/tracking/together-export.ts`, so a field the Mac page grows later never crosses by itself:
- Per person: name, rides and minutes this week, words learned, minutes per week for 12 weeks. The latest rides (date, name, session name, minutes), the shared mountain, the summit book, the climbed and the current passes. All of it the Mac page shows both people today.
- Left out on purpose, following the household rule in the server-coach design: the "who leads this week" line (a ranking) and the streaks (streak pressure). Never in it: watts, FTP, heart rate, ratings, notes, complaints, health data, rules, the plan's reasons.
- `you` marks whose copy it is, so the phone shows the own person first and the others in the Mac's order, never sorted by numbers.
- `week` is the Monday "this week" refers to; `atMs` is when what the record says last changed, shown as "Stand: …".

## When it is written

In the Mac's scan, only with no ride open, only for linked profiles, and only when the content (everything but `atMs`) differs from the stored copy. A new week is a change of its own (`week`), so at most one write a week without rides. An unlinked profile gets nothing; a profile alone on the Mac gets its own part. A phone with no or an unreadable record shows Heute as before. A snapshot from an earlier week says "Woche vom …" instead of "Diese Woche".
