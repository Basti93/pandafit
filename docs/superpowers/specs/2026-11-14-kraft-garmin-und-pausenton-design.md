# Krafttraining zu Garmin, Ton in der Pause

Stand: 14.11.2026. Kurzes Design, besprochen im Chat.

## 1. Krafttraining zu Garmin hochladen

**Warum:** Dokumentieren und der soziale Teil: Das Training soll in Garmin Connect stehen, damit man und andere sehen, dass und wie lange trainiert wurde. Übungen, Sätze und Gewichte sind nicht nötig.

**Ziele**
- Nach einem Pandafit-Krafttraining gibt es „Zu Garmin hochladen“, freiwillig, mit derselben Vorschau wie bei Fahrten.
- Garmin bekommt: Sportart Krafttraining, Start, Dauer, Name „Krafttraining“, optional den Projekt-Link als Beschreibung.

**Nicht-Ziele**
- Keine Übungen, Sätze, Gewichte, kein Puls.
- Kein automatisches Hochladen. Kein Hochladen von Hevy-Trainings.

**Anti-Ziele**
- Garmin ist nie Pflicht; ohne Verbindung oder bei „Hochladen aus“ ist nichts zu sehen.
- Kein Training geht zweimal hoch.

**Ansätze**
- *Gewählt:* Kleine FIT-Datei (file_id, timer-Events, lap, session `training`/`strengthTraining`, activity) auf dem Server erzeugen und mit dem vorhandenen `garmin_upload.py` hochladen. Wiederverwendet den geprüften Weg der Fahrten.
- Verworfen: „Manuelle Aktivität“ über die Garmin-Schnittstelle, ein zweiter, ungeprüfter Weg.
- Verworfen: Über Hevy, hilft nur Hevy-Nutzern.

**Entscheidungen**
- Knopf direkt nach dem Training und im Verlauf bei jedem Pandafit-Training (so geht auch ein älteres Training hoch).
- Sichtbar nur mit Garmin verbunden und Hochlade-Modus „ask“, wie bei Fahrten.
- Vorschau: Name, Start, Dauer, Hinweis auf doppelte Einträge, wenn die Uhr mitgezeichnet hat, Häkchen Projekt-Link.
- Status pro Training (wird hochgeladen, bei Garmin, fehlgeschlagen mit Grund) neben dem Status der Fahrten.
- Das zurückkommende Garmin-Training zählt nicht doppelt; das deckt der vorhandene Überschneidungs-Abgleich (`all-training.ts`) ab.

**Dem Bauenden überlassen:** Ablageort der FIT-Datei, Form der Status-Map, Nachrichtentyp im Protokoll.

## 2. Ton in der Pause

**Warum:** Beim Krafttraining gibt es weder kurz vor noch am Ende der Pause einen Ton. Heute gibt es nur eine Push-Mitteilung am Ende, und nur mit Push-Erlaubnis.

**Entscheidungen**
- Die Pieptöne vom Rad (`src/ui/countdown.ts`) wiederverwenden: Ton bei 3, 2, 1 Sekunden vor dem Ende, ein höherer bei 0.
- Nur solange die App offen ist; bei gesperrtem Handy bleibt die Push-Mitteilung.
- Schalter „Ton in der Pause“, standardmäßig an.
- Bekannte Grenze: Der iPhone-Stummschalter dämpft Web-Töne.
