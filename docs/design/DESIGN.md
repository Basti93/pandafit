# Pandafit Design: Abend im Dojo (Stil C)

Stand 09.11.2026. Diese Seite ist die Grundlage für jede Oberfläche der Web-App. Die Mac-App (nur Fahrt) bleibt bei ihrem Cockpit und übernimmt nur die gemeinsamen Tokens.

Die Bilder dazu: `docs/design/moodboard/*.html` im Browser öffnen (abgenommene Screens). Bei Widerspruch gilt diese Seite.

## Stimmung

- Kung-Fu-Panda-Grundrichtung, nicht der Filmstil: ein warmer Abend im Dojo, Bambus, Laternen, Papier, Pinselstriche.
- Ruhig und leicht. Keine Gamification (keine Punkte, Streaks, Abzeichen), keine Zahlenflut. Lieber ein klarer Satz als fünf Kennzahlen.
- Design und UX gehören zusammen: Jeder Screen beantwortet oben in einer Karte **Wo bin ich, was ist erledigt, was kommt als Nächstes.** Pro Screen **eine** Hauptaktion. Seltenes liegt hinter einem ruhigen Knopf oder in einem Sheet, bleibt aber erreichbar.

## Bo, dein Sensai

- Bo ist ein Panda mit Stirnband und Teetasse. Er heißt in der Oberfläche **Sensai**, nie „Coach“. Der Einstieg heißt „Frag Bo, deinen Sensai“.
- Bo ist warm und unterstützt immer zu 100 %. Er ist ein bisschen tollpatschig und vergisst auch mal etwas, weiß aber, dass genau das das Leben ausmacht. Ein eigener kleiner Patzer kommt **selten** vor, höchstens in einem von vielen Sätzen.
- Bo spricht nur in **Sprechblasen** (Karte mit kleinem Dreieck zu Bo), nie als loser Text.
- Das **Bambusnest** ist der Ort für den Gruß und für Tage ohne Plan: gebogene Halme als Laube, geflochtene Schale, Laterne an einem Halm.
- **Bos Orte:** Jede Pose hat eine kleine Szene (Moodboard `bos-orte.html`). Hinter Bo liegt immer ein warmer Lichtschein, damit sein dunkles Fell auf dunklem Grund lesbar bleibt.
- Jeder Ort legt fest, welche Posen zu ihm passen (`PLACE_POSES` in `kit/BoScene.tsx`). Auf Heute steht Bo an dem Ort seiner Pose (`placeOf`); Ort und Pose wählt er einmal beim Öffnen. Bei reduzierter Bewegung steht er dort als Standbild seiner Pose (`brand/bo-pose-*.svg`).
- Bo gleitet beim Öffnen einer Seite ruhig in seine Pose. Gesten (Begrüßen, Nicken, Zuhören) hält er still. Tätigkeiten (Stricken, Lesen, `ACTIVITY_SPANS` in `panda-canvas.ts`) macht er ruhig weiter, vor und zurück ohne Sprung.

| Pose | Wann | Ort |
|---|---|---|
| greet | Heute ohne Tagesplan | Bambusnest |
| listen | Gespräch mit dem Sensai | Laternen, niedriger Tisch, Tee (noch nicht gebaut) |
| breathe | Pause, Atmen, Ende einer Einheit | Am Wasser unter dem Mond (noch nicht gebaut) |
| flex | Krafttag | Dojo, kleine Hantel, Arnold-Comicporträt an der Wand |
| bike | Radtag | Hügel, Bambus, Mond |
| run | Lauftag | Weg quer von links nach rechts durch den Bambuswald |
| yoga | Beweglichkeit, Abschluss | Matte, Räucherstäbchen, Mond |
| read | Ruhetag (gerades Datum) | Laterne, Bücherstapel |
| knit | Ruhetag (ungerades Datum) | Dickes Sitzkissen, Wollregal |

## Farben

Die Tokens stehen in `src/design/tokens.css`. Dunkel ist der Normalfall. Hell („Papier am Morgen“) nutzt dieselben Bausteine mit den hellen Werten aus `tokens.css`; die Auswahl Hell/Dunkel/System im Profil bleibt.

| Rolle | Dunkel | Verwendung |
|---|---|---|
| Hintergrund | Verlauf `#2a3d2e` → `#18231b` (radial von oben) | Seite |
| Karte | `#263629`, Rand `#405044` | jede Fläche mit Inhalt |
| Karte leise | Text-Farbe mit 6 % Deckung | Listenkarten, Nebenkarten |
| Text | `#f5ecd8` | Fließtext |
| Gedämpft | `#b7c5ae` | Untertitel, Nebeninfo |
| Apricot | `#efab76` | Hauptknopf (gefüllt), aktiver Tab, Bo-Knopf (Rahmen) |
| Gold | `#f2bd55` | Kicker, Pinselstrich, „heute“ |
| Grün | `#9cba72`, `#b5cc8d` | Bambus, „erledigt“, „steigt“ |

## Schrift

- Überschriften: **Shojumaru**, Großbuchstaben, darunter der goldene **Pinselstrich** (SVG, leicht gewellt). Nur für kurze Titel, den Schriftzug und Bos Namen.
- Fließtext und Knöpfe: **Zen Kaku Gothic New** (400, 500, 700), Zeilenhöhe 1,5. Selbst gehostet, OFL.
- Zahlen und Daten in Cockpit-Ansichten bleiben in der UI-Schrift.
- **Kicker:** 12 px, fett, Großbuchstaben, Laufweite 0,6 px, Gold. Beispiel „JETZT DRAN“, „DIESE WOCHE“.

## Bausteine

- **Karte:** Radius 18 px, 1 px Rand. Alles steht in Karten, kein loser Text auf dem Hintergrund.
- **Hauptkarte** (z. B. „JETZT DRAN · OBERKÖRPER“): Kicker, Shojumaru-Titel mit Pinselstrich, ein Satz, Hauptknopf gefüllt Apricot plus ein Nebenknopf mit Rahmen. Dieses Grunddesign ist auf allen Screens gleich.
- **Knöpfe statt Links.** Mindestens 44 px hoch. Hauptknopf gefüllt, Nebenknopf mit Rahmen, ruhiger Knopf als Kachel.
- **Zeilenkarte:** Icon-Kachel links, Kicker, Titel, Untertitel, Pfeil rechts.
- **Wochenweg:** Mo–So als Punkte auf einer Linie. Erledigt: gefüllt Apricot mit Haken. Heute: Gold-Ring mit Glühen. Geplant: Ring. Ruhetag: kleiner Punkt.
- **Icons verspielt** (rund, kleine Details), nie generische Linien-Icons. Essen: ein Bild pro Mahlzeit-Typ (Frühstück Schale Brei, Mittag warme Schale, Abend Pfanne), nicht pro Gericht.

## Navigation

- Unten fünf Tabs mit Icons: **Heute, Woche, Kraft, Essen, Ausdauer**. Essen und Ausdauer erscheinen wie heute nur, wenn sie eingeschaltet sind.
- **Profil** ist ein runder Panda-Knopf oben rechts.
- **Gesundheit** steht sichtbar als Karte auf der Woche (ein Satz, drei Kacheln ohne Zahlen) und hat eine eigene Seite. Profil enthält nur Einstellungen.
- Während eines Krafttrainings ist die Tab-Leiste ausgeblendet; „Verkleinern“ führt zurück, das Training läuft als Karte weiter.

## Bambus im Hintergrund

- Rechts eine kräftige, vom Rand angeschnittene Gruppe mit Tiefe (hintere Halme blasser), links nur ein schlanker Trieb, der vom unteren Ende wächst. Nie symmetrisch eingequetscht.
- Der Bambus scrollt mit dem Inhalt und wächst über die ganze Länge: nahtlose Kachel `docs/design/assets/bamboo-tile-{dark,light}.svg` (390 × 900, wiederholt nach unten), Trieb `bamboo-shoot-{dark,light}.svg` am Seitenende.
- Parallax: Die Halmgruppe ist eine eigene Ebene (`.web-main::before`) und bleibt beim Scrollen etwas zurück (Token `--bamboo-parallax`, reines CSS mit scroll-getriebener Animation). Der Trieb am Seitenende bleibt fest. Ohne Browser-Unterstützung oder bei „weniger Bewegung“ scrollt der Bambus einfach mit.
- Farben sind deckend vorgemischt: Blätter haben die Farbe ihres Halms, vordere Halme verdecken hintere.
- Er liegt hinter allem und macht nichts unleserlich (vorgemischt auf etwa 9–24 % Deckung, hell bis 45 %).

## Texte

- Natürliche deutsche ganze Sätze, keine abgehackten Fragmente mit Gedankenstrich (siehe `docs/language.md`).
- Bo duzt. Kein Fachjargon auf der Fläche.

## Im Code: eine Stelle pro Sache

- Farben, Schrift, Radien, Breite (`--content-max`), Seitenhintergrund (`--page-bg`), Bambus (`--bamboo-tile`, `--bamboo-shoot`): `src/design/tokens.css`. Helle Werte nur unter `@media (prefers-color-scheme: light)`; die Profil-Auswahl erzeugt `themeChoice()` daraus.
- Bausteine (`Card`, `Kicker`, `BrushTitle`, `MainCard`, `Bubble`, `BoBubble`, Knöpfe): `src/tracking/ui/kit/`. Kein Screen baut sich eine eigene Karte oder Blase.
- UI-Icons: nur `src/tracking/ui/kit/Icon.tsx`, Farbe `currentColor`. Größere Bilder (Mahlzeit-Typen, Bos Szenen, Logo): SVG in `src/web/public/brand/`.
- Bos Name und feste Bo-Texte: `src/tracking/ui/bo.ts`.

## Logo

- App-Logo: **Bos Gesicht mit Fitness-Stirnband und Schweißtropfen**, flach, auf dunkelgrünem Grund, wenige Farben; ein Bild für alle Größen bis 16 px. Verworfen sind Ensō, Bambusnest, Panda und Maus, Monogramm sowie die Teetrinker-Entwürfe A, B und C (zu kompliziert).
- Gewählt: Entwurf D mit Schweißtropfen (`moodboard/logo.html`).
