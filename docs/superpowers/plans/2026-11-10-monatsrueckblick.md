# Monatsrückblick, Härte und Trainingsabschnitt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bo blickt einmal im Monat mit drei Monaten Sicht ehrlich zurück, fragt offene Beschwerden ab, pusht pro Person verschieden stark und bietet optional einen festen Abschnitt von 4–6 Wochen mit festen Kernübungen an.

**Architecture:** Drei Stufen, jede für sich lieferbar. Stufe A legt eine neue Scan-Aufgabe und eine Chat-Methode `openReview` an; der Rückblick liest gespeicherte Datensätze und die Krafthistorie, nie den Chat-Verlauf. Stufe B ergänzt `goal.push`, eine Guardrail für `gentle` und die Frage nach der Härte. Stufe C führt den Datensatz `block` ein, den der Kraftplaner liest und die Guardrails prüfen. Alle Grenzwerte stehen im Regelregister.

**Tech Stack:** TypeScript, React, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-10-monatsrueckblick-design.md` (Abschnitte 3–9, 10a). Dazu `docs/motivation.md` (Fragenregel) und `docs/superpowers/specs/2026-11-06-adaptive-training-coach-design.md` §5, §6, §13.

## Global Constraints

- UI-Texte ganze natürliche deutsche Sätze, keine Fragmente mit Gedankenstrich.
- Bo heißt „Sensai“ (ai).
- Grenzwerte nur im Regelregister (`src/shared/training-policy/rules.ts`); `src/coach/gym/limits.ts` und andere Module lesen sie nur. Jede Regeländerung erhöht `POLICY_VERSION` (`src/shared/training-policy/index.ts:10`) und passt `tests/shared/training-policy.test.ts:5` an.
- Der Coach ändert nichts still: jede Übernahme zeigt „Rückgängig“.
- Keine persönlichen Daten in Produktcode, konkrete Beispiele nur in Tests.
- Kein Gaming (keine Serien, Punkte, Abzeichen).
- Kein Körpergewicht.
- Essen unverändert.
- Pro Profil.
- Öffentliches Repo.
- Jeder Task ist ein eigener Commit. Branch `monatsrueckblick`, nach jeder Stufe lokal in `main` mergen, nicht pushen.

## Entscheidungen dieses Plans (beim Lesen prüfen)

1. `goal.push` ist optional; fehlt es, gilt `normal`. So erkennt der Code „nie gewählt“ für die erste Frage.
2. Eine offene oder heilende Beschwerde setzt das ganze Training auf `gentle`, nicht nur betroffene Übungen: Der Code kennt keine Zuordnung Beschwerde → Übung (nur `LEG_COMPLAINT`).
3. `normal` und `hard` ändern im Code nichts gegenüber heute; der Unterschied (Reserve, Drop-Sätze) steht im Prompt. Nur `gentle` ist eine Guardrail.
4. Die Frage nach der Härte ist eine Chat-Nachricht mit Auswahlkarte (`askPush`). Später ändert man die Härte im Profil oder im Chat (Zielentwurf mit `push`, Karte „Übernehmen“).
5. Auslöser „Pause über 21 Tage“ feuert bei der Rückkehr: erstes Krafttraining nach mehr als 21 Tagen ohne.
6. Die Rückblick-Beobachtungen stehen im Feld `review` der Chat-Nachricht; der Planer liest die jüngste. Nach 90 Tagen löscht der Chat sie, dann fehlt der Block.
7. Leichte Woche = Kalenderwoche, in der `end` liegt. Kappung pro Training: höchstens ⌊⅔ × Durchschnitt harter Sätze je Krafttraining der früheren Abschnittswochen⌋; ohne frühere Trainings keine Kappung, aber keine Versagenssätze.
8. „Geplant am Montag“: Die Scan-Aufgabe merkt sich beim ersten Lauf einer Woche die Zahl der Krafttage im Wochenplan (Datei neben `prompts-sent.json`).
9. Ein Tausch einer Kernübung durch die Person gilt für dieses Training; die Kernübung im Abschnitt bleibt bis zum nächsten Rückblick.
10. Der Abschnitt beginnt am Montag nach der Übernahme (am Montag selbst: heute). Das Ende ist höchstens `block.max-weeks` = 6 Wochen nach dem Start (Spec 4–6 Wochen); fällt so kein Rückblick auf das Ende, greift der Weg „Abschnitt endet ohne Rückblick“ (Task 17).

## Review Focus

1. Claude antwortet beim Rückblick nicht oder ist am Limit: nichts wird als gesendet markiert, der nächste Versuch kommt frühestens nach `WEEK_RETRY_MS`, nie zwei Rückblicke im selben Monat. Test in Task 5.
2. Unklare Antwort auf die Beschwerde-Frage („geht so“): der Status bleibt. Eine Beschwerde-id, die nicht offen ist, wird ignoriert. Test in Task 3.
3. Abschnitt mit `gentle` (Szenario M02): auch in harten Abschnittswochen nie Versagens- oder Drop-Sätze. Test in Task 16.
4. Eine ausgefallene Einheit im Abschnitt: das nächste Training nimmt die Vorlage des nächsten geplanten Krafttags, nicht die verpasste. Test in Task 16.
5. Rückblick abgeschaltet oder Schwelle nicht erreicht, Abschnitt läuft ab: Bo schreibt genau einen Satz, der Planer plant danach locker. Test in Task 17.

---

## Stufe A: Monatsrückblick

### Task 1: Regeln, Szenarien und Schalter

**Files:**
- Modify: `src/shared/training-policy/rules.ts`, `src/shared/training-policy/scenarios.ts`, `src/shared/training-policy/index.ts:10`, `src/shared/chat.ts:112-127` (`CoachPrefs`, `readCoachPrefs`), `src/tracking/ui/CoachPrefs.tsx`
- Test: `tests/shared/training-policy.test.ts`, `tests/shared/chat.test.ts`, `tests/tracking/coach-prefs.test.tsx`

**Interfaces:**
- Produces: `CoachPrefs = { week; evening; review: { on: boolean } }`; `DEFAULT_PREFS.review.on === true`; `readCoachPrefs` liest `review.on !== false` (alter Datensatz ohne Feld → an).
- Produces (Register, Domain `planner`, Klasse `product`, `checked`, Status `active`, Entscheidung „Monatsrückblick“): `review.window-days` = 90, `review.min-workouts` = 4, `review.min-gap-days` = 14, `review.pause-days` = 21, `review.weeks` = 13, `review.max-observations` = 3.
- Produces: Szenarien `M01`–`M04` (`task: 12`, Auftrag 12 der Konzept-Spec §19) mit den vier Fällen aus Spec §10 als allgemeine Situation, z. B. M02 „Anfängerin, eine Einheit pro Woche, Härte vorsichtig, abheilende Beschwerde“ → „Nie Versagenssätze; Rückblick fragt nach der Beschwerde“.

- [ ] **Step 1: Tests.** `training-policy.test.ts`: neue Version; `ruleNumber('review.min-gap-days')` = 14; alle `scenarioIds` der neuen Regeln existieren. `chat.test.ts`: `readCoachPrefs({ week: {}, evening: {} }).review.on` ist `true`; `{ review: { on: false } }` → `false`. `coach-prefs.test.tsx`: `it('schaltet den Monatsrückblick aus')`: Schalter „Monatsrückblick“ ist an; Tipp → `port.put` mit `review.on === false`.
- [ ] **Step 2:** `npx vitest run tests/shared/training-policy.test.ts tests/shared/chat.test.ts tests/tracking/coach-prefs.test.tsx` → FAIL.
- [ ] **Step 3:** Regeln, Szenarien und `POLICY_VERSION` (nächste Nummer) eintragen. `Switch label="Monatsrückblick" hint="Bo blickt am letzten Sonntag im Monat mit dir auf die letzten drei Monate zurück."`.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** `git commit -m "feat(rückblick): Regeln und Schalter"`

### Task 2: Wann ein Rückblick fällig ist

**Files:**
- Create: `src/coach/chat/month-review.ts`
- Modify: `src/coach/chat/prompts.ts:9-25` (`SentPrompts`), `src/shared/dates.ts`
- Test: `tests/coach/chat/month-review.test.ts`, `tests/coach/chat/prompts.test.ts`

**Interfaces:**
- Produces: `type Sent = { week?: string; evening?: string; review?: string; reviewSports?: string; pushAsk?: string; drift?: string; blockEnd?: string }`; `SentPrompts.mark(id, k: keyof Sent, v: string)`.
- Produces: `lastSundayOf(date: string): string` in `src/shared/dates.ts` (letzter Sonntag des Monats von `date`; Stufe C braucht es auch im Web).
- Produces: `type ReviewReason = 'month' | 'sports' | 'pause'`; `reviewDue(o: { prefs: CoachPrefs; sportsKey: string; gymDates: readonly string[]; sent: { review?: string; reviewSports?: string }; nowMs: number }): ReviewReason | null`.

Regeln für `reviewDue` (Werte aus dem Register):
- `prefs.review.on` false → null. Seit `sent.review` weniger als `review.min-gap-days` → null.
- `month`: heute = `lastSundayOf(heute)`, Stunde ≥ `prefs.week.hour`, `sent.review` ≠ heute, mindestens `review.min-workouts` verschiedene Krafttage in `review.window-days`.
- `sports`: `sent.reviewSports` gesetzt und ≠ `sportsKey`, Schwelle wie `month`.
- `pause`: jüngster Krafttag ≤ 2 Tage alt und der Krafttag davor mehr als `review.pause-days` früher; keine Schwelle.

- [ ] **Step 1: Tests `month-review.test.ts`.** `lastSundayOf('2026-11-10')` = `'2026-11-29'`; `('2026-02-03')` = `'2026-02-22'`. `it('ist am letzten Sonntag ab der Uhrzeit fällig')`: 29.11. 17 Uhr → null, 18 Uhr → `'month'`. `it('braucht vier Krafttrainings in 90 Tagen')`: 3 Tage → null. `it('lässt 14 Tage Abstand')`: `sent.review` = 20.11., Sonntag 29.11. → null. `it('kommt nach einer Pause außer der Reihe')`: Krafttage 1.10. und heute 10.11. → `'pause'`, auch bei nur 2 Krafttagen. `it('kommt bei neuem Schwerpunkt')`: `reviewSports` ≠ `sportsKey` → `'sports'`; gleich → null. `it('schweigt, wenn abgeschaltet')`.
- [ ] **Step 2: Test `prompts.test.ts`.** `mark(id, 'review', d)` bewahrt `week` und `evening`.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Implementieren. `sportsKey` = sortierte `goal.sports`-Einträge als Text (Hilfsfunktion `sportsKeyOf(goal)` in derselben Datei).
- [ ] **Step 5:** Tests → PASS.
- [ ] **Step 6:** `git commit -m "feat(rückblick): Fälligkeit"`

### Task 3: Der Chat setzt Beschwerden auf „heilt“

**Files:**
- Modify: `src/coach/chat/chat-coach.ts` (Deps um Zeile 34–41, Prompts Zeile 64 und 71, Schemas 97–126, `answer` 211–228, `applyComplaints` 262–267, `answerWorkout` 286), `src/coach/runtime/index.ts:219-227`
- Test: `tests/coach/chat/chat-coach.test.ts`

**Interfaces:**
- Produces: Antwortfeld `complaintsHealing: string[]` (required) in `answerSchema` und `workoutSchema`; `Deps.healComplaint?: (profileId: string, complaintId: string) => void`, verdrahtet mit `coach.updateComplaint(id, cid, 'healing', nowMs())`.
- Produces: `applyComplaints(id, complaint, over, healing: string[])`; eine id in `over` und `healing` zählt als `over`.

- [ ] **Step 1: Tests.**
  - `it('setzt eine Beschwerde auf heilt, wenn die Person es sagt')`: offene Beschwerde `c1`; Stub antwortet `complaintsHealing: ['c1']` → `healComplaint` mit `c1` aufgerufen.
  - `it('lässt den Status ohne klare Antwort')`: Stub mit leeren Listen → weder `healComplaint` noch `endComplaint`.
  - `it('ignoriert ids, die nicht offen sind')`: `complaintsHealing: ['x']` → kein Aufruf.
  - `it('ändert keine Beschwerde aus einer Nachricht, die Bo selbst eröffnet')`: `openWeek` mit `complaintsHealing: ['c1']` → kein Aufruf.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Prompt Zeile 64 ergänzen: „Sagt sie, dass eine Beschwerde besser wird, aber noch nicht weg ist, nenne deren id in complaintsHealing; sonst ist complaintsHealing leer. Ohne klare Aussage änderst du nichts.“ Gleicher Satz kurz in `WORKOUT_SYSTEM_PROMPT`.
- [ ] **Step 4:** `npx vitest run tests/coach/chat` → PASS.
- [ ] **Step 5:** `git commit -m "feat(chat): Beschwerde kann heilen"`

### Task 4: Kraftdaten für den Rückblick

**Files:**
- Create: `src/coach/gym/review-facts.ts`
- Modify: `src/coach/gym/gym-coach.ts` (neue Methode neben `nextSteps`, Zeile 289), `src/coach/chat/long-term.ts:16-31` (`weekHistory` mit Parameter `weeks = WEEKS`)
- Test: `tests/coach/gym/review-facts.test.ts`, `tests/coach/chat/long-term.test.ts`

**Interfaces:**
- Consumes: `muscleVolume(workouts, templates, catalog, nowMs, strength, focus)` aus `muscle-volume.ts:12`, `suggestNext` aus `history.ts:130`.
- Produces: `type StrengthFacts = { wochen: { montag: string; kraft: number }[]; uebungen: { titel: string; trend: 'steigt' | 'gleich' | 'faellt'; einheiten: number }[]; untenDauerhaft: string[] }`.
- Produces: `strengthFacts(workouts: StrengthWorkout[], templates: ExerciseTemplate[], catalog: Exercise[], goal: { strength: Strength; focus: MuscleGroup[] }, nowMs: number): StrengthFacts` — 13 Wochen (`review.weeks`); `uebungen` = die bis zu fünf häufigsten Übungen, Trend aus der ersten Arbeitslast der ersten und letzten Einheit im Fenster; `untenDauerhaft` = Muskelgruppen-Labels, deren `state` bei `nowMs`, `nowMs − 28 d` und `nowMs − 56 d` „unter dem Ziel“ ist.
- Produces: `GymCoach.reviewFacts(id: string): StrengthFacts | null` (null ohne Vorlagenliste, wie `nextSteps`).
- Produces: `weekHistory(stats, nowMs, weeks = 8)`.

- [ ] **Step 1: Tests `review-facts.test.ts`.** `it('zählt Krafttrainings je Woche über 13 Wochen')`: 13 Einträge, ältester zuerst. `it('erkennt eine steigende Übung')`: Last 40 → 50 kg → `trend: 'steigt'`. `it('nennt nur dauerhaft niedrige Muskeln')`: Gruppe nur heute unter Ziel → nicht in `untenDauerhaft`; in allen drei Fenstern unter Ziel → enthalten.
- [ ] **Step 2: Test `long-term.test.ts`.** `weekHistory(stats, now, 13).length` = 13; ohne Parameter 8.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Implementieren; `reviewFacts` nutzt `this.history(id)` und `[...this.listed.get(id).values()]`.
- [ ] **Step 5:** `npx vitest run tests/coach/gym tests/coach/chat` → PASS.
- [ ] **Step 6:** `git commit -m "feat(rückblick): Kraftdaten über drei Monate"`

### Task 5: Bo schreibt den Rückblick

**Files:**
- Modify: `src/shared/chat.ts` (`ChatMessage`, `readChat`), `src/coach/chat/chat-coach.ts` (Deps, neue Methode neben `openWeek` Zeile 424), `src/coach/runtime/index.ts:219-227`, `src/coach/runtime/scan.ts:259-274`
- Test: `tests/coach/chat/month-review-chat.test.ts`, `tests/shared/chat.test.ts`

**Interfaces:**
- Consumes: `reviewDue`, `sportsKeyOf`, `SentPrompts.mark` (Task 2), `GymCoach.reviewFacts` (Task 4), `weekHistory(…, 13)`.
- Produces: `ChatMessage.review?: { observations: { text: string; reason: string }[] }`; `readChat` übernimmt es nur mit höchstens `review.max-observations` Einträgen aus Strings.
- Produces: `Deps.strengthFacts?: (profileId: string) => StrengthFacts | null`; `ChatCoach.openReview(id: string, reason: ReviewReason): Promise<boolean>` (nie throw; `false` bei Fehler oder `busy`).
- Produces: `REVIEW_SYSTEM_PROMPT` und `reviewSchema = { opening: string; observations: { text; reason }[]; complaintQuestions: { id; question }[]; nextWeeks: string }` (alle required).

Prompt-Daten (keine `verlauf`-Daten): `heute`, `ziel` (`goalOfProfile`), Wunschzeile, Ausschlüsse als Titel, `beschwerden` (offen und heilend, mit id), `wochen` (`weekHistory(…, 13)`), `kraft` (`strengthFacts`), `geplant` (Krafttage je Woche aus `planOfWeek` der letzten 13 Wochen), `anlass` (`reason`). Systemprompt: Persona, „ehrlich und ermutigend, Regelmäßigkeit vor Gewichten“, höchstens drei Beobachtungen mit Grund, keine Vorwürfe, keine Serien, kein „du hast nur“, weniger Training heißt Rahmen anpassen, nie über Körpergewicht, Kalorien oder Aussehen, nichts gegen Regeln oder Beschwerden.

Nachrichtenaufbau im Code: `opening`, Leerzeile, je Beobachtung ein Satz „{text} {reason}“, je offene Beschwerde genau eine Frage (die der KI mit passender id, sonst „Wie geht es dir inzwischen mit {text}?“), zum Schluss `nextWeeks`. `push: true`, `review: { observations }`.

- [ ] **Step 1: Tests `month-review-chat.test.ts`** (Stub-`ask`, Fake-Store):
  - `it('schreibt höchstens drei Beobachtungen')`: Stub liefert fünf → Nachricht und `review.observations` haben drei.
  - `it('fragt jede offene Beschwerde genau einmal')`: zwei offene, Stub liefert eine Frage → zwei Fragen im Text, eine davon der Ersatzsatz.
  - `it('liest nicht den Chat-Verlauf')`: Verlauf mit Text „GEHEIM“ → Prompt enthält „GEHEIM“ nicht.
  - `it('sendet mit Push')`: `push === true`.
  - `it('schreibt nichts, wenn Claude ausfällt')`: Stub wirft → `false`, kein `chat`-Datensatz.
- [ ] **Step 2: Test `chat.test.ts`.** `readChat` mit `review` von vier Beobachtungen → `null`; mit zwei → übernommen.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Implementieren. Scan `prompts`: nach der Wochenrunde `reviewDue({ prefs, sportsKey, gymDates: gymDoneDates(p.id), sent: sentPrompts.get(p.id), nowMs: now })`; bei Fälligkeit und `now − reviewTried ≥ WEEK_RETRY_MS`: `chat.openReview` und nur bei `true` `mark('review', heute)` und `mark('reviewSports', sportsKey)`. Ohne `reviewSports` beim ersten Scan nur den Schlüssel merken, nichts senden.
- [ ] **Step 5:** `npx vitest run tests/coach tests/shared` → PASS.
- [ ] **Step 6:** `git commit -m "feat(rückblick): Bo schreibt den Monatsrückblick"`

### Task 6: Lockerer Modus kennt den Rückblick

**Files:**
- Modify: `src/coach/gym/prompt.ts` (`PromptInput` Zeile 79–100, Muskelsatz in `GYM_SYSTEM_PROMPT` Zeile 62, Blöcke in `buildGymPrompt`), `src/coach/gym/gym-coach.ts:472`, `src/shared/chat.ts`
- Test: `tests/coach/gym/prompt.test.ts` (neu), `tests/shared/chat.test.ts`

**Interfaces:**
- Produces: `latestReview(thread: ChatEntry[]): { atMs: number; observations: { text: string; reason: string }[] } | null` in `src/shared/chat.ts`.
- Produces: `PromptInput.review?: { observations: { text: string; reason: string }[] }` → Datenblock `rueckblick`.

- [ ] **Step 1: Tests.** `it('gibt dem Planer die Beobachtungen des letzten Rückblicks')`: Prompt enthält `rueckblick-nur-daten` mit beiden Texten. `it('wägt Muskellücken ab')`: `GYM_SYSTEM_PROMPT` enthält „gegen Ziel und Schwerpunkt abwägen“ und nicht mehr „plane sie bevorzugt ein“. `latestReview` nimmt die jüngste Coach-Nachricht mit `review`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Muskelsatz ersetzen: „Liegt eine Gruppe unter ihrem Zielbereich, wäge das gegen Ziel und Schwerpunkt ab; kleine isolierte Muskeln müssen nicht in jeder Einheit vorkommen. Die Muskelbilanz ist eine Prüfung, nicht der einzige Antrieb.“ Gym-Coach liest `chatThread(store.all(id, 'chat'))`.
- [ ] **Step 4:** `npx vitest run tests/coach/gym tests/shared` → PASS.
- [ ] **Step 5:** `git commit -m "feat(gym): Planer kennt den Rückblick"`

### Task 7: Stufe A abschließen

- [ ] `npm run typecheck`, `npx vitest run` → alles grün.
- [ ] `npm run dev:sim` mit Uhr auf einen letzten Sonntag: Rückblick erscheint im Sensai-Chat; Schalter im Profil wirkt.
- [ ] `docs/roadmap.md`: Zeile „Monatsrückblick“ (Stufe A) auf ✅. Merge in `main`.

## Stufe B: Härte

### Task 8: `push` im Ziel und im Register

**Files:**
- Modify: `src/shared/personal.ts:20-30` (Typen), `:37-47` (`readGoalParts`), `:73-77` (`storedGoalOf`), `:110` (`Rule.goal`) und `readRule`-Zielteil, `src/coach/chat/chat-coach.ts:89-93` (`ruleDraftSchema.goal`), `src/tracking/ui/RuleCard.tsx` (`same`), `src/shared/training-policy/rules.ts`, `src/shared/training-policy/index.ts:10`
- Test: `tests/shared/personal.test.ts`, `tests/shared/training-policy.test.ts`

**Interfaces:**
- Produces: `type Push = 'gentle' | 'normal' | 'hard'`; `GoalBody.push?: Push`; `PUSH_LABEL: Record<Push, string> = { gentle: 'Vorsichtig', normal: 'Normal', hard: 'Fordere mich' }`.
- Produces: `effectivePush(goal: { push?: Push }, complaints: readonly { status: string }[]): Push` — `gentle` bei einer Beschwerde `active` oder `healing`, sonst `goal.push ?? 'normal'`.
- Produces (Register, Domain `gym`): `push.rir` (`weighed`, Status `active`, `value` {1,3}, `ranges` gentle {2,3}, normal {1,3}, hard {0,2}, Einheit RIR); `push.gentle-no-failure` (`checked`, value 0: Versagens- und Drop-Sätze bei Vorsichtig); `push.ask-after-workouts` (`checked`, value 3). `scenarioIds` M01, M02.

- [ ] **Step 1: Tests.** `readGoal({ …, push: 'hard' }).push` = `'hard'`; `push: 'x'` → `null`; ohne `push` lesbar, `push` undefined. `applyGoalPatch(prior, { push: 'gentle' }, today).push` = `'gentle'`. `effectivePush({ push: 'hard' }, [{ status: 'healing' }])` = `'gentle'`; `({}, [])` = `'normal'`; `({ push: 'hard' }, [{ status: 'over' }])` = `'hard'`. Register: `ruleNamedRange('push.rir', 'gentle')` = {2,3}.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren; `storedGoalOf` gibt `push` weiter, wenn gesetzt.
- [ ] **Step 4:** `npx vitest run tests/shared tests/tracking` → PASS.
- [ ] **Step 5:** `git commit -m "feat(härte): Härte im Ziel"`

### Task 9: Guardrail und Prompt für die Härte

**Files:**
- Modify: `src/coach/gym/guardrails.ts` (`GymContext` Zeile 15–24, `checkWorkout` 153–190, `REASON_PHRASES` 196), `src/coach/gym/limits.ts`, `src/coach/gym/prompt.ts` (`PromptInput`, `tail`), `src/coach/gym/gym-coach.ts:451-472`
- Test: `tests/coach/gym/guardrails.test.ts`, `tests/coach/gym/guardrails-phrase.test.ts`, `tests/coach/gym/prompt.test.ts`, `tests/coach/gym/gym-coach.test.ts`

**Interfaces:**
- Consumes: `effectivePush`, `PUSH_LABEL` (Task 8).
- Produces: `GymContext.push?: Push`; Ablehnung `'Versagen passt nicht zur Härte'`; `reasonPhrase` → „Sätze bis zum Versagen, obwohl du vorsichtig trainierst“.
- Produces: `PromptInput.push?: Push` → Satz „Härte: {Label}. Plane die Arbeitssätze mit {min} bis {max} Wiederholungen Reserve.“ plus je Stufe: gentle „Keine Versagens- und keine Drop-Sätze.“; normal „Versagen höchstens im letzten Satz an sicheren Geräten.“; hard „Versagens- und Drop-Sätze sind an sicheren Geräten erlaubt, innerhalb der Grenze für Versagenssätze.“

- [ ] **Step 1: Tests.** `it('lehnt Versagenssätze bei vorsichtiger Härte ab')`: `push: 'gentle'`, ein `failure`-Satz an der Maschine → `{ ok: false, reason: 'Versagen passt nicht zur Härte' }`; gleich mit `dropset`. `it('erlaubt sie bei normal und hart wie bisher')`. `it('setzt bei offener Beschwerde vorsichtig')` (`gym-coach.test.ts`): Profil mit `push: 'hard'` und Beschwerde `healing` → Prompt enthält „Härte: Vorsichtig“, KI-Antwort mit Versagenssatz wird abgelehnt. Prompt: Reserve-Werte kommen aus `ruleNamedRange`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** In `checkWorkout` nach der Versagens-Obergrenze prüfen. `gym-coach` berechnet `effectivePush(goal, open)` einmal und gibt es an `ctx` und Prompt.
- [ ] **Step 4:** `npx vitest run tests/coach/gym` → PASS.
- [ ] **Step 5:** `git commit -m "feat(härte): vorsichtig heißt kein Versagen"`

### Task 10: Härte im Profil

**Files:**
- Modify: `src/tracking/ui/GoalRules.tsx:143-145` (`GoalSheet`)
- Test: `tests/tracking/frame-ui.test.tsx`

- [ ] **Step 1: Test.** `it('ändert die Härte im Ziel')`: GoalSheet öffnen; `ChoiceRow` „Härte“ zeigt „Normal“ ohne gespeicherten Wert; „Fordere mich“ wählen → `goal`-Datensatz mit `push: 'hard'`, `strength` und `focus` unverändert.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3:** `ChoiceRow label="Härte"` unter „Ziel“ mit `PUSH_LABEL`; darunter ein Hinweissatz: „Bei einer offenen Beschwerde plant Bo immer vorsichtig.“
- [ ] **Step 4:** `npx vitest run tests/tracking` → PASS.
- [ ] **Step 5:** `git commit -m "feat(härte): Härte im Profil"`

### Task 11: Bo fragt nach der Härte

**Files:**
- Modify: `src/coach/motivation.ts:5` (export), `src/coach/coach.ts:325` (neue Methode `questionAsked`), `src/coach/chat/month-review.ts`, `src/shared/chat.ts`, `src/coach/chat/chat-coach.ts` (`openReview`, neue Methode `askPush`), `src/coach/runtime/scan.ts` (Aufgabe `prompts`), `src/tracking/ui/ProposalCard.tsx`, `src/tracking/ui/chat-open.ts:16`
- Create: `src/tracking/ui/PushCard.tsx`
- Test: `tests/coach/chat/month-review.test.ts`, `tests/coach/chat/month-review-chat.test.ts`, `tests/tracking/push-card.test.tsx`

**Interfaces:**
- Produces: `export const QUESTION_GAP_DAYS`; `Coach.questionAsked(profileId: string): void` setzt `lastQuestionMs`.
- Produces: `pushAskDue(o: { goal: { push?: Push }; complaints: readonly { status: string }[]; gymDates: readonly string[]; sent: { review?: string; pushAsk?: string }; lastQuestionMs?: number; nowMs: number }): boolean` — true, wenn `push` fehlt, keine offene/heilende Beschwerde, mindestens `push.ask-after-workouts` Krafttage, kein Rückblick und keine Härte-Frage bisher, letzte Frage ≥ `QUESTION_GAP_DAYS` her.
- Produces: `ChatMessage.askPush?: true`. `ChatCoach.askPush(id): void` schreibt ohne KI: „Wie sehr soll ich dich beim Krafttraining fordern? Du kannst das jederzeit im Profil ändern.“ mit `push: true, askPush: true`. `openReview` setzt `askPush` beim ersten Rückblick (`sent.review` fehlt) und `push` fehlt.
- Produces: `PushCard({ port, now, newId, m })`: drei Knöpfe (`PUSH_LABEL`) und „Später“. Wahl schreibt `goal` mit `push` und eine Personen-Nachricht `takes: m.id`; danach „Gilt ab jetzt: {Label}.“ und „Rückgängig“ (setzt den vorigen Wert, `undoes: m.id`). „Später“ schreibt `declines: m.id`.

- [ ] **Step 1: Tests `month-review.test.ts`.** `it('fragt nach dem dritten Krafttraining')`: 3 Tage → true; 2 → false. `it('fragt nicht bei Beschwerde, nach dem ersten Rückblick oder zweimal')`. `it('hält drei Tage Abstand zur letzten Frage')`.
- [ ] **Step 2: Tests Chat und Karte.** `it('fragt beim ersten Rückblick nach der Härte')`: `askPush === true`; beim zweiten Rückblick nicht. `push-card.test.tsx`: Wahl „Vorsichtig“ → Ziel `push: 'gentle'`, Knopf „Rückgängig“ sichtbar; Rückgängig → Ziel ohne `push`; „Später“ → Karte nicht mehr in `openProposals`.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Implementieren. Scan: bei `pushAskDue` → `chat.askPush`, `mark('pushAsk', heute)`, `coach.questionAsked(id)`.
- [ ] **Step 5:** `npx vitest run tests/coach tests/tracking` → PASS.
- [ ] **Step 6:** `git commit -m "feat(härte): Bo fragt nach der Härte"`

### Task 12: Stufe B abschließen

- [ ] `npm run typecheck`, `npx vitest run` → grün.
- [ ] Web-App lokal: Härte im Profil ändern; Frage-Karte im Chat beantworten und rückgängig machen.
- [ ] `docs/roadmap.md` aktualisieren. Merge in `main`.

## Stufe C: Fester Abschnitt

### Task 13: Datensatz `block`

**Files:**
- Create: `src/shared/block.ts`
- Modify: `src/shared/records.ts:2` (`RECORD_KINDS`), `:17-29` (Rang wie `rule`), `src/web/validate.ts:30-60`, `src/shared/training-policy/rules.ts`, `src/shared/training-policy/index.ts:10`
- Test: `tests/shared/block.test.ts`, `tests/shared/records.test.ts`, `tests/shared/training-policy.test.ts`

**Interfaces:**
- Produces: `type BlockState = 'proposed' | 'active' | 'ended' | 'declined'`; `type BlockDay = { sport: Sport; hardness: Hardness; legs?: boolean; long?: boolean; template?: number }`; `type BlockBody = { state: BlockState; templates: { name: string; core: string[] }[]; rhythm: BlockDay[] /* 7, Montag zuerst */; start?: string; end?: string; priorMode?: PlanMode; atMs: number }`.
- Produces: `readBlock(body: unknown): BlockBody | null` (1–4 Vorlagen, Kern 3–4 ids aus `block.core-per-template`, Rhythmus besteht `checkWeekPlan`, jedes `template` zeigt auf eine Vorlage), `blockRecord(id, b, nowMs, have?)`, `blockId(msgId) = 'block-' + msgId`.
- Produces: `blockDates(today: string): { start: string; end: string }` — Start nach Entscheidung 10; Ende = `lastSundayOf` des nächsten Monatsendes, liegt es weniger als `block.min-weeks` × 7 Tage nach `today`, das übernächste; höchstens der Sonntag am Ende der `block.max-weeks`. Woche ab `start`.
- Produces: `activeBlock(records, today): (BlockBody & { id: string }) | null` (Zustand `active`, `start ≤ today ≤ end`); `blockWeek(b, date): { n: number; of: number; light: boolean }`; `blockWeeks(b): WeekProposal[]`; `templateFor(b, planDate): { name: string; core: string[] } | null` (Vorlage des Rhythmus-Tags, sonst die des nächsten Krafttags im Rhythmus).
- Produces (Register, Domain `gym`, `checked`): `block.min-weeks` = 4, `block.max-weeks` = 6, `block.core-per-template` = {3,4}, `block.light-share` = 0,67, `block.stagnation-sessions` = 2, `block.drift-share` = 0,5, `block.drift-weeks` = 2. Szenarien M01, M03.

- [ ] **Step 1: Tests `block.test.ts`.** `blockDates('2026-11-29')` = `{ start: '2026-11-30', end: '2026-12-27' }`; `blockDates('2026-12-07')` → `{ start: '2026-12-07', end: '2027-01-17' }` (6 Wochen gekappt). `blockWeek` am letzten Montag → `light: true`. `activeBlock` nach `end` → null. `readBlock` mit 5 Kernübungen → null; mit drei harten Tagen → null. `templateFor` an einem Ruhetag → Vorlage des nächsten Krafttags.
- [ ] **Step 2: Test `records.test.ts`.** `applyRecord`: `active` schlägt jüngeres `proposed`; `validBody('block', …)`.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Implementieren.
- [ ] **Step 5:** `npx vitest run tests/shared tests/web` → PASS.
- [ ] **Step 6:** `git commit -m "feat(abschnitt): Datensatz block"`

### Task 14: Der Rückblick schlägt einen Abschnitt vor

**Files:**
- Modify: `src/coach/chat/chat-coach.ts` (`reviewSchema`, `REVIEW_SYSTEM_PROMPT`, `openReview`, `put`), `src/shared/chat.ts` (`ChatMessage.block`, `readChat`)
- Test: `tests/coach/chat/month-review-chat.test.ts`

**Interfaces:**
- Produces: `reviewSchema.block: null | { templates: { name; core: string[] }[]; rhythm: BlockDay[] }`; `ChatMessage.block?: string` (id des `proposed`-Datensatzes, vor der Nachricht geschrieben wie `rule`).
- Prompt: „Schlag einen festen Abschnitt nur vor, wenn er zum Ziel und zu den letzten Wochen passt; sonst bleib locker. Kernübungen nach Ziel, Vorlieben und Regeln der Person, nie ausgeschlossene, 3 bis 4 je Vorlage, ids aus katalog.“

- [ ] **Step 1: Tests.**
  - `it('legt einen vorgeschlagenen Abschnitt an')`: Stub mit gültigem `block` → `block`-Datensatz `proposed`, Nachricht trägt `block`.
  - `it('lässt ausgeschlossene Kernübungen weg')`: eine Kernübung von aktiver Ausschluss-Regel betroffen → fehlt; bleiben weniger als 3, gibt es keinen Abschnitt und der Text bleibt ohne Karte.
  - `it('verwirft einen Rhythmus gegen die Erholungsregeln')`: drei harte Tage → kein Datensatz.
  - `it('schlägt keinen Abschnitt vor, während einer läuft')`: aktiver Abschnitt → `block` wird ignoriert.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren; Kern-ids über `validIds` und `excludedOf` prüfen, dann `readBlock`.
- [ ] **Step 4:** `npx vitest run tests/coach/chat` → PASS.
- [ ] **Step 5:** `git commit -m "feat(abschnitt): Vorschlag im Rückblick"`

### Task 15: Übernehmen, Rückgängig und „machen wir“

**Files:**
- Create: `src/tracking/ui/BlockCard.tsx`, `src/shared/block-take.ts`
- Modify: `src/tracking/ui/ProposalCard.tsx`, `src/tracking/ui/chat-open.ts:16`, `src/coach/chat/chat-coach.ts:174-205` (`acceptOpenRule` → auch offener Abschnitt), CSS wie `tk-nextchange`
- Test: `tests/shared/block-take.test.ts`, `tests/tracking/block-card.test.tsx`, `tests/coach/chat/chat-coach.test.ts`

**Interfaces:**
- Produces: `blockTakeWrites(o: { block: TrackedRecord; frame: TrackedRecord[]; plans: TrackedRecord[]; msgId: string; today: string; nowMs: number }): TrackedRecord[] | null` — Abschnitt `active` mit `blockDates(today)` und `priorMode`, `frame.mode = 'week'`, je Woche aus `blockWeeks` ein `weekplan` mit `takenFrom: msgId` und `prior` (wie `takeWeekPlan`). null, wenn der Abschnitt nicht mehr `proposed` ist.
- Produces: `blockUndoWrites(o: { … }): TrackedRecord[] | { refused: string }` — Abschnitt gelöscht, `frame.mode = priorMode`, Wochenpläne zurück; `UNDO_REFUSED`, wenn ein Wochenplan seither geändert wurde (`weekUndoRefusal`).
- Karte: Überschrift „Fester Abschnitt bis {Datum}“ (Datum aus `blockDates` zum Zeitpunkt der Anzeige), je Vorlage Name und Kernübungen in einem Satz, Wochenrhythmus als `Week brief`; `TAKE` / `DECLINE`; nach Übernahme „Gilt ab {Start}.“ mit `UNDO`.
- Chat: „machen wir“ bei offenem Abschnitt der direkt vorigen Coach-Nachricht → `blockTakeWrites` über den Store, Antwort trägt `block` (Karte zeigt „Rückgängig“).

- [ ] **Step 1: Tests `block-take.test.ts`.** Übernahme am 29.11. → fünf Datensätze (Abschnitt, Rahmen, vier Wochenpläne vom 30.11. an); `priorMode` = `'spontaneous'`, wenn der Rahmen so war. Undo stellt Rahmen und Wochenpläne her. Undo nach Änderung eines Wochenplans → `refused`.
- [ ] **Step 2: Tests Karte und Chat.** `it('übernimmt den Abschnitt mit Rückgängig')`. `it('übernimmt den offenen Abschnitt auf ausdrücklichen Wunsch')`: Stub `acceptsRule: true` → Abschnitt `active`. `it('übernimmt nichts ohne offenen Vorschlag')`.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Implementieren. `openProposals` zeigt `m.block` mit Zustand `proposed`.
- [ ] **Step 5:** `npx vitest run tests/shared tests/tracking tests/coach/chat` → PASS.
- [ ] **Step 6:** `git commit -m "feat(abschnitt): übernehmen und rückgängig"`

### Task 16: Der Planer liest die Kernübungen

**Files:**
- Modify: `src/coach/gym/history.ts` (neben `suggestNext`), `src/coach/gym/guardrails.ts` (`GymContext`, `checkWorkout`, `REASON_PHRASES`), `src/coach/gym/limits.ts`, `src/coach/gym/prompt.ts`, `src/coach/gym/gym-coach.ts:440-472`, `src/shared/personal.ts:222` (`personalKeyOf` mit Blöcken), `src/coach/runtime/index.ts:217`
- Test: `tests/coach/gym/history.test.ts`, `tests/coach/gym/guardrails.test.ts`, `tests/coach/gym/guardrails-phrase.test.ts`, `tests/coach/gym/prompt.test.ts`, `tests/coach/gym/gym-coach.test.ts`

**Interfaces:**
- Consumes: `activeBlock`, `blockWeek`, `templateFor` (Task 13), `hardSetsOf` aus `pre-fatigue.ts`.
- Produces: `stagnates(templateId: string, workouts: StrengthWorkout[], nowMs: number): boolean` — die letzten `block.stagnation-sessions` vergleichbaren Einheiten ohne mehr Last und ohne mehr Wiederholungen bei gleicher Last gegenüber der jeweils vorigen (gleicher Vergleich wie die Progression).
- Produces: `GymContext.block?: { core: string[]; exempt: ReadonlySet<string>; light: boolean; lightCap: number | null }`. Ablehnungen `'Kernübung fehlt'` und `'zu viel für die leichte Woche'`.
- `exempt` = Kernübungen, die stagnieren, ausgeschlossen sind, bei `avoidLegs` Beine trainieren, durch einen übernommenen Tausch ersetzt sind, oder alle, wenn eine Beschwerde offen ist.
- Prompt-Block `abschnitt`: Woche n von m, Vorlage, Kernübungen mit Titel, stagnierende markiert, `leichteWoche`. Satz: „Im Abschnitt bleiben die Kernübungen; Ergänzungen wählst du frei. Woche 1 an der oberen Reserve der Härte, jede Woche eine Wiederholung weniger Reserve bis zur unteren Grenze; die leichte Woche mit etwa zwei Dritteln der Sätze bei gleicher Last. Verpasste Einheiten holt niemand nach.“

- [ ] **Step 1: Tests.**
  - `history.test.ts`: `it('erkennt Stagnation nach zwei gleichen Einheiten')`; mehr Wiederholungen → false.
  - `guardrails.test.ts`: `it('lehnt einen Plan ohne Kernübung ab')`; Kernübung in `exempt` fehlt → ok. `it('kappt die leichte Woche')`: Durchschnitt 15 harte Sätze → Plan mit 11 → abgelehnt, mit 10 → ok; Versagenssatz → abgelehnt. `it('bleibt vorsichtig im Abschnitt')` (Szenario M02): `push: 'gentle'`, Abschnittswoche 3 → Versagenssatz abgelehnt.
  - `gym-coach.test.ts`: `it('plant nach einer ausgefallenen Einheit die nächste Vorlage')`: Rhythmus Mo A, Do B; Montag ohne Training, heute Donnerstag → Kernübungen von B, nicht A. `it('plant nach dem Ende wieder locker')`: nach `end` kein `abschnitt`-Block.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3:** Implementieren. `lightCap` = ⌊`block.light-share` × Durchschnitt `hardSetsOf` je Krafttraining zwischen `start` und dem Montag der leichten Woche⌋ (Entscheidung 7). `personalKeyOf` bekommt `blockRecords` als sechsten Parameter, damit ein übernommener Abschnitt neu planen lässt.
- [ ] **Step 4:** `npx vitest run tests/coach/gym tests/shared` → PASS.
- [ ] **Step 5:** `git commit -m "feat(abschnitt): Planer hält die Kernübungen"`

### Task 17: Anzeige, Abweichung und Ende

**Files:**
- Create: `src/tracking/ui/BlockLine.tsx`, `src/tracking/ui/DriftCard.tsx`, `src/coach/chat/block-watch.ts`
- Modify: `src/tracking/ui/CoachScreen.tsx` (Woche), `src/web/app/Training.tsx` (Kraft), `src/shared/chat.ts` (`ChatMessage.drift`), `src/coach/chat/chat-coach.ts`, `src/coach/runtime/scan.ts`, `src/tracking/ui/ProposalCard.tsx`, `src/tracking/ui/chat-open.ts`
- Test: `tests/shared/block.test.ts`, `tests/coach/chat/block-watch.test.ts`, `tests/tracking/block-line.test.tsx`, `tests/tracking/drift-card.test.tsx`

**Interfaces:**
- Produces: `blockLine(b, today, plans): string | null` in `block.ts`, z. B. „Woche 2 von 4 im festen Abschnitt. Als Nächstes kommt {Vorlage} am {Tag}.“; in der leichten Woche „Letzte Woche im Abschnitt, sie ist leichter.“ `BlockLine` zeigt sie auf Woche und Kraft, sonst nichts.
- Produces: `class PlannedWeeks` (Datei `chat/planned-weeks.json`): `note(id, monday, count)` nur beim ersten Mal, `get(id, monday)`.
- Produces: `driftDue(o: { block; planned: (monday: string) => number | undefined; gymDates: readonly string[]; sent: { drift?: string }; today: string }): boolean` — die zwei letzten vollen Kalenderwochen im Abschnitt haben je weniger als `block.drift-share` × geplant (geplant > 0); seit `sent.drift` mindestens `block.drift-weeks` × 7 Tage.
- Produces: `ChatMessage.drift?: string` (Abschnitts-id). `ChatCoach.askDrift(id, blockId)` schreibt ohne KI: „Die letzten zwei Wochen sahen anders aus als geplant. Sollen wir wieder locker planen?“ (`push: true`). `DriftCard`: „Ja, locker planen“ → Abschnitt `ended`, `frame.mode = 'spontaneous'`, Ziel unverändert, danach „Rückgängig“; „Nein, weiter so“ → `declines`.
- Produces: `blockEndDue(o: { block; sent: { blockEnd?: string; review?: string }; today: string }): boolean` — `today > end`, kein Rückblick am Tag `end`, `sent.blockEnd ≠ id`. Text ohne KI: „Dein fester Abschnitt ist vorbei. Ab jetzt plane ich wieder locker, dein Ziel bleibt.“

- [ ] **Step 1: Tests `block-watch.test.ts`.** `it('fragt nach zwei Wochen mit weniger als der Hälfte')`: geplant 3/3, gemacht 1/1 → true; gemacht 2/1 → false. `it('fragt frühestens nach zwei weiteren Wochen erneut')`. `it('zählt die laufende Woche nicht')`. `it('meldet das Ende, wenn kein Rückblick kam')`: Rückblick abgeschaltet → true, einmal; mit Rückblick am `end` → false.
- [ ] **Step 2: Tests UI.** `block-line.test.tsx`: Zeile auf Woche mit „Woche 2 von 4“; ohne Abschnitt nichts. `drift-card.test.tsx`: „Ja, locker planen“ → Rahmen `spontaneous`, Abschnitt `ended`, `goal` unverändert, „Rückgängig“ stellt beides her.
- [ ] **Step 3:** Tests → FAIL.
- [ ] **Step 4:** Implementieren. Scan `prompts`: für Profile mit Abschnitt `PlannedWeeks.note(id, montag, Krafttage im Wochenplan)`, dann `driftDue` → `askDrift` + `mark('drift', heute)`, `blockEndDue` → `chat.say` + `mark('blockEnd', id)`.
- [ ] **Step 5:** `npx vitest run tests/shared tests/coach/chat tests/tracking` → PASS.
- [ ] **Step 6:** `git commit -m "feat(abschnitt): Anzeige, Abweichung und Ende"`

### Task 18: Stufe C abschließen

- [ ] `npm run typecheck`, `npx vitest run` → grün.
- [ ] `npm run dev:sim` bzw. Web-App lokal: Rückblick mit Abschnitt-Vorschlag (Stub oder echte KI), übernehmen, Zeile auf Woche und Kraft, rückgängig machen.
- [ ] Szenarien M01–M04 gegen Spec §10 durchgehen: Rückblick ermutigend, höchstens drei Beobachtungen, nichts gegen Regel oder Beschwerde, M02 nie Versagenssätze, kein Nachholen.
- [ ] `docs/roadmap.md`: Zeile auf ✅, Parkplatz unten eintragen. Merge in `main`.

## Parkplatz (nicht in diesem Plan)

- Härte pro betroffener Übung statt fürs ganze Training, sobald Beschwerden Muskeln oder Übungen kennen.
- Dauerhafter Tausch einer Kernübung durch die Person mitten im Abschnitt.
- Härte in jedem Rückblick als eigene Auswahl statt über Chat oder Profil.
- Drop-Sätze bei „Fordere mich“ in die Grenze für Versagenssätze einrechnen.
