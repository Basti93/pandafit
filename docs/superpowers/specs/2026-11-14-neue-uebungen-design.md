# Neue Übungen: Sätze, geschätztes Startgewicht, Nachfrage

Stand: 14.11.2026, im Chat besprochen.

**Warum:** Mit wenig Verlauf beginnt eine neue Übung mit genau einem leeren Satz. Nach „Satz geschafft“ springt die Karte weiter, die Übung wirkt verschwunden, jeder weitere Satz muss einzeln hinzugefügt werden. Anfänger haben kein Gefühl fürs Startgewicht.

**Entscheidungen**
1. Eine Übung ohne Verlauf (im Training hinzugefügt oder getauscht) beginnt mit 3 Arbeitssätzen (Regel `gym.new-exercise-sets`, Wert 3) mit dem Wiederholungsbereich der Übung (`repRangeOf`), Gewicht leer. Das Gewicht wird einmal im ersten Satz eingetragen; leere Folgesätze übernehmen es schon heute als Vorschlag.
2. Plant Bo (KI-Planer) eine Übung ohne Verlauf, gibt er ein vorsichtiges Startgewicht an (lieber zu leicht), abgeleitet aus anderen Übungen und dem Profil. Dieses Gewicht wird von den Leitplanken nicht verworfen, aber als geschätzt markiert und auf die Gewichtsleiter gerundet. Ohne KI (Regel-Planer) bleibt es leer.
3. Die App zeigt bei geschätztem Gewicht: „Startgewicht von Bo geschätzt. Pass es nach Gefühl an.“
4. Nach dem ersten bestätigten Arbeitssatz einer Übung mit geschätztem Gewicht fragt die App: „Wie war das Gewicht?“ mit „Zu leicht“, „Passt“, „Zu schwer“ und „Überspringen“. Zu leicht / zu schwer: die folgenden offenen Arbeitssätze gehen eine Stufe der Gewichtsleiter hoch / runter (nur Sätze, die noch das geschätzte Gewicht haben), mit „Rückgängig“ bis zum nächsten bestätigten Satz. Einmal pro Übung.
5. Gelernt wird über die tatsächlich gemachten Gewichte (Verlauf); keine neue Speicherung des Gefühls.

**Nicht-Ziele:** Keine Gewichtsschätzung ohne KI; keine Nachfrage bei Übungen mit Verlauf (dafür gibt es die Tempo-Frage).

**Ansätze:** Feste Startgewichte pro Übung aus einer Tabelle (verworfen: passt nicht zu Person und Studio); KI schätzt, App fragt nach (gewählt, Wunsch der Person).
