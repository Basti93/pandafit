# Pandafit: weekly meal plan

Status: built on `feat/meals`, awaiting review. "[Decided]" marks what was set before building, "[Builder's call]" what was settled while building and can be overruled.

## Why

A household wants to plan the shopping on Saturday and not think during the week about what to eat: breakfast before work, a lunch to take along, a small dinner. Vegetarian, enough protein for strength training, healthy. It must make sense for any user, and all of it is optional.

## Settings, per profile, off by default [Decided]

An "Essensplan" section on the profile page: on/off, Ernährungsform (vegetarisch, vegan, alles), Abneigungen and Unverträglichkeiten as free text tags, and per meal whether it is usually eaten at home, taken along or eaten out on workdays (defaults: breakfast at home, lunch to take along, dinner at home). Stored in the coach's data folder (`coach/meals/household.json`), never in the repo.

- [Builder's call] The default diet is vegetarian, because the bundled recipe list is vegetarian. "alles" only lets the AI suggest more.
- [Builder's call] At the weekend every meal counts as at home for everyone with the plan on, whatever the workday habit says. "auswärts" takes a person out of that meal on workdays only.
- [Builder's call] A few common intolerances (Laktose, Gluten, Nüsse, Erdnuss, Ei, Soja, Sesam, Sellerie, Fruktose) stand for a list of ingredient words. Any other text is matched as written. The app says plainly that the ingredients should still be checked; it is a word check, not a guarantee.

## One household plan per Mac [Decided]

One plan covers every profile that turned it on. Each meal lists who eats it (by default everyone with the plan on, by habit). A person can be switched off or on for a single meal; portions and the shopping list follow.

- [Builder's call] Who eats and the shopping ticks are kept apart from the plan as a small state, entry by entry with a time, so the Mac and two phones merge without losing each other's taps (newer entry wins).
- [Builder's call] Turning the plan off takes the person out of the current plans at once. Turning it on adds the person to the plan's people without eating anything yet; they switch themselves on or press "Neu planen".
- Only the last, the current and the next week are kept.

## Sync to the phone [Decided]

A profile linked to a Pandafit account gets the plan as the new record kind `mealplan`: `week-<Monday>` holds the plan (marked with whom it was written for), `state-<Monday>` holds who eats and the ticks. The phone writes only the state record; the Mac merges it into the household state and writes the merged state to every linked profile. The server only stores records and has no meal logic.

Compatibility:
- An older phone drops records of a kind it does not know when it reads a page, and goes on syncing the rest (tested).
- An older server refuses an unknown kind per record with `unknown kind` and accepts the rest. [Builder's call] The Mac does not show such refusals as a problem and offers the records again after six hours, so the plan arrives once the new server is deployed (tested).
- [Builder's call] A phone updated after the plan was written gets it with the next change of the plan or its state; its cursor has already moved past the old one.

## Generation [Decided]

In the coach process, on Saturday from 06:00 local time at the first scan with no open ride, for the coming Monday to Sunday, and on demand with "Neu planen". During an open ride nothing is planned and no AI is asked; ticks and who eats are local writes and work also then.

- [Builder's call] On Sunday too, when the Mac was off on Saturday. Each week is planned automatically once; "Neu planen" can always redo it.
- [Builder's call] "Neu planen" on the current week replans from today on and keeps the days before.

The AI (`claude -p` through `src/coach/claude-client.ts`) gets one prompt for the week with a strict JSON schema: per day and meal a dish name, ingredients with per-portion amounts, unit, supermarket section and a raw flag, short steps, minutes, rough protein per portion, keeps-for days, and a reuse link (`restVon`) for cook once, eat twice. Diets, dislikes and intolerances go in as data blocks, with people as letters only (names and ids stay on the Mac). The week's usual training days go in too, for more protein on those days.

- [Builder's call] Training days are weekdays with at least two bike rides or strength sessions in the last four weeks. The planned workouts have no weekday, so the history is the best guide.

Every dish is checked in code: schema and ranges, diet against a word list for meat and fish (and dairy, eggs and honey for vegan) with plant look-alikes allowed ("Sojahack", "Hafermilch"), every dislike and intolerance of everyone eating it as word checks on ingredient names, the dish name and the steps, and the tone (no calories, weight, diet or healing words). "rohe Zwiebeln" blocks only ingredients marked raw. A reuse must point to an earlier cooked dish within its keeps-for days (capped at three). A dish that fails is replaced from the recipe list; the page says how many.

Fallback: Pandafit's own list of 31 vegetarian recipes (German, simple, protein-rich, common supermarket ingredients, vegan flag, meals, keeps-for days). A rule picks a varied week, preferring recipes not used last week and the protein-richer ones on training days, and cooks Monday's and Wednesday's lunch for the next day too.

"Tauschen" takes another fitting recipe from the list at once. "Coach fragen" asks the AI for one dish and checks it the same way, with the list as fallback. A rest follows its new dish when that keeps long enough, otherwise it gets its own.

## Chat with the coach [Decided]

Asked for by the users: "eine Feedback-Funktion, damit man einfach die Rezepte austauschen oder Zutaten abändern kann". On the meal page, on the Mac and on the phone: "Sag dem Coach, was du ändern willst" ("Mittwoch lieber was mit Nudeln", "ohne Tofu bitte", "Feta durch Mozzarella ersetzen", "das Rezept am Freitag ist zu aufwendig"). The last exchange shows open, the ones before are folded as "Bisheriges Gespräch", like the bike coach's.

The AI (one call, strict JSON schema) answers with a short calm reply and up to three changes: a new dish for a meal (the dish shape of the plan), or one ingredient replaced or left out with the steps and the title adjusted, and `abneigungenMerken` when the asking person clearly never wants something. The message goes in as a `nachricht-nur-daten` block, the week and the people as data blocks, people as letters only.

- Every changed dish passes the same checks as a planned one (diet, dislikes and intolerances of everyone eating it and its rests, tone). A failing change is not applied, and the reply then comes from the app: what was changed, what was not and why, in plain words. The AI's own reply is shown only when everything it asked for landed and its text passes the tone check.
- A remembered dislike goes into that person's meal settings before the checks run, and the app adds "Ich lasse Tofu künftig weg." to the reply.
- Past days of the current week are not changed.
- [Builder's call] Rests: an ingredient change always lands on the dish where it is cooked and on all its rests, so they stay the same dish. A new dish at the source is the rest too when it keeps long enough and fits its eaters; otherwise the rest keeps the old dish and is cooked on its own, and the reply says so. A new dish for a rest takes it out of the link; the source stays.
- A changed meal carries `askedBy` (a profile id), shown as "auf Wunsch von Lena" on both persons' plans. "Tauschen" and "Neu planen" clear it.
- Without the AI (no login, limit, error, an answer that does not fit the schema): a message naming exactly one day and one meal plus "tauschen", "anders" or "wechseln" swaps from the recipe list, the same way as "Tauschen"; anything else gets "Das kann ich gerade nicht ändern. Versuch es mit „Tauschen“ beim Gericht."
- Never with a ride open, and only one AI call at a time: a message waits (Mac: "Der Coach antwortet nach der Fahrt.") and is answered at the first tick with no ride open, oldest first.

[Builder's call] Messages travel as records of the existing kind `mealplan` with the id `chat-<time><random>`, one record per message, in the asking person's account only. Neither a new kind nor entries in the state record:
- No new kind means no server or phone kind list to change and no deploy order: the server already stores `mealplan`, and push only reads `week-…` ids.
- One record per message keeps them per person (the state record is copied to every linked profile) and makes "newer wins" safe: the phone writes it once, the Mac writes it once more with `reply`, `answeredMs` and `changed`.
- The Mac takes new `chat-` records in before every export, so none is removed unread. It keeps the last ten messages per person and tombstones older ones; a profile with the plan off or unlinked gets all its meal records tombstoned as before. Messages typed on the Mac go to that person's phone too.
- The phone shows "Der Coach antwortet, sobald der Mac wieder da ist" until the reply arrives with the next sync.

## Shopping list [Decided]

Built from the week, summed over the portions really eaten, rounded to what a shop sells (packs for common items such as quark, tofu, oats; 50 g steps; whole pieces, tins and bunches; garlic bulbs; loaves). Grouped by Obst und Gemüse, Kühlregal, Brot und Backwaren, Vorrat, Tiefkühl, Sonstiges. Tick boxes and "schon da" on Mac and phone.

- [Builder's call] Spoonfuls and pinches (oil, spices, pesto) are listed apart as "Kleine Mengen: kurz prüfen, ob da", without amounts.

## Tone and safety [Decided]

No calories, no weight, no body talk, no diet pressure, no medical claims. Protein is one rough number per portion. German text with correct umlauts. User text goes into data blocks.

## Interface [Decided]

Mac: "Essen" in the menu bar after "Kraft", only when the plan is on for the profile. A week grid with days as columns and meals as rows. [Builder's call] Each meal has its own color (breakfast yellow, lunch green, dinner blue) on the row and on the top edge of each card; today's column is orange; past days are dimmed; a rest is a dashed card with "Rest von Mo", and its source says "reicht für Di". People appear as colored initials (or their avatar). A card opens the recipe on the side with who eats (toggles), ingredients for all portions to cook, steps, keeps-for, "Tauschen" and "Coach fragen". The shopping list is the second view on the page. With two weeks planned, a switch picks the week; on the weekend the coming week shows first.

Phone: "Essen" in the bottom tab bar, only when a plan arrived for the account. Today first with its three meal cards, a day picker for the week, people toggles, the recipe folded, and the shopping list as the second view.

## Left out

- No own recipes. Single ingredients change only through the chat with the coach.
- No planning or swapping from the phone; it shows the plan and sends ticks, who eats and messages to the coach.
- No push or reminder for the Saturday plan.
