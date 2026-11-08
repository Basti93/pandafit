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

## Meilenstein A — Brief (umgesetzt 06.11.2026)

**Ziel:** Jede Übung, die ihr macht oder aus Hevy importiert, ist eine richtige PandaFit-Übung mit Muskel, Gerät und passender Anleitung.

**Abnahme:**
1. Taucht eine unbekannte Übung auf, schlägt der Coach einmal vor: „ist dieselbe wie X“ oder „neue Übung: Muskel, Gerät, kurze Anleitung“. Nach Bestätigen ist sie überall eine normale Übung: im Training, im Verlauf, in der Statistik und beim Coach – auch offline.
2. Ohne Netz oder KI bleibt die Übung voll nutzbar; der Muskel steht bis zur Einordnung auf „unbekannt“.
3. Eine falsche Einordnung lässt sich in einem Schritt korrigieren; alte Trainings bleiben erhalten und zählen danach richtig.
4. Die Übungsauswahl bietet eine größere, gemeinfreie Übungsbasis mit deutschen Namen und Bildern, wo vorhanden; Varianten mit anderem Gerät bekommen nie fremde Anleitungen.

**Fällt weg:** Hand gepflegte Zusatzeinträge für einzelne Hevy-Namen; die Sonderform „deutscher Titel + Gerät“, sobald gespeicherte Zuordnungen sie abdecken.

**Nicht dabei:** Wirkung sekundärer Muskeln auf Bilanz und Planung (kommt in B; die Daten werden aber schon mitgenommen), Geräteinventar (C).

**Entscheidungen der Person (06.11.2026):**
- Eine gemeinsame Übungsdatenbank für beide Profile; eine bestätigte Einordnung gilt für beide.
- Sehr eindeutige Vorschläge („Cable Curl“ = „Curl am Kabel“) werden ohne Rückfrage übernommen, mit Rückgängig.
- Basis ist free-exercise-db (gemeinfrei, Stand `f00c92c`, lokal in `~/Projects/pandafit-references/free-exercise-db`): 876 Übungen, 604 mit Nebenmuskeln, 1746 Bilder (~100 MB).

**Notizen für den Plan (noch nicht entschieden):**
- Records liegen heute pro Profil/Konto (`src/coach/server/household.ts`: „Each profile's records go to its own account's store“). Die gemeinsame Übungsdatenbank braucht deshalb einen Haushalts-Speicherort oder eine bewusste Spiegelung – das ist die erste Designfrage des Plans.
- Deutsche Namen für die Basis einmalig erzeugen und mitliefern (für die Suche); deutsche Kurzanleitung erst beim ersten Verwenden per KI erzeugen und speichern, statt 876 Anleitungen vorab zu übersetzen.
- Bilder nicht alle bündeln (Größe der PWA); zunächst nur für tatsächlich genutzte Übungen.
- Der KI-Vorschlag läuft auf der Coach-Seite (`coachHere`); Ergebnis ist eine gespeicherte Zuordnung, die UI, Statistik und Coach-Historie gleichermaßen verwenden.

## Meilenstein B — Brief (umgesetzt 06.11.2026)

**Ziel:** Die Muskelübersicht sagt pro Muskel in einem Wort, wo ihr steht – und rechnet die Arbeit mit, die andere Übungen nebenbei leisten.

**Abnahme:**
1. Rudern zählt auch für den Bizeps, Bankdrücken auch für Trizeps und vordere Schulter – als halbe Sätze (Regel `muscle.indirect-weight`). Das gilt für jede Übung im Katalog, auch für Basis- und KI-Übungen.
2. Gesäß und Oberschenkel hinten sowie Schulter vorn, seitlich und hinten sind getrennte Muskeln. Welche Übung welchen Teil trifft, steht in den Übungsdaten, nicht in Namenslisten.
3. Jeder Muskel steht in einem von vier Zuständen: **Noch nichts**, **Wenig**, **Im Ziel**, **Viel** (letzte 7 Tage gegen das Wochenziel der Person). Zahlen gibt es erst auf Antippen.
4. App, Statistik und Coach rechnen die Bilanz mit derselben Funktion; der Coach sieht dieselben Zustände.

**Fällt weg:** Titel-Regex und ID-Liste für Schulterteile; die Hauptanzeige „n von min–max Sätzen“; die zweite Volumenrechnung auf der Coach-Seite.

**Nicht dabei:** Körperbild/Muskelkarte (Parkplatz), persönliche Schwerpunkte (E/H), Gewichte und Geräte (C).

**Von Claude entschieden (Ledger):** Liste mit vier Zuständen statt Körperbild; Zielbereiche der neuen Teilmuskeln aus RP-Richtwerten im Regelregister; Altwert „Schultern“ ohne Teil zählt als „Schulter vorn“.

## Meilenstein C — Brief (umgesetzt 06.11.2026)

**Ziel:** Jeder Gewichtsvorschlag lässt sich am Gerät im jeweiligen Studio wirklich einstellen, und jede Übung steigert sich in ihrem eigenen Bereich.

**Abnahme:**
1. Ein Training gehört zu einem Studio. Vor dem Training wird das Studio gewählt; Vorschlag ist das zuletzt genutzte. Dieselbe Übung hat pro Studio einen eigenen Gewichtsverlauf.
2. Die App lernt die Gewichtsstufen jeder Übung pro Studio aus den eingetragenen Gewichten (z. B. nur Vielfache von 5 → 5-kg-Stufen). Bei der Übung steht die gelernte Stufe; sie lässt sich in einem Schritt korrigieren. Vorschläge und die Prüfung der Coach-Pläne liegen immer auf einer erreichbaren Stufe.
3. Der Wiederholungsbereich kommt aus der Übung (Muskelgruppe im Regelregister) statt global 6–12. Der nächste Lastschritt ist die nächste erreichbare Stufe statt pauschal 2,5 kg / 5 %.
4. „Keine Wiederholung mehr übrig“ senkt das Gewicht nicht, solange die Leistung steigt oder hält. Abgesenkt wird nur bei echtem Leistungsrückgang oder nach langer Pause.
5. Bei Langhantel-Übungen zeigt die App die Auflage pro Seite (20-kg-Stange, übliche Scheiben) und sagt, wenn ein Gewicht nicht genau aufgelegt werden kann.

**Fällt weg:** Regeln `gym.rep-range`, `gym.min-step-kg`, `gym.max-step-pct`, `gym.effort-step-back-count`; das Runden auf 0,5 kg in der Progression.

**Nicht dabei:** eigenes Inventar pro Studio (Stangengewicht, begrenzte Scheiben, Hantelsätze), persönliche Wiederholungsbereiche (E), Aufwärmsätze aus dem Gerätemodell (G).

**Entscheidungen der Person (06.11.2026):** Stufen selbst lernen statt Einrichtung; mehrere Studios mit getrennten Verläufen; Scheibenrechner gehört in C.

## Meilenstein D — Brief (umgesetzt 07.11.2026)

**Ziel:** Was der Coach ändern will, ist ein Vorschlag mit Grund. Übernommenes bleibt, lässt sich rückgängig machen und geht durch Schließen, Neustart oder ein altes Gerät nicht verloren. Was nicht geht, sagt der Coach mit Grund.

**Abnahme:**
1. Jede Coach-Änderung (laufendes Training, nächstes Training, Wochenplan) erscheint als Vorschlag mit einem Satz Grund und „Übernehmen“ / „Nein“. Der Vorschlag ist gespeichert: nach Schließen und Neustart steht er noch da, und zweimal Übernehmen ändert nichts doppelt.
2. Übernommenes lässt sich mit „Rückgängig“ zurücknehmen. Rückgängig stellt nur den Stand davor wieder her und überschreibt keine spätere eigene Änderung; geht das nicht mehr, steht dort warum.
3. Eine Änderung „fürs nächste Training“ überlebt das Neuplanen des Coaches, Schließen und Neustart und kommt beim nächsten Start im richtigen Training an.
4. Ein Wochenplan, der inzwischen woanders geändert wurde, wird nicht still überschrieben.
5. Kann der Coach etwas nicht umsetzen (Übung schon fertig, Regel verletzt, Plan abgelehnt), sagt er „geht nicht, weil …“ statt still etwas anderes zu tun.

**Fällt weg:** Nicht gespeicherte „schon übernommen“-Merker in der Oberfläche; stilles Verwerfen ungültiger Änderungen; der neutrale Ersatzgrund, wenn ein Coach-Plan abgelehnt wurde.

**Nicht dabei:** Coach ändert Routinen/Vorlagen (E/G), Konflikterkennung auf dem Server, Laufplan-Vorschläge.

**Von Claude entschieden (06.11.2026, Person hat Produktfragen an Claude übergeben):** Ein gemeinsamer Datensatz „Änderung“ für alle Vorschläge; Rückgängig bis zum Ende des Trainings bzw. bis zum Start des nächsten Trainings bzw. für den Wochenplan bis zur nächsten Änderung.

## Meilenstein E — Brief (umgesetzt 07.11.2026)

**Ziel:** Was du dauerhaft willst („künftig keine Kniebeugen“, „Schwerpunkt Rücken“, „Laufen nur erhalten“), steht als Regel oder Ziel sichtbar in der App und wirkt in jeder Planung, bis du es pausierst oder löschst.

**Abnahme:**
1. Sagst du dem Coach etwas Dauerhaftes, schlägt er eine Regel vor (ein Satz, bei Übungen mit den betroffenen Übungen). Nach „Übernehmen“ steht sie unter „Meine Regeln“ auf der Wochenseite.
2. Eine ausgeschlossene Übung taucht nirgends mehr auf: nicht im Coach-Plan, nicht im einfachen Ersatzplan, nicht in Tauschvorschlägen, nicht beim Start aus Plan oder Routine (dort mit kurzem Hinweis). Der Coach sagt „geht nicht, weil …“, wenn man sie per Chat einbauen will. Selbst hinzufügen bleibt möglich.
3. Wünsche, die sich nicht prüfen lassen („lieber kurze Einheiten“), wirken als Hinweis in allen Planern und sind als Wunsch gekennzeichnet.
4. Ziele: Kraftziel (Muskelaufbau / Kraft / Fit bleiben), bis zu drei Schwerpunkt-Muskeln und pro Sportart Schwerpunkt / gleichrangig / erhalten. Sie stehen sichtbar in der App und ersetzen das fest eingebaute „Muskelaufbau“.
5. Pausieren oder Löschen hebt die Wirkung sofort auf; Regeln und Ziele sind synchronisiert und gelten auf allen Geräten.

**Fällt weg:** Die nur auf dem Mac gespeicherten freien Coach-Regeln (Kraft und Rad) – sie werden einmal als Wünsche übernommen; das fest eingebaute Ziel „muscle“.

**Nicht dabei:** befristete Schwerpunkte/Blöcke (H), Regeln mit Wochentag oder Uhrzeit (F), Ausschluss ganzer Bewegungsfamilien ohne Übungsliste.

**Von Claude entschieden (07.11.2026):** Prüfbare Regel = Liste konkreter Übungen (der Coach schlägt alle passenden Varianten aus dem Katalog vor, du siehst sie vor dem Übernehmen); alles andere ist ein Wunsch. Regeln immer erst als Vorschlag, auch bei klarer Aussage. Selbst hinzugefügte Übungen werden nicht blockiert (deine eigene Wahl).

## Meilenstein F — Brief (umgesetzt 07.11.2026)

**Ziel:** Ob du eine feste Woche planst oder spontan trainierst, die App sagt dir jeden Tag in einem Satz, was heute passt und warum – und Pläne passen in die Zeit, die du hast.

**Abnahme:**
1. Du wählst „Feste Woche“ oder „Spontan“. Spontan gibt es keinen Wochenplan-Zwang: Start- und Wochenseite zeigen „Heute: … – weil …“ aus Belastung der letzten Tage, Zielen und Regeln.
2. Mit Wochenplan zeigt „Heute“ den Plantag; weicht die Empfehlung ab (z. B. harte Beine gestern), steht der Grund in einem Satz daneben. Ein nicht gemachtes Training zählt nicht als gemacht und wird nicht nachgeholt.
3. Ein Tag kann zwei Einheiten tragen (z. B. Kraft + lockeres Rad), nur wenn du es willst; Dauer und Belastung zählen zusammen.
4. Du gibst eine übliche Zeit pro Einheit an und kannst sie für heute ändern („heute nur 30 Min“). Der Kraftplan passt mit Aufwärmen und Pausen hinein und zeigt „ca. N Min“; ohne Angabe gilt ein sinnvoller Umfang mit Schätzung.
5. Der einfache Ersatzplan des Coaches wird genauso geprüft wie sein normaler Plan (Grenzen, Regeln, Zeit).

**Fällt weg:** die fest eingebauten 45 Minuten pro Krafttraining in der Tagesbelastung; der ungeprüfte Ersatzplan.

**Nicht dabei:** Kalender-Anbindung, Uhrzeiten, Wochentag-Regeln, mehrere Studios pro Woche planen.

**Von Claude entschieden (07.11.2026):** Rahmen als eigener Datensatz (Modus, übliche Minuten, Minuten nur für heute); „Was geht heute“ ist eine feste, erklärbare Regel ohne KI-Aufruf; Kombination nur mit höchstens einem harten Teil; Zeitschätzung Kraft = Aufwärmen + Sätze × (Arbeit + Pause) + Wechsel.

## Meilenstein G — Brief (umgesetzt 07.11.2026)

**Ziel:** Das laufende Training passt sich dem Studio an: Reihenfolge umstellen, beliebige Übungen zum Supersatz verbinden, Aufwärmen dort, wo eine neue Bewegung beginnt, und Pausen, die überall gleich gerechnet werden.

**Abnahme:**
1. Jede Übung lässt sich nach oben oder unten verschieben; ein Supersatz zieht als Block mit. Erledigte Sätze bleiben unverändert an ihrer Übung, Rückgängig von Coach-Änderungen funktioniert danach weiter.
2. Zwei beliebige offene Übungen lassen sich zum Supersatz verbinden; der Partner rückt direkt dahinter. Das Training führt rundenweise (A1, B1, A2, B2), Pause erst nach der Runde, erledigte oder ausgelassene Partner werden übersprungen.
3. Vor der ersten Übung eines neuen Bewegungsblocks bietet die App „Aufwärmen hinzufügen“ an: Steigerung aus dem Arbeitsgewicht auf erreichbaren Stufen (Milestone C), ohne erfundene Kilos, wenn kein Arbeitsgewicht bekannt ist. Der einfache Coach-Plan plant das Aufwärmen gleich mit.
4. Pausen kommen aus einer Quelle: Plan oder eigene Einstellung, sonst je nach Übung (Grundübung länger, Isolation kürzer). Timer, Zeitschätzung und Coach rechnen gleich; die Pause lässt sich verlängern und pro Übung ändern, ein Neuladen setzt sie nicht zurück.

**Fällt weg:** feste 90 s als Ersatzpause im Timer und 0 s in der Zeitschätzung; Supersatz nur mit der nächsten Übung; Aufwärmsätze, die in der Zeitschätzung wie Arbeitssätze zählen.

**Nicht dabei:** Ziehen per Drag-and-drop, Pausen pro einzelnem Satz, Aufwärmen nach Erfahrung der Person.

**Von Claude entschieden (07.11.2026):** Verschieben mit „Nach oben/unten“ im Übungsmenü statt Ziehen (leicht, sicher auf dem Handy); Bewegungsblock = Muskelgruppe der Übung (B-Gruppen); Aufwärmen in der App nur als Angebot, im einfachen Coach-Plan automatisch; Steigerung 40 %×5, 60 %×3, 80 %×2, bei Langhantel zuerst die leere Stange (Werte im Regelregister).

## Meilenstein H — Brief (umgesetzt 07.11.2026)

**Ziel:** Über Wochen bleibt nachvollziehbar, was der Coach tut und warum: Schwerpunkte haben ein Ende, deine Rückmeldung zeigt sichtbar Wirkung, und der Chat ist ein Verlauf mit Datum und Uhrzeit.

**Abnahme:**
1. Ein Schwerpunkt (Muskeln oder Sportart) kann befristet sein („4 Wochen Rücken“). Solange er gilt, plant der Coach mehr dafür und die Muskelbilanz rechnet mit höherem Ziel; danach gilt wieder dein Grundziel, und die App sagt einmal sichtbar, dass er ausgelaufen ist.
2. Nach dem Training sieht man pro Übung in einem Satz, was beim nächsten Mal passiert und warum („Nächstes Mal 62,5 kg – weil du alle Wiederholungen geschafft hast“; „Gewicht bleibt – weil noch 0 übrig war“).
3. Auf der Wochenseite steht „Zuletzt geändert“: die letzten Änderungen aller Coaches mit Datum und Grund (z. B. FTP angepasst, Lauf-Phase gewechselt, Gewicht gesteigert).
4. Der Chat zeigt Tagestrenner und Uhrzeiten; ältere Nachrichten lassen sich schrittweise laden.
5. Was der Chat-Coach an andere Coaches weitergibt, steht sichtbar unter „Meine Regeln und Ziele“ und lässt sich entfernen; es ist synchronisiert.

**Fällt weg:** die nur auf dem Mac gespeicherte Auftragsliste der Coaches; unbefristete Schwerpunkte als einzige Möglichkeit.

**Nicht dabei:** neue Lösch-Regeln für den Chat (90 Tage bleiben), automatische Volumenanpassung über Wochen ohne Bestätigung, Rückfrage nach jedem Lauf.

**Von Claude entschieden (07.11.2026):** Befristung als optionaler Zeitraum im Ziel (Grundziel bleibt gespeichert); Schwerpunkt-Muskeln erhöhen das Wochenziel um einen Faktor aus dem Regelregister; Begründungen der Steigerung kommen vom Coach mit dem Plan; Aufträge werden eigene Datensätze statt Mac-Datei.

## Meilenstein I — Brief (umgesetzt 07.11.2026)

**Ziel:** Die kleinen Stolpersteine des Alltags verschwinden: Gewichte stimmen fürs gewählte Studio, nach dem Training sieht man kurz, was war und was kommt, und was man übernimmt, wirkt sofort.

**Abnahme:**
1. Wählt man vor oder zu Beginn des Trainings ein anderes Studio als das, für das der Coach geplant hat, stehen die Gewichte dieses Studios da (eigener Verlauf, sonst auf dessen Stufen gerundet).
2. Nach „Beenden“ erscheint eine kurze Zusammenfassung: Dauer, Sätze, und pro Übung „Nächstes Mal …“ (oder „Kommt nach der Auswertung“).
3. Eine übernommene Änderung fürs nächste Training lässt den Coach sofort neu planen; „Berücksichtigt: …“ erscheint ohne Warten.
4. Beim Umbenennen eines Studios bleiben eigene Gewichtsstufen erhalten. Ein Studio ohne Trainings lässt sich entfernen, eines mit Trainings ausblenden.
5. Eine selbst eingestellte Pause bleibt beim Tauschen einer Übung erhalten.
6. Hat man heute schon trainiert, sagt die Empfehlung ab dem Abend „Heute erledigt“ statt einer neuen Einheit.
7. Die Zielkarte zeigt nur Sportarten, die man in letzter Zeit gemacht hat; die anderen hinter „Weitere“.
8. Nach einem Lauf fragt die App einmal „Wie war der Lauf?“ (leicht / passend / schwer). Die Antwort fließt in den Laufplan ein: zweimal schwer hintereinander → keine Steigerung, mit Grund.

**Fällt weg:** Plan-Gewichte eines anderen Studios; Zielkarte mit immer allen drei Sportarten.

**Nicht dabei:** Inventar pro Studio, Teilen von Studios zwischen Profilen.

**Von Claude entschieden (07.11.2026):** Plan merkt sich sein Studio; ein abweichendes Studio nimmt eigene Werte, sonst den Plan auf seine Stufen abgerundet. Ausblenden statt Löschen, sobald Trainings dranhängen. „Heute erledigt“ ab 18 Uhr (Regelregister). „In letzter Zeit“ = 90 Tage.

## Meilenstein J — Brief (umgesetzt 07.11.2026)

**Ziel:** Der Coach kennt jede Übung, die die App kennt: Tauschen und Ausschließen klappen aus dem ganzen Katalog, ganze Bewegungsfamilien lassen sich ausschließen, und man kann die Übungen mit Bild in Ruhe ansehen.

**Abnahme:**
1. Schlägt der Wochen-Chat fürs nächste Training einen Tausch vor, ist die neue Übung eine echte Katalog-Übung; kennt er sie nicht sicher, schaut er einmal im Katalog nach statt den Vorschlag zu verwerfen.
2. Jede Übung gehört zu einer Bewegungsfamilie (z. B. Kniebeuge, Kreuzheben, Bankdrücken, Rudern). „Künftig keine Kniebeugen“ kann als ganze Familie ausgeschlossen werden – das trifft auch Varianten, die später dazukommen.
3. Übungen aus der Übungsbasis zeigen ihre Bilder, geladen erst beim Ansehen.
4. Unter Kraft gibt es „Übungen“: suchen, nach Muskel stöbern, Info mit Bild und Anleitung, und von dort „Ausschließen“ (Übung oder Familie).

**Fällt weg:** Ausschluss nur über aufgezählte Varianten; Wochen-Chat ohne Katalog.

**Nicht dabei:** Bilder offline, eigene Bilder hochladen, Mobilitätsübungen im Kraftkatalog (Mobilität bleibt eine eigene, kleine Liste).

**Von Claude entschieden (07.11.2026):** Familien als Datenfeld der Übung (Basis: beim Import abgeleitet, eingebaute: von Hand, KI-Übungen: im Vorschlag); Bilder der gemeinfreien Basis werden beim Bauen verkleinert aus der lokalen Kopie erzeugt und nicht ins Repo gelegt; Katalog als vierter Unterpunkt unter Kraft (höchstens sechs Haupt-Tabs bleibt).

## Meilenstein L — Brief (umgesetzt 07.11.2026)

**Ziel:** Jeder Screen hat eine Hauptaufgabe und ist ruhig: Zeilen statt Kartenstapel, ein Hauptknopf, Zahlen und Einstellungen erst auf Antippen. Die Wochenseite zeigt die Woche; der Chat ist ein eigener Ort mit fester Eingabe.

**Abnahme:**
1. Alle Web-Screens sind in Handygröße fotografiert (`npm run ui:web-shots`) und von unabhängigen UX-Prüfern vorher und nachher bewertet; nachher liegt kein Screen unter 7/10 bei Ruhe und Hauptaufgabe.
2. Woche: oben die sieben Tage, darunter je eine Zeile für Zuletzt geändert, Mein Ziel, Regeln und Coach; der Chat öffnet als eigene Ansicht mit Eingabe unten und angehefteten offenen Vorschlägen.
3. Im Training sieht man den nächsten Satz, die Pause sitzt fest, alles Seltene steckt im Menü der Übung.
4. Formulare, Auswahllisten und Chats öffnen als Blatt; Löschen ist immer ein roter Textlink mit Rückfrage.
5. Nichts geht verloren: jede Funktion bleibt erreichbar, gespeichert wird wie bisher.

**Nicht dabei:** neue Funktionen (Ausnahme auf Wunsch: eigene Produkte auf der Einkaufsliste), Symbole in der Tableiste, Gesten.

**Von Claude entschieden (07.11.2026):** sechs Tabs bleiben (größer), keine Langdruck-Gesten, „Wie oft pro Woche“ beim Laufen bleibt; Begriffe: Verlauf = vergangene Trainings, Entwicklung = eine Übung über Zeit, Übungen = Katalog.

## Meilenstein M — Brief (umgesetzt 07.11.2026)

**Ziel:** Jede Person bekommt am Sonntagabend ihre Wochenübersicht per E-Mail: was die letzte Woche war und was die nächste bringt. Die Adresse steht im Profil und lässt sich dort selbst ändern.

**Abnahme:**
1. Im Profil gibt es „E-Mail“ (ändern, leeren) und einen Schalter „Wochenübersicht per E-Mail“. Beides ist synchronisiert.
2. Sonntags ab 18 Uhr (Regelregister) verschickt der Coach-Server einmal pro Person und Woche eine kurze Mail: Rückblick (Einheiten, Zeit, was auffiel), nächste Woche Tag für Tag, offene Vorschläge als Hinweis, Link zur App. Kein Versand ohne Adresse, ohne Schalter oder ohne Mail-Zugang.
3. Der Mail-Dienst des Heimservers erlaubt einem berechtigten Client genau einen Empfänger pro Mail; Tageslimit und Protokoll bleiben.
4. Keine Adresse und kein Zugangsschlüssel steht im Repo.

**Von Claude entschieden (07.11.2026):** Sonntag 18 Uhr; Empfänger frei pro Mail nur für Clients mit `allowRecipient`, eine Adresse, geprüftes Format; Adressen als Datensatz pro Profil auf dem Server.

## Meilenstein N — Brief (07.11.2026)

**Ziel:** Nichts geht verloren, wenn der Mac verloren geht.

**Stand vorher (geprüft 07.11.2026):** Beide Profile sind umgezogen; jede beendete oder abgebrochene Fahrt wird samt Sekundenwerten und FIT auf den Server geladen und täglich gesichert (auch auf den Mac gezogen). Der Coach-Stand liegt auf dem Server. Der Vorgänger-Server `bike-coach` bekommt parallel noch Daten, enthält aber nichts Zusätzliches.

**Abnahme:**
1. Ein Mac ohne Fahrten holt nach dem Anmelden alle Fahrten seines Profils vom Server zurück (Verlauf, Kurven, FIT), ohne Doppelte.
2. Die Mac-App zeigt im Verlauf in einer Zeile, ob alle Fahrten gesichert sind („Alle Fahrten gesichert“ / „1 Fahrt wartet auf Upload“).
3. Der alte Abgleich (config.json → Vorgänger-Server) und dessen Code sind entfernt; der Vorgänger-Dienst ist abgeschaltet, seine Daten gesichert.

**Nicht dabei:** Garmin-Rohdaten (werden neu geholt), Geräte-Kopplungen.

## Meilenstein U — Brief (umgesetzt 08.11.2026)

**Ziel:** Auf der Wochenseite sehe ich auf einen Blick, was ich diese Woche erledigt habe, und an einer Stelle meine letzten Aktivitäten aus allen Sportarten.

**Anlass (08.11.2026):** Ein Morgenlauf fehlte mittags noch. Der Garmin-Abgleich läuft nur alle 3–6 Stunden; der letzte Lauf um 09:00 fand ihn noch nicht. Die Woche zeigt nur den Plan (nur Fahrten bekommen „gefahren“), der Verlauf ist auf Kraft, Rad und Laufen verteilt.

**Abnahme:**
1. Ein vergangener Tag der Woche zeigt nur, was wirklich gemacht wurde (z. B. „Lauf 6 km“, „Kraft Oberkörper“), egal was geplant war. Ohne Aktivität steht ruhig „Ruhetag“, kein „verpasst“, nichts wird nachgeholt.
2. Heute zeigt das schon Gemachte und dazu, was noch geplant ist („Lauf 6 km ✓ · Kraft Oberkörper“). Kommende Tage zeigen den Plan wie bisher.
3. Auf der Wochenseite gibt es unter der Woche die Zeile „Verlauf“. Sie öffnet eine Liste der letzten Aktivitäten aller Sportarten, neueste oben, eine Zeile pro Aktivität. Antippen öffnet bei Kraft und Fahrten die vorhandene Detailansicht (Krafttraining bleibt dort korrigierbar); Läufe und andere Garmin-Aktivitäten öffnen ein kleines Blatt mit Datum, Dauer, Strecke und Puls, soweit vorhanden.
4. Die getrennten Listen sind entfernt: „Verlauf“ im Kraft-Tab und die Zeile „Fahrten“ unter Ausdauer. Die Karten „Letzter Lauf“ (mit der Frage „Wie war der Lauf?“) und „Letzte Fahrt“ bleiben.
5. Eine neue Garmin-Aktivität steht spätestens eine Stunde nach dem Hochladen zu Garmin Connect in der App, ohne den großen Abgleich öfter laufen zu lassen. Während einer offenen Fahrt wird nie geprüft.

**Stand vorher (geprüft 08.11.2026):** Garmin-Aktivitäten sind keine Datensätze; die Web-App kennt sie nur zusammengefasst (Minuten pro Tag, letzter Lauf). Der Coach-Server führt alles schon mit `allActivities` zusammen und muss die Liste neu veröffentlichen. Eine neue Datensatzart ändert die Sync-Signatur: jedes Gerät holt einmal alles neu.

**Fällt weg:** „Verlauf“ im Kraft-Tab, die Zeile „Fahrten“ unter Ausdauer, die Sonderanzeige „gefahren“.

**Nicht dabei:** Statistik, Filter oder Suche im Verlauf, Knopf „Jetzt abgleichen“, Umplanen der restlichen Woche, wenn ein Tag ausfiel.

**Von Claude entschieden (08.11.2026):** Alle Aktivitäten zählen, auch Garmin-Aktivitäten ohne eigenen Bereich (z. B. Yoga), jede nur einmal (wie `allActivities`). Auch im Modus „Spontan“ zeigt die Woche die vergangenen Tage mit dem Gemachten. Für neue Aktivitäten prüft der Server alle 50 Minuten nur die erste Seite der Aktivitätsliste (unter einer Stunde wegen Daten-Cache und Scan); nur wenn etwas neu ist, planen die Coaches neu (wie heute). Nur Web-App: die Mac-App ist nur fürs Rad (Q).

## Meilenstein V — Brief (umgesetzt 08.11.2026)

**Ziel:** Was ich mit dem Coach abspreche, kommt im Training auch so an, und kein Coach rechnet mit einem Training, das ich nicht gemacht habe.

**Anlass (Trainingsaudit 2.–8.11.2026):** Donnerstag und Freitag war „ohne Beine“ vereinbart, beide Einheiten enthielten trotzdem Beinübungen. Ein bestätigter Trizepstausch blieb in einem verworfenen Entwurf stecken. Der Wunsch „15–20 Min. Ausdauer im Gym“ blieb nur eine Notiz. Der Rad-Coach behandelte das offene Sonntags-Krafttraining als erledigt. Der gespeicherte Wochentext zeigte einen älteren Ruhepulsbefund. Einmalige Aufträge blieben pauschal sieben Tage offen.

**Abnahme:**
1. Was für einen Tag vereinbart ist („ohne Beine“, ein bestätigter Tausch, „15–20 Min. Ausdauer dazu“), steht beim Start genau so im Training. Ein bestätigter Tausch geht nie mit einem verworfenen Entwurf verloren.
2. Ein geplantes, aber nicht gemachtes Training gilt bei keinem Coach als erledigt. Alle Coaches arbeiten mit demselben Stand von geplant und erledigt (die Zählung aus U).
3. Hinweise zur Erholung stammen aus den aktuellen Daten und nennen ihr Datum. Ein älterer Befund erscheint nicht als heutiger.
4. Ein Auftrag mit Tag („am Montag …“) gilt nur bis zu diesem Tag. Ein Auftrag für die nächste Einheit gilt bis zu dieser Einheit und ist danach erledigt. Dauerhafte Wünsche werden persönliche Regeln (E).
5. Ich kann Läufe selbst wählen: Der Lauf-Coach plant dann nichts, meine Läufe zählen aber bei Belastung und Tagesvorschlag mit.

**Stand vorher (geprüft 08.11.2026):** Einmalige Aufträge laufen fest nach sieben Tagen ab (`ONE_OFF_MS` in `src/shared/tasks.ts`); `doneMs` existiert, wird aber nirgends gesetzt. „Ohne Beine“ wirkte nur, wenn es auf dem heutigen Plantag stand; der Kraft-Coach plant aber für den nächsten Krafttag. Ein bestätigter Tausch wurde beim Start still übersprungen, wenn die Übung nach einem Neuplanen fehlte. „Ausdauer dazu“ gab es nur als Notiz. Geplante Einheiten standen ohne Kennzeichen zwischen erledigten. Der Gesundheitstext wurde nur einmal pro Woche geschrieben.

**Fällt weg:** die pauschalen sieben Tage für einmalige Aufträge.

**Nicht dabei:** Belastung nach Menge (W). Kein Abgleich mit dem Garmin-Kalender: An Garmin gesendete oder gestrichene Termine sind für die App egal, es zählt nur, was in Garmin abgeschlossen wurde.

**Von Claude entschieden (08.11.2026):** Aus dem Audit nicht übernommen: getrennte Zählung direkter und indirekter Sätze und ein Wochenbudget je Muskel (widerspricht „keine Zahlenflut“; Muskelbilanz B und Steigerung C/H gibt es schon).

## Meilenstein W — grob

Ein Krafttag wird nach Muskelgruppe, Satzzahl und Anstrengung bewertet, nicht nach „eine Beinübung = hart“ (`src/coach/day-load.ts`). Die 48-Stunden-Beinsperre (`LEG_WINDOW_MS` in `src/coach/gym/history.ts`) greift nur nach echter Beinbelastung. „Zwei harte Tage“, „sechs Tage ohne Pause“ und die 18-Uhr-Regel werden dagegen geprüft. Die 48-Stunden-Regel nach einer harten Radfahrt bleibt. Hintergrund: Bei gleichem Wochenumfang bringt höhere Frequenz keinen klaren Vorteil; Muskelkater ist kein Wachstumsmaß; Versagen ist optional. Passt zu den Parkplatz-Punkten aus F („nur Beine“) und O (harte Fahrt und müde Beine).

## Meilenstein X — Brief (umgesetzt 08.11.2026)

**Ziel:** Wer die Web-App zum ersten Mal öffnet, versteht, was Pandafit kann und wo er tippen soll. Die App wird einfacher, keine wichtige Funktion fällt weg.

**Vorgehen:** Screenshots aller Screens in sechs Varianten (390, 360, Tablet, Desktop, dunkel, leeres Konto), acht Prüfschritte der Reihe nach, Zusammenführung zu 84 Punkten (`docs/ux-review/2026-11-08-synthese.md`, Methode in `docs/superpowers/plans/2026-11-08-ux-review-method.md`).

**Umgesetzt:** Tabs folgen den Profil-Schaltern in fester Reihenfolge; Statistik ist der Block „Rückblick“ in Woche; Kraft hat drei Unter-Tabs (Entwicklung und Übungen zusammen); ein Muster für Seitenkopf und Schließen; Heute mit einer Karte und ehrlicher Begründung; wartender Vorschlag als Karte; Coach-Änderungen mit Grund im Chat; Sätze werden aus dem vorigen Satz derselben Art vorbelegt; Anleitung per „i“ auf der Übungskarte; Fahrt-Begleiter in Worten („Leichter/Schwerer“, beruhigend bei Verbindungsverlust); Profil in Gruppen Planen, Verbindungen, Nachrichten; „Etwas anderes heute?“. Ein Training, das lange vor dem ersten Satz gestartet wurde, nimmt beim Beenden den ersten Satz als Start (Fall vom 08.11.2026).

**Nicht dabei:** alles unter „Verworfen“ in der Synthese; 24-Stunden-Zeit im Lauf-Formular (Parkplatz L); Dauer je Beweglichkeitsübung (braucht Coach-Daten).

## Meilenstein Y — Brief (umgesetzt 08.11.2026)

**Ziel:** Die Startseite zeigt auf einen Blick, was heute dran ist, und motiviert, statt zu kontrollieren. Spec: `docs/superpowers/specs/2026-11-08-heute-day-pages-design.md`, Plan: `docs/superpowers/plans/2026-11-08-milestone-y-heute-day-pages.md`.

**Was kam:** neue Record-Art `daytext`; der Coach schreibt einmal am Tag und nach jedem fertigen Training einen Satz (höchstens 4 KI-Aufrufe pro Tag, nie bei offener Fahrt, Prüfung auf Druckwörter und fremde Zahlen, 60 s Zeitgrenze). Ohne Satz zeigt die Seite einen täglich wechselnden Spruch aus einer festen Liste. Kopf mit Pfeilen und Wischen; „Dein Körper“ in Worten ohne Zahlen; Gemeinsam unten; Gestern mit Training und Essen des Tages, Morgen mit Plan. Erledigt damit die Wünsche „Coach prominenter“ und „Spruch auf Heute“.

**Geparkt:** Der Satz-Input wird bei jedem Scan neu gebaut (günstig, aber unnötig oft).

## Meilenstein Z — Brief (umgesetzt 08.11.2026)

**Ziel:** Ein ruhiger Abschluss nach dem Krafttraining, angeboten, nie verlangt. Plan: `docs/superpowers/plans/2026-11-08-milestone-z-finisher.md`. Nur Web, eine reine Regel `finisherOf` (`src/tracking/ui/finisher.ts`), gezeigt in der Zusammenfassung und auf Heute (dort mit der Beweglichkeits-Zeile des Coaches). Keine Server-Änderung.

## Parkplatz

- ~~Export nach Hevy wählt bei zwei verknüpften Hevy-Vorlagen derselben Übung die zuerst gelistete (aus Review Meilenstein 0).~~ Erledigt mit K.
- Ohne Statistik-Record zählen manche deutschen Hevy-Varianten als „Sonstiges“ (löst sich mit A).
- Eigene Übung mit gleichem Titel wie eine eingebaute verliert gegen die eingebaute (löst sich mit A).
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
  - Körperbild/Muskelkarte statt Liste? (Frage an die Person offen.)
  - Zielbereiche Gesäß + Oberschenkel hinten und Schulter seitlich + hinten summieren sich höher als früher; beobachten, ob der Coach dort zu viele Sätze plant.
  - Muskelpaare zählen halbe Sätze einer Übung auch auf der Gegenseite (Kniebeuge → Gesäß), das mildert den Ungleichgewichtshinweis.
  - Unbekannte Hevy-Übungen mit „Schultern“ zählen als Schulter vorn.
  - Coach erkennt Übungen über ID/Hevy-Verknüpfung, die Statistik zusätzlich über deutsche Titel; in seltenen Fällen leicht abweichende halbe Sätze.
- Aus Meilenstein C:
  - Coach plant immer fürs zuletzt genutzte Studio; wer vor dem Start ein anderes Studio wählt, bekommt Gewichte des alten Studios aus dem Plan.
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
  - Die Handy-App kennt keine Radfahrten; ohne veröffentlichte Empfehlung des Coaches rechnet sie nur mit Kraft und Laufen.
  - Ein Plantag kann nicht „nur Beine“ markieren; nach harten Beinen wird Kraft immer zu „Kraft ohne Beine“.
  - ~~Die Empfehlung kennt keine Uhrzeit; abends gilt noch die Empfehlung des Tages.~~ Erledigt mit I.
- Aus Meilenstein G:
  - Pausen pro einzelnem Satz und Aufwärmen nach Erfahrung der Person.
  - Verschieben per Ziehen statt über das Menü.
  - ~~Eigene Pausen-Einstellung geht beim Tauschen einer Übung verloren (die neue Übung bekommt ihre eigene Pause).~~ Erledigt mit I.
- Aus Meilenstein H:
  - ~~„Nächstes Mal“ steht nur im Verlauf beim letzten Training; eine eigene Zusammenfassung nach dem Training fehlt.~~ Erledigt mit I.
  - Rad-Änderungen ohne eigenen Grund erscheinen in „Zuletzt geändert“ ohne „– Grund“.
  - Chat-Nachrichten werden weiter nach 90 Tagen gelöscht (alte Regel, bewusst beibehalten).
  - ~~Läufe haben keine eigene Rückfrage nach dem Training.~~ Erledigt mit I.
- Aus Meilenstein I:
  - Ausblenden/Entfernen eines Studios nur auf dem Startbildschirm, nicht im laufenden Training.
  - Eine schwere Laufwoche hält nur, wenn es eine Basis gibt; ohne Läufe der letzten Wochen wirkt sie nicht.
- Aus Meilenstein J:
  - Bilder der Übungsbasis machen App und Server-Paket ~50 MB größer; ggf. kleiner rechnen.
  - „Wieder erlauben“ pausiert eine Regel ganz, auch wenn sie mehrere Übungen betrifft; der Knopf sagt das nicht.
  - ~~Titel-Auflösung beim Tausch per Chat unterscheidet Groß-/Kleinschreibung.~~ Erledigt mit K.
  - Einordnung einzelner Basis-Übungen (enges Bankdrücken bei Bankdrücken, Hyperextensions bei Sonstige).
- Aus Meilenstein L:
  - Eigene Produkte der Einkaufsliste erscheinen nur in der Web-App, nicht in der Mac-Ansicht.
  - Datumsstil in Laufen/Entwicklung noch gemischt („ab 14. Sept.“ / „26.10. bis 1.11.“).
  - Native Datums-/Zeitfelder folgen der Gerätesprache (im Test-Browser AM/PM).
  - Katalog: große Gruppen zeigen zuerst eingebaute/genutzte Übungen; ggf. später Untergruppen.
  - Shot-Werkzeug erreicht „Haben wir“ auf der Einkaufsliste nicht.
- Aus Meilenstein O:
  - Eine harte Fahrt zählt nicht als „Beine müde“ (Server und Web gleich); nur die Regel „zwei harte Tage“ schützt. Prüfen, ob Fahrten die Beine belasten sollen.
  - Umschalter „Rad | Laufen“ steht über dem Seitentitel (wie bei Laufen); unter den Titel nur mit Platz in `PageHead`.
  - Sechs Tabs: auf Handys schmaler als 390 px nicht geprüft.
- Aus Meilenstein P:
  - Nach „Intervall überspringen“ ordnen `onTargetPct` und die Intervallwerte (`src/coach/metrics.ts`) Fahrzeit den Schritten ohne die übersprungenen Sekunden zu; Fix: übersprungene Sekunden an `summarizeRide` geben. „Geschafft“ zählt Übersprungenes als nicht gefahren (gewollt).
  - Handy-Begleiter noch nicht in einer echten Fahrt erprobt; WebSocket unter CSP `default-src 'self'` in Safari ungetestet.
- Aus Meilenstein Q:
  - Ältere Fahrt nachträglich zu Garmin hochladen hat kein Zuhause mehr (nur direkt nach der Fahrt).
  - ~~Gesundheit (Garmin) gibt es nur am Mac unter Verbindungen; Web hat keine Ansicht.~~ Erledigt mit R.
  - `src/ui/coachTrackingPort.ts` nur noch von zwei Tests genutzt; tote CSS in `src/ui/style.css`.
- Aus Meilenstein R:
  - `coach.strengthHealth` und die Nachricht `strength-health` haben keinen Nutzer mehr.
  - Statistik ist ohne Statistik-Record und ohne Trainings ausgeblendet: eine Person nur mit Garmin sähe „Gesundheit“ nicht.
  - Fällt die KI beim ersten Wochenlauf aus, bleibt der feste Text die ganze Woche.
  - HRV/Schlaf fließen noch nicht in die Tagesbewertung ein (nur angezeigt).
- Aus Meilenstein V:
  - Ändern sich die Befunde zweimal am selben Tag, bleibt bis zur nächsten Änderung der feste Text ohne KI stehen.
  - Rad + Kraft als zweite Einheit mit Minuten: das Kraft-Zeitbudget nimmt die Minuten nicht, nur der Prompt kennt sie.
  - Manuelle Läufe ohne Lauf-Einstellungen und ohne Garmin fehlen der Mobilität (selten).
  - Die Start-Hinweise („Ohne Beine“, „Dazu heute“) haben keinen Oberflächentest.
- Aus Meilenstein X:
  - Ein neues Gerät kennt den Essensplan-Schalter erst nach der ersten Coach-Antwort (bis 30 s); ein synchronisierter Datensatz wäre sauberer (braucht Server).
  - Browser-Zurück in verschachtelten Sheets schließt das ganze Sheet.
  - „Woche planen“ auf Heute führt zur Woche, dort braucht es einen zweiten Tipp bis zum Chat.
  - Der Rad-Verlauf zeigt Wattbereiche nur bei „bei N %“-Bezeichnungen.
