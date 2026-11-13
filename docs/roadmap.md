# PandaFit Roadmap

Stand 06.11.2026. Diese Seite ersetzt die parallelen Listen „Auftrag 0–12“ (Konzept §19), „Schritte 0–8“ (Migrationsbewertung §5) und die Pakete im Grundlagenpapier als **einzige Arbeitsreihenfolge**. Die Dokumente bleiben fachliche Grundlage: [Konzept](superpowers/specs/2026-11-06-adaptive-training-coach-design.md), [Trainingswissenschaft](research/2026-11-06-training-science-foundation.md), [Migrationsbewertung](research/2026-11-06-migration-assessment.md).

## Leitsätze

- **Leicht und ruhig.** Zwei Gelegenheitsnutzer sollen ohne Einarbeitung zurechtkommen. Keine Gamification, keine Workout-Skriptsprache, keine Zahlenflut; lieber vier verständliche Zustände als zwanzig Dezimalwerte.
- **Ein Training geht nie verloren.** Protokollieren funktioniert ohne Netz und ohne KI.
- **Allgemeine Mechanismen statt Einzelfälle.** Werden Namen oder Sonderfälle aufgezählt, ist das ein Warnsignal. Muster: *KI schlägt vor → Person bestätigt → Ergebnis wird gespeichert → Code wendet es danach ohne KI an.*
- **Vorschlag, Bestätigen, Rückgängig.** Der Coach ändert nichts still. Jede Änderung hat einen Grund in einem Satz und lässt sich zurücknehmen.
- **Produktregeln im Code, Persönliches in der Datenbank.** Das Regelregister (`src/shared/training-policy/`) ist versioniert und geprüft; Ziele, eigene Regeln und Zuordnungen sind synchronisierte Records.

## Arbeitsweise

1. **Ein Meilenstein nach dem anderen.** Jeder Meilenstein ist im echten Training spürbar.
2. **Brief vor dem Bau:** Ziel in einem Satz, 3–5 Abnahmesätze aus Nutzersicht, was wegfällt, was nicht dazugehört. Die Person segnet den Brief ab.
3. **Plan nur für den nächsten Meilenstein.** Spätere bleiben grob, sie ändern sich durch das Gelernte.
4. **Rollen:** Die Person legt Ziel und Abnahme fest und probiert am Ende im Training aus. Claude (Opus) schreibt den Plan, überwacht und prüft jede Aufgabe gegen Plan und Abnahme. Ein günstigeres Modell (Sonnet) setzt die Aufgaben um.
5. **Parkplatz statt Abschweifen.** Was beim Bauen auffällt, aber die Abnahme nicht ändert, kommt unten in den Parkplatz. Am Meilensteinende wird entschieden.
6. **Tests nach Zweck.** Streng: Datenerhalt, Speicherung, Sync. Neu: nur die Abnahmesätze. Tests ersetzter Heuristiken werden mit ihrem Meilenstein gelöscht, nicht angepasst.
7. **Alte Wege entfernen.** Ein Meilenstein ist fertig, wenn der ersetzte Pfad weg ist oder ein Abbautermin feststeht.

## Meilensteine

| | Meilenstein | Spürbar daran, dass … | Ersetzt (alt) |
|---|---|---|---|
| ✅ | **0 Grundlage** | Regelregister existiert, Übungsidentität nur über ID/exakten Titel, unbekannte Muskeln sind sichtbar. | Auftrag 0, Schritt 0–1 (teilweise) |
| ✅ | **A Jede Übung ist richtig bekannt** | Jede gemachte oder importierte Übung hat Muskel, Gerät und passende Anleitung; Unbekanntes wird einmal per KI-Vorschlag eingeordnet. | Auftrag 1 |
| ✅ | **B Die Muskelbilanz stimmt** | Zusatzarbeit (z. B. Bizeps beim Rudern) zählt mit, Gesäß/Beinbeuger und Schulterteile sind getrennt; Anzeige in vier Zuständen statt Zahlenwand. | Auftrag 2 |
| ✅ | **C Gewichte passen zum Gerät** | Vorschläge sind am eigenen Gerät erreichbar; Progression pro Übung statt globaler 6–12/2,5 kg; RIR 0 wird nicht bestraft. | Auftrag 3–4 |
| ✅ | **D Coach-Änderungen sind sicher** | Vorschläge mit Grund, Bestätigen, Rückgängig; überlebt Schließen und Neustart; Coach sagt „geht nicht, weil …“ statt zu raten. | Auftrag 8, Teile 11 |
| ✅ | **E Meine Regeln und Ziele wirken** | „Künftig keine Kniebeugen“ wird als Regel vorgeschlagen, bestätigt, angezeigt und wirkt in jeder Planung; Löschen hebt die Wirkung auf. | Auftrag 5 |
| ✅ | **F Planung ist flexibel** | Feste Woche oder spontan, Kombination an einem Tag, Zeitrahmen; „was heute geht“ mit Grund in einem Satz. | Auftrag 6–7 |
| ✅ | **G Training ist veränderbar** | Reihenfolge ändern, beliebige Supersatz-Partner, Aufwärmen pro Bewegungsblock, Pausen aus einer Quelle. | Auftrag 9–10 |
| ✅ | **H Entwicklung über Wochen** | Befristete Schwerpunkte, Rückmeldung nach dem Training wirkt nachvollziehbar, Chat mit Datum/Zeit. | Auftrag 11–12 |
| ✅ | **I Alltag glätten** | Gewichte passen zum gewählten Studio, Zusammenfassung nach dem Training, Übernommenes wirkt sofort, Studios verwalten, „Heute erledigt“, Rückfrage nach dem Lauf. | Parkplatz C, D, F, G, H |
| ✅ | **J Coach kennt alle Übungen** | Chat tauscht zuverlässig aus dem ganzen Katalog, ganze Bewegungsfamilien lassen sich ausschließen, Übungen mit Bildern, Katalog zum Stöbern. | Parkplatz A, D, E |
| ✅ | **K Aufräumen** | Kleinkram aus dem Parkplatz erledigt. | Parkplatz 0, A, B |
| ✅ | **L Ruhige Oberfläche** | Jeder Screen unabhängig geprüft und entschlackt; die Wochenseite ist nicht mehr vom Chat erdrückt. | UX-Probe |
| ✅ | **M Wochenübersicht per E-Mail** | Jede Person bekommt ihre Wochenübersicht per E-Mail an die Adresse aus ihrem Profil (selbst änderbar). | Wunsch 07.11.2026 |
| ✅ | **N Nichts nur auf dem Mac** | Fahrten und Coach-Stand liegen auf dem Server (gab es schon); ein neuer Mac holt alles zurück; der alte Abgleich zum Vorgänger-Server ist abgebaut. | Wunsch 07.11.2026 |
| ✅ | **O Rad in der Web-App** | Fahrten, Rad-Plan und Entwicklung lesbar am Handy; Heute/Woche/Empfehlung kennen Fahrten; der Chat erreicht den Rad-Coach. | Parkplatz F |
| ✅ | **P Begleiter während der Fahrt** | Das Handy zeigt die laufende Fahrt groß und kann Leistung anpassen, Marker setzen und Intervalle überspringen; der Mac bleibt Chef. | Wunsch 07.11.2026 |
| ✅ | **Q Mac nur fürs Rad** | Die Web-App ist die Haupt-App; die Mac-App kann nur noch koppeln, fahren und kurz zusammenfassen, alles andere öffnet die Web-App. Eine Fahrt geht nie verloren. | Wunsch 07.11.2026 |
| ✅ | **R Gesundheit** | Garmin-Gesundheit in der Web-App: Ruhepuls, Fitness, Alltagsbewegung, Schlaf, ruhig in Sätzen, belegte Regeln mit Quellen, wöchentliche Coach-Auswertung ohne Diagnose. | Wunsch 07.11.2026 |
| ✅ | **S Echte Rezepte** | Vegetarische Rezeptsammlung auf dem Heimserver (wächst langsam, frei ab 1.000), eigene Rezepte per Link sofort; der Plan wählt echte Rezepte statt zu erfinden. | Wunsch 07.11.2026 |
| ✅ | **T Rezepte ansehen** | Rezepte in der Web-App suchen und ansehen, mit Bild, Portionen, „In den Plan“ und Favoriten pro Person, die der Plan bevorzugt. | Wunsch 07.11.2026 |
| ✅ | **U Was ich gemacht habe** | Die Woche zeigt rückwirkend das Gemachte oder „Ruhetag“; ein Verlauf über alle Sportarten; ein Garmin-Lauf ist nach spätestens einer Stunde da. | Wunsch 08.11.2026 |
| ✅ | **V Absprachen halten** | Was für einen Tag vereinbart ist, steht beim Start im Training; alle Coaches kennen denselben Stand von geplant und erledigt; Aufträge gelten so lange wie gemeint; Läufe zählen mit, ohne geplant zu werden. | Trainingsaudit 08.11.2026 |
| ⬜ | **W Belastung nach Menge** | Ein Krafttag ist so hart, wie viel und was trainiert wurde: eine einzelne Beinübung sperrt die Beine nicht mehr 48 Stunden. | Trainingsaudit 08.11.2026 |
| ✅ | **X Erster Eindruck** | Eine neue Person versteht ohne Anleitung, was Pandafit kann und wo sie tippt: Tabs folgen den Profil-Schaltern, Rückblick statt Statistik-Tab, klare Wörter, ruhigere Kraft-, Essen-, Ausdauer- und Fahrt-Screens. | UX-Review 08.11.2026 |
| ✅ | **Y Heute als Tagesseite** | Heute zeigt Gestern, Heute und Morgen (Pfeile, Wischen): oben ein persönlicher Satz vom Coach, neu nach jedem Training; dann Training, Essen, Dein Körper, Gemeinsam. Gestern zeigt, was gemacht wurde, Morgen, was ansteht. | Wunsch 08.11.2026 |
| ✅ | **Z Zum Abschluss** | Nach dem Krafttraining schlägt die App ruhig einen Abschluss vor: 20 Min locker Cardio und Dehnen, oder nur Dehnen, wenn Ausdauer heute schon dran ist, eine Beschwerde offen ist oder das Training lang war. In der Zusammenfassung und 3 Stunden lang auf Heute. | Wunsch 08.11.2026 |
| ✅ | **Style-System** | Alle Farben, Radien, Schriftgrößen und Abstände als Tokens in `src/web/tokens.css` (hell und dunkel), keine festen Farbwerte mehr in web.css und tracking.css (Test). Danach ein Aussehen pro Art von Element: Hauptknopf, Knopf mit Rahmen, Text-Link, Löschen, Chips, Umschalter, Überschriften, Zeilen. | Wunsch 08.11.2026 |
| ✅ | **Training ansehen und anpassen** | Das nächste Krafttraining lässt sich vor dem Start im Detail ansehen und ändern (Kilo, Wiederholungen, Sätze, Übung tauschen, entfernen, hinzufügen); „Training starten“ nimmt die angepasste Version. Entwurf nur auf dem Gerät. | Wunsch 08.11.2026 |
| ✅ | **Panda-Design** | Neues Aussehen nach dem Entwurf von Codex auf allen Seiten und am Mac: warmes Papier, Waldgrün, Apricot, Karten. Schriftzug und Überschriften in Shojumaru. Der Panda heißt Bo („Frag Bo, deinen Coach“) und bewegt sich ruhig auf Heute und im Chat (eigener Canvas-Player, zehn Gesten, kein Rive zur Laufzeit). Plan: `docs/archive/plans/2026-11-08-pandafit-redesign.md`. | Wunsch 08.11.2026 |
| ✅ | **Fundament** | Die App ist leichter zu warten und zu erweitern: ein Weg für sicheres Schreiben, Prüfung aller Eingaben, lokale Verbindungen nur mit Token, klare Modulgrenzen (Test), aufgeteilte Gottdateien, eine Datenschicht in der Web-App, gemeinsame Design-Tokens, ESLint und mehr CI. Für Nutzer fühlt sich nichts anders an. Plan: `docs/archive/plans/2026-11-09-fundament-technical-debt.md`. | Architektur-Audit 09.11.2026 |
| ✅ | **Dojo 1 Fundament** | Die Web-App sieht überall nach „Abend im Dojo“ aus: Zen Kaku Gothic New, Bambus scrollt mit, Tabs mit verspielten Icons (Heute, Woche, Kraft, Essen, Ausdauer), Profil als Panda-Knopf, Bo heißt überall Sensai. | Panda-Design (Aussehen) |
| ✅ | **Dojo 2 Heute, Woche, Sensai** | Heute und Woche geben sofort Orientierung (erledigt, heute, kommt noch); Bo sitzt im Bambusnest; Gesundheit steht sichtbar auf der Woche und hat eine eigene Seite; das Gespräch mit dem Sensai ist ein ruhiger Chat. | Woche-Seite, Rückblick-Gesundheit |
| ✅ | **Dojo 3 Kraft und Ausdauer** | Kraft zeigt das nächste Training als Hauptkarte, das laufende Training den nächsten Satz groß; Ausdauer schaltet Rad und Laufen oben um. | Kraft-Umschalter Training/Routinen/Übungen |
| ✅ | **Dojo 4 Essen und Profil** | Essen zeigt die nächste Mahlzeit groß und die Woche ruhig; ein Rezept trägt man auf der Seite in den Plan ein; Profil ist nur noch Einstellungen. | Tage/Einkauf-Umschalter, „In den Plan“-Sheet |
| ✅ | **Dojo 5 Bos Orte und Logo** | Hinter jeder Pose von Bo steht seine Szene; das App-Logo zeigt Bos Gesicht mit Stirnband und Schweißtropfen, im Dock, auf dem Handy und als Favicon. | Altes Logo (Panda und Maus auf dem Rad) |
| ✅ | **Kraft-Feedback 10.11.** | Das Gewicht folgt der Stelle im Training (spätere Übungen für denselben Muskel bekommen weniger), der Coach plant dieselbe Ausführung nie doppelt, „Trag das ein“ im Chat übernimmt den offenen Regelvorschlag, Sätze sind immer bearbeitbar, „+“ hängt einen Satz an, das Übungsmenü ist eine Liste. | Training und Chat 10.11.2026 |
| ✅ | **Monatsrückblick, Härte, Abschnitt** | Bo blickt am Monatsende im Sensai-Chat auf drei Monate zurück, ermutigt, fragt nach Beschwerden und schlägt die nächsten Wochen vor (Stufe A ✅). Härte pro Person „Vorsichtig“, „Normal“, „Fordere mich“ (Stufe B ✅). Optional ein fester Abschnitt mit Kernübungen und leichter Woche, Nachfrage bei Abweichung und Meldung am Ende (Stufe C ✅). | Konzept 2026-11-10-monatsrueckblick-design.md |
| ⬜ | **Kraft-Feedback 13.11.** | Aufwärmen kurz hintereinander, dann Pause vor dem Arbeitssatz; die Pausenleiste hat eigene Knöpfe; „Satz geschafft“ bestätigt spürbar; weniger Gewicht lässt sich für die restlichen Sätze übernehmen; Verschieben rechnet neu; die Frage zur Reserve fragt nach dem Tempo der letzten Wiederholungen; mitbeteiligte Muskeln zählen zur Vorermüdung; „Training beenden“ beendet sofort; weniger Strom im Training. | Feedback 13.11., Parkplatz |

Die Reihenfolge folgt dem Nutzen: A–C machen die Kraftdaten verlässlich, D ist die Voraussetzung dafür, dass E–H dem Coach mehr erlauben.

## Vorbilder

Lokale Kopien in `~/Projects/pandafit-references/` (nicht im Repo). Übernommen werden Mechanismen, nie Stil oder Bedienkomplexität.

| Vorbild | Was wir nehmen | Für |
|---|---|---|
| GymCoach (MIT) | Muskelkarte mit vier Zuständen; Gewichte auf vorhandene Hanteln/Scheiben runden; KI-Antwort prüfen, Text bleibt bei Fehler sichtbar; Freitext „Bank 60 × 8, ging noch 2“ → bestätigter Satz | B, C, D, G |
| free-exercise-db (gemeinfrei, über GymCoach) | Größere Übungsbasis mit primären/sekundären Muskeln, Gerät und Bildern | A, B |
| Enduragent (MIT) | Änderungs-Vorschlag mit Version und Bestätigen; „unvollständig, weil …“; „was heute geht“ mit Grund; nur auf ausdrückliche Bitte verordnen; Claude-Abo-Schutz | D, F |
| Coach Watts (Apache 2.0) | Prüfen → einmal mit Fehlerhinweis neu versuchen → begrenzen; Regel-Gedächtnis getrennt vom Chat mit Bestätigung; „von KI geplant“-Markierung | D, E, F |
| Liftosaur | Geräteinkremente, begrenzter Scheibenbestand | C |
| Ironvellum | Aufwärmen pro Bewegungsblock, freie Supersatz-Partner | G |
| Heracles | Herkunft einer Muskelzuordnung (nur Modell, nicht die Zahlendarstellung) | B |
| Repstack | Befristete Blöcke, strukturierte Rückmeldung | H |

Die Briefs der fertigen Meilensteine stehen in [`docs/archive/milestone-briefs.md`](archive/milestone-briefs.md), ihre Pläne und Specs unter `docs/archive/`.

## Meilenstein W — grob

Ein Krafttag wird nach Muskelgruppe, Satzzahl und Anstrengung bewertet, nicht nach „eine Beinübung = hart“ (`src/coach/day-load.ts`). Die 48-Stunden-Beinsperre (`LEG_WINDOW_MS` in `src/coach/gym/history.ts`) greift nur nach echter Beinbelastung. „Zwei harte Tage“, „sechs Tage ohne Pause“ und die 18-Uhr-Regel werden dagegen geprüft. Die 48-Stunden-Regel nach einer harten Radfahrt bleibt. Hintergrund: Bei gleichem Wochenumfang bringt höhere Frequenz keinen klaren Vorteil; Muskelkater ist kein Wachstumsmaß; Versagen ist optional. Passt zu den Parkplatz-Punkten aus F („nur Beine“) und O (harte Fahrt und müde Beine).


## Dojo — Briefs

Grundlage für alle fünf: [`docs/design/DESIGN.md`](design/DESIGN.md), Bilder in `docs/design/moodboard/` (im Browser öffnen). Plan nur für Dojo 1: [`archive/plans/2026-11-09-dojo-1-fundament.md`](archive/plans/2026-11-09-dojo-1-fundament.md) (erledigt), Dojo 2: [`archive/plans/2026-11-09-dojo-2-heute-woche-sensai.md`](archive/plans/2026-11-09-dojo-2-heute-woche-sensai.md) (erledigt), Dojo 3: [`archive/plans/2026-11-09-dojo-3-kraft-ausdauer.md`](archive/plans/2026-11-09-dojo-3-kraft-ausdauer.md) (erledigt), Dojo 4: [`archive/plans/2026-11-09-dojo-4-essen-profil.md`](archive/plans/2026-11-09-dojo-4-essen-profil.md) (erledigt). Dojo 5: [`archive/plans/2026-11-09-dojo-5-bos-orte-logo.md`](archive/plans/2026-11-09-dojo-5-bos-orte-logo.md) (erledigt).

**Dojo 1 Fundament.** Ziel: Das neue Aussehen steckt in Tokens und Bausteinen, bevor ein Screen umgebaut wird.
- Jede Seite der Web-App hat den Dojo-Hintergrund mit Bambus, der beim Scrollen mitwächst, hell und dunkel.
- Fließtext und Knöpfe stehen in Zen Kaku Gothic New, auch ohne Netz (selbst gehostet).
- Die Tab-Leiste zeigt Heute, Woche, Kraft, Essen, Ausdauer mit Icons; Profil ist ein runder Panda-Knopf oben rechts.
- Nirgends in der Web-App steht „Coach“; Bo heißt Sensai („Frag Bo, deinen Sensai“).
- Bausteine Karte, Kicker, Pinseltitel, Hauptknopf, Bo-Sprechblase gibt es einmal und werden von den Screens benutzt.
Fällt weg: die Textlabels ohne Icon in der Tab-Leiste. Nicht dabei: Umbau einzelner Screens, Mac-App.

**Dojo 2 Heute, Woche, Sensai.** Ziel: Die zwei meistgenutzten Seiten sind nicht mehr überladen und geben Orientierung.
- Heute: Wochenweg oben, Bo im Bambusnest mit Sprechblase und „Frag Bo, deinen Sensai“, eine Hauptkarte „Jetzt dran“, darunter nur Essen und Morgen.
- Woche: eine Karte Erledigt / Heute / Kommt noch, das Ziel in einem Satz, Details erst beim Tippen auf einen Tag.
- Gesundheit: Karte auf der Woche (ein Satz, Ruhepuls, Fitness, Bewegung als Wörter) und eigene Seite; Schlaf/HRV nur als Hinweis ohne Daten.
- Sensai: Chat mit Sprechblasen, Bos Wochenvorschlag mit „Übernehmen“ und „Nein danke“ direkt in der Blase.
Fällt weg: Gesundheit im Rückblick-Sheet. Nicht dabei: neue Coach-Funktionen.

**Dojo 3 Kraft und Ausdauer.** Ziel: Vor und während des Trainings ist klar, was jetzt dran ist.
- Kraft: nächstes Training als Hauptkarte, Studio und „Anderes Training“ als ruhige Knöpfe, Routinen und Übungen als zwei Kacheln.
- Laufendes Training: nächster Satz groß mit „Satz geschafft“, Pause schmal, weitere Übungen ruhig darunter; Tab-Leiste ausgeblendet.
- Ausdauer: Rad/Laufen-Umschalter oben, nächste Einheit als Hauptkarte, Entwicklung als ein Satz.
Fällt weg: Umschalter Training/Routinen/Übungen. Nicht dabei: Änderungen an Progression oder Planung.

**Dojo 4 Essen und Profil.** Ziel: Essen macht Lust, Profil ist aufgeräumt.
- Essen: nächste Mahlzeit groß mit Bild nach Mahlzeit-Typ, die übrigen Mahlzeiten des Tages klein, die Woche als ruhige Liste, Rezepte und Einkauf als zwei Kacheln, „Plan ändern“ über Bos Sprechblase.
- Rezept: „In den Plan“ als Karte auf der Seite mit vorgewähltem Tag.
- Profil: Kopfkarte und vier Gruppen (Planen, Verbindungen, Nachrichten, Darstellung), keine Gesundheit.
Fällt weg: Tage/Einkauf-Umschalter, „In den Plan“-Sheet. Nicht dabei: neue Rezeptfunktionen.

**Dojo 5 Bos Orte und Logo.** Ziel: Bo hat zu jeder Pose seinen Ort, und die App erkennt man am Logo.
- Jede Pose aus `dayClip` erscheint mit ihrer Szene aus `DESIGN.md` (Tabelle „Bos Orte“), auch bei reduzierter Bewegung als Standbild.
- Neues Logo: Bos Gesicht mit Fitness-Stirnband und Schweißtropfen (Entwurf D im Moodboard), als `resources/icon.svg`, Mac-Icon, PWA-Icons und Favicon.
Fällt weg: Panda und Maus auf dem Rad. Nicht dabei: neue Posen-Animationen.

## Parkplatz
- Aus Kraft-Feedback 10.11.:
  - Wochentage als feste Einstellung (Freitag gut, Wochenende lang, Montag kurz) statt freier Wunsch-Regel; prüfen, ob der Planer `wish`-Regeln für Tage liest.
  - Der Ausblick nutzt Hevy-Titel statt der eigenen Übungsnamen.
  - `repRange` je Satz einer Übung ist uneinheitlich (z. B. 8–12 und 6–12).
  - Den Anteil der Vorermüdung pro Person aus eigenen Daten lernen.
  - Aus Stufe B: Eine Beschwerde mitten im offenen Training ändert schon geplante Versagenssätze nicht; erst das nächste Training wird vorsichtig geplant.
  - Aus Stufe B: Die Frage-Karte zur Härte bleibt angeheftet, auch wenn die Härte schon im Profil gewählt wurde.
  - „Nächstes Mal“-Zeile und Änderungsnotizen (`gym-coach.ts`) kennen die Stelle im Training noch nicht und können ein höheres Gewicht nennen als der Plan.
  - Das Senken nach der Stelle macht eine geplante Pyramide flach.
- Aus Monatsrückblick Stufe C:
  - Härte pro betroffener Übung statt fürs ganze Training, sobald Beschwerden Muskeln oder Übungen kennen.
  - Dauerhafter Tausch einer Kernübung durch die Person mitten im Abschnitt.
  - Härte in jedem Rückblick als eigene Auswahl statt über Chat oder Profil.
  - Drop-Sätze bei „Fordere mich“ in die Grenze für Versagenssätze einrechnen.
  - „Abschnitt beenden“ lässt die restlichen Wochenpläne des Abschnitts stehen; klären, ob sie mit enden sollen.
  - Scheitert nach „Abschnitt beenden“ das Speichern der Chat-Zeile, geht nur diese Zeile verloren.
  - Die Karte sagt nicht, dass die Übernahme schon geplante Wochen ersetzt (die alten bleiben für Rückgängig gespeichert).
  - Nach Rückgängig und Neuladen zeigt die Rückblick-Karte nichts statt „Rückgängig gemacht“.
  - Beschwerden prüft der Abschnitt-Vorschlag nur über den Prompt; während einer offenen Beschwerde sind alle Kernübungen frei.
  - Die Szenarien M01–M04 im Regelregister weichen von der Spec §10 ab.
- ~~Aus Dojo 1: Hauptknöpfe ohne `class="primary"` (z. B. `RecipesScreen.tsx`) haben noch das schlichte Aussehen.~~ Erledigt mit Dojo 4.
- Aus Dojo 4: Ein gemeinsamer Kit-Rahmen `SubPage` für Unterseiten (heute `SubPage` in `Training.tsx` und `EssenPage` in `src/web/essen/`).
- Aus Dojo 4: Tippt man auf den Tab, während eine Unterseite offen ist (Mahlzeit von Heute, Kraft-Unterseiten), bleibt die Unterseite stehen.
- ~~Aus Dojo 4: „Essen heute“ auf Heute zeigt noch das Icon statt des Bilds.~~ Erledigt mit Dojo 5.
- ~~Aus Dojo 1: Die Mac-Oberfläche (`src/ui`) sagt noch „Coach“, z. B. HevyCard „Kraft-Coach“. `training-policy/rules.ts` sagt intern „Coach“, erreicht aber weder Screen noch Prompt.~~ Erledigt (Parkplatz Design).
- ~~Aus Dojo 1: Im CSS steht teils font-weight 600.~~ Erledigt mit Dojo 2 (nur die Mac-Oberfläche hat noch 600, eigene Schrift).
- ~~Aus Dojo 2: „Zurück“ im Chat, den man von Heute aus geöffnet hat, landet auf der Woche statt auf Heute (gehört zu Browser-Zurück, Entscheidung 10).~~ Erledigt (Parkplatz Design).
- ~~Aus Dojo 2: Gesundheit und Gemeinsam sind Unterseiten der Woche ohne Browser-Zurück.~~ Erledigt (Parkplatz Design).
- ~~Aus Dojo 2: `TogetherScreen` baut seine Karten noch von Hand (`section.card`); beim nächsten Anfassen auf Kit-Bausteine umstellen.~~ Erledigt (Parkplatz Design).
- ~~Aus Dojo 2: `BoBubble` mit `portrait="mini"` und `place` verkleinert die Szene; in Dojo 5 prüfen, sobald es einen Aufruf gibt.~~ Erledigt mit Dojo 5: Ein kleiner Bo zeigt nie einen Ort.
- Aus Dojo 5: Die Orte für „listen“ (Laternen und Tee) und „breathe“ (am Wasser unter dem Mond) sind noch nicht gebaut; bis dahin sitzt Bo dafür im Nest oder im Dojo.
- Aus Dojo 3: Sheets, die aus dem Übungsmenü geöffnet werden (Sätze bearbeiten, Tauschen, Reihenfolge ändern), zeigen „‹ Zurück“ statt ×; einmal im Kit lösen.
- Aus Dojo 3: Der Pausen-Wecker (`port.restAlarm`) endet beim Verkleinern des Trainings wie beim Tab-Wechsel. Die Pause selbst läuft im Record weiter und steht nach „Weitermachen“ wieder da; nur der Ton am Ende fehlt dann.
- ~~`npm run dev:web`: Der Proxy-Präfix `/push` fängt auch das Modul `/push.ts` ab, ohne laufenden Server bleibt die Seite leer. Präfix enger fassen (`/push/`).~~ Erledigt (Parkplatz Design).

- Anpassungen am nächsten Training liegen nur auf dem Gerät; eine Übernahme zwischen Geräten wäre ein eigener Record. Ein Vorschlag, der zwischen Anpassen und Start übernommen wird, fehlt im Entwurf.

- ~~Export nach Hevy wählt bei zwei verknüpften Hevy-Vorlagen derselben Übung die zuerst gelistete (aus Review Meilenstein 0).~~ Erledigt mit K.
- ~~Ohne Statistik-Record zählen manche deutschen Hevy-Varianten als „Sonstiges“ (löst sich mit A).~~ Erledigt mit A.
- ~~Eigene Übung mit gleichem Titel wie eine eingebaute verliert gegen die eingebaute (löst sich mit A).~~ Erledigt mit A.
- ~~Harmlose doppelte Titelformen wie „Seitheben am Kabel (Kabel)“.~~ Erledigt mit K.
- ~~Zweitnamen „Dip“/„Single Arm Dumbbell Row“ prüfen, ob gewichtet/ungewichtet zusammenpasst.~~ Erledigt mit K.
- Aus Meilenstein A:
  - ~~Bilder der Übungsbasis fehlen noch (nur für genutzte Übungen nachladen).~~ Erledigt mit J.
  - ~~Eigene Seite „Übungskatalog“ zum Stöbern? (Heute nur über die Übungsauswahl.)~~ Erledigt mit J.
  - ~~Chat-Coach und Mobilität kennen nur die eingebauten Übungen.~~ Erledigt mit J.
  - Englische Namen der Basis können Hevy-Titel ohne Vorschlag verknüpfen (heute keine Kollision).
  - ~~Karte „Übungen einordnen“ zeigt doppelte Vorschläge, wenn zwei Coaches gleichzeitig fragen; Vorschläge mit gelöschtem Ziel bleiben unsichtbar und werden nie neu gefragt.~~ Erledigt mit K.
  - ~~Rückgängig nach „Neue Übung bestätigen“ lässt die ungenutzte Übung im Katalog.~~ Erledigt mit K.
  - ~~Einige übersetzte Anleitungen sind lang (>90 Wörter)~~ (gekürzt mit „mehr“, Erledigt mit K); wenige Originaltexte passen nicht zum Titel.
  - ~~`src/shared/catalog.ts` importiert Muskelnamen aus `src/tracking/ui/labels` (Schichtung).~~ Erledigt mit K.
  - ~~Eigene Übungs-Records: Muskel/Gerät/Typ werden nicht gegen die erlaubten Werte geprüft.~~ Erledigt mit K.
- Aus Meilenstein B:
  - ~~Körperbild/Muskelkarte statt Liste? (Frage an die Person offen.)~~ Gestrichen am 09.11.2026: zu viel Detail, die Liste bleibt.
  - Zielbereiche Gesäß + Oberschenkel hinten und Schulter seitlich + hinten summieren sich höher als früher; beobachten, ob der Coach dort zu viele Sätze plant.
  - Muskelpaare zählen halbe Sätze einer Übung auch auf der Gegenseite (Kniebeuge → Gesäß), das mildert den Ungleichgewichtshinweis.
  - Unbekannte Hevy-Übungen mit „Schultern“ zählen als Schulter vorn.
  - Coach erkennt Übungen über ID/Hevy-Verknüpfung, die Statistik zusätzlich über deutsche Titel; in seltenen Fällen leicht abweichende halbe Sätze.
- Aus Meilenstein C:
  - ~~Coach plant immer fürs zuletzt genutzte Studio; wer vor dem Start ein anderes Studio wählt, bekommt Gewichte des alten Studios aus dem Plan.~~ Erledigt mit I.
  - Eigenes Inventar pro Studio (Stangengewicht, begrenzte Scheiben, Hantelsätze).
  - Gewichtsstufen und Studios werden nicht zwischen Profilen geteilt.
  - ~~Eine eigene Gewichtsstufe geht beim Umbenennen eines Studios verloren; ein Studio lässt sich noch nicht entfernen.~~ Erledigt mit I.
- Aus Meilenstein D:
  - ~~Übernehmen einer Änderung fürs nächste Training plant nicht sofort neu; „Berücksichtigt: …“ erscheint erst beim nächsten Neuplanen.~~ Erledigt mit I.
  - ~~Der Wochen-Chat kennt keinen Übungskatalog und kann fürs nächste Training nicht zuverlässig tauschen.~~ Erledigt mit J.
  - Keine Konflikterkennung auf dem Server; ein Wochenvorschlag wird nur gegen die Zeit des Vorschlags geprüft.
  - ~~Rückgängig eines schon an Garmin gesendeten Wochenplans: prüfen, ob Garmin-Einheiten verwaist bleiben.~~ Entfällt (08.11.2026): Der Garmin-Kalender ist für die App egal, es zählt nur Abgeschlossenes.
- Aus Meilenstein E:
  - ~~Ausschluss ganzer Bewegungsfamilien ohne Übungsliste (heute: Liste konkreter Varianten).~~ Erledigt mit J.
  - ~~Sportarten in der Zielkarte immer alle drei; später nur die genutzten zeigen.~~ Erledigt mit I.
  - ~~Schwerpunkt-Muskeln wirken im Coach-Prompt, noch nicht in der Bilanz-Anzeige.~~ Erledigt mit H.
- Aus Meilenstein F:
  - ~~Die Handy-App kennt keine Radfahrten; ohne veröffentlichte Empfehlung des Coaches rechnet sie nur mit Kraft und Laufen.~~ Erledigt mit O.
  - Ein Plantag kann nicht „nur Beine“ markieren; nach harten Beinen wird Kraft immer zu „Kraft ohne Beine“.
  - ~~Die Empfehlung kennt keine Uhrzeit; abends gilt noch die Empfehlung des Tages.~~ Erledigt mit I.
- Aus Meilenstein G:
  - Pausen pro einzelnem Satz und Aufwärmen nach Erfahrung der Person.
  - ~~Verschieben per Ziehen statt über das Menü.~~ Erledigt: langes Drücken auf eine Übung (Titel oder „Danach“) hebt sie an.
  - ~~Eigene Pausen-Einstellung geht beim Tauschen einer Übung verloren (die neue Übung bekommt ihre eigene Pause).~~ Erledigt mit I.
- Aus Meilenstein H:
  - ~~„Nächstes Mal“ steht nur im Verlauf beim letzten Training; eine eigene Zusammenfassung nach dem Training fehlt.~~ Erledigt mit I.
  - Rad-Änderungen ohne eigenen Grund erscheinen in „Zuletzt geändert“ ohne „– Grund“.
  - Chat-Nachrichten werden weiter nach 90 Tagen gelöscht (alte Regel, bewusst beibehalten).
  - ~~Läufe haben keine eigene Rückfrage nach dem Training.~~ Erledigt mit I.
- Aus Meilenstein I:
  - ~~Ausblenden/Entfernen eines Studios nur auf dem Startbildschirm, nicht im laufenden Training.~~ Erledigt mit Dojo 3 (bewusst so, Entscheidung 5).
  - Eine schwere Laufwoche hält nur, wenn es eine Basis gibt; ohne Läufe der letzten Wochen wirkt sie nicht.
- Aus Meilenstein J:
  - Bilder der Übungsbasis machen App und Server-Paket ~50 MB größer; ggf. kleiner rechnen.
  - „Wieder erlauben“ pausiert eine Regel ganz, auch wenn sie mehrere Übungen betrifft; der Knopf sagt das nicht.
  - ~~Titel-Auflösung beim Tausch per Chat unterscheidet Groß-/Kleinschreibung.~~ Erledigt mit K.
  - Einordnung einzelner Basis-Übungen (enges Bankdrücken bei Bankdrücken, Hyperextensions bei Sonstige).
- Aus Meilenstein L:
  - ~~Eigene Produkte der Einkaufsliste erscheinen nur in der Web-App, nicht in der Mac-Ansicht.~~ Überholt mit Q.
  - ~~Datumsstil in Laufen/Entwicklung noch gemischt („ab 14. Sept.“ / „26.10. bis 1.11.“).~~ Erledigt.
  - Native Datums-/Zeitfelder folgen der Gerätesprache (im Test-Browser AM/PM).
  - Katalog: große Gruppen zeigen zuerst eingebaute/genutzte Übungen; ggf. später Untergruppen.
  - ~~Shot-Werkzeug erreicht „Haben wir“ auf der Einkaufsliste nicht.~~ Erledigt mit Dojo 4.
- Aus Meilenstein O:
  - Eine harte Fahrt zählt nicht als „Beine müde“ (Server und Web gleich); nur die Regel „zwei harte Tage“ schützt. Prüfen, ob Fahrten die Beine belasten sollen.
  - ~~Umschalter „Rad | Laufen“ steht über dem Seitentitel (wie bei Laufen); unter den Titel nur mit Platz in `PageHead`.~~ Erledigt mit Dojo 3.
  - ~~Sechs Tabs: auf Handys schmaler als 390 px nicht geprüft.~~ Überholt mit Dojo 1.
- Aus Meilenstein P:
  - Nach „Intervall überspringen“ ordnen `onTargetPct` und die Intervallwerte (`src/coach/metrics.ts`) Fahrzeit den Schritten ohne die übersprungenen Sekunden zu; Fix: übersprungene Sekunden an `summarizeRide` geben. „Geschafft“ zählt Übersprungenes als nicht gefahren (gewollt).
  - Handy-Begleiter noch nicht in einer echten Fahrt erprobt; WebSocket unter CSP `default-src 'self'` in Safari ungetestet.
- Aus Meilenstein Q:
  - Ältere Fahrt nachträglich zu Garmin hochladen hat kein Zuhause mehr (nur direkt nach der Fahrt).
  - ~~Gesundheit (Garmin) gibt es nur am Mac unter Verbindungen; Web hat keine Ansicht.~~ Erledigt mit R.
  - `src/ui/coachTrackingPort.ts` nur noch von zwei Tests genutzt; tote CSS in `src/ui/style.css`.
- Aus Meilenstein R:
  - `coach.strengthHealth` und die Nachricht `strength-health` haben keinen Nutzer mehr.
  - ~~Statistik ist ohne Statistik-Record und ohne Trainings ausgeblendet: eine Person nur mit Garmin sähe „Gesundheit“ nicht.~~ Überholt mit Dojo 2.
  - Fällt die KI beim ersten Wochenlauf aus, bleibt der feste Text die ganze Woche.
  - HRV/Schlaf fließen noch nicht in die Tagesbewertung ein (nur angezeigt).
- Aus Meilenstein V:
  - Ändern sich die Befunde zweimal am selben Tag, bleibt bis zur nächsten Änderung der feste Text ohne KI stehen.
  - Rad + Kraft als zweite Einheit mit Minuten: das Kraft-Zeitbudget nimmt die Minuten nicht, nur der Prompt kennt sie.
  - Manuelle Läufe ohne Lauf-Einstellungen und ohne Garmin fehlen der Mobilität (selten).
  - ~~Die Start-Hinweise („Ohne Beine“, „Dazu heute“) haben keinen Oberflächentest.~~ Erledigt mit Dojo 3.
- Aus Meilenstein X:
  - Ein neues Gerät kennt den Essensplan-Schalter erst nach der ersten Coach-Antwort (bis 30 s); ein synchronisierter Datensatz wäre sauberer (braucht Server).
  - Browser-Zurück in verschachtelten Sheets schließt das ganze Sheet. Für Essen erledigt mit Dojo 4 (Seiten statt Sheets); offen für Kraft und Woche.
  - ~~„Woche planen“ auf Heute führt zur Woche, dort braucht es einen zweiten Tipp bis zum Chat.~~ Erledigt mit Dojo 2.
  - ~~Der Rad-Verlauf zeigt Wattbereiche nur bei „bei N %“-Bezeichnungen.~~ Erledigt mit Dojo 3.
