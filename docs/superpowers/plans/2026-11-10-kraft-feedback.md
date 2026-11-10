# Kraft-Feedback vom 10.11. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Training vom 10.11. und der Chat zeigen vier Schwächen: Gewichte ignorieren die Reihenfolge, der Coach plant dieselbe Ausführung doppelt, „Trag das als Regel ein“ übernimmt keine Regel, und die Übungsansicht versteckt Bearbeiten hinter „Mehr“. Dieser Plan behebt alle vier.

**Architecture:** Teil A ändert nur die Trainings-UI (`src/tracking/ui/workout/**`, `ExerciseInfo`). Teil B ändert den Gym-Coach: eine Vorermüdung pro Übung fließt in `suggestNext` und in die Guardrails, eine neue Prüfung verbietet dieselbe Ausführung zweimal. Teil C lässt den Chat einen offenen Regelvorschlag auf ausdrücklichen Wunsch übernehmen.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

**Spec:** Notizen des Nutzers vom 10.11. und die Analyse in diesem Plan (Abschnitt „Befund“). Grundregeln: `CLAUDE.md`, `docs/roadmap.md` (Vorschlag, Bestätigen, Rückgängig), `docs/gym-foundations.md`.

## Befund (Training 6164fb4c, Chat vom 10.11.)

- Schrägbankdrücken Multipresse: geplant 40 kg (aus Trainings, in denen sie Übung 1 oder 2 war), gemacht 30 kg × 8/10/10 als Übung 4 nach Brustpresse (4 Sätze) und Schulterpresse. Kabel-Crossover danach 9/7/8 statt 10/9/8.
- Brust heute: 10 direkte harte Sätze in einer Einheit.
- 05.11.: „Trizepsdrücken am Kabel“ und „Trizepsdrücken mit Seil“ im selben Training, dazu zwei Rudervarianten. Heute wurde eine Drückvariante gegen Überkopf getauscht.
- Chat: Der Coach legt eine Regel als Entwurf an. „Trag das als Regel ein“ legt nur einen zweiten Entwurf an. Es gibt keine aktive Regel. Der nächste Plan legt 85 Min Beine auf Donnerstag.
- Ausblick nennt Übungen mit Hevy-Namen („Decline Crunch (Weighted)“ statt „Crunch an der Negativbank mit Gewicht“, „Hip Thrust (Langhantel)“ statt „Hip Thrust“). Nicht in diesem Plan, siehe Parkplatz.
- Crossover Satz 3 trägt `repRange` 6–12, Satz 1–2 tragen 8–12. Nicht in diesem Plan, siehe Parkplatz.

## Global Constraints

- UI-Texte: ganze deutsche Sätze, keine Fragmente mit Gedankenstrich; Bo heißt „Sensai“.
- Grenzwerte stehen nur im Regelregister `src/shared/training-policy/rules.ts` (ids `gym.*`), `src/coach/gym/limits.ts` liest sie nur.
- Der Coach ändert nichts still: jede Übernahme zeigt „Rückgängig“.
- Keine persönlichen Daten oder Beispiele des Nutzers im Produktcode; konkrete Titel nur in Tests.
- Jeder Task ist ein eigener Commit. Branch `kraft-feedback`, danach lokal in `main` mergen, nicht pushen.

## Review Focus

1. Eine Übung ohne Muskeldaten (Hevy-Titel ohne Katalogtreffer): Vorermüdung ist 0, nichts bricht. Test in Task 5.
2. Nur Verlauf mit anderer Position (z. B. immer frisch, heute müde): kein Fortschrittssprung, Gewicht geht anteilig zurück. Test in Task 5.
3. Superset aus zwei Übungen für denselben Muskel: die zweite zählt die Sätze der ersten als Vorermüdung. Test in Task 5.
4. „Ja“ im Chat ohne offenen Regelentwurf: nichts wird übernommen. Test in Task 7.
5. Bestätigter Satz im immer offenen Bearbeiten: Entfernen fragt weiterhin nach. Test in Task 2.

---

## Teil A: Trainings-UI

### Task 1: Anleitung ohne „mehr“

**Files:**
- Modify: `src/tracking/ui/ExerciseInfo.tsx:21-28`
- Test: `tests/tracking/exercise-info.test.tsx`

- [ ] **Step 1: Test anpassen.** `it('zeigt die ganze Anleitung ohne mehr-Knopf')`: lange Beschreibung rendern; erwarte den ganzen Text und `queryByRole('button', { name: 'mehr' })` ist `null`. Bestehende Tests zu „mehr“/„weniger“ löschen.
- [ ] **Step 2:** `npx vitest run tests/tracking/exercise-info.test.tsx` → FAIL.
- [ ] **Step 3:** Clamp, `open`-State und Knopf entfernen; Kommentar anpassen. CSS-Klasse `tk-clamp` löschen, wenn sie sonst niemand nutzt (`grep -rn tk-clamp src`).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** `git commit -m "feat(kraft): Anleitung immer ganz"`

### Task 2: Sätze immer bearbeitbar

Ein Tipp auf einen Satzpunkt öffnet die Satztabelle immer im Bearbeiten-Modus (Werte, Haken, ×).

**Files:**
- Modify: `src/tracking/ui/workout/SetsSheet.tsx`, `src/tracking/ui/workout/useActiveWorkout.ts` (State `editing` entfernen), `src/tracking/ui/workout/ExerciseMenu.tsx` (Eintrag „Sätze bearbeiten“ entfernen)
- Test: `tests/tracking/live-focus.test.tsx`

- [ ] **Step 1: Tests.** `it('öffnet die Sätze beim Tipp auf einen Satzpunkt bearbeitbar')`: Tipp auf einen MarkDot; erwarte Knopf `Satz 1 entfernen`. `it('fragt beim Entfernen eines erledigten Satzes nach')`: Satz bestätigen, × tippen; erwarte die Rückfrage, der Satz bleibt.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** `SetsSheet` rendert `SetHead`/`SetRow` mit `editing` fest auf `true`. `ui.editing` und alle Verwendungen entfernen (`grep -rn "editing" src/tracking/ui/workout`).
- [ ] **Step 4:** `npx vitest run tests/tracking` → PASS.
- [ ] **Step 5:** `git commit -m "feat(kraft): Sätze immer bearbeitbar"`

### Task 3: „+“ für einen Satz direkt an der Übung

**Files:**
- Modify: `src/tracking/ui/workout/FocusCard.tsx:58-61`, `src/tracking/ui/workout/SetsSheet.tsx`
- Test: `tests/tracking/live-focus.test.tsx`

- [ ] **Step 1: Test.** `it('hängt mit plus einen Satz an')`: Knopf mit Namen `Satz hinzufügen ${title}` in der Punktreihe tippen; erwarte einen Satzpunkt mehr. Gleicher Test für den Knopf am Ende der Satztabelle.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** Nach den MarkDots einen runden „+“-Knopf (gleiche Größe wie MarkDot, `aria-label="Satz hinzufügen ${e.title}"`), Aktion `act((x) => addSet(x, e.rid))` mit `a.tapOnce('add')`. In `SetsSheet` unter der letzten Zeile denselben Knopf als Textknopf „Satz hinzufügen“.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** `git commit -m "feat(kraft): Satz mit plus anhängen"`

### Task 4: Übungsmenü ohne „Mehr“

**Files:**
- Modify: `src/tracking/ui/workout/ExerciseMenu.tsx`, `src/tracking/ui/workout/useActiveWorkout.ts` (State `menuMore` entfernen), `src/tracking/ui/workout/FocusCard.tsx:64`
- Test: `tests/tracking/live-workout.test.tsx`

- [ ] **Step 1: Test.** `it('zeigt alle Aktionen einer Übung in einer Liste')`: Menü öffnen; erwarte direkt „Tauschen“, „Pause ändern“, „Reihenfolge ändern“, „Entfernen“; `queryByRole('button', { name: /^Mehr$/ })` ist `null`; „Satz hinzufügen“ fehlt im Menü (das macht jetzt „+“).
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** Eine Liste in dieser Reihenfolge: Notiz, Tauschen, Pause ändern, Aufwärmen hinzufügen, Supersatz mit, Aus Superset lösen, Reihenfolge ändern; darunter der Link „Entfernen“. Der Menü-Knopf in `FocusCard` heißt `Menü ${e.title}` statt `Mehr zu …`. Bestehende Tests, die „Mehr“ suchen, anpassen (`grep -rln "Mehr zu\|Sätze bearbeiten" tests`).
- [ ] **Step 4:** `npx vitest run tests/tracking tests/web` → PASS.
- [ ] **Step 5:** `git commit -m "feat(kraft): Übungsmenü in einer Liste"`

## Teil B: Planung

### Task 5: Vorermüdung in der Lastwahl

**Files:**
- Create: `src/coach/gym/pre-fatigue.ts`
- Modify: `src/coach/gym/history.ts` (`sessionsOf`, `suggestNext`), `src/coach/gym/guardrails.ts` (`checkWorkout`/`checkExercise`), `src/coach/gym/prompt.ts`, `src/shared/training-policy/rules.ts`, `src/coach/gym/limits.ts`
- Test: `tests/coach/gym/pre-fatigue.test.ts`, `tests/coach/gym/history.test.ts`, `tests/coach/gym/guardrails.test.ts`

**Interfaces:**
- Produces: `preFatigue(exercises: { primaryMuscle: string | null | undefined; hardSets: number; supersetId: number | null }[]): number[]` — pro Übung die harten Sätze (normal, failure, dropset) aller früheren Übungen derselben `muscleGroupOf`-Gruppe; ohne Muskel 0. In einem Superset zählen die Sätze des Partners, wenn er davor steht.
- Produces: `suggestNext(templateId, workouts, nowMs, ex?, plan?, preSets = 0): Suggestion` — neuer letzter Parameter.
- Produces: `REASONS['other-position']` = „weil die Übung diesmal an anderer Stelle im Training steht“.

**Regeln (Register, Kategorie Lastauswahl, Status `product`, mit Hinweis „eigene Wahl, später pro Person lernen“):**
- `gym.pre-fatigue-tolerance` = 2 Sätze: Verlauf mit |Δ Vorermüdung| ≤ 2 ist vergleichbar.
- `gym.pre-fatigue-share-per-set` = 0,03, `gym.pre-fatigue-share-min` = 0,75: Anteil = max(0,75; 1 − 0,03 × Δ).

- [ ] **Step 1: Tests `pre-fatigue.test.ts`.** Brustpresse 4 Sätze, Schulterpresse 3, Schrägbank → `[0, 0, 4]` (Schulter ist eine andere Gruppe). Unbekannter Muskel → 0. Superset Brust A + Brust B → B bekommt die Sätze von A.
- [ ] **Step 2: Tests `history.test.ts`.**
  - `it('nimmt nur Verlauf mit ähnlicher Vorermüdung')`: zwei Trainings mit Schrägbank frisch bei 40 kg; Aufruf mit `preSets = 4` → `weightKg` = `snapDown(40 × 0,88)` auf der Leiter, `why: 'keep'`, Grund `other-position`.
  - `it('springt nicht hoch, wenn der Verlauf nur müde war')`: Verlauf nur mit Vorermüdung 6, Aufruf mit 0 → letztes Gewicht, `why: 'keep'`.
  - `it('verhält sich ohne preSets wie bisher')`: alle bestehenden Tests unverändert grün.
- [ ] **Step 3: Test `guardrails.test.ts`.** `it('kappt die Last nach der Stelle im Training')`: KI-Antwort plant Schrägbank als dritte Brustübung mit 40 kg → das geprüfte Training hat ≤ dem Vorschlag aus Step 2.
- [ ] **Step 4:** Tests → FAIL.
- [ ] **Step 5: Implementieren.**
  - `occurrences`/`sessionsOf` speichern pro Vorkommen `preSets` (aus der Reihenfolge des Trainings mit `preFatigue`, Muskel über Template/Katalog wie in `muscle-volume.ts`).
  - `suggestNext` filtert `sessions` auf vergleichbare. Gibt es keine, aber andere: `last` = jüngste beliebige Sitzung, Gewicht = `snapDown(kg × Anteil)`, nur wenn heutige Vorermüdung höher ist; sonst letztes Gewicht. Beides `keep`, `other-position`.
  - `checkWorkout` berechnet `preFatigue` über die geparsten Übungen und reicht den Wert an die Stelle durch, die `suggestNext` für `weightCap` aufruft.
  - `prompt.ts`: ein Satz: „Die wichtigste Übung eines Muskels steht vorn; spätere Übungen für denselben Muskel sind schwächer, die App senkt ihre Last selbst.“
- [ ] **Step 6:** `npx vitest run tests/coach/gym tests/shared` → PASS. `npm run typecheck` → ohne Fehler.
- [ ] **Step 7:** `git commit -m "feat(gym): Last folgt der Stelle im Training"`

### Task 6: Dieselbe Ausführung nicht zweimal

**Files:**
- Create: `src/shared/execution.ts`
- Modify: `src/coach/gym/guardrails.ts`, `src/coach/gym/guardrails.ts` (`reasonPhrase`-Tabelle), `src/coach/gym/prompt.ts`, `src/shared/training-policy/rules.ts`
- Test: `tests/shared/execution.test.ts`, `tests/coach/gym/guardrails.test.ts`, `tests/coach/gym/guardrails-phrase.test.ts`

**Interfaces:**
- Produces: `executionKey(e: { title: string; family?: string; primaryMuscle?: string | null }): string | null` — `familyOf(e)` + Muskel + Titelstamm ohne Gerätewörter; `null` für Familie `other`.
- Gerätewörter (eine Liste in `execution.ts`): Klammerteil, „mit Seil“, „mit Stange“, „mit SZ-Stange“, „am Kabel“, „am Kabelzug“, „an der Maschine“, „an der Multipresse“, „mit Kurzhanteln“, „mit Langhantel“, „einarmig“.

- [ ] **Step 1: Tests `execution.test.ts`** (Katalogeinträge aus `src/shared` per id laden, nicht nachbauen):
  - Trizepsdrücken mit Seil = Trizepsdrücken am Kabel → gleicher Schlüssel.
  - Trizepsdrücken mit Seil ≠ Trizepsstrecken über Kopf am Kabel.
  - Crunch am Kabel ≠ Crunch an der Negativbank mit Gewicht.
  - Scott-Curl ≠ Curl hinter dem Rücken am Kabel.
  - Familie `other` → `null`.
- [ ] **Step 2: Test `guardrails.test.ts`.** `it('lehnt dieselbe Ausführung zweimal ab')`: Plan mit Seil- und Stangen-Drücken → `{ ok: false, reason: 'dieselbe Ausführung doppelt' }`. Ein Plan mit Seil-Drücken und Überkopf-Strecken → ok. `reasonPhrase('dieselbe Ausführung doppelt')` liefert einen ganzen Satz.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** In `checkWorkout` nach der Ausschluss-Prüfung: Schlüssel pro Übung über den Katalogeintrag (gleiche Auflösung wie `isExcluded`); doppelter Schlüssel ≠ `null` → `no('dieselbe Ausführung doppelt')`. Regel `gym.one-per-execution` (Wert 1, Kategorie Übungsauswahl). `prompt.ts`: „Pro Training jede Ausführung nur einmal; andere Winkel desselben Muskels (z. B. über Kopf statt Drücken) sind erlaubt.“ Ein Tausch durch die Person bleibt erlaubt; nur der Coach-Plan wird geprüft.
- [ ] **Step 5:** `npx vitest run tests/shared tests/coach/gym` → PASS. Stichprobe: alle eigenen Katalogeinträge mit Familie `triceps`, `row`, `curl`, `core` durch `executionKey` schicken und die Gruppen ansehen; offensichtlich falsche Gruppen über die Gerätewort-Liste korrigieren.
- [ ] **Step 6:** `git commit -m "feat(gym): keine doppelte Ausführung im Plan"`

## Teil C: Chat

### Task 7: „Trag das ein“ übernimmt den offenen Regelentwurf

**Files:**
- Modify: `src/coach/chat/chat-coach.ts` (Schemas um Zeile 83–125, Prompt um Zeile 57, Verarbeitung um Zeile 172–205)
- Test: `tests/coach/chat/chat-coach.test.ts`

**Interfaces:**
- Consumes: `moveRule(rec, 'active', nowMs)` und `ruleRecord` aus dem Regelmodul (gleicher Weg wie `RuleCard.go`).
- Produces: Antwortfeld `acceptsRule: boolean` in beiden Schemas (required).

- [ ] **Step 1: Tests.**
  - `it('übernimmt den offenen Entwurf auf ausdrücklichen Wunsch')`: Verlauf mit Coach-Nachricht + Regelentwurf (`kind: 'wish'`, Status Entwurf); Person: „Trag das als Regel ein“; KI-Stub antwortet `acceptsRule: true, ruleDraft: null` → Regel ist aktiv, kein zweiter Entwurf, Antwort trägt `rule` (die Karte zeigt „Rückgängig“).
  - `it('übernimmt nichts ohne offenen Entwurf')`: `acceptsRule: true` ohne Entwurf → keine Regel ändert sich.
  - `it('übernimmt Ziele nie aus dem Chat')`: offener Entwurf `kind: 'goal'` → bleibt Entwurf, Antwort verweist auf „Übernehmen“.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Prompt: „Bestätigt die Person einen offenen Regelentwurf ausdrücklich (‚trag ein‘, ‚ja, übernehmen‘), setze acceptsRule true und ruleDraft null.“ Verarbeitung: offener Entwurf = Regel im Entwurfsstatus aus der direkt vorigen Coach-Nachricht. Bei `acceptsRule` und `kind` ≠ `goal`: `moveRule(..., 'active')`, Nachricht mit `rule: id`. Sonst `acceptsRule` ignorieren.
- [ ] **Step 4:** `npx vitest run tests/coach/chat` → PASS.
- [ ] **Step 5:** `git commit -m "feat(chat): ausdrückliche Bestätigung übernimmt die Regel"`

### Task 8: Abschluss

- [ ] `npm run typecheck`, `npx vitest run` → alles grün.
- [ ] `npm run dev:sim` bzw. Web-App lokal: Training starten, Satzpunkt tippen, „+“, Menü, Anleitung ansehen.
- [ ] `docs/roadmap.md`: Zeile „Kraft-Feedback 10.11.“ auf ✅; Parkplatz-Punkte unten eintragen.
- [ ] Merge in `main`.

## Parkplatz (nicht in diesem Plan)

- Wochentage als feste Einstellung (Freitag gut, Wochenende lang, Montag kurz) statt freier Wunsch-Regel; prüfen, ob der Planer `wish`-Regeln für Tage überhaupt liest.
- Ausblick nutzt Hevy-Titel statt der eigenen Übungsnamen.
- `repRange` je Satz einer Übung uneinheitlich (Crossover 8–12 und 6–12).
- Nach „Reihenfolge ändern“ im laufenden Training die Vorschläge neu berechnen.
- Vorermüdungs-Anteil pro Person aus eigenen Daten lernen, sobald genug Paare frisch/müde da sind.
