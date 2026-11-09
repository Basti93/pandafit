# Dojo 4 Essen und Profil Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Essen macht Lust (die nächste Mahlzeit groß mit Bild, der Tag klein, die Woche ruhig, Rezepte und Einkauf als zwei Kacheln, „Plan ändern“ über Bos Sprechblase, ein Rezept trägt man auf der Seite in den Plan ein), Profil ist aufgeräumt (Kopfkarte und vier Gruppen), und „Morgen“ auf Heute führt direkt zum Training.

**Architecture:** Erst wächst das Kit um wenige allgemeine Teile: `HeadCard` (die eine Kopfkarte einer Seite mit Titel, für Essen, Rezept/Mahlzeit und Profil), `MealPicture` (das gezeichnete Bild pro Mahlzeit-Typ aus `brand/meals.svg`), ein Bild-Platz in `MainCard` und `RowCard`, ein Icon-Platz in `Row` und `Switch`, ein Überschriften-Kicker, ein gedrückter Zustand für `RoundButton` und neue Icons. Dann sagt ein reines Modul `src/web/essen/meals-view.ts` alles über Essen in Worten und hält die Wochen-Daten (`Week`, `mealWeeks`, `mealDayOf`). Danach werden die Seiten nur aus Kit-Teilen gebaut, jede Unterseite über den einen lokalen Rahmen `EssenPage`: Mahlzeit-Seite (auch von Heute aus), Essen-Start, Einkauf, Rezepte und Rezept mit der Karte „In den Plan“, Profil. Bilder von Mahlzeiten wählt `MealImage`: Rezeptfoto, sonst die Zeichnung. Zum Schluss führt „Morgen“ auf Heute zum Training. Jede Schreibaktion läuft weiter über dieselben Funktionen; nur die Oberfläche ändert sich.

**Tech Stack:** React 19, Vite, vitest mit @testing-library/react (ohne jest-dom: nur einfache Assertions wie `toBeTruthy()`, `textContent`, `toBe`), CSS-Tokens.

**Spec:** `docs/design/DESIGN.md` (bindend, auch „Im Code: eine Stelle pro Sache“), Brief „Dojo 4 Essen und Profil“ in `docs/roadmap.md` (Abschnitt „Dojo — Briefs“ und Tabellenzeile). Bilder: `docs/design/moodboard/{essen,rezept,profil}.html` im Browser öffnen; der HTML-Kommentar oben in jeder Datei sagt, wohin jede heutige Funktion wandert (er ist Teil der Abnahme). `heute.html` zeigt das gemeinsame Muster (Karte oben, eine Hauptkarte, ruhige Zeilenkarten).

## Global Constraints

- **Texte:** natürliche deutsche ganze Sätze, keine abgehackten Fragmente mit Gedankenstrich (`docs/language.md`). Bo duzt, ist warm und unterstützt. Bo heißt „Sensai“, nie „Coach“ und nie „Sensei“ (`tests/web/sensai-wording.test.ts` bleibt grün). Feste Bo-Texte nur aus `src/tracking/ui/bo.ts`, feste Essen-Sätze nur aus `src/web/essen/meals-view.ts` (Screens bauen keine Sätze oder Kicker aus Teilen).
- **Leicht bleiben:** keine Gamification (keine Punkte, Streaks, Abzeichen), keine Zahlenflut. Zahlen nur, wo man sie zum Kochen und Einkaufen braucht (Minuten, Mengen, Portionen, offene Dinge). Die Freundin des Nutzers nutzt die App mit: nichts Technisches auf der Fläche.
- **Optional:** Hevy, Garmin, die Verbindung zum Heimserver, E-Mail und Benachrichtigungen sind nie Pflicht. Ohne Verbindung keine leere Karte „Verbindungen“, keine Mahnung. Ohne Essensplan kein Essen-Tab (wie heute).
- **Öffentliches Repo:** keine persönlichen Daten in Code, Texten oder Fixtures (Namen wie „Max“, „Lena“, „anna“, erfundene Rezepte wie in den bestehenden Tests).
- **Daten bleiben sicher:** keine Änderung daran, wie Essenspläne, Zustand der Woche (`state-<woche>`), Herzen (`fav-`), „In den Plan“ (`place-`), Links (`link-`), Nachrichten (`chat-`), eigene Rezepte (`recipe-`), Kontakt, Lauf-Einstellungen, Sensai-Zeiten (`coachprefs`) oder Profil-Einstellungen geschrieben werden. `useMealData` (`change`, `toggleFav`, `place`), `addLink`, `deleteRecipe`, `say`, `ContactSettings.save`, `writeSettings`, `CoachPrefs.save` und alle `link.send(...)` bleiben im Inhalt wörtlich gleich; wird Code in eine neue Datei verschoben, wandert er unverändert. Die zwei Stellen, an denen bisher die gewählte Woche in einen Record ging, sind ausdrücklich festgelegt: `say` schreibt `week: shoppingWeek(weeks, now).plan.week` (die bisherige Vorgabe `first`, Task 4), die Einkaufsliste schreibt über `change(<angezeigte Woche>, f)` (Task 5). Nicht anfassen: `src/shared/**`, `src/service/**`, `src/main/**`, `src/coach/**`, `src/ui/**`, `src/tracking/{session,store,registry,plan-draft,workout-change,studios}.ts`. Tests, die geschriebene Records prüfen (`essen.test.tsx`: Haken, „isst mit“, eigene Dinge; `recipes.test.tsx`: Herzen, `place-`; `essen-coach-integration.test.tsx`; `connection-settings.test.tsx`; `push-ui.test.tsx`), werden nur im Weg zum Knopf angepasst, ihre Erwartungen an Records bleiben wörtlich gleich.
- **Eine Stelle pro Sache:** Farben nur als Token in `src/design/tokens.css` (dunkel auf `:root`, hell nur unter `@media (prefers-color-scheme: light)`, sonst `/* shared */`). Keine Farb-Literale in CSS oder TSX (`tests/web/style-tokens.test.ts`). Jede Regel oben in `src/tracking/ui/tracking.css` beginnt mit `.tk-`. Bausteine nur in `src/tracking/ui/kit/`, UI-Icons nur in `kit/Icon.tsx` (`currentColor`), größere Bilder als SVG in `src/web/public/brand/`. Ein neuer Kit-Teil nur, wenn ihn zwei Stellen brauchen.
- **Aussehen nur im Kit:** Screen-Dateien setzen nur Layout-Klassen. Ausnahme: die Zeilen der Einkaufsliste (`.pm-item`, `.pm-itemline`, `.pm-check`, `.pm-name`, `.pm-have`, `.pm-add`, `.pm-addline`) und die Rezeptliste (`.rc-row`, `.rc-open`, `.rc-thumb`, `.rc-blank`, `.rc-heart`) behalten ihre Regeln in `src/web/web.css`. Alle anderen `.pm-`/`.rc-`-Regeln werden gelöscht, sobald sie unbenutzt sind.
- **Schriftgewicht:** nur 400, 500, 700.
- **Knöpfe:** mindestens 44 px; pro Seite eine Hauptaktion (`primary`). Rollen über Klassen (`primary`, `secondary`, `link`, `danger-link` über `ConfirmLink`), geprüft von `tests/tracking/control-roles.test.tsx`. In jeder Datei, die eine Aufgabe anfasst, hat kein Knopf mehr eine leere Klasse (Parkplatz Dojo 1). Chips (`.tk-chips`) bleiben Auswahl, nicht Aktion.
- **Bo:** verspielt und bewegt nur auf Heute und im Chat. Auf Essen ist Bo das kleine Standbild (`BoBubble portrait="mini"`, ohne `place` und ohne `pose`).
- **Unterseiten:** eine Mechanik. Lokaler Zustand `page` in `MealsScreen`, jede Unterseite in `EssenPage` (`useBackEntry` + `PageHead` mit Zurück-Pille, Task 3). Eine Seite, die eine weitere zeigt (Rezepte → Rezept, Mahlzeit → Rezept), bleibt gemountet und behält ihren Verlaufseintrag; die innere Seite nimmt einen zweiten (`takeEntry` überspringt den Popstate auf die eigene Marke, `Sheet.tsx:47`). Hooks nie bedingt.
- **Tests nach Zweck** (`docs/roadmap.md`, Arbeitsweise 6): neue Tests nur für Abnahmesätze und Review-Focus-Fälle. Tests ersetzter Wege (aufklappbare Mahlzeitzeilen, Tagesleiste, Umschalter Tage/Einkauf, „In den Plan“-Sheet, Mahlzeit-Sheet auf Heute, `MealThumb`, `MealDetail`) werden gelöscht oder ersetzt. Gemeinsame Testhilfen (`pill`, `openMeal`) stehen in `tests/web/app/helpers.tsx`.
- **Skripte:** `scripts/web-smoke.ts` klickt weder Essen noch Profil (geprüft); ändert eine Aufgabe ein Label, das es doch nutzt, passt sie das Skript im selben Commit an. `scripts/web-shots.ts` (Bildschirmfotos) klickt Essen, Rezepte und Einkauf: Task 4, 5 und 6 passen ihre Schritte im selben Commit an.
- **Stand von `main`:** Die Umbenennung zu „Sensai“ ist schon im Branch (`BO.ask` = „Frag Bo, deinen Sensai“, `docs/design/moodboard/sensai.html`). `useBackEntry(onBack)` aus `kit/Sheet.tsx` ist der Weg für Unterseiten; `Training.tsx` (`SubPage`) ist das Vorbild. `kit/Sheet.tsx`, `CoachScreen`, `TogetherScreen`, `Training.tsx`, `TodayCard.tsx` nicht ändern. `Shell.tsx` ändert nur Task 3 (Einstieg Mahlzeit von Heute).
- Befehle: `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler, höchstens 52 Warnungen), `npm test`, `npm run test:web-smoke`. Einzeltest: `npx vitest run <datei>`.

## Entscheidungen

Vom Nutzer abgenommen (Entscheidung 3 und 7 nach seiner Änderung):

1. **Essen hat keinen `PageHead`**, sondern oben eine `HeadCard`: Kicker „Montag, 9. November · Trainingstag“ (Trainingstag nur, wenn `plan.trainingDays` heute enthält), Titel „Essen“ als `<h1>` mit Pinselstrich, ein Satz („Das Frühstück liegt hinter dir. Als Nächstes gibt es um 13 Uhr Skyr mit Nüssen.“). Grund: Moodboard `essen.html`.
2. **Welche Mahlzeit „dran“ ist:** eine Mahlzeit von heute gilt bis zwei Stunden nach ihrer Zeit aus `SLOT_TIME` (8, 13, 19 Uhr) als dran. Danach ist es die nächste von heute; nach dem Abendessen die erste von morgen (Kicker „Morgen · Frühstück um 8 Uhr“, auch über die Wochengrenze). Gibt es keine, gibt es keine Hauptkarte; die Kopfkarte sagt es in einem Satz.
3. **Bild einer Mahlzeit: das Rezeptfoto ist der Standard.** Hat die Mahlzeit ein Rezept mit Foto (`dish.recipeId`, Bild unter `/coach/recipes/{id}/image`), zeigt die Hauptkarte, jede kleine Zeile, die Woche und die Mahlzeit-Seite dieses Foto. Nur ohne Rezept, ohne Foto oder wenn es nicht lädt, steht die Zeichnung nach Mahlzeit-Typ aus der neuen Datei `src/web/public/brand/meals.svg`: `fruehstueck` (Schale Brei mit Beeren und Löffel), `mittag` (warme Schale mit Stäbchen), `abend` (Pfanne), alle drei aus `essen.html` (heute gibt es sie nicht; `brand/` hat nur Bambus, Nest, Panda und Schriften). Die Wahl trifft eine Stelle, `MealImage` (Task 3), ausdrücklich: `RecipePicture` liefert nie `null` (es zeigt sonst den Farbblock), deshalb fragt `MealImage` selbst „Rezept da, Foto nicht gescheitert“. Die Farben des Essens bleiben im SVG (ein Bild, hell und dunkel gleich, wie die Bambus-Dateien); Schatten und Dampf kommen aus den neuen Tokens `--meal-shadow` und `--meal-steam`. Die Rezept-Seite zeigt ihr Foto (`d.image`), sonst die Pfanne. Die Rezeptliste behält Foto oder Farbblock. `MealThumb` fällt weg.
4. **Die übrigen Mahlzeiten von heute** stehen klein als `RowCard` mit Bild unter der Hauptkarte („Frühstück · 8 Uhr“, Titel, Satz). Vorbei ist eine Mahlzeit mit grünem Haken und „War heute früh dran.“ („mittags“, „abends“).
5. **Die Woche:** eine ruhige Karte „Der Rest der Woche“ mit einer `RowCard` pro Tag nach heute (Vorsatz „Di 10.“, Bild und Titel der Hauptmahlzeit: Abendessen, sonst Mittagessen, sonst Frühstück; ein kurzer Satz). Gibt es den Plan der nächsten Woche (ab Samstag), folgt eine zweite Karte „Nächste Woche“ mit allen sieben Tagen. Ein Tag ohne Mahlzeit ist eine Zeile „Nichts geplant“ ohne Pfeil. Ein Tipp öffnet ein kleines Sheet mit den drei Mahlzeiten des Tages; ein Tipp darin öffnet die Mahlzeit-Seite. Damit fallen die Tagesleiste Mo–So und der Wochen-Umschalter auf Essen weg (der Umschalter bleibt nur auf Einkauf).
6. **Mahlzeit, Rezept, Rezepte und Einkauf sind Unterseiten im Essen-Tab** (lokaler Zustand in `MealsScreen`, Zurück-Pille, Browser-Zurück), keine Sheets; die Tab-Leiste bleibt sichtbar. Die Rezept-Seite wird von der Rezepte-Seite selbst gezeigt (die Liste bleibt gemountet und hält ihren Verlaufseintrag), so führt Zurück zur Liste mit Suche und Filtern. Damit ist der Parkplatz-Punkt „Browser-Zurück in verschachtelten Sheets“ für Essen gelöst.
7. **Die Mahlzeit-Seite** ist die Rezept-Seite für eine Mahlzeit aus dem Plan: Kopfkarte mit Bild (Entscheidung 3), Kicker „Mittagessen · heute um 13 Uhr“, Titel, ein Satz, „Auf Wunsch von Lena.“ (wenn `askedBy` gesetzt ist), „Wer isst mit“; Karte „Zutaten“ für die Portionen der Esser (ohne Stepper, wie heute) mit „Dazu“; Karte „So geht's“; ruhige Karte „Mehr“ mit `secondary` „Ganzes Rezept ansehen“, wenn das Gericht ein gespeichertes Rezept ist (`recipeId`; öffnet die Rezept-Seite mit Herz, Löschen für eigene Rezepte und „In den Plan“; ihre Zurück-Pille heißt „Mahlzeit“), sonst „Originalrezept öffnen“, wenn es einen Link gibt. Kein „In den Plan“ auf der Mahlzeit-Seite selbst.
8. **„Wer isst mit“** ist ein ruhiger Knopf mit kleinen Initialen und dem Satz „Max und Lena essen mit“ (auf der Hauptkarte und der Mahlzeit-Seite). Er öffnet ein kleines Sheet „Wer isst mit?“ mit den bisherigen Schaltern (die lesende Person zuerst). „Max isst nicht mit“ unter einer geschlossenen Zeile fällt weg; der Knopf sagt es.
9. **Heute führt zur Mahlzeit-Seite:** Ein Tipp auf eine Mahlzeit unter „Essen heute“ öffnet den Essen-Tab auf der Mahlzeit-Seite (Zurück-Pille „Heute“ führt zurück nach Heute). Das Mahlzeit-Sheet auf Heute fällt weg, damit es nur eine Ansicht einer Mahlzeit gibt. Sonst bleibt „Essen heute“ wie es ist (Icon `essen`, kein Bild). Bewusst hingenommen: Tippt man dann auf den Tab „Essen“, bleibt die Mahlzeit-Seite mit der Pille „Heute“ stehen; Kraft-Unterseiten verhalten sich heute genauso.
10. **„Plan ändern“** ist Bos Sprechblase unten auf Essen (Standbild, Text `BO_LINES.mealsChange` = „Schmeckt dir etwas nicht, oder passt ein Tag nicht? Sag es mir, dann schlage ich dir eine Änderung vor.“, Knopf `secondary` „Plan ändern“). Er öffnet das bisherige Eingabe-Sheet, das jetzt „Plan ändern“ heißt; „Senden“ wird `primary`.
11. **Kacheln:** „Rezepte“ mit „2 Favoriten“ / „1 Favorit“ / „Alle Rezepte durchsuchen“, „Einkauf“ mit „11 Dinge offen“ / „1 Ding offen“ / „Alles ist erledigt“ (für die Woche, die Einkauf zuerst zeigt: ab Samstag die nächste, wenn es sie gibt). Neue Icons `rezepte` (Buch mit Lesezeichen) und `einkauf` (Korb) nach `essen.html`.
12. **Rezept-Seite:** Das Herz ist ein runder Knopf in der Kopfkarte, nicht oben rechts (dort sitzt der Profil-Knopf der App); der runde Knopf gilt nur auf der Rezept-Seite, die Zeilen der Rezeptliste behalten ihr bisheriges Herz. Die Karte „In den Plan“ hat den Kicker „In den Plan“, den Satz „Wähle einen Tag und eine Mahlzeit. Max und Lena essen mit.“ (Esser der gewählten Mahlzeit), bei zwei Plänen „Diese Woche“/„Nächste Woche“, Tage und Mahlzeiten als Chips und den Hauptknopf „Am Mittwoch zum Mittagessen eintragen“ bzw. „Heute zum Abendessen eintragen“. **Vorgewählt:** Abendessen heute; ist das Abendessen von heute vorbei (Entscheidung 2), morgen, auch Montag der nächsten Woche, wenn ihr Plan da ist; sonst heute. Steht das Rezept schon im Plan, sagt die Kopfkarte „Steht schon im Plan: heute, Montag, zum Abendessen.“
13. **Rezepte-Seite:** „+ Rezept per Link“ wird `PillButton` „Rezept per Link“ (Icon `plus`) unter dem Kopf; sonst bleibt die Liste (Suche, Filter-Chips, Zeilen mit ihrem Herz, „Mehr anzeigen“ als `secondary`).
14. **Profil-Kopf:** kein sichtbarer Seitentitel (`<h1 className="tk-sr">Profil</h1>`), `HeadCard` mit Panda-Kreis, Name des Kontos als Titel und dem Sicherungs-Satz („Alles ist gesichert.“ statt „Alles gesichert“; die anderen Sätze aus `syncText` bleiben). Die Moodboard-Zeile „Offen ist nur deine E-Mail …“ entfällt bewusst: E-Mail ist optional, keine Mahnung.
15. **Profil-Gruppen als vier Karten.** Der Gruppenname bleibt eine `<h2>`-Überschrift (sieht aus wie ein Kicker), damit Screenreader die Gruppen weiter als Überschriften finden; Zeilen mit Icon-Kachel:
    - „Was Pandafit für dich plant“: „Laufen planen“ (Icon `lauf`), „Essensplan“ (`essen`), „Essen anpassen“ (`blatt`), dann eine ruhige Zeile (`kraft`) „Dein Krafttraining wird immer geplant. Rad fährst du am Mac.“; ist Kraft aus, steht stattdessen der Schalter „Krafttraining planen“ und darunter „Rad fährst du am Mac.“ (ohne Fahrt: „Rad geht mit der ersten Fahrt am Mac los.“). Ohne Verbindung zum Server nur Laufen und der Rad-Satz. „Rezeptsammlung: …“ zieht ins Sheet „Essen anpassen“.
    - „Verbindungen“: Hevy (`kraft`), Garmin (`uhr`), nur mit Verbindung; jede Zeile öffnet ihr Sheet wie heute.
    - „Nachrichten“: „Wochenübersicht per E-Mail“ (`brief`), „E-Mail“ (`brief`, Wert „noch keine“ statt „keine“), „Benachrichtigungen“ (`glocke`) mit „Neue Version“, und die Zeile „Wann sich der Sensai meldet“ (`laterne`, „Wochengespräch und Gruß am Vorabend.“), die ein Sheet mit `CoachPrefs` öffnet (sichtbar unter derselben Bedingung wie heute).
    - „Darstellung“: Hell/Dunkel/System und der Erklärsatz.
    - „Abmelden“ ist ein `secondary`-Knopf über die ganze Breite unter den Karten (Nachfrage bei Ungesendetem wie heute). Gesundheit steht nicht im Profil (schon seit Dojo 2; ein Test hält es fest).
16. **„Morgen“ auf Heute führt zum Training** (Wunsch und Entscheidung des Nutzers). Es entscheidet die Hauptsportart des Morgen-Tags (`tomorrowPlan.sport`): `gym` → direkt das Sheet „Nächstes Training“ in Kraft (`goTraining('plan')`), sobald es einen aktuellen Plan mit Training gibt (`readPlan(...).workout !== null`); nur ohne ein solches Training die Kraft-Seite (`goTraining()`). `bike` → Ausdauer Rad (`goBike`); `run` → Ausdauer Laufen (`goRun`); `mobility`, `rest` oder fehlender Weg (kein Rad-Plan sichtbar, Laufen aus) → wie heute das Tages-Sheet. **Plan und Morgen:** `plan/current` trägt kein Datum, er ist immer „das nächste Krafttraining“. Ist heute noch ein Krafttag offen, zeigt das Sheet also das Training von heute; der Nutzer nimmt das bewusst in Kauf. Die Morgen-Karte selbst (Text, Aussehen) bleibt.
17. **Heute bleibt sonst unverändert** (Wochenweg, Bo im Nest, Jetzt dran, „Essen heute“ mit Icon, Morgen-Karte in Aussehen und Text).

**Aus dem Parkplatz übernommen:**
- „Hauptknöpfe ohne `class="primary"` … Essen folgt in Dojo 4“: Essen, Rezepte, Rezept, Einkauf, Profil und die Benachrichtigungs-Karte (`PushCard`, „Einschalten“ wird `primary`) bekommen Rollenklassen. Der Punkt wird damit erledigt.
- „Shot-Werkzeug erreicht ‚Haben wir‘ auf der Einkaufsliste nicht“ (zweimal gelistet, L): die Schritte in `scripts/web-shots.ts` öffnen Einkauf als Seite und erreichen „Haben wir“ über die Rolle (Task 5).
- „Browser-Zurück in verschachtelten Sheets schließt das ganze Sheet“ (X): für Essen gelöst (Entscheidung 6); der Punkt bleibt für die übrigen Sheets offen und sagt das.
- Nicht übernommen: „Sheets aus dem Übungsmenü zeigen ‹ Zurück statt ×“ (Kraft), „`BoBubble` mini mit `place`“ (Dojo 5), „Essensplan-Schalter auf neuem Gerät“ (braucht Server).

## Review Focus

1. **Tagesränder:** spät am Abend nach der letzten Mahlzeit, ein Tag ohne Mahlzeiten, Sonntagabend ohne Plan der nächsten Woche, die Nacht der Zeitumstellung: keine leere Hauptkarte, kein übersprungener Tag, die Kopfkarte sagt in einem Satz, was ansteht. (Tests in Task 2 und Task 4.)
2. **Nur der Plan der nächsten Woche** (Samstag, oder ein neues Konto ohne laufende Woche): „Der Rest der Woche“ fehlt ohne Lücke, „Nächste Woche“ steht da, die Hauptkarte zeigt Montagmorgen nur, wenn morgen Montag ist; Einkauf öffnet ab Samstag auf der nächsten Woche, und zurück geht es. (Tests in Task 4 und Task 5.)
3. **Schnelles Tippen bei langsamem Speichern:** zwei Schalter im Sheet „Wer isst mit?“ hintereinander und ein Haken auf Einkauf landen alle im `state-`Record, keiner überschreibt den anderen (die Warteschlange in `useMealData.change` bleibt die eine Stelle; `DayMeals` hat keine eigene). (Test in Task 3.)
4. **„In den Plan“ an den Rändern:** ohne Plan sagt die Karte es ruhig und hat keinen Hauptknopf; vergangene Tage sind gesperrt; nach dem Abendessen ist morgen vorgewählt, auch über die Wochengrenze; nach „Eintragen“ ist der Knopf bis zur Antwort gesperrt und die Antwort steht als Status da. (Tests in Task 2 und Task 6.)
5. **Profil ohne Verbindung zum Server und ohne Benachrichtigungen im Browser:** keine leere Karte, kein „Verbindungen“, „Laufen planen“ und Darstellung gehen, nichts wird verlangt; „Wann sich der Sensai meldet“ steht wie heute, wenn es keine Benachrichtigungen gibt. (Test in Task 7.)

---

### Task 1: Kit für Dojo 4

**Files:**
- Modify: `src/design/tokens.css` (`--meal-shadow`, `--meal-steam`), `src/tracking/ui/tracking.css` (Kit-Block), `src/tracking/ui/kit/{Dojo.tsx,RowCard.tsx,Row.tsx,Switch.tsx,PageHead.tsx,Icon.tsx,index.ts}`
- Create: `src/tracking/ui/kit/HeadCard.tsx`, `src/tracking/ui/kit/MealPicture.tsx`, `src/web/public/brand/meals.svg`
- Test: `tests/web/dojo-kit.test.tsx`, `tests/web/style-tokens.test.ts`, `tests/web/meal-picture.test.ts` (neu)

**Interfaces:**
- Produces (Token, dunkel / hell): `--meal-shadow` `rgba(13,20,15,.45)` / `rgba(80,60,30,.18)`, `--meal-steam` `#7f9180` / `#a3a690`. Kopfkarte, Avatar-Kreis und Kachel nur aus vorhandenen Tokens (`--card`, `--line`, `--accent`, `--tile`).
- Produces (Bild): `src/web/public/brand/meals.svg` mit `<symbol id="fruehstueck|mittag|abend" viewBox="0 -4 120 94">`, Pfade aus `essen.html` (Hauptkarte = `mittag`, Zeile „Frühstück“ = `fruehstueck`, Zeile „Abendessen“ = `abend`). Schatten-Ellipse `style="fill: var(--meal-shadow)"`, Dampf `style="stroke: var(--meal-steam)"`, Essensfarben als Literale im SVG (Entscheidung 3).
- Produces (Icons): `IconName` um `'rezepte' | 'einkauf' | 'favorit' | 'blatt' | 'uhr' | 'brief' | 'glocke' | 'laterne'` erweitert. Formen aus `essen.html` (Kacheln Rezepte, Einkauf) und `profil.html` (Essen anpassen = Blatt, Garmin = Uhr, E-Mail = Brief, Benachrichtigungen = Glocke, Sensai = Laterne), `favorit` = schlichtes Herz ohne Pulslinie. Nur Striche in `currentColor`, keine Füllfarben.
- Produces (Kit):
  - `MealPicture({ slot, size = 'small' }: { slot: Slot; size?: 'small' | 'big' })` in eigener Datei `MealPicture.tsx` (`Slot` als Typ aus `src/shared/meals`): `<svg className="tk-meal {size}" aria-hidden="true" viewBox="0 -4 120 94"><use href={`/brand/meals.svg#${slot}`} /></svg>`. `small` füllt eine Kachel (40 px), `big` 196 × 154 px mittig. Die Klasse `tk-meal {size}` gilt auch für ein `<img>` (Foto, `object-fit: cover`, Radius aus Tokens), damit Foto und Zeichnung gleich groß stehen (Task 3, `MealImage`).
  - `HeadCard({ kicker, title, level = 1, text, icon, picture, children }: { kicker?: string; title: string; level?: 1 | 2; text?: ReactNode; icon?: IconName; picture?: ReactNode; children?: ReactNode })`: **die eine Kopfkarte einer Seite** (`Card label={title}`), `Kicker`, `BrushTitle level={level}`, `text` als gedämpfter Satz, dann `children`. Zwei Formen, im Kommentar beschrieben: mit `picture` steht das Bild oben mittig (Essen, Mahlzeit, Rezept); mit `icon` steht links ein runder Avatar (64 px, Rand `--accent`) und der Text daneben (nur Profil). Kein Ersatz für `MainCard` (keine Haupt- und Nebenaktion).
  - `MainCard` + `picture?: ReactNode` (über dem Kicker, mittig). Ein Nutzer (Essen-Hauptkarte); ein Prop an einem vorhandenen Teil, kein neuer Teil.
  - `RowCard` + `picture?: ReactNode`; `icon` wird optional (`icon?: IconName`). Die Kachel zeigt `picture`, sonst das Icon.
  - `Row` + `icon?: IconName` und `hint?: string` (Kachel links, kleine gedämpfte Zeile unter dem Titel; ersetzt `withHint` in `ConnectionSettings`). Ohne `onClick` ist `Row` eine ruhige Zeile mit Icon (Profil: Kraft- und Rad-Satz). `Switch` + `icon?: IconName` (gleiche Kachel links).
  - `Kicker` + `heading?: boolean`: mit `heading` ein `<h2 className="tk-kicker">` statt `<p>` (Profil-Gruppen, Entscheidung 15).
  - `RoundButton` + `pressed?: boolean` (`aria-pressed`; gedrückt füllt das Icon mit `--accent`). Im Prop-Kommentar: „only for icons that read as filled when on (the heart)“. Ohne `pressed` kein `aria-pressed`.
  - `PageHead`: `title` wird optional; ohne Titel steht nur die Zurück-Pille (Seiten, deren Titel in der `HeadCard` steht).
  - CSS: `.tk-screen a.secondary` sieht aus wie `button.secondary` (Links „Originalrezept öffnen“).
  - `kit/index.ts` exportiert `HeadCard`, `MealPicture`. Kopfkommentar: neue Zeile „HeadCard is the one head card of a page with its title (Essen, a meal, a recipe, Profil); MealPicture the one drawn picture per meal type (brand/meals.svg)“; die Zeile zu `RowCard`/`Row` wird „RowCard is the only row card (an icon or picture tile in a card of its own); Row is the list row, with an optional icon tile and hint (settings)“; die Zeile zu `Segments` nennt nicht mehr „Essen Tage/Einkauf“.

- [ ] **Step 1: Write the failing tests.** In `tests/web/style-tokens.test.ts` die Liste „Dojo 2 tokens“ um `--meal-shadow`, `--meal-steam` erweitern. `tests/web/meal-picture.test.ts` (wie der Nest-Test in `bo-scene.test.tsx`):

```ts
it('has the three meal pictures and paints theme colours only through meal tokens of both schemes', () => {
  const svg = readFileSync('src/web/public/brand/meals.svg', 'utf8');
  for (const s of ['fruehstueck', 'mittag', 'abend']) expect(svg).toContain(`<symbol id="${s}"`);
  const vars = [...new Set(svg.match(/var\((--[a-z-]+)\)/g)?.map((v) => v.slice(4, -1)))];
  expect(vars.sort()).toEqual(['--meal-shadow', '--meal-steam']);
  const [dark, light] = readFileSync('src/design/tokens.css', 'utf8').split('@media (prefers-color-scheme: light)');
  for (const t of vars) { expect(dark, t).toContain(`${t}:`); expect(light, t).toContain(`${t}:`); }
});
```

In `tests/web/dojo-kit.test.tsx`:

```tsx
it('draws every registered icon with currentColor only', () => { /* bestehender Test: Namensliste um die 8 neuen Namen erweitern */ });
it('a head card names its region by the title and carries kicker, h1 and sentence', () => {
  render(<HeadCard kicker="Montag, 9. November" title="Essen" text="Als Nächstes gibt es um 13 Uhr Skyr." />);
  const card = screen.getByRole('region', { name: 'Essen' });
  expect(within(card).getByRole('heading', { level: 1, name: 'Essen' })).toBeTruthy();
  expect(card.textContent).toContain('Als Nächstes gibt es um 13 Uhr Skyr.');
});
it('a head card with an icon shows the round avatar and a level-2 title', () => {
  render(<HeadCard icon="profil" level={2} title="anna" />);
  expect(screen.getByRole('heading', { level: 2, name: 'anna' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'anna' }).querySelector('svg[data-icon="profil"]')).toBeTruthy();
});
it('a meal picture uses its symbol from brand/meals.svg', () => {
  const { container } = render(<MealPicture slot="abend" size="big" />);
  expect(container.querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#abend');
});
it('a row card can carry a picture instead of an icon; a main card a picture on top', () => {
  render(<><RowCard picture={<MealPicture slot="mittag" />} kicker="Mittagessen · 13 Uhr" title="Linsen-Bolognese" onClick={() => {}} /><MainCard kicker="Jetzt dran" title="Skyr" picture={<MealPicture slot="mittag" size="big" />} /></>);
  expect(screen.getByRole('button', { name: /Linsen-Bolognese/ }).querySelector('use')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Jetzt dran' }).querySelector('svg.tk-meal.big')).toBeTruthy();
});
it('a row and a switch can carry an icon tile and a hint', () => {
  render(<><RowList><Row icon="uhr" title="Garmin" hint="Ruhepuls und Läufe übernehmen" value="optional" onClick={() => {}} /></RowList><Switch icon="glocke" label="Benachrichtigungen" checked={false} onChange={() => {}} /></>);
  expect(screen.getByRole('button', { name: /Garmin/ }).querySelector('svg[data-icon="uhr"]')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Benachrichtigungen' }).closest('label')!.querySelector('svg[data-icon="glocke"]')).toBeTruthy();
});
it('a kicker can be a heading', () => {
  render(<Kicker heading>Nachrichten</Kicker>);
  expect(screen.getByRole('heading', { level: 2, name: 'Nachrichten' }).className).toBe('tk-kicker');
});
it('a round button can be pressed', () => {
  render(<RoundButton icon="favorit" name="Skyr aus den Favoriten nehmen" pressed onClick={() => {}} />);
  expect(screen.getByRole('button', { name: 'Skyr aus den Favoriten nehmen' }).getAttribute('aria-pressed')).toBe('true');
});
it('a page head without a title is only the back pill', () => {
  render(<PageHead back={{ label: 'Rezepte', onClick: () => {} }} />);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.getByRole('button', { name: 'Rezepte' }).className).toBe('tk-pill');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/dojo-kit.test.tsx tests/web/style-tokens.test.ts tests/web/meal-picture.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** Tokens, Bild, Icons, Bausteine und ihre CSS-Regeln (nur Tokens, alles mit `.tk-`).
- [ ] **Step 4: Run** die drei Tests, dann `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(design): Dojo 4 kit (head card, meal picture, pictures in cards, icon rows, icons)`.

### Task 2: Essen in Worten

**Files:**
- Create: `src/web/essen/meals-view.ts`
- Modify: `src/web/MealsScreen.tsx` (`Week`, `mealWeeks`, `mealDayOf`, `listAnd` ziehen nach `meals-view.ts`; `MealsScreen.tsx` exportiert `Week`, `mealWeeks`, `mealDayOf` weiter, damit `Shell` und Tests unverändert importieren)
- Test: `tests/web/meals-view.test.ts`

**Interfaces:**
- Consumes: aus `src/shared/meals` `SLOTS`, `SLOT_LABEL`, `SLOT_TIME`, `DAY_SHORT`, `dateOf`, `dayIndex`, `weekOf`, `addWeeks`, `mealKey`, `eatersOf`, `shoppingList`, `readMealPlan`, `readMealState`, `stateRecordId`; `localDayKey` aus `src/shared/dates`; `longDateLabel`, `longDayOfKey` aus `src/tracking/ui/labels.ts`; `numberWord`, `cap` aus `src/tracking/ui/week-path.ts`. Kein Import aus `MealsScreen.tsx` (keine Ringabhängigkeit).
- Produces (rein, alles exportiert):
  - Daten (verschoben, unverändert): `type Week = { plan: MealPlan; state: MealState }`, `mealWeeks(records, now): Week[]`, `mealDayOf(records, ms)`, `listAnd(names: string[]): string`.
  - `type MealAt = { week: string; meal: string }` (`meal` = `mealKey(day, slot)`), `type MealRef = { week: Week; meal: Meal; when: 'heute' | 'morgen' }`.
  - `MEAL_OVER_MS = 2 * 3_600_000`; `isOver(slot: Slot, nowMs: number): boolean` (Uhrzeit aus `SLOT_TIME` am Kalendertag von `nowMs` plus zwei Stunden ist vorbei).
  - `todayMeals(weeks: Week[], nowMs: number): { week: Week; meal: Meal; over: boolean }[]` in der Reihenfolge `SLOTS` (Woche über `weekOf(nowMs)`, Tag über `dayIndex(nowMs)`).
  - `nextMeal(weeks: Week[], nowMs: number): MealRef | null` (Entscheidung 2). „Morgen“ über Wochen-Schlüssel und Tagesindex, nie über `nowMs + DAY`: Tag 6 → Tag 0 von `addWeeks(week, 1)`.
  - `slotHour(slot: Slot): string` → „8 Uhr“, „13 Uhr“, „19 Uhr“ (aus `SLOT_TIME`); `slotAt(slot)` → „um 8 Uhr“; `slotKicker(slot: Slot): string` → „Frühstück · 8 Uhr“ (Zeilen); `SLOT_TO: Record<Slot, string>` → „zum Frühstück“, „zum Mittagessen“, „zum Abendessen“; `SLOT_WHEN: Record<Slot, string>` → „früh“, „mittags“, „abends“.
  - `NEXT_PLAN = 'Der nächste Plan kommt am Samstagmorgen.'` (die eine Stelle; Kopfsatz und Essen ohne Plan).
  - `headKicker(nowMs: number, trainingDay: boolean): string` → `longDateLabel(nowMs)` plus „ · Trainingstag“.
  - `headSentence(today: { meal: Meal; over: boolean }[], next: MealRef | null): string`:
    - `next` heute, davor vorbei: „Das Frühstück liegt hinter dir. Als Nächstes gibt es um 13 Uhr Skyr mit Nüssen.“ (zwei vorbei über `listAnd`: „Das Frühstück und das Mittagessen liegen hinter dir. …“);
    - `next` heute, nichts vorbei: „Als Nächstes gibt es um 8 Uhr Haferbrei mit Beeren.“;
    - `next` morgen: „Für heute steht nichts mehr an. Morgen gibt es um 8 Uhr Haferbrei mit Beeren.“ (heute nichts geplant: „Heute ist nichts geplant. Morgen gibt es …“);
    - kein `next`: „Für heute steht nichts mehr an. “ bzw. „Heute ist nichts geplant. “ plus `NEXT_PLAN`.
  - `mealKicker(r: MealRef): string` → „Jetzt dran · Mittagessen um 13 Uhr“ bzw. „Morgen · Frühstück um 8 Uhr“; `mealPageKicker(week: Week, meal: Meal, nowMs: number): string` → „Mittagessen · heute um 13 Uhr“, „Abendessen · morgen um 19 Uhr“, sonst „Abendessen · Mittwoch um 19 Uhr“.
  - `mealSentence(week: Week, meal: Meal): string`: Rest vom selben Tag → „Das kochst du schon vorher mit.“, Rest von einem anderen Tag → „Das ist der Rest von Montag.“; sonst „In {minutes} Minuten fertig“ plus, in dieser Reihenfolge, `takeAlong` → „ und gut zum Mitnehmen“, andere Mahlzeiten nutzen den Rest → „, und es reicht auch für Donnerstag“ (mehrere über `listAnd`), `keepsDays > 0` → „, und es hält sich einen Tag“ / „zwei Tage“ (`numberWord`), dann „.“.
  - `askedSentence(week: Week, meal: Meal): string | null` → „Auf Wunsch von Lena.“ (`askedBy`), sonst `null`.
  - `rowSentence(week: Week, meal: Meal): string` (kurz): Rest → „Rest von Montag.“, nutzt jemand den Rest → „Reicht auch für Donnerstag.“, sonst „Etwa {minutes} Minuten.“
  - `pastSentence(slot: Slot): string` → „War heute früh dran.“ / „War heute mittags dran.“ / „War heute abends dran.“
  - `eatersLine(names: string[]): string` → „Niemand isst mit“, „Lena isst mit“, sonst `listAnd(names)` + „ essen mit“.
  - `type DayRow = { week: Week; day: number; lead: string; dateLong: string; meal: Meal | null }`; `restOfWeek(weeks: Week[], nowMs: number): DayRow[]` (Tage nach heute in der laufenden Woche; `lead` „Di 10.“; `dateLong` über `longDayOfKey(localDayKey(dateOf(week, day).getTime()))`; `meal` = Abendessen, sonst Mittag, sonst Frühstück); `nextWeekRows(weeks: Week[], nowMs: number): DayRow[]` (alle sieben Tage des Plans der nächsten Woche, leer ohne ihn).
  - `shoppingWeek(weeks: Week[], nowMs: number): Week | undefined` (die bisherige Regel `first` aus `MealsScreen`: ab Samstag die nächste, wenn es sie gibt, sonst die laufende, sonst die erste).
  - `openCount(week: Week): number` (`list.open` plus eigene offene Dinge, wie bisher in `MealsScreen`); `favSentence(n: number): string` → 0 „Alle Rezepte durchsuchen“, 1 „1 Favorit“, n „{n} Favoriten“; `openSentence(n: number): string` → 0 „Alles ist erledigt“, 1 „1 Ding offen“, n „{n} Dinge offen“; `shoppingSentence(people: number): string` → „Die Liste reicht für die ganze Woche und für zwei Personen.“ (eine: „für eine Person“).
  - `placeDefault(weeks: Week[], nowMs: number): { week: string; day: number; slot: Slot } | null` (Entscheidung 12; `null` ohne Plan); `placeButton(day: number, slot: Slot, today: boolean): string` → „Heute zum Abendessen eintragen“ / „Am Mittwoch zum Mittagessen eintragen“; `placedSentence(weeks: Week[], recipeId: string, nowMs: number): string | null` → „Steht schon im Plan: heute, Montag, zum Abendessen.“ bzw. „Steht schon im Plan: Mittwoch, zum Mittagessen.“ (erster Treffer ab heute, sonst `null`).
  - `recipeSentence(d: { minutes: number; proteinG: number | null; keepsDays: number }): string` → „In 30 Minuten fertig, mit viel Eiweiß, und es hält sich zwei Tage.“ (Eiweiß nur ab 20 g; `keepsDays === 0` → „…, am besten frisch.“).

- [ ] **Step 1: Write the failing test** `tests/web/meals-view.test.ts` (Wochen als `Week`-Objekte, `at(day, h, m)` als lokale Uhrzeit in der Testwoche, `MO … SO` Tagesindizes):

```ts
it('a meal is dran until two hours after its time, then the next one, after dinner tomorrow', () => {
  expect(nextMeal(weeks, at(MO, 9, 30))!.meal.slot).toBe('fruehstueck');
  expect(nextMeal(weeks, at(MO, 10, 1))!.meal.slot).toBe('mittag');
  const late = nextMeal(weeks, at(MO, 21, 5))!;
  expect([late.when, late.meal.day, late.meal.slot]).toEqual(['morgen', 1, 'fruehstueck']);
});
it('Sunday night goes to Monday of next week by its key, also on the night the clocks change', () => {
  const r = nextMeal([thisWeek, nextWeek], atDst(SO, 22, 0)); // Testwoche mit Zeitumstellung in der Nacht
  expect([r!.week.plan.week, r!.meal.day]).toEqual([NEXT, 0]);
});
it('says the day in one sentence, also late and without a plan for tomorrow', () => {
  expect(headSentence(todayMeals(weeks, at(MO, 11, 0)), nextMeal(weeks, at(MO, 11, 0)))).toBe('Das Frühstück liegt hinter dir. Als Nächstes gibt es um 13 Uhr Skyr mit Nüssen.');
  expect(headSentence(todayMeals([thisWeek], at(SO, 22, 0)), nextMeal([thisWeek], at(SO, 22, 0)))).toBe('Für heute steht nichts mehr an. Der nächste Plan kommt am Samstagmorgen.');
  expect(headSentence([], null)).toBe('Heute ist nichts geplant. Der nächste Plan kommt am Samstagmorgen.');
});
it('says a meal in words: minutes, take along, what it is enough for, how long it keeps, who wished it', () => {
  expect(mealSentence(w, skyr)).toBe('In 5 Minuten fertig und gut zum Mitnehmen.');
  expect(mealSentence(w, curryWithRest)).toBe('In 30 Minuten fertig, und es reicht auch für Donnerstag, und es hält sich zwei Tage.');
  expect(rowSentence(w, restOfCurry)).toBe('Rest von Mittwoch.');
  expect(askedSentence(w, wished)).toBe('Auf Wunsch von Lena.');
  expect(eatersLine(['Max', 'Lena'])).toBe('Max und Lena essen mit');
  expect(slotKicker('fruehstueck')).toBe('Frühstück · 8 Uhr');
});
it('the rest of the week starts after today, the next week only with its plan', () => {
  expect(restOfWeek(weeks, at(MO, 12, 0)).map((r) => r.lead)).toEqual(['Di 10.', 'Mi 11.', 'Do 12.', 'Fr 13.', 'Sa 14.', 'So 15.']);
  expect(restOfWeek(weeks, at(MO, 12, 0))[0]!.dateLong).toBe('Dienstag, 10. November');
  expect(restOfWeek(weeks, at(SO, 12, 0))).toEqual([]);
  expect(nextWeekRows([thisWeek], at(SA, 12, 0))).toEqual([]);
});
it('In den Plan preselects dinner today, tomorrow once dinner is over, across the week end; nothing without a plan', () => {
  expect(placeDefault(weeks, at(MI, 18, 0))).toMatchObject({ day: 2, slot: 'abend' });
  expect(placeDefault(weeks, at(SO, 21, 30))).toMatchObject({ week: NEXT, day: 0, slot: 'abend' });
  expect(placeDefault([], at(MI, 18, 0))).toBeNull();
  expect(placeButton(2, 'mittag', false)).toBe('Am Mittwoch zum Mittagessen eintragen');
});
it('the tiles and the list count calmly', () => {
  expect([favSentence(0), favSentence(1), openSentence(11), openSentence(0)]).toEqual(['Alle Rezepte durchsuchen', '1 Favorit', '11 Dinge offen', 'Alles ist erledigt']);
  expect(shoppingSentence(2)).toBe('Die Liste reicht für die ganze Woche und für zwei Personen.');
  expect(shoppingWeek([thisWeek, nextWeek], at(SA, 9, 0))!.plan.week).toBe(NEXT);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/meals-view.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `meals-view.ts` (keine React-Imports) und verschiebe die vier Daten-Funktionen.
- [ ] **Step 4: Run** den Test und `npx vitest run tests/web/app/essen.test.tsx` — Expected: PASS. `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(essen): the meals in words`.

### Task 3: Mahlzeit-Seite, auch von Heute aus

**Files:**
- Create: `src/web/essen/EssenPage.tsx`, `src/web/essen/MealImage.tsx`, `src/web/essen/MealPage.tsx`, `src/web/essen/RecipeParts.tsx`
- Modify: `src/web/MealsScreen.tsx` (Seitenzustand, Typ `MealData`, `DayMeals` öffnet die Seite, `MealDetail`, `MealRow`-Aufklappen und `MealThumb` löschen), `src/web/app/Heute.tsx` (nur `DayMeals`-Aufruf und Prop `goMeal`), `src/web/app/Shell.tsx` (Einstieg), `src/web/web.css` (unbenutzte `.pm-`-Regeln löschen), `tests/web/app/helpers.tsx` (`pill`, `openMeal`)
- Test: `tests/web/app/meal-page.test.tsx` (neu), `tests/web/app/essen.test.tsx`, `tests/web/app/recipes.test.tsx`

**Interfaces:**
- Consumes: `HeadCard`, `MealPicture`, `Card`, `Kicker`, `PageHead`, `Sheet`, `useBackEntry` (Kit); `MealAt`, `mealPageKicker`, `mealSentence`, `askedSentence`, `eatersLine`, `mealDayOf` (Task 2).
- Produces:
  - `EssenPage({ back, title, children }: { back: { label: string; onClick: () => void }; title?: string; children: ReactNode })`: der eine Rahmen jeder Essen-Unterseite: `useBackEntry(back.onClick)` und `<div className="tk-screen tk-headblock"><PageHead title={title} back={back} /></div>` vor `children` (wie `SubPage` in `Training.tsx`, das eingefroren bleibt).
  - `MealImage({ recipeId, has, slot, size }: { recipeId?: string; has?: boolean; slot: Slot; size?: 'small' | 'big' })`: zeigt `<img className={`tk-meal ${size} photo`} src={`/coach/recipes/${recipeId}/image`} alt="" loading="lazy" onError={…}>`, wenn `recipeId && has !== false && !failed`; sonst `MealPicture slot size`. Die eine Stelle für Foto oder Zeichnung (Entscheidung 3).
  - `export type MealData = ReturnType<typeof useMealData>` in `MealsScreen.tsx`.
  - `RecipeParts.tsx`: `IngredientsCard({ portions, onPortions, ingredients, side }: { portions: number; onPortions?: (n: number) => void; ingredients: Ingredient[]; side?: Side })` (Karte, Kicker „Zutaten“, mit `onPortions` der Stepper „Eine Portion weniger/mehr“ 1–4 wie heute, ohne nur „Für 2 Portionen“; Mengen über `recipeAmount`; „Dazu: …“ über `sideText`); `StepsCard({ steps }: { steps: string[] })` (Kicker „So geht's“, nummerierte Liste); `EatersButton({ week, meal, me, onEater }: { week: Week; meal: Meal; me?: string; onEater: (person: string, on: boolean) => void })` (Knopf `secondary` mit Initialen und `eatersLine`, öffnet `Sheet size="small" title="Wer isst mit?"` mit `role="group" aria-label="Wer isst mit"` und den bisherigen Knöpfen „Lena isst mit“ / „Lena isst nicht mit“, die lesende Person zuerst; ein vergangener Tag zeigt nur den Satz, keinen Knopf).
  - `MealPage({ data, at, me, backLabel, onBack }: { data: MealData; at: MealAt; me?: string; backLabel: 'Essen' | 'Heute'; onBack: () => void })` in `EssenPage back={{ label: backLabel, onClick: onBack }}` (ohne Titel): `HeadCard picture={<MealImage recipeId={dish.recipeId} slot size="big" />} kicker={mealPageKicker} title={dish.title} text={mealSentence}` mit `children`: `askedSentence` (wenn gesetzt) und `EatersButton`. Ist es ein Rest: Hinweis „Das ist schon gekocht. Pack es einfach ein.“ statt Zutaten; sonst `IngredientsCard portions={cook.total}` (ohne Stepper) und `StepsCard`. `Card soft label="Mehr"`: mit `recipeId` `button.secondary` „Ganzes Rezept ansehen“ (Zustand `recipeOpen`; bis Task 6 öffnet er das bisherige `RecipeView`-Sheet, ab Task 6 rendert `MealPage` an seiner Stelle `RecipePage` mit `backLabel="Mahlzeit"`, `MealPage` bleibt gemountet); sonst mit Quelle `a.secondary` „Originalrezept öffnen“; sonst keine Karte. Steht die Mahlzeit nicht mehr im Plan: `Card` „Diese Mahlzeit steht nicht mehr im Plan.“. Esser ändern über `data.change(at.week, (s, t) => withEater(s, at.meal, person, on, t))`.
  - `MealsScreen({ port, now, fetchFn, account, entry, onEntryDone, onHeute })`: neu `entry?: MealAt | null`, `onEntryDone?: () => void`, `onHeute?: () => void`. Zustand `page: { name: 'start' } | { name: 'meal'; at: MealAt; from: 'essen' | 'heute' }` (Task 4–6 ergänzen `einkauf` und `rezepte`). Mit `entry` startet die Seite als `meal` mit `from: 'heute'` und ruft einmal `onEntryDone`. Zurück von `from: 'heute'` ruft `onHeute`, sonst `page = start`. Bis Task 4 öffnet ein Tipp auf eine Mahlzeitzeile die Seite (statt aufzuklappen).
  - `DayMeals({ port, now, onOpen }: { port: WebPort; now: () => number; onOpen: (at: MealAt) => void })`: liest nur über `usePortRecords(port, 'mealplan')` und `mealDayOf` (kein `useMealData`, also keine zweite Schreib-Warteschlange), Zeilen wie bisher, Tipp ruft `onOpen`; kein Sheet, kein `RecipeView`.
  - `Heute` + `goMeal?: (at: MealAt) => void`; `DayMeals` nur, wenn `meals && goMeal`.
  - `Shell`: `const [mealEntry, setMealEntry] = useState<MealAt | null>(null)`; `Heute goMeal={(m) => { setMealEntry(m); setTab('essen'); }}`; `MealsScreen entry={mealEntry} onEntryDone={() => setMealEntry(null)} onHeute={() => setTab('heute')}`. Sonst keine Änderung an `Shell.tsx`.
  - `tests/web/app/helpers.tsx`: `pill(name: string): HTMLElement` (der Knopf mit `className === 'tk-pill'` unter allen Knöpfen dieses Namens; Pille und Tab heißen beide „Essen“ bzw. „Heute“); `openMeal(title: string): Promise<void>` (klickt die Zeile mit diesem Titel; Task 4 passt sie an die Startseite an).

- [ ] **Step 1: Write the failing tests** `tests/web/app/meal-page.test.tsx` (Plan wie in `essen.test.tsx`; „Linsen-Bolognese“ hat ein `recipeId`, „Skyr mit Beeren“ keins):

```tsx
it('a meal opens as its page: picture, kicker, title, sentence, who eats, ingredients and steps; Essen comes back', async () => {
  await boot({ account: 'anna', seed: [mealPlan], recipes: route([]) });
  fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
  await openMeal('Skyr mit Beeren');
  const head = await screen.findByRole('region', { name: 'Skyr mit Beeren' });
  expect(head.querySelector('use')!.getAttribute('href')).toBe('/brand/meals.svg#fruehstueck'); // kein Rezept: die Zeichnung
  expect(head.textContent).toContain('Frühstück · heute um 8 Uhr');
  expect(within(head).getByRole('button', { name: /Max und Lena essen mit/ }).className).toBe('secondary');
  expect(screen.getByRole('region', { name: 'Zutaten' }).textContent).toContain('Skyr');
  expect(screen.getByRole('region', { name: "So geht's" }).textContent).toContain('Verrühren.');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(pill('Essen'));
  expect(await screen.findByRole('button', { name: /Skyr mit Beeren/ })).toBeTruthy();
});
it('a meal with a recipe shows its photo, falls back to the drawing when it fails, and leads to the whole recipe', async () => {
  // openMeal('Linsen-Bolognese') → head img.tk-meal.big src `/coach/recipes/${RID}/image`
  // fireEvent.error(img) → img weg, use href '/brand/meals.svg#mittag'
  // Knopf „Ganzes Rezept ansehen“ (secondary) → Text des Rezepts „Linsen kochen.“ erscheint
});
it('two quick changes in Wer isst mit both land in the state record', async () => {
  // Sheet „Wer isst mit?“ → „Lena isst mit“ und „Max isst mit“ direkt hintereinander, ohne await dazwischen
  // waitFor: state-<woche>.eaters[`${today}-fruehstueck`].pb.on === false UND .pa.on === false
});
it('the reader comes first in Wer isst mit, whatever the case', async () => {
  // account 'lena' → im Sheet ist der erste Knopf der Gruppe „Wer isst mit“ „Lena isst mit“; account 'nobody' → Reihenfolge Max, Lena
});
it('a rest has no ingredients, only the note to pack it; a wished meal says who wished it', async () => {
  // reuseOf → Text „Das ist schon gekocht. Pack es einfach ein.“, queryByRole('region', { name: 'Zutaten' }) === null
  // askedBy 'pb' → Kopfkarte enthält „Auf Wunsch von Lena.“
});
it('from Heute a meal opens the Essen page, and its back pill leads to Heute', async () => {
  await boot({ account: 'anna', seed: [mealPlan] });
  const list = await screen.findByRole('list', { name: 'Essen heute' });
  fireEvent.click(within(list).getByRole('button', { name: /Linsen-Bolognese/ }));
  expect(await screen.findByRole('region', { name: 'Linsen-Bolognese' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Seiten' }).querySelector('[aria-current="page"]')!.textContent).toContain('Essen');
  fireEvent.click(pill('Heute'));
  expect(await screen.findByRole('list', { name: 'Essen heute' })).toBeTruthy();
});
it('the browser Back leaves the meal page', async () => {
  // openMeal('Skyr mit Beeren') → history.back() → findByRole('button', { name: /Skyr mit Beeren/ }) (Essen-Start) und keine Region „Zutaten“
});
```

Bestehende Tests anpassen: `essen.test.tsx` „on Heute … tapping opens the meal“ prüft jetzt die Mahlzeit-Seite statt eines Dialogs; „today first with its meals …“ öffnet „Wer isst mit?“ über die Seite (die Record-Erwartungen bleiben wörtlich); „the reader's own chip comes first …“ wird durch den neuen Test ersetzt (`MealDetail` gibt es nicht mehr). `recipes.test.tsx` „a meal of a real recipe has a small picture …“ wird durch den Foto-Test oben ersetzt; „a recipe that cannot be opened …“ geht über „Ganzes Rezept ansehen“.

- [ ] **Step 2: Run** `npx vitest run tests/web/app/meal-page.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/web` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(essen): a meal is a page, also from Heute`.

### Task 4: Essen-Start, Tag-Sheet und „Plan ändern“

**Files:**
- Create: `src/web/essen/EssenStart.tsx` (die Startseite; `MealsScreen.tsx` bleibt Daten und Seitenwechsel)
- Modify: `src/web/MealsScreen.tsx` (Startseite raus, `ChatSheet` heißt „Plan ändern“, `say` schreibt `week: shoppingWeek(weeks, now).plan.week`), `src/tracking/ui/bo.ts` (`BO_LINES.mealsChange`), `src/web/web.css` (`.pm-days`, `.pm-dayname`, `.pm-titleline`, `.pm-rowtitle`, `.pm-thumb` und weitere unbenutzte `.pm-`-Regeln löschen), `tests/web/app/helpers.tsx` (`openMeal`), `scripts/web-shots.ts` (Essen-Schritte bis auf Einkauf)
- Test: `tests/web/app/essen-start.test.tsx` (neu), `tests/web/app/meal-page.test.tsx` (läuft über `openMeal`), `tests/web/app/essen.test.tsx`, `tests/web/app/essen-coach-integration.test.tsx`

**Interfaces:**
- Consumes: `HeadCard`, `MainCard`, `RowCard`, `Card`, `Kicker`, `BoBubble`, `Sheet` (Kit); alles aus Task 2; `EatersButton`, `MealImage` (Task 3).
- Produces:
  - `EssenStart({ data, nowMs, me, onMeal, onShopping, onRecipes, onChat }: { data: MealData; nowMs: number; me?: string; onMeal: (at: MealAt) => void; onShopping: () => void; onRecipes: () => void; onChat: () => void })`. Von oben:
    1. `HeadCard kicker={headKicker(nowMs, trainingDay)} title="Essen" text={headSentence(...)}`.
    2. Mit `nextMeal`: `MainCard label="Nächste Mahlzeit" picture={<MealImage recipeId slot size="big" />} kicker={mealKicker} title={dish.title} text={mealSentence}` mit `middle={<EatersButton … />}` und `primary` „Rezept ansehen“ (öffnet die Mahlzeit-Seite).
    3. Die übrigen Mahlzeiten von heute (ohne die der Hauptkarte): `div.tk-rowcards` mit `RowCard picture={<MealImage recipeId slot />} kicker={slotKicker(slot)} title sub` (`sub` = `pastSentence` mit `end="done"`, wenn vorbei, sonst `rowSentence`); Tipp öffnet die Mahlzeit-Seite.
    4. `Card soft label="Der Rest der Woche"` mit `Kicker` und je Tag `RowCard lead picture title sub` (ohne Mahlzeit: `RowCard icon="essen" title="Nichts geplant" end="none"` ohne `onClick`); Tipp öffnet `Sheet size="small" title={row.dateLong}` mit den Mahlzeiten des Tages als `RowCard` (Tipp schließt das Sheet und öffnet die Mahlzeit-Seite). Ohne Tage keine Karte. Danach genauso `Card soft label="Nächste Woche"` aus `nextWeekRows`.
    5. `div.tk-tiles`: `RowCard icon="rezepte" title="Rezepte" sub={favSentence(favs.size)}` (bis Task 6 öffnet sie das bisherige `RecipesSheet`) und `RowCard icon="einkauf" title="Einkauf" sub={openSentence(openCount(shoppingWeek(...)))}` (bis Task 5 öffnet sie die bisherige Einkaufsansicht in einem `EssenPage`).
    6. `BoBubble portrait="mini" actions={<button type="button" className="secondary" onClick={onChat}>Plan ändern</button>}>{BO_LINES.mealsChange}</BoBubble>`.
  - Ohne Plan: `HeadCard title="Essen" text={`Noch gibt es keinen Essensplan. ${NEXT_PLAN}`}` und die Kachel „Rezepte“; kein Einkauf, keine Blase.
  - `ChatSheet`: Titel „Plan ändern“, „Senden“ `primary`, Inhalt unverändert. `say` schreibt den Record wörtlich wie bisher, mit `week: shoppingWeek(weeks, now).plan.week`.
  - `openMeal(title)` in `helpers.tsx`: steht der Titel in der Region „Nächste Mahlzeit“, klickt sie dort „Rezept ansehen“, sonst die Zeilenkarte mit dem Titel.

- [ ] **Step 1: Write the failing tests** `tests/web/app/essen-start.test.tsx`:

```tsx
it('Essen: head card, the next meal large with its picture, the rest of today small, the week calm, two tiles and Bo', async () => {
  await boot({ account: 'anna', seed: [weekWith3MealsToday], now: at(today, 11, 0) });
  fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
  const head = await screen.findByRole('region', { name: 'Essen' });
  expect(within(head).getByRole('heading', { level: 1 }).textContent).toBe('Essen');
  expect(head.textContent).toContain('Das Frühstück liegt hinter dir. Als Nächstes gibt es um 13 Uhr');
  const main = screen.getByRole('region', { name: 'Nächste Mahlzeit' });
  expect(main.querySelector('svg.tk-meal.big, img.tk-meal.big')).toBeTruthy();
  expect(within(main).getByRole('button', { name: 'Rezept ansehen' }).className).toBe('primary');
  expect(screen.getByRole('button', { name: /Frühstück · 8 Uhr/ }).textContent).toContain('War heute früh dran.');
  expect(screen.getByRole('region', { name: 'Der Rest der Woche' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Rezepte/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Einkauf/ }).textContent).toMatch(/Dinge? offen|Alles ist erledigt/);
  expect(document.querySelector('.tk-bo')!.textContent).toContain('Schmeckt dir etwas nicht');
  expect(screen.queryByRole('group', { name: 'Ansicht' })).toBeNull();
  expect(screen.queryByRole('tablist', { name: 'Tag' })).toBeNull();
  expect(document.querySelectorAll('.tk-screen button:not([class])')).toHaveLength(0);
});
it('a meal with a recipe shows the photo on the main card and in the rows', async () => {
  // Mittag mit recipeId → main querySelector('img.tk-meal.big').src endet auf `/coach/recipes/${RID}/image`; Frühstück ohne Rezept → Zeile mit use '#fruehstueck'
});
it('late in the evening the main card is tomorrow’s breakfast; without one there is no main card', async () => {
  // 21:30 → Region „Nächste Mahlzeit“ enthält „Morgen · Frühstück um 8 Uhr“
  // Sonntag 22:00 ohne nächste Woche → queryByRole('region', { name: 'Nächste Mahlzeit' }) === null; Kopfkarte enthält „Für heute steht nichts mehr an. Der nächste Plan kommt am Samstagmorgen.“
});
it('a day of the week opens its three meals; a meal there opens its page', async () => {
  // Knopf /^Mi 11\./ → Dialog „Mittwoch, 11. November“ mit drei Knöpfen; Tipp auf „Tomatensuppe“ → kein Dialog, Region „Tomatensuppe“
});
it('with only next week’s plan there is no rest of the week, but Nächste Woche', async () => {
  // Seed nur nextPlan, Samstag → keine Region „Der Rest der Woche“, Region „Nächste Woche“ mit 7 Zeilen (Mo … So)
});
it('Plan ändern opens the message sheet and writes for the week Einkauf shows first', async () => {
  // Knopf „Plan ändern“ → Dialog „Plan ändern“, Feld „Nachricht an Bo“, „Senden“ primary
  // Samstag mit beiden Plänen: chat-Record body.week === NEXT; Mittwoch: body.week === laufende Woche
});
```

Bestehende Tests anpassen (nur Weg und Label, Record-Erwartungen wörtlich): `essen.test.tsx` — „today first with its meals …“: Überschrift „Heute“ → Region „Nächste Mahlzeit“, Mahlzeiten über `openMeal`. `essen-coach-integration.test.tsx`: „Änderung wünschen“ → „Plan ändern“. `meal-page.test.tsx` läuft ohne Änderung über `openMeal`.
`scripts/web-shots.ts`: `essen-tage` heißt `essen`; `essen-mahlzeit-offen` klickt in der Hauptkarte „Rezept ansehen“, dann Pille „Essen“; `essen-gericht-quelle` öffnet die zweite Zeilenkarte; `essen-wunsch` klickt „Plan ändern“.

- [ ] **Step 2: Run** `npx vitest run tests/web/app/essen-start.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** Tagesleiste, `.tk-textseg` auf der Startseite, `Segments` „Ansicht“ und `MealRow` löschen.
- [ ] **Step 4: Run** `npx vitest run tests/web` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(essen): the next meal large, the week calm, Plan ändern with Bo`.

### Task 5: Einkauf als Seite

**Files:**
- Create: `src/web/essen/ShoppingPage.tsx` (`Shopping` aus `MealsScreen.tsx` verschoben, Schreibwege unverändert)
- Modify: `src/web/MealsScreen.tsx` (`page` + `{ name: 'einkauf' }`), `src/web/web.css` (`.pm-group` und weitere unbenutzte `.pm-`-Regeln löschen), `scripts/web-shots.ts` (Einkauf-Schritte)
- Test: `tests/web/app/essen.test.tsx`

**Interfaces:**
- Consumes: `EssenPage` (Task 3); `shoppingWeek`, `shoppingSentence` (Task 2); `Card`, `Kicker` (Kit).
- Produces:
  - `ShoppingPage({ weeks, nowMs, change, onBack }: { weeks: Week[]; nowMs: number; change: MealData['change']; onBack: () => void })` in `EssenPage title="Einkauf" back={{ label: 'Essen', onClick: onBack }}`: bei zwei Plänen `.tk-textseg` „Diese Woche“/„Nächste Woche“ (Start über `shoppingWeek`), Satz `shoppingSentence(people)`, Formular „Etwas dazuschreiben“ in einer `Card`, je Gruppe `Card soft label={Gruppenname}` mit `h2.tk-section` und den bisherigen Zeilen. Jede Änderung geht über `change(<angezeigte Woche>.plan.week, f)` (wie bisher `change` der gewählten Woche). „Hinzufügen“ bleibt `secondary`.
  - Die Kachel „Einkauf“ (Task 4) öffnet `page = einkauf`.

- [ ] **Step 1: Write the failing tests** in `tests/web/app/essen.test.tsx` (bestehende anpassen, einer neu):

```tsx
it('Einkauf is a page with a back pill; Essen comes back', async () => {
  await boot({ account: 'anna', seed: [mealPlan] });
  fireEvent.click(await screen.findByRole('button', { name: 'Essen' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Einkauf/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Einkauf' })).toBeTruthy();
  expect(screen.getByText('Die Liste reicht für die ganze Woche und für zwei Personen.')).toBeTruthy();
  fireEvent.click(pill('Essen'));
  expect(await screen.findByRole('region', { name: 'Essen' })).toBeTruthy();
});
```

Anpassen: „/^Einkauf · \d+ offen$/“ → Kachel `/^Einkauf/` mit Text `/Dinge? offen/`; „für Mo–So, 2 Personen“ → der neue Satz; „from Saturday the shopping list opens on next week …“ bleibt auf der Einkauf-Seite und prüft zusätzlich, dass ein Haken dort im `state-<nächste Woche>`-Record landet; die Tests zu eigenen Dingen und „Haben wir“ laufen über die Kachel, ihre Record-Erwartungen bleiben wörtlich.
`scripts/web-shots.ts`: `essen-einkauf` klickt die Kachel `/^Einkauf/`; `essen-einkauf-haben-wir` klickt `page.getByRole('button', { name: 'Haben wir' }).first()` (Parkplatz L) statt `.pm-have`; danach Pille „Essen“.

- [ ] **Step 2: Run** `npx vitest run tests/web/app/essen.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** `Shopping` unverändert nach `ShoppingPage.tsx` verschieben, dann nur die Hülle bauen.
- [ ] **Step 4: Run** `npx vitest run tests/web` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(essen): Einkauf as a page`.

### Task 6: Rezepte und Rezept mit „In den Plan“

**Files:**
- Modify: `src/web/RecipesScreen.tsx` (`RecipesSheet` → `RecipesPage`, `RecipeView` → `RecipePage`, `PlaceSheet` → `PlaceCard`, neues `RecipeHeart`), `src/web/essen/MealPage.tsx` („Ganzes Rezept ansehen“ zeigt `RecipePage`), `src/web/MealsScreen.tsx` (`page` + `rezepte`; `AddRecipeSheet` „Hinzufügen“ `primary`), `src/web/web.css` (`.rc-hero`, `.rc-headline`, `.rc-tags`, `.rc-portions`, `.rc-place`, `.rc-daypick`, `.rc-slotpick`, `.rc-view`, `.rc-facts` löschen, sobald unbenutzt), `scripts/web-shots.ts` (Rezept-Schritte)
- Test: `tests/web/app/recipe-page.test.tsx` (neu), `tests/web/app/recipes.test.tsx`, `tests/web/app/meal-page.test.tsx`, `tests/web/app/essen.test.tsx` (Link-Rezept)

**Interfaces:**
- Consumes: `HeadCard`, `Card`, `Kicker`, `PillButton`, `RoundButton`, `ConfirmLink` (Kit); `EssenPage`, `MealImage`, `IngredientsCard`, `StepsCard` (Task 3); `placeDefault`, `placeButton`, `placedSentence`, `recipeSentence`, `eatersLine`, `SLOT_TO` (Task 2).
- Produces:
  - `Heart` (Liste) bleibt wie heute. Neu `RecipeHeart({ on, title, onToggle })`: `RoundButton icon="favorit" pressed={on} name={on ? `${title} aus den Favoriten nehmen` : `${title} zu den Favoriten`}` (Namen wie bei `Heart`), nur auf der Rezept-Seite.
  - `RecipesPage({ ctx, onBack, onAddLink }: { ctx: RecipeCtx; onBack: () => void; onAddLink?: () => void })` in `EssenPage title="Rezepte" back={{ label: 'Essen', onClick: onBack }}` (hält seinen Verlaufseintrag immer, auch während eine Rezept-Seite offen ist); `PillButton icon="plus" label="Rezept per Link"`; Suche, Chips, Liste und „Mehr anzeigen“ (`secondary`) wie heute. Mit `viewId` rendert sie statt der Liste die `RecipePage` (`backLabel="Rezepte"`); Suche, Filter und geladene Einträge bleiben im Zustand.
  - `RecipePage({ ctx, id, backLabel, onBack, onDeleted }: { ctx: RecipeCtx; id: string; backLabel: 'Rezepte' | 'Mahlzeit'; onBack: () => void; onDeleted?: () => void })` in `EssenPage back={{ label: backLabel, onClick: onBack }}` (ohne Titel; zweiter Verlaufseintrag über dem der Liste bzw. der Mahlzeit): `HeadCard picture={<MealImage recipeId={d.id} has={d.image} slot="abend" size="big" />} kicker={d.own ? 'Von dir gesammelt' : 'Aus der Sammlung'} title={d.title} text={recipeSentence(d)}` mit `children`: Stichworte als ruhige Liste `aria-label="Schlagwörter"`, `RecipeHeart`, Hinweis `placedSentence` (nur mit Treffer, `p.tk-note`); `IngredientsCard` mit Stepper (Start 2 Portionen); `StepsCard`; `PlaceCard`; `Card soft label="Mehr zu diesem Rezept"` mit `a.secondary` „Originalrezept öffnen“ (nur mit `sourceUrl`) und, bei eigenen Rezepten, `ConfirmLink` „Rezept löschen“ (Frage wie bisher). Laden und Fehler wie heute („Einen Moment …“, „Dieses Rezept ist gerade nicht zu öffnen.“) in einer `Card`.
  - `PlaceCard({ ctx, recipe }: { ctx: RecipeCtx; recipe: RecipeSummary })`: `Card label="In den Plan"`, `Kicker`, Satz „Wähle einen Tag und eine Mahlzeit. {eatersLine(names)}.“; bei zwei Plänen `.tk-textseg` „Diese Woche“/„Nächste Woche“; `div.tk-chips role="group" aria-label="Tag"` (Knöpfe „Mo 9“ …, vergangene gesperrt, `aria-pressed`), `div.tk-chips role="group" aria-label="Mahlzeit"`; darunter gedämpft „Tauscht {Gericht} aus.“ / „Noch frei.“ / „Schon eingetragen.“; `button.primary` `placeButton(...)` → `ctx.place(...)` wie bisher (gesperrt: vergangener Tag oder Antwort ausstehend); nach dem Senden `role="status"` mit `placeAnswer(...)`. Vorwahl aus `placeDefault`; ohne Plan nur der Satz „Es gibt noch keinen Essensplan, in den das Rezept passt.“ ohne Knopf.
  - `MealsScreen` `page` + `{ name: 'rezepte' }`; die Kachel öffnet sie; `AddRecipeSheet` öffnet sich über der Seite wie bisher.

- [ ] **Step 1: Write the failing tests** `tests/web/app/recipe-page.test.tsx` (Rezept-Route und `records` wie in `recipes.test.tsx`; `openRecipe(title)` = Kachel „Rezepte“, dann die Zeile):

```tsx
it('a recipe is a page: picture, sentence, heart, ingredients with portions, steps, In den Plan and Mehr', async () => {
  await openRecipe('Erfundener Topf 1');
  const head = await screen.findByRole('region', { name: 'Erfundener Topf 1' });
  expect(head.textContent).toContain('In 21 Minuten fertig');
  expect(within(head).getByRole('button', { name: 'Erfundener Topf 1 zu den Favoriten' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Eine Portion mehr' }));
  expect(screen.getByRole('region', { name: 'Zutaten' }).textContent).toContain('3 Portionen');
  expect(within(screen.getByRole('region', { name: 'In den Plan' })).getByRole('button', { name: /eintragen$/ }).className).toBe('primary');
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('without a photo the recipe page shows the drawn pan', async () => {
  // Rezept mit image: false → head querySelector('use').href === '/brand/meals.svg#abend', kein img
});
it('In den Plan preselects a day and a meal; Eintragen sends the request and waits for the answer', async () => {
  // now 18:00 → Knopf „Heute zum Abendessen eintragen“
  // Chip-Gruppe „Mahlzeit“ → „Frühstück“ → Text „Tauscht Skyr mit Beeren aus.“; Knopf „Heute zum Frühstück eintragen“ klicken
  // status „Bo trägt es gleich ein.“, Knopf disabled
  // records 'place-': genau 1, body toMatchObject({ week, meal: `${today}-fruehstueck`, recipeId: RID(1), result: null }) (wörtlich wie bisher)
});
it('after dinner time tomorrow is preselected, across the week end', async () => {
  // Sonntag 21:30 mit nextPlan → Knopf „Am Montag zum Abendessen eintragen“, Knopf „Nächste Woche“ aria-pressed true
});
it('without a plan the card says so and has no main button', async () => {
  // Seed ohne week-Records → Region „In den Plan“ enthält „Es gibt noch keinen Essensplan, in den das Rezept passt.“; within(region).queryByRole('button', { name: /eintragen$/ }) === null
});
it('a recipe already in the plan says where in the head card', async () => {
  // Plan mit dish.recipeId = RID(1) heute mittags → Kopfkarte enthält „Steht schon im Plan: heute, {Wochentag}, zum Mittagessen.“
});
it('Back from a recipe returns to the list with its search; Back again to Essen', async () => {
  // Suche „Topf“ → Rezept → pill('Rezepte') → Feld „Rezept suchen“ hat Wert „Topf“, Liste da
  // history.back() von der Rezept-Seite wirkt genauso; dann pill('Essen') → Region „Essen“
});
```

In `meal-page.test.tsx` erwartet „… leads to the whole recipe“ jetzt die Rezept-Seite (Region mit dem Rezepttitel, Pille „Mahlzeit“ führt zurück zur Mahlzeit). Bestehende Tests anpassen: `recipes.test.tsx` öffnet Rezepte über die Kachel `/^Rezepte/`; „In den Plan ›“ fällt weg (die Karte steht auf der Seite), „Eintragen“ → Knopf `/eintragen$/`, „Tag“-Gruppe und Erwartungen an `place-` bleiben; „opens the recipe: picture, facts, tags …“ prüft den Satz statt „21 Min ·“; „the heart in the recipe view …“ über den runden Knopf; die Listen-Herz-Tests bleiben unverändert; „+ Rezept per Link“ → „Rezept per Link“ in `essen.test.tsx`. `scripts/web-shots.ts`: Rezepte über die Kachel, `.rc-open` bleibt, „In den Plan ›“ fällt weg (Aufnahme `essen-rezept-in-den-plan` scrollt zur Region „In den Plan“), „+ Rezept per Link“ → „Rezept per Link“, Zurück über die Pillen statt Escape.

- [ ] **Step 2: Run** `npx vitest run tests/web/app/recipe-page.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/web tests/tracking/control-roles.test.tsx` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(essen): recipes as pages, In den Plan as a card with a preselected day`.

### Task 7: Profil

**Files:**
- Modify: `src/web/app/Profil.tsx`, `src/web/ConnectionSettings.tsx` (`ProfileGroup` wird Karte mit `h2`-Kicker, Zeilen mit Icon, Rezeptsammlung ins Sheet, `withHint` löschen, `bikeLine`), `src/web/ContactSettings.tsx` (Icons, „noch keine“), `src/web/app/Push.tsx` (Icon, `PushCard` „Einschalten“ `primary`), `src/tracking/ui/RunSettingsCard.tsx` (nur `icon="lauf"`), `src/tracking/ui/CoachPrefs.tsx` (nur Abschnittsname), `src/tracking/ui/tracking.css` und `src/web/web.css` (alle `.tk-pgroup`-Regeln löschen, auch `web.css:217-218` und der Teil in der Media-Regel `web.css:235`)
- Test: `tests/web/app/profil.test.tsx` (neu), `tests/web/app/shell.test.tsx`, `tests/web/connection-settings.test.tsx`, `tests/web/push-ui.test.tsx`

**Interfaces:**
- Consumes: `HeadCard`, `Card`, `Kicker heading`, `Row` mit `icon`/`hint`, `Switch` mit `icon`, `Segments`, `Sheet` (Kit).
- Produces:
  - `syncText`: letzter Fall „Alles ist gesichert.“ (sonst unverändert); `quiet` prüft diesen Satz.
  - `ProfileGroup({ title, children })`: `<Card label={title}><Kicker heading>{title}</Kicker>{children}</Card>`.
  - `bikeLine(hasBike: boolean): string` in `ConnectionSettings.tsx` → „Rad fährst du am Mac.“ / „Rad geht mit der ersten Fahrt am Mac los.“; `planLine(gymOn: boolean, hasBike: boolean): string` → `gymOn` ? „Dein Krafttraining wird immer geplant. “ + `bikeLine` : `bikeLine`. Die eine Stelle für diese Sätze.
  - `ConnectionSettings({ link, plan, hasBike })`: neu `hasBike: boolean`. „Was Pandafit für dich plant“ = `plan` (Laufen), dann mit Ansicht: `Switch icon="essen" label="Essensplan" hint="Ein Wochenplan mit Einkaufsliste."`, mit `meals.on` `Row icon="blatt" title="Essen anpassen" hint="Vorlieben, Abneigungen und Unverträglichkeiten." onClick`, dann ohne `gymOn` `Switch icon="kraft" label="Krafttraining planen" hint="Auch ohne Hevy."`, dann `Row icon="kraft" title={planLine(gymOn, hasBike)}` ohne `onClick` (in einer `RowList`). Ohne Ansicht nur `plan` und `Row icon="ausdauer" title={bikeLine(hasBike)}`. „Verbindungen“ nur mit Ansicht: `Row icon="kraft" title="Hevy" hint="Krafttrainings übernehmen"` und `Row icon="uhr" title="Garmin" hint="Ruhepuls und Läufe übernehmen"` (Werte wie heute). `MealsSheet` zeigt unten `collectionLine(v.recipes)` (nur mit `v.recipes`); Sheet-Inhalt sonst unverändert.
  - `Profil`: `<h1 className="tk-sr">Profil</h1>`; `HeadCard icon="profil" level={2} title={account} text={sync}` (mit `role="status"`, wenn nicht ruhig); `ConnectionSettings hasBike={hasBike}`; `ProfileGroup title="Nachrichten"`: `ContactSettings`, `PushSettings`, und unter derselben Bedingung wie heute (`!push || push.on`) `Row icon="laterne" title="Wann sich der Sensai meldet" hint="Wochengespräch und Gruß am Vorabend." onClick` → `Sheet title="Wann sich der Sensai meldet"` mit `CoachPrefs nested`; `ProfileGroup title="Darstellung"` wie heute; dann `button.secondary` „Abmelden“ (`tk-wide`), die Nachfrage wie heute (`secondary` „Trotzdem abmelden“, `link` „Doch nicht“).
  - `ContactSettings`: `Switch icon="brief"`, `Row icon="brief" title="E-Mail" value={contact.email ?? 'noch keine'}`. `PushSettings`: `Switch icon="glocke"`, der Hinweis bleibt wörtlich (`push-ui.test.tsx` prüft ihn). `CoachPrefs`: `aria-label` „Wann sich der Sensai meldet“ statt „Wann sich Bo meldet“.
  - `RunSettingsCard`: `Switch icon="lauf"`, sonst unverändert.
  - Region-Namen und `h2` der Karten: „Was Pandafit für dich plant“, „Verbindungen“, „Nachrichten“, „Darstellung“.

- [ ] **Step 1: Write the failing tests** `tests/web/app/profil.test.tsx`:

```tsx
it('Profil: head card with the name and the save sentence, then four cards with h2 names, no Gesundheit, Abmelden at the bottom', async () => {
  await boot({ account: 'anna', seed: [] /* mit Verbindung: coach-state wie in connection-settings.test */ });
  fireEvent.click(await screen.findByRole('button', { name: 'Profil' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Profil' }).className).toBe('tk-sr');
  const head = await screen.findByRole('region', { name: 'anna' });
  expect(head.textContent).toMatch(/Alles ist gesichert\.|Der erste Abgleich folgt gleich\./);
  const groups = ['Was Pandafit für dich plant', 'Verbindungen', 'Nachrichten', 'Darstellung'];
  for (const g of groups) expect(within(screen.getByRole('region', { name: g })).getByRole('heading', { level: 2, name: g })).toBeTruthy();
  expect(document.body.textContent).not.toContain('Gesundheit');
  expect(screen.getByRole('button', { name: 'Abmelden' }).className).toContain('secondary');
  expect(document.querySelectorAll('.tk-screen button:not([class])')).toHaveLength(0);
});
it('without a coach on the server there is no Verbindungen card; Laufen and Darstellung still work', async () => {
  // boot ohne Verbindung → queryByRole('region', { name: 'Verbindungen' }) === null
  // Schalter „Laufen planen“ → settings-Record wie bisher (on: true); Text „Rad geht mit der ersten Fahrt am Mac los.“ steht
  // Darstellung „Hell“ → aria-pressed true
});
it('Wann sich der Sensai meldet is a row that opens the timing in a sheet', async () => {
  // Row → Dialog „Wann sich der Sensai meldet“ mit Schalter „Wochengespräch“; Schalter → coachprefs-Record week.on true
});
it('the e-mail row says noch keine, and the weekly switch waits for an address', async () => {
  // Knopf /E-Mail/ enthält „noch keine“; Schalter „Wochenübersicht per E-Mail“ disabled; Text „Trag zuerst deine E-Mail ein.“
});
```

Anpassen: `tests/web/app/shell.test.tsx:248-252` — „Rad · Es geht mit der ersten Fahrt am Mac los.“ → „Rad geht mit der ersten Fahrt am Mac los.“, die Reihenfolge prüft `h2` „Was Pandafit für dich plant“ vor „Nachrichten“. `tests/web/connection-settings.test.tsx`: `ConnectionSettings` bekommt `hasBike={false}`; „Rezeptsammlung …“ öffnet zuerst „Essen anpassen“ und erwartet die Zeilen im Sheet (Werte wörtlich); „Auch ohne Hevy“ → „Auch ohne Hevy.“. `tests/web/push-ui.test.tsx`: „Einschalten“ ist `primary`; Erwartungen an die Abos bleiben.

- [ ] **Step 2: Run** `npx vitest run tests/web/app/profil.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run tests/web` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(profil): head card and four calm cards`.

### Task 8: „Morgen“ auf Heute führt zum Training

**Files:**
- Create: `src/web/today/tomorrow.ts`
- Modify: `src/web/app/Heute.tsx` (nur der `onClick` der Morgen-Karte)
- Test: `tests/web/tomorrow.test.ts` (neu), `tests/web/heute-day.test.tsx`

**Interfaces:**
- Consumes: `PlanDay` aus `src/shared/week-plan`; `p` (`readPlan` des `plan/current`), `goBike`, `goRun` (alles schon in `Heute`).
- Produces:
  - `export type TomorrowTarget = 'plan' | 'kraft' | 'rad' | 'lauf' | 'tag'`.
  - `tomorrowTarget({ tomorrow, planWorkout, canBike, canRun }: { tomorrow: PlanDay; planWorkout: boolean; canBike: boolean; canRun: boolean }): TomorrowTarget` (Entscheidung 16): nach `tomorrow.sport`: `gym` → `planWorkout ? 'plan' : 'kraft'`; `bike` → `canBike ? 'rad' : 'tag'`; `run` → `canRun ? 'lauf' : 'tag'`; sonst `'tag'`.
  - In `Heute`: `tomorrowTarget({ tomorrow: tomorrowPlan, planWorkout: !!p?.workout, canBike: !!goBike, canRun: !!goRun })`; die Morgen-Karte ruft je nach Ziel `goTraining('plan')`, `goTraining()`, `goBike!()`, `goRun!()` oder wie bisher `setSheetDate(tomorrow)`. Aussehen und Text der Karte bleiben.

- [ ] **Step 1: Write the failing tests.** `tests/web/tomorrow.test.ts`:

```ts
const day = (sport: Sport, also?: AlsoPart): PlanDay => ({ date: '2026-11-13', sport, hardness: 'moderate', fixed: false, ...(also ? { also } : {}) });
const base = { planWorkout: true, canBike: true, canRun: true };
it('a strength day tomorrow opens Nächstes Training; only without a plan workout the Kraft page', () => {
  expect(tomorrowTarget({ ...base, tomorrow: day('gym') })).toBe('plan');
  expect(tomorrowTarget({ ...base, tomorrow: day('gym', { sport: 'bike', hardness: 'easy' }) })).toBe('plan');
  expect(tomorrowTarget({ ...base, tomorrow: day('gym'), planWorkout: false })).toBe('kraft');
});
it('bike and run go to Ausdauer when there is a way; otherwise and on rest the day sheet', () => {
  expect(tomorrowTarget({ ...base, tomorrow: day('bike') })).toBe('rad');
  expect(tomorrowTarget({ ...base, tomorrow: day('run') })).toBe('lauf');
  expect(tomorrowTarget({ ...base, tomorrow: day('bike'), canBike: false })).toBe('tag');
  expect(tomorrowTarget({ ...base, tomorrow: day('rest') })).toBe('tag');
  expect(tomorrowTarget({ ...base, tomorrow: day('mobility') })).toBe('tag');
});
```

In `tests/web/heute-day.test.tsx` den Test „tomorrow is one row card that opens the day sheet …“ aufteilen (Seeds wie dort, `weekplan({...})`, `TOMORROW` als Datum):

```tsx
it('Morgen with strength opens Nächstes Training in Kraft directly, without the day sheet', async () => {
  await boot([weekplan({ [TOMORROW]: 'gym' }), planRecord]);
  fireEvent.click(await screen.findByRole('button', { name: /^Morgen/ }));
  expect(await screen.findByRole('dialog', { name: 'Nächstes Training' })).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)/ })).toBeNull();
});
it('Morgen with strength but no plan workout opens the Kraft page', async () => {
  await boot([weekplan({ [TOMORROW]: 'gym' })]);
  fireEvent.click(await screen.findByRole('button', { name: /^Morgen/ }));
  expect(await screen.findByRole('region', { name: 'Kraft · diese Woche' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('Morgen with a ride opens Ausdauer on Rad', async () => {
  // weekplan morgen bike + bike-Record mit next → Klick → Region „Rad · diese Woche“, kein Dialog
});
it('Morgen with a run opens Ausdauer on Laufen', async () => {
  // weekplan morgen run + run-settings on → Klick → Region „Laufen · diese Woche“, kein Dialog
});
it('Morgen as a rest day still opens the day sheet; Spontan and no plan keep no card', async () => {
  // Ruhetag → Klick → Dialog mit dem Wochentag von morgen; die beiden Fälle ohne Karte aus dem alten Test bleiben wörtlich
});
```

- [ ] **Step 2: Run** `npx vitest run tests/web/tomorrow.test.ts tests/web/heute-day.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `tomorrow.ts` und den einen `onClick` in `Heute.tsx`.
- [ ] **Step 4: Run** die Tests, dann `npx vitest run tests/web` und `npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(heute): Morgen leads to the training itself`.

### Task 9: Abschluss

- [ ] **Step 1:** `npm run typecheck`, `rtk proxy npm run lint` (0 Fehler, höchstens 52 Warnungen), `npm test` — Expected: alles grün. `grep -rn "MealDetail\|MealThumb\|PlaceSheet\|RecipesSheet\|RecipeView\|withHint\|tk-pgroup\|Änderung wünschen\|In den Plan ›\|Rezept ansehen ›\|+ Rezept per Link\|pm-days\|label=\"Ansicht\"" src/web src/tracking/ui scripts tests/web` — Expected: keine Treffer. `npx vitest run tests/web/sensai-wording.test.ts` — Expected: PASS. `git diff main --stat -- src/main src/ui src/service src/shared src/coach src/tracking/session.ts src/tracking/store.ts src/tracking/registry.ts src/tracking/plan-draft.ts src/tracking/workout-change.ts src/tracking/studios.ts` — Expected: leer.
- [ ] **Step 2:** Sichtprüfung: `npm run build:web`, dann `/private/tmp/claude-501/-Users-sbinder-Projects-bike-coach/76e854cd-52f8-4db9-8605-4ff1597ea055/scratchpad/vis3/shoot.cjs` nach `/private/tmp/claude-501/-Users-sbinder-Projects-bike-coach/76e854cd-52f8-4db9-8605-4ff1597ea055/scratchpad/vis7/shoot.cjs` kopieren (`/bin/cp`), `R` auf diesen Worktree setzen und die Records um einen Essensplan dieser Woche (drei Mahlzeiten pro Tag, ein Rest, ein Gericht mit `recipeId` und Foto, eines mit `recipeId` ohne Foto, eines mit `sourceUrl`, eines mit `askedBy`), den Plan der nächsten Woche, einen `state-`Record mit einem Haken, zwei Herzen, eine `place-`Antwort und einen `contact`-Record ohne E-Mail ergänzen; Rezepte über eine kleine Route wie in `recipes.test.tsx`. Aufnahmen bei 390 px und 1200 px, dunkel und hell: Essen (Vormittag und nach 21 Uhr), Tag-Sheet, Mahlzeit-Seite mit Foto und mit Zeichnung, „Wer isst mit?“, Einkauf, Rezepte, Rezept mit „In den Plan“, Plan ändern, Profil mit und ohne Verbindung, Heute mit Morgen-Karte. Mit `docs/design/moodboard/{essen,rezept,profil}.html` vergleichen: Fotos und Zeichnungen gleich groß, Zeichnungen hell lesbar (Schatten, Dampf), Kopfkarten, Kacheln, Bos Blase, Karte „In den Plan“, Profil-Karten mit Icon-Kacheln. Abweichungen nur über Tokens in `tokens.css` oder den Kit-Block beheben; was die Abnahme nicht betrifft, in den Parkplatz.
- [ ] **Step 3:** `npm run test:web-smoke` — Expected: alle Schritte grün; läuft kein Testserver, im Bericht sagen, dass der Smoke nicht lief.
- [ ] **Step 4:** Roadmap: Zeile Dojo 4 auf ✅; im Abschnitt „Dojo — Briefs“ den Verweis auf diesen Plan ergänzen (wie bei Dojo 1–3). Parkplatz: Dojo-1-Punkt „Hauptknöpfe ohne `class="primary"`“ durchstreichen mit „Erledigt mit Dojo 4“; „Shot-Werkzeug erreicht ‚Haben wir‘ …“ (L) durchstreichen mit „Erledigt mit Dojo 4“; „Browser-Zurück in verschachtelten Sheets …“ (X) ergänzen um „Für Essen erledigt mit Dojo 4 (Seiten statt Sheets); offen für Kraft und Woche.“ Neu: „Ein gemeinsamer Kit-Rahmen `SubPage` für Unterseiten (heute `SubPage` in `Training.tsx` und `EssenPage` in `src/web/essen/`).“, „Tippt man auf den Tab, während eine Unterseite offen ist (Mahlzeit von Heute, Kraft-Unterseiten), bleibt die Unterseite stehen.“ und „‚Essen heute‘ auf Heute zeigt noch das Icon statt des Bilds.“ Plan nach `docs/archive/plans/` verschieben (`git mv docs/superpowers/plans/2026-11-09-dojo-4-essen-profil.md docs/archive/plans/`).
- [ ] **Step 5: Commit** `docs: Dojo 4 done`.
