# Stangen-Typen

Stand: 14.11.2026. Kurzes Design, im Chat besprochen.

**Warum:** Die App rechnet bei jeder Langhantel-Übung mit 20 kg Stange. Beim Scott-Curl mit SZ-Stange (etwa 8,5 kg) sind dadurch Scheiben-Zeile, Aufwärmen und das niedrigste Gewicht falsch.

**Entscheidungen**
- Zwei Typen: `langhantel` (Standard 20 kg, Regel `load.bar-kg`) und `sz` (Standard 10 kg, neue Regel `load.sz-bar-kg`).
- Das Gewicht eines Typs stellt die Person pro Studio ein (Stangen sind je Studio anders). Ohne Einstellung gilt der Standard.
- Der Katalog ordnet jeder Langhantel-Übung einen Typ zu: `pf-preacher-curl` und `pf-skullcrusher` bekommen `sz`, alle anderen `langhantel`. Die Person kann den Typ einer Übung ändern (gilt überall).
- Das eingetragene Gewicht ist weiter das Gesamtgewicht mit Stange.
- Der Typ wirkt auf: Scheiben-Zeile, Aufwärmen (erster Satz = Stange, nichts darunter), niedrigstes Gewicht der Gewichtsleiter, Anker einer noch leeren Leiter. In App und Coach gleich.
- Übungs-Info zeigt „Stange: SZ-Stange, 8,5 kg“; Tippen öffnet die Wahl von Typ und Gewicht für dieses Studio.
- Personendaten liegen in Records (neue Art `bar`), Produktwerte in Regeln und Katalog.

**Nicht-Ziele:** Keine weiteren Typen (Trap-Bar usw.), keine Kurzhantel-Griffe, keine Maschinen.

**Ansätze:** Gewicht pro Übung (verworfen: dieselbe Stange müsste mehrfach eingestellt werden); Typ mit Gewicht, Übung hat Typ (gewählt, Vorschlag der Person).

## Nachtrag: eigene Stangen (14.11.2026)

- In der Stangen-Wahl der Übungs-Info: „Eigene Stange hinzufügen“ mit Name und Gewicht.
- Gewicht pro Studio wie bei den festen Typen; das beim Anlegen eingegebene Gewicht gilt in jedem Studio, bis dort ein anderes eingestellt ist.
- Eine eigene Stange steht bei allen Langhantel-Übungen zur Wahl.
- Umbenennen und Löschen möglich; nach dem Löschen nutzen ihre Übungen wieder den Katalog-Standard.
- Langhantel und SZ-Stange bleiben fest (nicht löschbar, Gewicht einstellbar).
