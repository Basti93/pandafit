# Monatsrückblick, Härte und Trainingsabschnitt

Stand: 10.11.2026. Ergänzt `2026-11-06-adaptive-training-coach-design.md` (Abschnitte 5, 6, 13, 16). Kennzeichnung: **Nutzer** = im Gespräch gesagt; **Entscheidung** = Vorschlag des Autors, beim Lesen prüfen.

## 1. Warum

Der Kraft-Coach plant heute nur nach Muskel-Lücken der letzten Tage. Er füllt jede Woche auf, was fehlt, und wechselt dabei oft die Übungen. Das hat am 10.11. zwei Folgen gezeigt: Seitheben in jedem Training, und große Übungen wie Kreuzheben kommen nie dran, weil ihr Muskel „im Ziel“ ist.

**Nutzer:** Die Übungsauswahl ist nicht der Engpass. Ein guter Coach würde vor allem
- die langfristige Entwicklung im Blick behalten, damit man das nicht selbst tun muss,
- in Abständen ehrlich zurückblicken und einen Weg zum Ziel vorschlagen, ohne Druck,
- einen gelegentlich näher ans Muskelversagen bringen,
- ermutigen, gerade Anfänger und Unsichere.

Trainingsplanung ist zu dynamisch für feste Programmregeln. Die KI entscheidet, was gut ist; feste Regeln bleiben Leitplanken für das, was nie passieren darf (Nutzer, bestätigt in diesem Gespräch).

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
1. Monatsrückblick von Bo im Sensai-Chat mit Drei-Monats-Sicht.
2. Persönliche Härte: wie stark Bo pusht.
3. Optional ein fester Abschnitt von 4–6 Wochen mit festen Kernübungen und steigender Härte, danach eine leichtere Woche.
4. Bo erkennt, wenn ein fester Abschnitt nicht mehr passt, und bietet den lockeren Modus an.
5. Im lockeren Modus kennt Bo das langfristige Ziel ebenso und wägt pro Training ab.
6. Offene Beschwerden fragt Bo im Monatsrückblick ab.

**Nicht-Ziele**
- Kein festes Programm für alle, keine Pflichtübungen (kein Kreuzheben für jede Person).
- Ernährung wird in diesem Konzept nicht gebaut (eigenes Thema, siehe Abschnitt 9).
- Keine neue Statistikseite, keine Zahlenflut (Projektregel „keine kleinteiligen Zahlen“).

**Anti-Ziele** (wäre ein Fehlschlag, auch wenn es technisch läuft)
- Bo wirkt drängend, vorwurfsvoll oder schulmeisterlich, wenn jemand weniger trainiert.
- Gaming: Serien, Punkte, Abzeichen (Projektregel „leicht bleiben“, `docs/motivation.md`: keine Serien).
- Eine vorsichtige Person (z. B. nach Verletzung) bekommt Versagenssätze.
- Bo fragt so oft, dass es nervt.
- Ein fester Abschnitt erzeugt „Trainingsschulden“, wenn eine Einheit ausfällt (Spezifikation Abschnitt 6: kein Nachholen).

## 3. Monatsrückblick

**Nutzer:** am Monatsende, im Sensai-Chat, mit Blick auf drei Monate, ohne Druck.

- **Wann:** am letzten Sonntag des Monats, zur Uhrzeit der Wochenrunde (`coachprefs.week.hour`), sonst 18 Uhr. **Entscheidung.** Zusätzlich außer der Reihe, wenn sich der Schwerpunkt im Ziel ändert (`goal.sports`) oder nach einer Pause von mehr als 21 Tagen ohne Krafttraining (**Entscheidung**).
- **Wer bekommt ihn:** jedes Profil mit mindestens 4 Krafttrainings in den letzten 90 Tagen (**Entscheidung**). Abschaltbar in den Coach-Einstellungen wie Wochenrunde und Abendgruß (`CoachPrefs`, Standard: an).
- **Weg:** neue Aufgabe im Scan `prompts` (`src/coach/runtime/scan.ts`), neuer Schlüssel in `SentPrompts`, eine neue Chat-Methode neben `openWeek` (`src/coach/chat/chat-coach.ts`), die eine Nachricht mit Push schreibt.
- **Datenquelle:** gespeicherte Trainings, Aktivitäten, Ziel, Regeln, Beschwerden, Wochenpläne der letzten 13 Wochen. Nicht der Chat-Verlauf (wird nach 90 Tagen gelöscht).
- **Inhalt** (Aufbau fest im Code, Worte von der KI, wie in `docs/motivation.md` beschrieben):
  1. Ein ehrlicher, ermutigender Satz zum Monat (Regelmäßigkeit vor Gewichten).
  2. Höchstens drei Beobachtungen aus drei Monaten, jede mit Grund, z. B. eine Kernübung steigt seit Wochen, ein Muskel liegt dauerhaft weit unter dem Ziel, Trainings pro Woche schwanken.
  3. Je offene Beschwerde eine Frage: „Wie geht es dem Knie?“ Antworten setzen sie auf `healing` oder `over` (siehe Abschnitt 6).
  4. Ein Vorschlag für die nächsten Wochen, passend zum Ziel: weiter locker, oder ein fester Abschnitt (Abschnitt 5) mit Kernübungen und Tagen. Annahme mit „Übernehmen“ oder im Chat („machen wir“, gleicher Weg wie `acceptsRule`), immer mit „Rückgängig“.
  5. Beim ersten Rückblick einer Person die Frage nach der Härte (Abschnitt 4).
- **Länge:** kurz, etwa fünf bis acht Sätze plus Vorschlagskarte. **Entscheidung.**
- **Ton:** keine Vorwürfe, keine Serien, kein „du hast nur …“. Weniger Training heißt: Rahmen anpassen und ehrlich sagen, was es für das Ziel bedeutet.

## 4. Härte als persönliche Einstellung

**Nutzer:** Bo pusht, aber pro Person verschieden; Anfänger und Verletzte vorsichtig.

- Drei Stufen, gespeichert im `goal`-Datensatz als neues Feld `push: 'gentle' | 'normal' | 'hard'`, Standard `normal`. **Entscheidung.** Anzeigen im Profil unter Ziel: „Vorsichtig“, „Normal“, „Fordere mich“.
- Bo fragt die Stufe beim ersten Monatsrückblick ab; danach kann sie bei jedem Rückblick oder im Profil geändert werden.
- Wirkung (Werte als Produktregeln im Register `src/shared/training-policy/rules.ts`, **Entscheidung** für die Startwerte):
  - `gentle`: Reserve 2–3, keine Versagens- oder Drop-Sätze.
  - `normal`: Reserve 1–3, Versagen nur im letzten Satz an sicheren Geräten, wie heute.
  - `hard`: Reserve 0–2, Versagens- und Drop-Sätze („Leitern“) an sicheren Geräten erlaubt, innerhalb `gym.max-failure-sets`.
- Eine offene oder heilende Beschwerde setzt für betroffene Übungen immer auf `gentle`, unabhängig von der Stufe.

## 5. Fester Abschnitt (optional)

**Nutzer:** Wer Ja sagt, sieht über die nächsten Wochen, was ansteht. Sportwissenschaftlich gilt (als Tendenz): Kernübungen eine Weile gleich lassen hilft der Steigerung; Ergänzungsübungen dürfen wechseln. Härte steigt, dann Luft holen.

- **Länge:** bis zum nächsten Monatsrückblick, 4–6 Wochen; die letzte Woche ist leichter. **Entscheidung.**
- **Inhalt:** Wochenrhythmus (Tage für Kraft, Rad, Lauf; baut auf `weekplan` und `frame.mode = 'week'` auf) und je Krafttag eine Vorlage, z. B. „Oberkörper A“, mit 3–4 Kernübungen. Die KI wählt die Kernübungen beim Vorschlag nach Ziel, Vorlieben und Regeln der Person.
- **Pro Training:** Kernübungen bleiben, Gewicht und Wiederholungen folgen der bestehenden Progression (inkl. Vorermüdung). Ergänzungen wählt der Planer frei. Eine Kernübung wechselt im Abschnitt nur, wenn sie wehtut (Beschwerde), die Person sie tauscht oder zwei Einheiten in Folge stagniert; sonst beim nächsten Rückblick.
- **Härte über die Wochen:** Woche 1 an der oberen Reserve der Stufe, jede Woche eine Wiederholung weniger Reserve bis zur unteren Grenze, die letzte Woche mit etwa zwei Dritteln der Sätze bei gleicher Last. **Entscheidung** (deckt sich mit `LONG_TERM_GUIDE` in `src/coach/chat/long-term.ts`).
- **Anzeige:** Woche und Kraft zeigen, in welcher Woche des Abschnitts man ist und was als Nächstes kommt; eine Zeile, keine Tabelle.
- **Kein Nachholen:** Fällt eine Einheit aus, geht der Abschnitt normal weiter.
- **Wenn er nicht mehr passt:** zwei Kalenderwochen nacheinander mit weniger als der Hälfte der geplanten Krafttrainings (**Entscheidung**) → Bo fragt einmal: „Die letzten zwei Wochen sahen anders aus als geplant. Sollen wir wieder locker planen?“ Ja → `frame.mode = 'spontaneous'`, Abschnitt endet, Ziel bleibt. Nein → Abschnitt bleibt, Frage frühestens nach zwei weiteren Wochen.

## 6. Beschwerden im Rückblick

- Offene Beschwerden (`active`, `healing`) fragt Bo im Monatsrückblick einzeln ab.
- Der Chat darf künftig auch `healing` setzen, nicht nur neu/vorbei (heute: `newComplaint`, `complaintsOver` in `chat-coach.ts`). Nur die Worte der Person ändern den Status, wie heute.
- `healing` heißt: betroffene Übungen vorsichtig, Last langsam wieder steigern; `over` heißt: normal.

## 7. Lockerer Modus

- Bleibt Standard. Der Planer bekommt zusätzlich das Ziel, die Härte und die Beobachtungen des letzten Rückblicks als Datenblock, damit jedes Einzeltraining zum langfristigen Ziel passt.
- Die Muskelbilanz bleibt als Prüfung, ist aber nicht mehr der einzige Antrieb: Der Prompt sagt, dass Lücken gegen Ziel und Schwerpunkt abzuwägen sind und isolierte Kleinmuskeln nicht in jeder Einheit vorkommen müssen. **Entscheidung.**

## 8. Was bestehen bleibt

Leitplanken aus `guardrails.ts` (Gewichtsstufen, Versagens-Grenze, doppelte Ausführung, Vorermüdung), „Vorschlag, Bestätigen, Rückgängig“, Regeln und Wünsche der Person, Beschwerden, Wochen-Mail, Wochenrunde.

## 9. Festlegungen nach der Bauprüfung (Entscheidungen des Autors)

1. **Abschnitt ist ein eigener Datensatz** `block` (Start, Ende, Kernübungen je Krafttag-Vorlage, Wochenrhythmus). Annehmen setzt zusätzlich `frame.mode = 'week'` und schreibt die Wochenpläne aus dem Abschnitt. Der Abschnitt besitzt die Kernübungen, der Planer liest sie.
2. **Länge:** Das Ende steht beim Annehmen fest: der Tag des übernächsten regulären Rückblicks, wenn der nächste weniger als 4 Wochen entfernt ist, sonst der nächste. So entstehen 4–6 Wochen. Am Ende kommt der Rückblick; kommt keiner (abgeschaltet, Schwelle nicht erreicht), endet der Abschnitt trotzdem, Bo schreibt einen Satz, und es geht locker weiter.
3. **Härte im Code oder im Prompt:** Die Stufen sind feste Leitplanken: `gentle` lehnt Versagens- und Drop-Sätze ab (Guardrail), `hard` erlaubt sie bis `gym.max-failure-sets`. Die Leichte-Woche-Regel ist ebenfalls fest: höchstens zwei Drittel der durchschnittlichen harten Sätze der übrigen Abschnittswochen, keine Versagenssätze. Die Steigerung der Härte von Woche zu Woche steht nur im Prompt (KI entscheidet).
4. **Definitionen:** Stagnation = zwei Einheiten der Kernübung in Folge ohne mehr Last oder mehr Wiederholungen bei gleicher Last (wie die bestehende Progression). „Geplant“ = Krafttage im Wochenplan, wie er am Montag der Woche stand.
5. **Beschwerden:** Eine Nachricht, eine Frage je Beschwerde. Die Antwort läuft über den Chat (`complaintsOver` und neu `complaintsHealing`), kein neuer Knopf. Ohne Antwort bleibt der Status.
6. **Abstand:** Zwischen zwei Rückblicken liegen mindestens 14 Tage. Der Auslöser „Pause über 21 Tage“ umgeht die Schwelle von 4 Trainings; der Auslöser „Schwerpunkt geändert“ nicht.
7. **Härte vor dem ersten Rückblick:** Mit offener oder heilender Beschwerde gilt automatisch `gentle`. Sonst fragt Bo die Stufe schon nach dem dritten Krafttraining, über die bestehende Fragenregel (höchstens eine Frage in drei Tagen, überspringbar, `docs/motivation.md`), falls der erste Rückblick noch nicht war.
8. **Pro Profil:** Rückblick, Härte und Abschnitt gelten je Profil, nie für den Haushalt.

## 10a. Körpergewicht (Nutzer entschieden, 10.11.2026)

- **Nutzer:** Essen und Essens-Coach bleiben unverändert. Die Regel, dass er nicht über Kalorien, Gewicht oder Körper spricht, gilt weiter.
- **Nutzer:** Körpergewicht bleibt ganz draußen. Ohne Garmin-Waage wird es nicht verlässlich eingetragen. Kein Gewichtsverlauf, kein Gewichtsziel, Bo spricht im Rückblick nie über Gewicht.

## 10. Prüfung

Szenarien im Register (`scenarioIds`) und Tests mit gestellter KI:
1. 3× pro Woche, Massephase, Härte „Fordere mich“, mag Kreuzheben.
2. 1× pro Woche, Anfängerin, Härte „Vorsichtig“, abheilende Schulter.
3. Nur Geräte, wechselt zwischen 1× und 3× pro Woche.
4. Rückkehr nach 4 Wochen Pause.

Abnahme: Für jedes Szenario ist der Rückblick ermutigend und ohne Vorwurf, nennt höchstens drei Beobachtungen, schlägt nichts gegen eine Regel oder Beschwerde vor; Szenario 2 bekommt nie Versagenssätze; ein ausgefallener Tag erzeugt kein Nachholen.

## 11. Dem Bauenden überlassen

Struktur der neuen Datensätze (Abschnitt, Rückblick-Beobachtungen), genaue Prompt-Texte, Aufteilung in Bauschritte (Vorschlag: Rückblick → Härte → fester Abschnitt), Darstellung der Abschnittszeile.
