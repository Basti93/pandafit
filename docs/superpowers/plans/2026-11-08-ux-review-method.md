# UX- und Design-Review der Web-App — Vorgehen

**Auftrag (08.11.2026):** Screenshots aller Screens in mehreren Auflösungen, UX- und Design-Review aus Sicht einer Person, die die App zum ersten Mal benutzt und nicht weiß, wo sie tippen soll. Danach ein Änderungsplan, Umsetzung, Deploy, Push.

**Grundsätze:** Die App wird einfacher, nicht komplexer. Keine wichtige Funktion fällt weg. Leitsätze der Roadmap gelten („Leicht und ruhig“, keine Zahlenflut).

## Phase 1 — Aufnahme (Werkzeug: `scripts/web-shots.ts`)

Ein Lauf pro Variante, Ablage unter dem Scratchpad, nicht im Repo:

| Variante | Einstellung | Zweck |
|---|---|---|
| A Basis | 390×844, hell, Beispielkonto | alle ~75 Screens, Hauptgrundlage |
| B Klein | 360×740 | Umbrüche, abgeschnittene Texte, Tippflächen |
| C Tablet | 768×1024 | Nutzung der Breite |
| D Desktop | 1440×900 | Nutzung der Breite, Lesbarkeit |
| E Dunkel | 390×844, `SHOTS_DARK=1` | Kontrast, Farben |
| F Neu | 390×844, `SHOTS_EMPTY=1` | erster Eindruck ohne Daten, alle Tabs |

Danach ein Inventar: welche Screens jede Variante erreicht hat, welche fehlen (`MISSED`).

## Phase 2 — Analyse der Reihe nach

Feste Reihenfolge, ein Prüfer nach dem anderen. Jeder Prüfer schreibt seine Befunde in eine eigene Datei mit dem gleichen Raster. Ich lese jede Datei, bevor der nächste Prüfer startet, und gebe ihm bekannte Befunde mit, damit nichts doppelt kommt.

1. **Erstnutzer-Gang (F, dann A):** Login → Heute → jeder Tab. Für jeden Screen: Was ist das? Was soll ich hier tun? Wohin tippe ich als Nächstes? Was verstehe ich nicht (Wörter, Symbole)?
2. **Bereiche in Basisgröße (A),** je ein Prüfer: Heute und Fahrt-Begleiter · Woche mit Ziel, Regeln, Chat · Kraft (Start, Training, Routinen, Entwicklung, Übungen) · Essen (Tage, Rezepte, Einkauf) · Ausdauer (Rad, Laufen) · Statistik, Gesundheit, Profil.
3. **Auflösungen (B, C, D) und Dunkel (E):** ein Prüfer vergleicht die Hauptscreens jeder Variante mit A. Nur Layoutfehler: Überlauf, Abschneiden, verschwendeter Platz, Kontrast.

**Raster je Befund:** Screen (Dateiname) · Was die Person sieht oder nicht versteht · Warum es stört · Vorschlag (einfacher, ohne Funktion zu streichen) · Schwere (blockiert / verwirrt / Feinschliff) · Aufwand (klein / mittel / groß).

## Phase 3 — Zusammenführen

Ein Durchgang über alle Befunddateien: Doppelte zusammenlegen, gegen die Grundsätze prüfen (Vorschläge, die mehr Bedienelemente bringen oder Wichtiges streichen, fallen raus), nach Nutzen für Erstnutzer ordnen. Ergebnis: eine Liste in Themen.

## Phase 4 — Plan, Umsetzung, Abschluss

Umsetzungsplan in `docs/superpowers/plans/`, Bau nach dem bekannten Ablauf (Sonnet baut, Prüfung je Aufgabe, Gesamtprüfung). Danach Variante A und F neu aufnehmen und vorher/nachher vergleichen. Dann Merge, Tests, Deploy, Push.
