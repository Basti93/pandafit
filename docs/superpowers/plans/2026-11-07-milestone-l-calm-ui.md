# Milestone L: Calm UI

Brief: `docs/roadmap.md`, section "Meilenstein L — Brief".

Material for this milestone:
- Before shots: `/private/tmp/claude-501/web-shots-before/` (index `INDEX.md`, phone-sized slices in `slices/`).
- Six independent UX reviews, summarized in `/private/tmp/claude-501/web-shots-before/REVIEWS.md`. Read the section for your screen before you start.
- Shot tool: `npm run ui:web-shots -- <dir> [filter]`.

## Assessment (Opus)

The reviews agree, and I agree with them.

**Scores:** the worst screens are Woche (3/10 calm), the live workout (3), Statistik (4), Laufen (3) and the Verlauf detail (4). The best are login and the open-workout card.

**Root causes that repeat everywhere:**
1. **Everything is a card,** cards sit in cards, and there are three or four different "row" styles.
2. **No button rule.** Orange is used for many things, destructive actions sit next to normal ones, and native selects and checkboxes are used.
3. **Numbers and details are always visible** instead of on demand: stats tables, hint lines under every set, per-row counts.
4. **Forms and chats live at the end of long pages** instead of in a sheet with a fixed input.
5. **Each screen has several tasks.** Woche is plan + settings + rules + chat; Laufen is today + 6 statistics.

**I decide against these review proposals:**
- **Drop the bottom tabs to 5:** the extra tabs are conditional already. Larger tap areas are enough.
- **Long-press for info:** hidden gestures are bad for the second user.
- **Remove "Wie oft pro Woche":** the run coach uses it separately from the day choice.

Everything else in the reviews is in scope.

## Global Constraints

- Before each task, check that no ride is open: the live file must be older than 1 h, and no `ride-*/meta.json` may have status open.
- No npm install, no new dependencies, no push, no deploy.
- **A workout is never lost.** No behaviour change in what is saved.
  - Every action that exists today stays reachable, maybe one tap deeper.
  - Destructive actions get a confirm step.
- **Mac app:** it shares `src/tracking/ui`. It must keep working, but it is not the target layout.
- **Tests:**
  - Keep the tests that are about behaviour.
  - Tests that pin replaced layout or texts are rewritten for the new structure (same behaviour), or deleted when the element is gone.
  - Use role and label queries, not CSS classes.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` and `npm run typecheck` are green after each task.
- **After each task:** run `npm run ui:web-shots -- /private/tmp/claude-501/web-shots-after <filter>` for the screens you touched, look at the slices, and fix what looks wrong before you commit.
  - Long pages need slicing: `sips -c H 780 --cropOffset Y 0`.

## Design rules (Task 1 builds them, all later tasks use them)

1. **Rows, not cards.**
   - A list item is one row: the title left, a short muted value right, and a chevron `›` when it opens something. Rows are separated by thin dividers.
   - Cards are used only for the one main thing on a screen and for groups.
   - Never put a card inside a card.
2. **Buttons:**
   - **Primary:** filled orange, at most one per screen or sheet, for the next action.
   - **Secondary:** outline.
   - **Tertiary:** a text link.
   - **Destructive** (Löschen, Verwerfen, Entfernen) is always a text link in muted red, with a confirm. It never sits directly next to the primary button.
3. **Sheet:** forms, pickers, chat and edit dialogs open in one `Sheet` component.
   - Full screen on the phone, with a title, an `×` top right, and a sticky bottom action area for the primary button.
   - The body behind does not scroll.
   - Back or Escape closes it.
4. **Native controls in app style:**
   - **Switch:** a row with the label left and the switch right; the whole row is tappable. It replaces checkboxes.
   - **Choice row:** "Label — Wert ›" opens a small sheet or segmented chips. It replaces selects where there are more than a couple.
   - **Dates:** `de-DE` formats everywhere; no US date or AM/PM. Use `dates.ts`.
5. **Details on demand:**
   - Numbers, statistics, explanations, credits and licence lines go behind "Details", or appear when the row is opened.
   - Muted explanation text is at most one line.
6. **Only one open:** expandable rows use a chevron that turns, and only one is open at a time.
7. **Spacing and headings:**
   - one page title;
   - section headings at one small size;
   - vertical rhythm on an 8 px grid;
   - lower the current card padding and gaps by about a third.
8. **Words:** plain German.
   - No "direkt", "±0", "Verhältnis", "Sonstiges" or type labels.
   - One meaning per word. "Verlauf" is the list of past workouts. The progress of one exercise is "Entwicklung". The catalog is "Übungen".

## Tasks

### Task 1: Foundations

- **New components:**
  - `src/tracking/ui/kit/` (or next to the existing shared components): `Row`, `RowList`, `Sheet`, `Switch`, `ChoiceRow`, `ConfirmLink` (a destructive text link that asks "Wirklich löschen?" inline with Ja/Abbrechen).
  - Button classes: `primary`, `secondary`, `link`, `danger-link`.
- **CSS in `tracking.css`** (and the web CSS): the rules above, the spacing, headings, row dividers and chevron.
  - Map the existing `secondary`, `ghost` and `card` classes so pages already look calmer.
  - Remove card-in-card backgrounds: a nested `.card` gets no background or border.
- **Profil** (as the first user of the kit):
  - one row "Angemeldet als X · Alles gesichert · 07:42";
  - switch rows for notifications and run planning, with a one-line explanation each;
  - "Wann sich der Coach meldet" moves here from Woche;
  - the storage hint only when persistence was refused, in one plain sentence;
  - "Abmelden" as the last row, a link.
  - A back arrow "‹ Zurück" in the Profil header.
- **Login:** the primary button always looks enabled. With empty fields it shows "Bitte gib deinen Namen und dein Passwort ein.". The form is placed a bit lower.
- **Tests:**
  - the kit: the sheet opens, closes on × and Escape, and focus goes to it;
  - the switch row toggles;
  - the confirm link needs a second tap;
  - Profil behaviour unchanged.

Commit: `feat(ui): calm building blocks, profile and login use them`.

### Task 2: Woche is the week, the chat is its own place

- **Woche page, top to bottom:**
  1. The page title "Woche".
  2. The week card: seven day rows (Mo–So, today marked, one line each: sport and hardness, plus "gelaufen/erledigt"). In spontaneous mode, the today advice line instead.
  3. "Zuletzt geändert ›": one row showing the newest change; it opens the five lines.
  4. Row "Mein Ziel ›" with the value "Muskeln aufbauen · Rücken". It opens a sheet with the goal choice, focus chips (+ duration), sport priorities, the planning mode and time per session (moved here from the top of the page).
  5. Row "Regeln ›" with the value "4 Regeln". It opens a sheet listing rules and forwarded requests as one list. Each row shows text plus a muted kind (Wunsch, pausiert, an Kraft-Coach). Tapping a row shows Pausieren / Fortsetzen and a danger link "Löschen". Below the list are "Regel hinzufügen" and "Übung ausschließen".
  6. Row "Coach" with a preview of the last message (one line, muted time) and a "›". It opens the chat sheet. When a proposal is open, the row says "Ein Vorschlag wartet auf dich".
- **Remove:** the intro paragraph; the old prefs card (moved to Profil in Task 1).
- **Chat sheet:**
  - full screen; messages oldest to newest; on open it scrolls to the newest;
  - the input is fixed at the bottom, with "Senden" as an icon button; "Der Coach denkt nach …" appears as a message bubble;
  - "Ältere anzeigen" at the top keeps the scroll position;
  - open proposals (week plan, next change, rule) are pinned above the input until decided; in the history they show as one line "Übernommen: …" / "Abgelehnt", without buttons.
  - The rules, undo and take logic is unchanged; only placement changes.
- **Fix:** the rule text duplication "Ohne alle Varianten: X (Alle Varianten: X)". Show the family line only when the text does not already contain it.
- **`WorkoutCoach`** (the in-workout chat) uses the same message list component.
- **Tests:**
  - Woche shows the four rows;
  - the chat opens and closes;
  - the input is in the sheet;
  - a pinned proposal can be taken and leaves the pin;
  - history proposals have no buttons;
  - goal and rules sheets keep their behaviour tests (move the existing tests).

Commit: `feat(ui): the week page shows the week, the coach chat is its own place`.

### Task 3: Heute

- **The page title is the date** ("Samstag, 7. November").
- **When a workout is open,** the first card is "<Titel> läuft noch – seit 14:05" with the primary button "Weitermachen". Today this is missing on Heute.
- **Today card:** a one-line title "Laufen, 50 Minuten" (no duplicate line) and the primary button. "Anders heute? ›" reveals "Heute nur … Min" (chips) and "Morgen: …".
- **"Heute erledigt" state:** one line.
- **Mobility:** one row "Beweglichkeit · 6 Min ›". It opens a sheet with the exercises and "Gemacht" / "Heute nicht".
- **The bottom tabs** get larger tap targets (min 48 px high, label 13–14 px). Without icons is fine.
- **Tests:**
  - an open workout shows "Weitermachen" on Heute;
  - "Anders heute" reveals the today-minutes choice and writes the frame as before;
  - the mobility sheet buttons work.

Commit: `feat(ui): Heute shows the one thing to do`.

### Task 4: Live workout

- **During an active workout:**
  - hide the Kraft sub-nav (Training/Routinen/Verlauf/Übungen);
  - the header is one line: the title + "⋯" (menu: Studio wechseln, Coach fragen, Training beenden, danger "Training verwerfen");
  - the running time is small and muted, or gone.
- **Rest timer:** sticky above the bottom bar, as a single bar "Pause 1:12 · +30 s". Tapping the bar skips it.
- **Exercises:**
  - The current exercise (`currentSet`) is expanded. The others are one row: "Seitheben · 2/3 ✓" and the superset marker. Tapping one expands it and collapses the previous one. The auto-advance follows `currentSet`.
  - **Expanded:** one row per set: number (A for warm-up, with a title tooltip "Aufwärmen"), kg, reps, check.
    - The "zuletzt …" and "Ziel …" hints show only for the next open set. The plates line goes under kg only for that set.
    - The `×` per set is gone; deleting a set is in the exercise "⋯" or via edit mode.
  - **Exercise "⋯" menu:** Satz hinzufügen, Aufwärmen hinzufügen (when offered), Notiz, Pause ändern, Nach oben/unten, Supersatz mit …, Tauschen, Entfernen (danger).
  - The note field shows only when a note exists or "Notiz" was chosen.
  - Number inputs: `inputmode="decimal"`, and the kg field uses the exercise step.
- **End:** "Training beenden" is a secondary button at the end of the list, not orange. With open sets, a sheet asks "N Sätze offen" with the choices "Weglassen" (primary), "Als erledigt zählen" and "Zurück". The timer stops.
- **Summary (milestone I):** verify it shows on the web after finishing. The before shots did not show it, so find out why and fix it. Polish it: one line "Fertig · 4 Übungen · 38 Min", the next-time lines muted, the primary button "Fertig".
- **Start screen:**
  - the plan card (title, exercise names only, primary "Training starten");
  - "Anderes Training ›" opens a sheet with routines and "Leeres Training";
  - "Studio: Nord ›" is a choice row; rename, hide and remove live in its sheet.
  - Open-workout card: fix "Nov.."; title "<Titel> läuft noch"; primary "Weitermachen"; "Beenden" as a link; "Verwerfen" as a danger link.
- **Tests:**
  - behaviour tests stay (confirm, rest, superset rounds, warm-up, studio change, end choices);
  - add: collapsed rows expand;
  - the hints only on the next set;
  - the menu actions reach the same functions;
  - the end sheet defaults to Weglassen as primary;
  - the summary appears after finishing.

Commit: `feat(ui): the live workout shows the next set and little else`.

### Task 5: Picker, Routinen, Verlauf

- **ExercisePicker** becomes a `Sheet`:
  - the search on top;
  - "Zuletzt benutzt" (up to 6 from history), then the muscle groups collapsed (accordion);
  - each row is the name only, with a small "ⓘ" opening the info inside the sheet (keep the tap target ≥ 40 px);
  - "Eigene Übung anlegen" at the end, and as the result when the search finds nothing.
  - Used for adding and swapping during the workout, in the routine editor, and for excluding.
- **Routinen:**
  - The list rows are the name, with the exercise names muted in one line; tap → a routine sheet with "Training starten" (primary), "Bearbeiten" and a danger "Löschen".
  - "Neue Routine" is a secondary button.
  - **Editor:**
    - each exercise is one row "Name  − 3 +  ×";
    - "Speichern" is sticky at the bottom; "Abbrechen" is a link;
    - with missing data: "Gib einen Namen und mindestens eine Übung an.";
    - focus goes to the name.
- **Verlauf:**
  - The list rows are the title and date, with month headings. It shows the last 8 weeks, then "Ältere anzeigen". No set count.
  - The inner "Trainings / Übungen" switch becomes a small segmented text control.
  - **Workout detail, read mode:**
    - one line per exercise: "Bankdrücken  70 kg × 8, 8, 8, 7" (warm-ups muted and short);
    - the "Nächstes Mal" line once per exercise when it exists, else one muted line for the whole workout;
    - "Bearbeiten" (secondary) switches to the existing edit fields;
    - "Training löschen" is a danger link at the end with a confirm.
  - Tapping an exercise opens its "Entwicklung".
  - **Exercise detail ("Entwicklung"):**
    - top line "Letztes Mal: 57,5 kg × 8";
    - one list of date + best working set;
    - tapping a row shows all sets;
    - no bar block, no duplicate text list.
- **Tests:**
  - picker search, recent and own exercise;
  - routine start, edit and delete with confirm;
  - the routine editor steppers;
  - history paging;
  - the read mode lines;
  - edit mode still saves;
  - delete needs a confirm.

Commit: `feat(ui): pickers, routines and history read calmly`.

### Task 6: Übungen and Statistik

- **Catalog:**
  - The display groups merge into about 8 ("Brust", "Rücken", "Schultern", "Arme", "Bauch", "Beine", "Gesäß", "Ganzkörper & Ausdauer"). This is a display mapping only; the muscle data stays.
  - No counts. Accordion, one open. Rows with a chevron and no type labels.
  - **Info:**
    - the description up to 3 lines with "mehr";
    - pictures in a calm frame without white letterbox (object-fit and the card background);
    - "Video ansehen" as a link;
    - "Nicht mehr vorschlagen ›" opens a small choice "Nur diese Übung" / "Alle Varianten (<Familie>)";
    - the source and licence on one small muted line at the end;
    - the family label with the prefix "Familie:".
- **Statistik:**
  - **Top:**
    - one sentence with the week ("Diese Woche: 3 Einheiten, 2 Std 10 Min");
    - the four-state muscle list;
    - only the noteworthy lines ("Schulter vorn kommt zu kurz").
  - **"Details ›"** opens the rest: the 8-week chart as bars + dates only (no numbers above the bars, no explanation paragraph), progress lines, and ratios.
  - The 12×4 sets table is removed.
  - Muscle rows: chevron, one open; the text "7 von 12–18 Sätzen diese Woche".
- **Tests:**
  - the group mapping covers every muscle;
  - the accordion;
  - "Nicht mehr vorschlagen" writes the same rules as before;
  - statistics shows the details only after a tap;
  - the table is gone (delete its tests).

Commit: `feat(ui): exercises and statistics show numbers only on demand`.

### Task 7: Laufen and Essen

- **Laufen:**
  - **Top:**
    - the today card ("Langer, ruhiger Lauf · 50 Min · Puls bis 160"), without the explainer card;
    - primary "Lauf eintragen" (opens a sheet);
    - "Letzter Lauf" (summary line + the feel question from milestone I, with "Überspringen" as a link).
  - **"Entwicklung ›"** opens a sheet: progress as one sentence, longest run, km per week (bars + dates), and the weekly look-back. The 12 unlabeled bars are removed.
  - **"Lauftage und Angaben ›"** is a row at the end. It opens a sheet:
    - all seven day chips in one row;
    - the pain question as a switch row;
    - "Speichern" sticky.
  - **Run entry sheet:**
    - Strecke and Dauer first; the date defaults to today and is shown "Heute" / "Sa., 7. Nov.", changeable;
    - start time and heart rate under "Mehr";
    - German formats, `inputmode`.
- **Essen:**
  - A meal is one row: "Frühstück · Haferbrei mit Beeren · 10 Min ›". Tapping expands the recipe and the protein.
  - The person chips show only for a deviation ("Jonas isst nicht mit"). Editing who eats is inside the expanded row.
  - "Heute" is shown once.
  - The coach wish is a secondary button "Änderung wünschen", which opens the chat sheet of the meal coach.
  - **Einkauf:**
    - one flat list with small category headings;
    - each row is a checkbox, the name and the amount;
    - "schon da" moves into a row action (tap the amount area → "Haben wir"), so there is no link per row;
    - bought items sink to the end;
    - the "11 von 11" line is gone.
    - **Own items (wish of the person, 07.11.2026):** one input row at the end, "Etwas dazuschreiben …" + Hinzufügen. It adds a free item (e.g. "Kaffee", optional amount) to the same week list, not a new list.
      - Own items are synced records per profile and week (or household, if the shopping list is shared – follow how the list is stored), are checked off like the others, can be removed (danger link), and survive a new meal plan for the same week.
      - They show under a small heading "Eigenes".
      - The meal coach does not touch them.
      - Tests: add, check, remove, and that they survive a regenerated list and sync.
- **Tests:** the existing behaviour tests are moved; add the run entry sheet defaults, the feel question placement, and meal row expansion.

Commit: `feat(ui): running and meals put today first`.

### Task 8: After shots and independent re-review

- Run `npm run ui:web-shots -- /private/tmp/claude-501/web-shots-after` for all screens, and slice them like the before set.
- **A fresh reviewer:**
  - given the same `REVIEW-BRIEF.md` with the after folder;
  - not given the before reviews;
  - scores every screen.
- **Fixes:** every finding with a score below 7 or a clear bug is fixed in this task, then re-shot.

Commit: `fix(ui): findings of the after review`.
