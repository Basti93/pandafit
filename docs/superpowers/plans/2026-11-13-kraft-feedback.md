# Kraft-Feedback vom 13.11. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Training vom 13.11. zeigt neun Schwächen: Aufwärmsätze haben falsche Pausen, „Satz geschafft“ fühlt sich nach nichts an, die Pausenleiste endet beim Tipp auf die Zeit, weniger Gewicht muss man Satz für Satz eintippen, „Reihenfolge ändern“ lässt die Gewichte stehen, die Reserve-Frage überfordert Anfänger, das Handy wird im Training warm, „Training beenden“ hat einen zweiten Schritt, und Kniebeuge und Rumänisches Kreuzheben ermüden das Gesäß nicht in der Rechnung. Dieser Plan behebt alle neun.

**Architecture:** Teil A ändert nur reine Logik (`src/shared/**`, `src/coach/gym/**`, `src/tracking/*.ts`) mit Tests. Die Vorermüdung und die Fortschrittsregel ziehen nach `src/shared/gym/`, damit die Trainings-App dieselbe Rechnung wie der Coach nutzt (heute importiert `src/tracking` nichts aus `src/coach`, außer Typen). Teil B baut die UI darauf (`src/tracking/ui/**`, `src/web/**`).

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

**Spec:** Notizen des Nutzers vom 13.11., die neun abgesegneten Punkte und der Befund unten. Grundregeln: `CLAUDE.md`, `docs/roadmap.md` (Leitsätze, Arbeitsweise), `docs/gym-foundations.md`.

## Befund (Code gelesen am 13.11.)

- Pausen: `restAfterSet` (`src/shared/rest.ts`) gibt nach jedem Aufwärmsatz `rest.warmup-s` (30 s). Nach dem letzten Satz einer Übung kommt immer die volle Pause der Übung, auch wenn die nächste Übung mit Aufwärmen beginnt. `gymMinutes` (`src/shared/duration.ts`) rechnet jeden Aufwärmsatz mit 30 s.
- Pausenleiste: `TimerCard` (`src/tracking/ui/kit/Dojo.tsx:94`) macht den ganzen Text zum Knopf „Pause überspringen“. Einziger Nutzer ist `ActiveWorkout.tsx:48`.
- Platzierung im laufenden Training: Die Trainings-App rechnet keine Vorermüdung. Die Gewichte kommen fertig platziert vom Coach (`checkWorkout` → `placedSuggestion`), `startFromPlan` kopiert sie nur in `plannedKg`/`prefillKg`. Nach `moveExerciseTo` bleibt alles stehen.
- Vorermüdung: `preFatigue` (`src/coach/gym/pre-fatigue.ts`) zählt nur frühere Sätze derselben Hauptgruppe. Aufrufer: `history.ts:86` (Verlauf), `guardrails.ts:200` (KI-Plan), `rules.ts:29` (Regel-Plan). Die Synergisten-Liste `muscle.synergists` erlaubt bei `quads` nur `glutes`; Kniebeuge hat `hamstrings` als Nebenmuskel, die Liste filtert ihn heraus. Mit der Liste allein ermüdet die Kniebeuge also das Gesäß, aber nicht den Beinbeuger.
- Reserve-Frage: `EffortQuestion.tsx` fragt „Wie viele Wiederholungen hättest du … noch geschafft?“ mit 0 / 1–2 / 3+. `suggestNext` (`src/coach/gym/history.ts`) nutzt `plenty` für einen Schritt auch ohne alle Wiederholungen; `none` bestraft nicht. `toStrengthWorkout` (`src/coach/tracking/merge.ts`) übergibt `effort`, aber keine geplanten Wiederholungen.
- Strom: `useTick(true)` in `useActiveWorkout.ts:106` rendert das ganze `ActiveWorkout` jede Sekunde neu; „Läuft seit“ zeigt nur Minuten. Bo bewegt sich im laufenden Training nicht: Heute ist dann nicht gemountet, und `WorkoutCoach`/`ChatBubble` zeigen Bo nur als Standbild (`portrait="mini"`). Bo bewegt sich aber auf Heute, wenn das Training verkleinert ist (`CoachLine` → `PandaPortrait` → `keepDoing` läuft per `requestAnimationFrame` ohne Ende). Der Browser pausiert `requestAnimationFrame` bei verstecktem Tab selbst. Wake Lock: der Browser gibt ihn beim Verstecken frei, `useWakeLock` holt ihn beim Zurückkommen neu. `webPort.ts:137` synchronisiert alle 60 s, auch bei verstecktem Tab.
- Beenden: `end()` beendet schon mit einem Tipp (außer bei den zwei Rückfragen). Danach zeigt `WorkoutScreen` die `WorkoutSummary` mit „Fertig“; erst „Fertig“ führt nach Heute. Heute zeigt die Abschlusskarte (`Finisher`) schon 3 Stunden lang selbst.

## Global Constraints

- UI-Texte: ganze deutsche Sätze, keine Fragmente mit Gedankenstrich; Bo heißt „Sensai“.
- Grenzwerte stehen nur im Regelregister `src/shared/training-policy/rules.ts`; Code liest sie mit `ruleNumber`/`policyRule`.
- Der Coach und die App ändern nichts still: jede vorgeschlagene Übernahme zeigt „Rückgängig“ oder lässt sich durch die Gegenaktion zurücknehmen.
- Keine persönlichen Daten oder Beispiele des Nutzers im Produktcode; konkrete Übungen nur in Tests.
- `src/tracking/**` importiert aus `src/coach/**` höchstens Typen. Was beide brauchen, liegt in `src/shared/**`.
- Tests nur für Abnahmesätze und Datenerhalt (`docs/roadmap.md`, Arbeitsweise 6). Tests einer ersetzten Regel werden gelöscht, nicht verbogen.
- Jeder Task ist ein eigener Commit. Branch `kraft-feedback-13`, danach lokal in `main` mergen, nicht pushen.
- Prüfbefehle pro Task: `npx vitest run <Pfade>`, am Ende jedes Tasks `npm run typecheck` und `npm run lint`.

## Review Focus

1. Ein Training ohne Aufwärmsätze hat dieselben Pausen und dieselbe Dauerschätzung wie vorher. Test in Task 1.
2. Eine Übung ohne Katalogeintrag (nur Hevy-Vorlage, keine Nebenmuskeln) hat dieselbe Vorermüdung wie vorher. Test in Task 2.
3. Die Fortschrittsregel ist nach dem Umzug in `src/shared` unverändert: alle bestehenden Tests in `tests/coach/gym/history.test.ts` bleiben ohne Änderung grün. Task 4.
4. Ein offenes Training aus einer älteren App-Version (ohne `placedPre`) ändert beim Verschieben kein Gewicht. Test in Task 8.
5. „Weniger Gewicht übernehmen“ und das Verschieben fassen nie einen erledigten oder selbst eingetippten Satz an. Tests in Task 7 und Task 8.
6. Nach „Training beenden“ geht nichts verloren, wenn das Speichern scheitert: der Bildschirm bleibt wie heute im Training. Test in Task 15.

---

## Teil A: Logik

### Task 1: Pausen beim Aufwärmen

**Files:**
- Modify: `src/shared/rest.ts` (`restAfterSet`), `src/shared/duration.ts` (`gymMinutes`), `src/shared/training-policy/rules.ts`
- Test: `tests/shared/rest.test.ts`, `tests/shared/frame.test.ts` (dort liegen die `gymMinutes`-Tests; `grep -rn gymMinutes tests`)

**Regeln (Register, Kategorie Satzpause, Status `active`, Klasse `product`, `checked`):**
- `rest.warmup-s` bleibt 30 s, Satz neu: „Zwischen zwei Aufwärmsätzen genügen 30 Sekunden Pause.“
- Neu `rest.after-warmup-s` = 90 s: „Nach dem letzten Aufwärmsatz kommt vor dem ersten Arbeitssatz eine richtige Pause: 90 Sekunden, höchstens die Pause der Übung.“ `where`: `rest.ts`, `duration.ts`.
- Neu `rest.before-warmup-s` = 60 s: „Beginnt die nächste Übung mit einem Aufwärmsatz, ist die Pause nach dem letzten Satz der Übung davor nur ein Gerätewechsel: 60 Sekunden, höchstens die Pause der Übung.“ `where`: `rest.ts`, `duration.ts`.

**Verhalten `restAfterSet(w, rid, setIndex)`:**
- Aufwärmsatz, und der nächste Satz derselben Übung ist auch ein Aufwärmsatz → `rest.warmup-s`.
- Aufwärmsatz, und danach folgt ein Arbeitssatz (oder kein Satz mehr) → `min(rest.after-warmup-s, restOf(e))`.
- Letzter Satz der Übung (Arbeitssatz) und die Übung ist kein Supersatz-Mitglied: Ist der erste offene Satz (`doneMs === null`) der nächsten Übung in `w.exercises` ein Aufwärmsatz → `min(rest.before-warmup-s, restOf(e))`. Sonst wie heute.
- Supersatz: Gilt nur nach der letzten Runde der Gruppe, und „nächste Übung“ ist die erste Übung nach der Gruppe. Alles andere im Supersatz bleibt, wie es ist (inklusive `null`, solange ein Partner offen ist).

**Verhalten `gymMinutes`:** Pro Übung zählen alle Aufwärmsätze außer dem letzten mit `work + rest.warmup-s`, der letzte mit `work + min(rest.after-warmup-s, restOf(e))`. Hat die nächste Übung (nach dem Block) Aufwärmsätze, zählt die letzte Pause des Blocks `min(rest.before-warmup-s, …)` statt der vollen Pause.

- [ ] **Step 1: Tests `rest.test.ts`.**
  - `it('ruht zwischen Aufwärmsätzen kurz und vor dem ersten Arbeitssatz richtig')`: Übung mit 3 Aufwärm- und 3 Arbeitssätzen, Pause der Übung 120 s → nach Satz 0 und 1: 30; nach Satz 2: 90. Übung mit Pause 60 s → nach Satz 2: 60.
  - `it('wechselt nach der letzten Übung nur kurz, wenn danach aufgewärmt wird')`: Übung A (120 s) letzter Satz, Übung B beginnt mit offenem Aufwärmsatz → 60. B ohne Aufwärmsatz → 120. B mit schon erledigtem Aufwärmsatz und offenem Arbeitssatz → 120.
  - Der bestehende Test Zeile 33 (`rest.warmup-s` nach jedem Aufwärmsatz) wird auf die neue Regel umgeschrieben.
- [ ] **Step 2: Test `frame.test.ts`.** `it('rechnet den letzten Aufwärmsatz mit der richtigen Pause')`: Zwei Übungen, die zweite mit Aufwärmen; erwarteter Wert von Hand gerechnet. Ein Training ohne Aufwärmen gibt denselben Wert wie vorher.
- [ ] **Step 3:** `npx vitest run tests/shared/rest.test.ts tests/shared/frame.test.ts` → FAIL.
- [ ] **Step 4:** Implementieren wie oben. `tests/shared/training-policy.test.ts` prüft das Register; neue Regeln brauchen `where`, sonst schlägt er fehl.
- [ ] **Step 5:** `npx vitest run tests/shared tests/coach/gym tests/tracking` → PASS (die Coach-Dauerprüfung nutzt `gymMinutes`). `npm run typecheck`, `npm run lint`.
- [ ] **Step 6:** `git commit -m "feat(kraft): kurze Pausen beim Aufwärmen, richtige Pause vor dem Arbeitssatz"`

### Task 2: Mitbeteiligte Muskeln zählen zur Vorermüdung

**Files:**
- Create: `src/shared/gym/pre-fatigue.ts` (Inhalt von `src/coach/gym/pre-fatigue.ts`, erweitert)
- Modify: `src/coach/gym/pre-fatigue.ts` (wird `export * from '../../shared/gym/pre-fatigue';`), `src/shared/muscle-balance.ts` (`contributions` bekommt einen optionalen dritten Parameter `synergists`), `src/coach/gym/history.ts:86`, `src/coach/gym/guardrails.ts:200`, `src/coach/gym/rules.ts:29`, `src/shared/training-policy/rules.ts`
- Test: `tests/coach/gym/pre-fatigue.test.ts`, `tests/coach/gym/history.test.ts`

**Interfaces:**
- `type Muscles = { primaryMuscle: string | null | undefined; secondaryMuscles?: readonly string[] }`
- `musclesOfFrom(templates, catalog): (templateId: string) => Muscles | undefined` — Katalog zuerst (mit `secondaryMuscles`), dann die Hevy-Vorlage (nur Hauptmuskel). `muscleOfFrom` bleibt für bestehende Aufrufer.
- `preFatigue(exercises: readonly (Muscles & { hardSets: number; supersetId: number | null })[]): number[]` — pro Übung die Summe aus allen früheren Übungen: volle harte Sätze für dieselbe Hauptgruppe, `gym.pre-fatigue-secondary-weight` × harte Sätze für jede Gruppe, die die frühere Übung mitbeteiligt. Ergebnis ist eine Kommazahl.
- `positionShare(deltaSets: number): number` = `max(gym.pre-fatigue-share-min, 1 − gym.pre-fatigue-share-per-set × deltaSets)`; `suggestNext` und Task 8 nutzen diese eine Funktion.

**Welche Gruppen eine frühere Übung mitbeteiligt:** `contributions(e, undefined, FATIGUE_SYNERGISTS)` aus `muscle-balance.ts`, also derselbe Mechanismus wie die Muskelbilanz, aber mit einer eigenen Liste aus dem Register. Grund: In der Bilanz zählt der Beinbeuger bei der Kniebeuge zu Recht nicht als Training, für die Ermüdung der Hüftstrecker zählt er.

**Regeln (Register, Kategorie Lastauswahl, Status `replace(12, 'Eigene Wahl, später pro Person lernen.')`):**
- `gym.pre-fatigue-secondary-weight` = 0,5: „Eine frühere Übung ermüdet einen mitbeteiligten Muskel mit einem halben Satz je hartem Satz.“
- `gym.pre-fatigue-synergists` (lists): Kopie von `muscle.synergists`, dazu `quads: ['glutes', 'hamstrings']`. Satz: „Für die Ermüdung zählen dieselben Mitspieler wie in der Muskelbilanz; die Kniebeuge ermüdet zusätzlich den Beinbeuger.“

- [ ] **Step 1: Tests `pre-fatigue.test.ts`** (Katalogeinträge über `EXERCISES` per id laden, nicht nachbauen):
  - `it('Kniebeuge und Rumänisches Kreuzheben ermüden den Hip Thrust')`: `pf-squat` 4, `pf-romanian-deadlift` 3, `pf-hip-thrust` → RDL > 0 (Beinbeuger über die Kniebeuge), Hip Thrust = 4 × 0,5 + 3 × 0,5 = 3,5.
  - `it('eine Rückenübung ermüdet die Beine nicht über den unteren Rücken')`: Kreuzheben-Nebenmuskel `lower_back` macht Rudern danach nicht müder als die Liste erlaubt (Erwartung aus der Liste ablesen und im Test begründen).
  - Bestehende Tests bleiben: ohne Nebenmuskeln (Hevy-Vorlage) dieselben Zahlen wie vorher (Review Focus 2).
- [ ] **Step 2: Test `history.test.ts`.** `it('Hip Thrust nach Kniebeuge und Kreuzheben bekommt weniger als frisch')`: Verlauf mit Hip Thrust immer als erste Übung bei 100 kg; heute an dritter Stelle nach 4 Sätzen Kniebeuge und 3 Sätzen RDL (`muscleOf` aus `musclesOfFrom` mit Katalog) → `weightKg < 100`, Grund `other-position`.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4: Implementieren.** Datei nach `src/shared/gym/pre-fatigue.ts` verschieben; `Plan.muscleOf` in `history.ts` wird `(id) => Muscles | undefined`. Alle drei Aufrufer übergeben `secondaryMuscles`. `suggestNext` nutzt `positionShare`. Toleranz-Vergleiche bleiben, sie funktionieren mit Kommazahlen.
- [ ] **Step 5:** `npx vitest run tests/coach/gym tests/shared` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 6:** `git commit -m "feat(gym): mitbeteiligte Muskeln zählen zur Vorermüdung"`

### Task 3: Höchstens zwei hüftdominante Übungen pro Training

> Am 13.11. wieder entfernt: Für eine Grenze pro Anzahl der Übungen gibt es keinen Beleg.

**Files:**
- Modify: `src/coach/gym/guardrails.ts` (`checkWorkout`, `REASON_PHRASES`), `src/coach/gym/rules.ts` (`plainWorkout`, Auswahl `frequent`), `src/coach/gym/prompt.ts`, `src/coach/gym/limits.ts`, `src/shared/training-policy/rules.ts`
- Test: `tests/coach/gym/guardrails.test.ts`, `tests/coach/gym/guardrails-phrase.test.ts`

**Regel:** `gym.max-hip-dominant` = 2, `lists: { families: ['hinge', 'hip-thrust'] }`, Kategorie Übungsauswahl, `active`. Satz: „Höchstens zwei hüftdominante Übungen (Kreuzheben-Varianten, Hip Thrust, Brücke) pro Training.“

**Verhalten:**
- Familie einer Übung: `familyOf(resolveCatalogEntry(e, ctx.catalog ?? [], ctx.links) ?? {})`, dieselbe Auflösung wie `executionKeyOf`. Ohne Katalogeintrag zählt die Übung nicht.
- `checkWorkout`: mehr als 2 → `no('mehr als 2 hüftdominante Übungen')`; Phrase: „zu viele Übungen für die Hüftstreckung in einem Training“.
- Abschnitt: Verlangt `ctx.block.core` selbst schon mehr als 2 solche Übungen, gilt diese Zahl als Grenze (die Kernübungen gewinnen).
- `plainWorkout`: beim Füllen nach Häufigkeit eine dritte hüftdominante Übung überspringen, wie bei doppelter Ausführung.
- `prompt.ts`, ein Satz in den Regeln: „Plane höchstens zwei hüftdominante Übungen (Kreuzheben-Varianten, Hip Thrust, Brücke) pro Training.“

- [ ] **Step 1: Tests.** `it('lehnt eine dritte hüftdominante Übung ab')`: Plan mit RDL, Hip Thrust, Glute Bridge → `{ ok: false }`, Grund passt zur Phrase. Plan mit Kniebeuge, RDL, Hip Thrust → ok. `reasonPhrase` liefert den ganzen Satz.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren wie oben.
- [ ] **Step 4:** `npx vitest run tests/coach/gym` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(gym): höchstens zwei hüftdominante Übungen pro Training"`

### Task 4: Fortschrittsregel in den geteilten Code

Reiner Umzug, damit die Trainings-App in Task 6 dieselbe Rechnung wie der Coach nutzt. Kein Verhalten ändert sich.

**Files:**
- Create: `src/shared/gym/progression.ts`, `src/shared/gym/strength-history.ts`
- Modify: `src/shared/gym/types.ts` (Typ `StrengthWorkout` und `SetType` ziehen hierher), `src/coach/hevy.ts` (re-exportiert die Typen), `src/coach/gym/history.ts`, `src/coach/tracking/merge.ts`
- Test: keine neuen; alle bestehenden bleiben unverändert grün.

**Inhalt:**
- `progression.ts`: `suggestNext`, `stagnates`, `ladderFor`, `plannedKey`, `isAssisted`, `REASONS`, Typen `Suggestion`, `Plan`, `ExerciseInfo`, die privaten `occurrences` und `sessionsOf`. Die Grenzwerte liest die Datei selbst aus dem Register (`ruleNumber('gym.…')`), nicht aus `src/coach/gym/limits.ts`.
- `strength-history.ts`: `toStrengthWorkout` und `historyFromLogged` aus `merge.ts` (rein, ohne Node).
- `src/coach/gym/history.ts` behält `availableExercises`, `recentLegWork`, `isRepBased`, `LEG_MUSCLES`, `stepWords` und re-exportiert alles aus `progression.ts`; `merge.ts` re-exportiert die zwei Funktionen. So ändert sich kein Import im Coach.

- [ ] **Step 1:** Umziehen. `grep -rn "from '.*hevy'" src/shared` muss leer sein (shared darf keinen Node-Code ziehen).
- [ ] **Step 2:** `npx vitest run tests/coach tests/shared` → PASS ohne Änderung an Tests. `npm run typecheck`, `npm run lint`, `npm run build:web` (prüft, dass der Web-Build nichts aus `node:` zieht).
- [ ] **Step 3:** `git commit -m "refactor(gym): Fortschrittsregel liegt im geteilten Code"`

### Task 5: Versagenssatz weit über Plan zählt wie „viel übrig“, keine Frage nach Versagen

**Files:**
- Modify: `src/shared/gym/types.ts` (`StrengthWorkout` → `workSets[]` bekommt `plannedReps?: number`), `src/shared/gym/strength-history.ts` (`toStrengthWorkout` übernimmt `plannedReps` eines eigenen Satzes, gelesen über eine kleine Typprüfung, weil `LoggedSet` das Feld nicht im Typ hat), `src/shared/gym/progression.ts` (`occurrences`), `src/tracking/effort.ts` (`asksEffort`), `src/shared/training-policy/rules.ts`
- Test: `tests/coach/gym/history.test.ts`, `tests/tracking/effort.test.ts`

**Regel:** `gym.failure-plenty-margin` = 3, Kategorie Progression, `active`: „Schafft ein Versagenssatz mindestens 3 Wiederholungen mehr als geplant, zählt das wie ‚noch viel übrig‘, auch ohne Antwort.“

**Verhalten:**
- `occurrences`: `effort` = gegebene Antwort, sonst `'plenty'`, wenn ein Satz vom Typ `failure` dieser Übung `reps ≥ plannedReps + margin` hat. Ohne `plannedReps` (Hevy) keine Änderung.
- `asksEffort`: `false`, wenn der letzte Arbeitssatz vom Typ `failure` ist (die Zahlen sagen es schon).

- [ ] **Step 1: Tests.**
  - `history.test.ts`: `it('ein Versagenssatz weit über Plan bringt einen Schritt wie viel übrig')`: zwei Sitzungen, die letzte mit Versagenssatz 15 bei Plan 12, ohne Antwort → `why: 'progress'`, Grund `plenty-left`. Mit 13 bei Plan 12 → wie bisher.
  - `effort.test.ts`: `it('fragt nach einem Versagenssatz nicht')`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npx vitest run tests/coach/gym tests/tracking/effort.test.ts tests/shared` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(gym): Versagenssatz weit über Plan zählt wie viel übrig"`

### Task 6: Was die Antwort für das nächste Mal heißt

**Files:**
- Create: `src/tracking/next-time.ts`
- Test: `tests/tracking/next-time.test.ts`

**Interface:** `nextTimeLine(w: TrackedWorkout, exRid: string, o: { history: LoggedWorkout[]; catalog: Exercise[]; studios: StudioState; overrides: LoadStepOverrides; nowMs: number }): string | null`

**Verhalten:**
- Verlauf = `historyFromLogged(o.history, new Map())` plus das laufende Training als beendet (`toStrengthWorkout({ ...w, endMs: nowMs }, new Map())`; es zählen nur bestätigte Sätze). Die Records tragen schon die eigenen Ids (`hevyRecord` setzt die Links beim Import), deshalb leere Links.
- `suggestNext(exerciseId, verlauf, nowMs, info, { studio: w.studio, overrides, renames: studios.renames })` ohne `muscleOf`, also wie der Vorschlag im Prompt („blind“). `info` aus dem Katalogeintrag (`resolveExercise`).
- Heute: schwerstes Gewicht der bestätigten Arbeitssätze (`normal`/`failure`) und die kleinste Wiederholungszahl dort.
- Text (Zahlen mit Komma, `formatDecimal`):
  - `why: 'none'` → `null`.
  - Ohne Gewicht: mehr Wiederholungen → „Nächstes Mal {n} statt {heute} Wiederholungen.“, sonst „Nächstes Mal bleibt es bei {n} Wiederholungen.“
  - Gewicht höher → „Nächstes Mal {kg} kg statt {heute} kg.“
  - Gleiches Gewicht, mehr Wiederholungen → „Nächstes Mal {n} statt {heute} Wiederholungen mit {kg} kg.“
  - Gleiches Gewicht, gleiche Wiederholungen → „Nächstes Mal bleibt es bei {kg} kg.“
  - Gewicht niedriger → „Nächstes Mal etwas leichter, mit {kg} kg.“

- [ ] **Step 1: Tests** (je ein Satz für `plenty` mit Wiederholungsschritt, `plenty` am Bereichsende mit Gewichtsschritt, `some` ohne alle Wiederholungen → „bleibt es bei“, Übung ohne Verlauf → `null`).
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npx vitest run tests/tracking/next-time.test.ts` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): Folge der Antwort für das nächste Mal"`

### Task 7: Weniger Gewicht für die restlichen Sätze (Logik)

**Files:**
- Create: `src/tracking/lighter-rest.ts`
- Test: `tests/tracking/lighter-rest.test.ts`

**Interfaces:**
- `lighterRest(w: TrackedWorkout, exRid: string, snap: (kg: number) => number): { kg: number | null; sets: { rid: string; kg: number }[] } | null`
- `setWeights(w: TrackedWorkout, exRid: string, sets: readonly { rid: string; kg: number }[]): TrackedWorkout` — setzt `weightKg` nur bei Sätzen, die noch offen sind. Dient für „Übernehmen“ und für „Rückgängig“ (mit den alten Werten).

**Verhalten `lighterRest`:**
- Bezug: der zuletzt bestätigte Arbeitssatz (nicht `warmup`) der Übung mit Gewicht. Geplant = `plannedKg ?? prefillKg`. Nur wenn `weightKg < geplant` gilt.
- Faktor = `weightKg / geplant`. Für jeden offenen Arbeitssatz mit Gewicht: neu = `snap((plannedKg ?? weightKg) × Faktor)`. So bleibt eine Pyramide eine Pyramide.
- Nur Sätze mit `neu < weightKg` kommen in `sets`. Leer → `null` (die restlichen Sätze haben das Gewicht schon).
- `kg`: der gemeinsame neue Wert, wenn alle gleich sind, sonst `null`.
- Zeitübungen (`timed`) → `null`.

- [ ] **Step 1: Tests.**
  - Drei Sätze à 60 kg, Satz 1 mit 50 kg bestätigt → Sätze 2 und 3 auf 50, `kg: 50`.
  - Pyramide 60/65/70, Satz 1 mit 54 → 58,5 und 63 vor dem Einrasten, nach `snap` auf 2,5er-Stufen 57,5 und 62,5, `kg: null`.
  - Restliche Sätze schon auf 50 → `null`.
  - Ein offener Satz, den die Person schon tiefer eingetippt hat, wird nicht angehoben (Review Focus 5).
  - `setWeights` lässt erledigte Sätze unangetastet.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npx vitest run tests/tracking/lighter-rest.test.ts` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): weniger Gewicht für die restlichen Sätze berechnen"`

### Task 8: Verschieben rechnet die Gewichte neu

**Files:**
- Create: `src/tracking/placement.ts`
- Modify: `src/tracking/session.ts` (`TrackedExercise` bekommt `placedPre?: number`; `startFromPlan` setzt es; `otherStudio` exportieren), `src/tracking/ui/workout/ActiveWorkout.tsx` (`onDrop`/`onStep`), `docs/roadmap.md` (Parkplatz-Zeile „Nach ‚Reihenfolge ändern‘ … neu berechnen“ löschen)
- Test: `tests/tracking/move.test.ts`

**Interfaces:**
- `placesOf(exercises: readonly TrackedExercise[], catalog: readonly Exercise[]): number[]` — `preFatigue` aus `src/shared/gym/pre-fatigue.ts` in dieser Reihenfolge; Muskeln über `resolveExercise`; harte Sätze = alle Sätze vom Typ `normal`/`failure`/`dropset` (geplant oder erledigt).
- `refitPlaces(w: TrackedWorkout, catalog, snap: (exerciseId: string, kg: number) => number): { workout: TrackedWorkout; changed: string[] }` — `changed` sind die Titel der Übungen, deren Gewichte sich geändert haben.

**Verhalten:**
- `startFromPlan`: nach dem Bau der Übungen `placedPre = placesOf(exercises)[i]` je Übung (die Stelle, für die der Coach das Gewicht gemacht hat).
- `refitPlaces` fasst nur Übungen an, die: `placedPre` haben, keinen erledigten Satz haben und in denen jeder Arbeitssatz mit `prefillKg` noch `weightKg === prefillKg` hat. Nur wenn das Studio dem Plan-Studio entspricht (`!otherStudio(w.planStudio, …)`); nach einem Studiowechsel bleibt alles stehen.
- Pro Arbeitssatz mit `plannedKg !== null`: `delta = jetzt − placedPre`; neu = `delta > gym.pre-fatigue-tolerance ? snap(plannedKg × positionShare(delta)) : plannedKg`. Nie über `plannedKg`. `weightKg` und `prefillKg` bekommen den neuen Wert. Aufwärmsätze bleiben.
- Rückgängig ist das Zurückschieben: dieselbe Rechnung bringt `plannedKg` zurück.
- `ActiveWorkout`: `act((x) => refit(moveExerciseTo(x, …)))`; `snap` über `extendDown(ladderHere(…).ladder, equipment)` und `snapDown` wie in `prefillWeights`. Ist `changed` nicht leer: `setNotice(`Die Gewichte von ${liste} passen jetzt zur neuen Reihenfolge.`)` (Liste mit „und“ wie `mates` in `FocusCard`).

- [ ] **Step 1: Tests `move.test.ts`.**
  - `it('senkt das Gewicht einer Brustübung, die hinter zwei Brustübungen rutscht')`: Plan Schrägbank 40 kg vorn; nach hinten hinter Brustpresse 4 Sätze und Crossover 3 Sätze → Gewicht < 40, auf der Leiter.
  - `it('bringt das Gewicht zurück, wenn die Übung wieder nach vorn kommt')`.
  - `it('lässt erledigte und selbst eingetippte Sätze stehen')`.
  - `it('ändert ohne placedPre nichts')` (offenes Training einer alten Version, Review Focus 4).
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren, Parkplatz-Zeile in `docs/roadmap.md` löschen.
- [ ] **Step 4:** `npx vitest run tests/tracking` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): Verschieben rechnet die Gewichte neu"`

## Teil B: Trainings-UI

### Task 9: Hinweis bei den Aufwärmsätzen

**Files:**
- Modify: `src/tracking/ui/workout/FocusCard.tsx` (`FocusSet`)
- Test: `tests/tracking/live-focus.test.tsx`

**Verhalten:** Ist der gezeigte Satz ein Aufwärmsatz, steht unter den Feldern (wie `target`, Klasse `muted tk-lift-hint`): „Die Aufwärmsätze machst du kurz hintereinander. Vor dem ersten Arbeitssatz kommt eine richtige Pause.“ Bei Arbeitssätzen steht der Satz nicht.

- [ ] **Step 1: Test.** `it('erklärt beim Aufwärmen die kurzen Pausen')`: Übung mit Aufwärmsatz im Fokus → Text sichtbar; nach Bestätigen aller Aufwärmsätze → Text weg.
- [ ] **Step 2:** Test → FAIL. **Step 3:** Implementieren. **Step 4:** `npx vitest run tests/tracking` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): Hinweis zu den Pausen beim Aufwärmen"`

### Task 10: Pausenleiste mit eigenen Knöpfen

**Files:**
- Modify: `src/tracking/ui/kit/Dojo.tsx` (`TimerCard`), `src/tracking/ui/kit/index.ts` (Kommentar), `src/tracking/ui/tracking.css` (`.tk-timercard`, `.tk-rest-main`), `src/tracking/ui/workout/ActiveWorkout.tsx:46-52`
- Test: `tests/tracking/live-frame.test.tsx:134`, `tests/tracking/screens.test.tsx:72`, `tests/web/style-tokens.test.ts:122`

**Interface:** `TimerCard({ label, more, end, children }: { label: string; more: Action; end: Action; children: ReactNode })`. Der Text ist ein `<span className="tk-rest-main">`, kein Knopf. Rechts zwei Knöpfe `secondary`: „30 s mehr“ und „Pause beenden“.

**CSS:** `.tk-timercard { flex-wrap: wrap; }`, `.tk-rest-main { flex: 1 1 8rem; }`, Knöpfe `flex: none`. Auf schmalen Handys rutschen die Knöpfe in eine zweite Zeile; nichts scrollt waagrecht. Die bestehende Schrift-Regel für `.tk-rest-main` bleibt (der Test in `style-tokens.test.ts` prüft sie).

- [ ] **Step 1: Tests anpassen.** `it('die Pause endet nur mit dem Knopf')`: Tipp auf den Zeittext beendet nichts; „Pause beenden“ beendet; „30 s mehr“ verlängert. Alte Abfragen nach „Pause überspringen“ auf „Pause beenden“ umstellen (`grep -rn "Pause überspringen" tests src`).
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren (`grep -rn TimerCard src`: einziger Nutzer ist `ActiveWorkout`). **Step 4:** `npx vitest run tests/tracking tests/web` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** Sichtprüfung bei 360 px Breite (`npm run dev:web`, Gerätemodus im Browser).
- [ ] **Step 6:** `git commit -m "feat(kraft): Pausenleiste mit eigenen Knöpfen"`

### Task 11: „Satz geschafft“ bestätigt spürbar

**Files:**
- Create: `src/tracking/ui/workout/feedback.ts`
- Modify: `src/tracking/ui/workout/useActiveWorkout.ts` (`confirmShown`, UiState `justDone: string | null`), `src/tracking/ui/workout/FocusCard.tsx` (MarkDot-Klasse), `src/tracking/ui/kit/…` (MarkDot nimmt `pop?: boolean`), `src/tracking/ui/tracking.css`
- Test: `tests/tracking/live-focus.test.tsx`

**Verhalten:**
- `buzz(): void` — `try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(15); } catch { /* kein Vibrieren */ }`. Wirft nie. iOS hat kein `vibrate`, dort passiert nichts.
- `confirmShown` ruft `buzz()` und setzt `justDone` auf die Satz-Id; der nächste bestätigte Satz ersetzt sie.
- Der MarkDot dieses Satzes bekommt die Klasse `tk-mark-pop`: ein kurzer Haken, der einmal aufploppt (ca. 400 ms, `transform: scale`). Die Animation steht nur in `@media (prefers-reduced-motion: no-preference)`; sonst wechselt der Punkt nur still auf erledigt. Der Satzpunkt bleibt sichtbar, auch wenn der Fokus zum nächsten Satz springt, darum sitzt die Bestätigung dort und nicht am Knopf.

- [ ] **Step 1: Tests.** `it('bestätigt einen Satz mit einem kurzen Vibrieren, wo es geht')`: `navigator.vibrate` als Spy → einmal mit kurzem Wert gerufen; ohne `navigator.vibrate` kein Fehler. `it('markiert den gerade geschafften Satz')`: der MarkDot trägt `tk-mark-pop`.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npx vitest run tests/tracking` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): Satz geschafft bestätigt spürbar"`

### Task 12: Vorschlag „Restliche Sätze auch mit … kg?“

**Files:**
- Modify: `src/tracking/ui/workout/FocusCard.tsx` (unter dem Knopf „Satz geschafft“ in `FocusSet`), `src/tracking/ui/workout/useActiveWorkout.ts` (UiState `lighterNo: ReadonlySet<string>`, `lighterUndo: { rid: string; prior: { rid: string; kg: number }[] } | null`)
- Test: `tests/tracking/live-focus.test.tsx`

**Verhalten:**
- `proposal = lighterRest(w, e.rid, snap)` mit `snap` über `ladderHere` wie in Task 8. Sichtbar, solange `proposal` nicht `null` ist und die Übung nicht in `lighterNo` steht.
- Text: mit `kg` „Die restlichen Sätze auch mit {kg} kg?“, sonst „Die restlichen Sätze im selben Verhältnis leichter machen?“ Knopf `secondary` „Übernehmen“, Link „Nein danke“ (setzt `lighterNo`).
- „Übernehmen“: alte Werte merken (`lighterUndo`), `act((x) => setWeights(x, e.rid, proposal.sets))`. Danach steht dort „Die restlichen Sätze sind jetzt leichter.“ mit dem Link „Rückgängig“ (`setWeights` mit den alten Werten). `lighterUndo` verschwindet mit dem nächsten bestätigten Satz.
- Ruhig: eine Zeile, keine Karte, keine Zahlenliste.

- [ ] **Step 1: Tests.** `it('schlägt nach weniger Gewicht die restlichen Sätze vor')`: Gewicht 50 statt 60 eintippen, „Satz geschafft“ → Text „Die restlichen Sätze auch mit 50 kg?“; „Übernehmen“ → nächster Satz zeigt 50; „Rückgängig“ → wieder 60. `it('fragt nicht, wenn die Sätze schon so leicht sind')`.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npx vitest run tests/tracking` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): weniger Gewicht für die restlichen Sätze übernehmen"`

### Task 13: Die Frage nach den letzten Wiederholungen

**Files:**
- Modify: `src/tracking/ui/EffortQuestion.tsx`, `src/tracking/ui/workout/ActiveWorkout.tsx:66-72`, `src/tracking/ui/workout/useActiveWorkout.ts` (UiState `reask: string | null`), `src/tracking/ui/workout/SetsSheet.tsx:39`, Kommentar an `Effort` in `src/shared/records.ts`, Kommentar an `asksEffort`
- Test: `tests/tracking/live-focus.test.tsx` oder `tests/tracking/summary-and-feel.test.tsx` (wo die Frage heute getestet wird: `grep -rln "hättest du" tests`)

**Verhalten:**
- Frage: „Wie liefen die letzten Wiederholungen bei {title}?“ Darunter: „Zähl nur saubere Wiederholungen. Bo macht daraus höchstens einen kleinen Schritt.“
- Antworten in dieser Reihenfolge: „So schnell wie die ersten“ (`plenty`), „Langsamer, aber sauber“ (`some`), „Die letzte ging kaum noch hoch“ (`none`); dazu „Überspringen“ und „Nicht mehr fragen“ wie bisher.
- `EFFORT_LABEL` wird `EFFORT_ANSWER` mit diesen Texten; `SetsSheet` zeigt „Letzte Wiederholungen: {Antwort}.“ statt „Noch möglich: …“.
- Nach einer Antwort: statt „Danke! Das fließt in den nächsten Vorschlag ein.“ steht `nextTimeLine(…)` (Task 6), ohne Ergebnis „Danke, das merkt sich Bo für das nächste Mal.“ Daneben der Link „Doch anders“: setzt `reask` auf die Übung, die Frage erscheint wieder, eine neue Antwort ersetzt die alte (`setEffort`).
- Gespeicherte Werte und ihre Bedeutung bleiben (`none`/`some`/`plenty`); alte Trainings brauchen keine Umwandlung.

- [ ] **Step 1: Tests.** `it('fragt nach dem Tempo der letzten Wiederholungen')`: die drei Antworttexte sind Knöpfe; „So schnell wie die ersten“ speichert `plenty`. `it('zeigt nach der Antwort, was das nächste Mal passiert')`: mit Verlauf → Satz beginnt mit „Nächstes Mal“; „Doch anders“ zeigt die Antworten wieder. Alte Tests auf „0“/„1–2“/„3+“ ersetzen.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npx vitest run tests/tracking` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): Frage nach dem Tempo der letzten Wiederholungen"`

### Task 14: Weniger Strom im Training

**Files:**
- Modify: `src/tracking/ui/hooks.ts` (`useTick` ersetzen durch `useNow(periodMs, active)`; `useWakeLock`), `src/tracking/ui/workout/useActiveWorkout.ts` (kein `useTick`, kein `remaining` mehr), `src/tracking/ui/workout/ActiveWorkout.tsx` (Komponenten `LiveSince`, `RestBar`), `src/tracking/ui/PandaPortrait.tsx` und `BoBubble` in `src/tracking/ui/kit/Dojo.tsx` (Prop `still`), `src/web/today/CoachLine.tsx`, `src/web/app/Heute.tsx`, `src/web/webPort.ts`
- Test: `tests/tracking/live-frame.test.tsx`, `tests/web/web-port.test.ts`, `tests/web/heute-day.test.tsx`

**Verhalten:**
- `useNow(periodMs, active): number` — eigener State nur in der Komponente, die ihn ruft. Läuft nur, solange `active` und `document.visibilityState === 'visible'`; bei `visibilitychange` stoppt der Takt, beim Zurückkommen rechnet er sofort neu.
- `LiveSince` zeigt „Läuft seit …“ und tickt alle 60 s (die Anzeige hat nur Minuten).
- `RestBar` zeigt die `TimerCard`, tickt jede Sekunde nur während einer Pause und gibt bei 0 `null` zurück. Nur diese kleine Komponente rendert jede Sekunde; `ActiveWorkout`, `FocusCard` und die Liste nicht mehr.
- Bo: Im laufenden Training ist er heute schon ein Standbild (siehe Befund), daran ändert sich nichts. Neu: `PandaPortrait`/`BoBubble` nehmen `still?: boolean`; Heute gibt `still` mit, solange ein Training offen ist (`open`). Dann gibt es kein Canvas und keine Endlos-Animation, während das Training verkleinert ist.
- Wake Lock bleibt an. Beim Verstecken gibt `useWakeLock` ihn ausdrücklich frei (der Browser tut es meist schon), beim Zurückkommen holt er ihn wie bisher neu.
- `webPort.ts`: Der 60-s-Takt überspringt den Abgleich, solange `document.visibilityState === 'hidden'`. Abgleich nach Schreiben (`schedule`) und beim Sichtbarwerden bleibt; ein Satz geht also nie verloren und wird beim Zurückkommen sofort abgeglichen.
- Keine Probleme erfinden: Andere Timer (`Shell` 60 s, `LiveRide`) bleiben.

- [ ] **Step 1: Tests.**
  - `live-frame.test.tsx`: `it('die Pause zählt herunter und verschwindet bei null')` mit Fake-Timern.
  - `web-port.test.ts`: `it('gleicht im Hintergrund nicht im Takt ab')`: `visibilityState = 'hidden'`, Takt vorspulen → kein Abruf; `'visible'` + Ereignis → Abruf.
  - `heute-day.test.tsx`: `it('Bo steht still, solange ein Training offen ist')`: offenes Training → kein `canvas` im Dokument.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npx vitest run tests/tracking tests/web` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "perf(kraft): weniger Strom im Training"`

### Task 15: „Training beenden“ führt direkt nach Heute

**Files:**
- Modify: `src/tracking/ui/WorkoutScreen.tsx` (Zeile 185 `onLeave`, Zeile 222), `src/tracking/ui/WorkoutSummary.tsx`, `src/web/app/Heute.tsx`, `src/web/app/Training.tsx` (nur falls `onDone` dort anders verdrahtet werden muss)
- Test: `tests/tracking/summary-and-feel.test.tsx`, `tests/web/app/shell.test.tsx`, `tests/ui/finisher-view.test.tsx`

**Verhalten:**
- Nach einem gespeicherten Ende setzt `WorkoutScreen` `setPendingSummary(id)` wie bisher und ruft sofort `onDone()` (die Web-App geht nach Heute). Ohne `onDone` (andere Einbettung) zeigt `WorkoutScreen` die Zusammenfassung wie heute.
- Heute: Ist `pendingSummary()` gesetzt und das Training beendet, steht im Platz „Jetzt dran“ statt der Abschlusskarte die `WorkoutSummary`: Hauptkarte „Gespeichert“ mit Titel, Dauer und den nächsten Schritten (`stats`-Record wie in `WorkoutScreen`), darunter Bo mit dem Abschluss-Vorschlag (`finisherOf`). Statt „Fertig“ trägt die Karte „Schließen“ (`setPendingSummary(null)`); danach zeigt Heute die normale Abschlusskarte für den Rest der 3 Stunden. So erscheint der Abschluss nie doppelt.
- Die Rückfragen „offene Sätze“ und „noch nichts erledigt“ bleiben unverändert. Scheitert das Speichern, bleibt das Training offen wie heute (Review Focus 6).

- [ ] **Step 1: Tests.**
  - `shell.test.tsx`: `it('Training beenden führt mit einem Tipp nach Heute zur Zusammenfassung')`: alle Sätze erledigt, „Training beenden“ → Heute ist aktiv, Karte „Gespeichert“ mit Abschlussvorschlag; „Schließen“ → Karte weg, Abschlusskarte da.
  - `summary-and-feel.test.tsx`: Tests auf „Fertig“ umstellen oder löschen, wenn sie die alte Seite prüfen.
  - Bestehender Test: Speichern scheitert → Training bleibt offen.
- [ ] **Step 2:** Tests → FAIL. **Step 3:** Implementieren. **Step 4:** `npx vitest run tests/tracking tests/web tests/ui` → PASS. `npm run typecheck`, `npm run lint`.
- [ ] **Step 5:** `git commit -m "feat(kraft): Training beenden führt direkt nach Heute"`

### Task 16: Abschluss

- [ ] `npm run typecheck`, `npm run lint`, `npx vitest run --exclude 'tests/chaos/**'` (gleich `npm test`) → alles grün.
- [ ] `npm run test:web-smoke` und `npm run ui:web-shots`; Bilder der Trainingsseite (Pause, Aufwärmen, Vorschlag leichter, Frage) ansehen.
- [ ] `npm run dev:web` im Handy-Format: Training mit Aufwärmen starten, Pausen prüfen, Satz bestätigen, weniger Gewicht eintippen, Übung verschieben, Frage beantworten, beenden.
- [ ] `docs/roadmap.md`: Zeile „Kraft-Feedback 13.11.“ auf ✅ (die Zeile ist im Arbeitsverzeichnis schon eingetragen, aber noch nicht committet); Parkplatz-Punkte unten eintragen.
- [ ] `git commit -m "docs: Kraft-Feedback 13.11. fertig, Parkplatz ergänzt"`, dann Merge in `main`.

## Parkplatz (nicht in diesem Plan)

- Die Folge-Zeile nach der Antwort rechnet wie der Vorschlag im Prompt, ohne Stelle im nächsten Training; plant die KI anders, kann das nächste Training abweichen.
- Aufwärmsätze werden beim Verschieben nicht neu gerechnet, nur die Arbeitssätze.
- Nach einem Studiowechsel rechnet das Verschieben nichts neu.
- Bo bewegt sich auf Heute weiter ohne Ende (`keepDoing`), solange kein Training offen ist; der Browser pausiert das nur bei verstecktem Tab.
- Den Anteil der mitbeteiligten Muskeln (0,5) pro Person aus eigenen Daten lernen.
