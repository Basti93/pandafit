# Heute als Tagesseite: Gestern, Heute, Morgen

**Stand:** 08.11.2026 · Entwurf abgestimmt mit dem Nutzer (Mockup „A · Spruch vom Coach“, Runde 2).

## Absicht

Die Startseite der Web-App ist zu voll. „Gemeinsam“ steht ganz oben, obwohl es nicht das Wichtigste ist. Die Person will beim Öffnen in einem Blick sehen:

- was heute an Training dran ist,
- was heute auf dem Essensplan steht,
- einen persönlichen, motivierenden Satz vom Coach,
- wie es dem Körper geht (aus den Gesundheitsdaten).

Dazu soll man durch die Tage schalten können: **gestern** zeigt, was man geschafft hat, **morgen** zeigt, was ansteht.

Der Ton ist **motivierend, nicht kontrollierend**. Der Nutzer hat ausdrücklich gestrichen: „Der Coach hat alles im Blick“ und Häkchen wie „Absprachen gehalten“.

Aus der Warteliste geht dieser Umbau in zwei Wünschen auf: „Coach prominenter“ und „wechselnder, motivierender Spruch auf Heute“ (Wunsch von Celine).

## Ziele

1. Heute zeigt in dieser Reihenfolge:
   1. Kopf mit Tagesumschaltung,
   2. Satz vom Coach,
   3. Training,
   4. Essen,
   5. Dein Körper,
   6. Gemeinsam.
2. Gestern und Morgen sind über Pfeile im Kopf und über Wischen erreichbar.
3. Der Satz vom Coach ist auf die Person abgestimmt. Er nimmt Bezug auf ihren echten Fortschritt und ihre Woche.
4. Gestern zeigt nur Fakten: was trainiert und was gegessen wurde, mit denselben Karten wie Heute.
5. Morgen zeigt Training und Essen, ohne Coach-Satz, ohne „Dein Körper“ und ohne Gemeinsam.

## Nicht-Ziele

- Keine Wochenleiste und kein Sprung zu beliebigen Tagen. Erreichbar sind nur gestern, heute und morgen. Die Woche bleibt im Tab Woche.
- Keine neue Gesundheitsauswertung. „Dein Körper“ nutzt, was der `health`-Record schon hat.
- Kein Abhaken von Mahlzeiten. Gestern zeigt beim Essen den Plan des Tages.
- Der Wunsch „nach dem Krafttraining Cardio oder Dehnen vorschlagen“ ist nicht Teil davon. Er bleibt auf der Warteliste.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Jede Form von Kontrolle oder Bilanz: „x von y geschafft“, „ausgelassen“, rote Kreuze, Absprache-Häkchen.
- Mehr Zahlen auf der Startseite. Leitsatz „keine Zahlenflut“: höchstens Minuten beim Training.
- Ein Coach-Satz, der allgemein klingt wie ein Kalenderspruch, obwohl Daten da sind. Oder einer, der Zahlen erfindet.
- Ein Training geht verloren oder lässt sich nicht mehr mit einem Tipp starten oder fortsetzen.

## Der Aufbau im Einzelnen

### Kopf mit Tagesumschaltung

- In der Mitte der Tagesname groß („Gestern“, „Heute“, „Morgen“), darunter das Datum klein („So, 8. November“). Der `PageHead` von Heute wird dadurch ersetzt.
- Links ein Pfeil „‹“ (Tag zurück), rechts „›“ (Tag vor). Beide sind 44 px große runde Knöpfe. Auf Gestern ist „‹“ aus, auf Morgen „›“.
- Waagerechtes Wischen über die Seite (> 50 px) schaltet einen Tag weiter oder zurück. Senkrechtes Scrollen bleibt ungestört.
- Der gewählte Tag wird nicht gespeichert. Jeder Wechsel auf den Tab Heute und jeder neue Kalendertag beginnt bei Heute.

### Heute

1. **Laufendes Training:** Ist ein Training offen, steht wie bisher die Karte „… läuft – Weitermachen“ ganz oben, direkt unter dem Kopf. Die Trainingskarte fällt dann weg (wie heute).
2. **Satz vom Coach:** eine Karte mit Coach-Zeichen und 1–2 Sätzen. Sie hat keine Überschrift und keine Knöpfe. Herkunft siehe „Der Satz vom Coach“.
3. **Training:** die bestehende `TodayCard` mit Startknopf, Details und „Etwas anderes heute?“. Daneben bleiben die Karten, die heute schon vorkommen: „Was soll Pandafit für dich planen?“, wartender Vorschlag und Beweglichkeit. Sie stehen beim Training, nicht darüber.
4. **Essen:** die bestehende `TodayMeals`-Liste, wenn Essen eingeschaltet ist.
5. **Dein Körper:** nur wenn ein `health`-Record da ist. Die Karte zeigt kurze, positiv formulierte Zeilen aus `healthRows` (ein Wort oder ein kurzer Satz je Bereich, keine Zahlen) und darunter den Link „Mit dem Coach reden“. Der Link führt zum Tab Woche.
   - Gibt es einen Befund mit Ton `arzt`, steht er ruhig als erste Zeile da. Er wird nicht weggelassen, weil er wichtig ist.
   - „Beachten“-Befunde stehen in Worten da, ohne Warnfarbe.
6. **Gemeinsam:** die bestehende `TogetherCard`, jetzt ganz unten.

### Gestern

Gestern verwendet dieselben Karten. Es gibt kein neues Design, nur andere Inhalte:

- **Training gestern:** jede Aktivität des Tages als Zeile, nach Startzeit sortiert. Die Daten kommen aus `mergedActivities`, also Kraft, Rad, Lauf und Garmin-Aktivitäten. Jede Zeile hat Titel und Minuten, zum Beispiel „Beine · 54 Min“. Bei Kraft stehen darunter die Übungen gedämpft. Erledigte Beweglichkeit steht als eigene Zeile da.
- **Essen gestern:** die Mahlzeiten des Plans für diesen Tag, als dieselbe Liste wie heute.
- Hat gestern nichts stattgefunden, steht dort ein ruhiger Satz wie „Gestern war ein Ruhetag.“. Das ist ein Ruhetag, kein Versäumnis.
- Es gibt keinen Coach-Satz, kein „Dein Körper“ und kein Gemeinsam.

### Morgen

- **Training morgen:** der Tag aus dem Wochenplan (`planFor` mit dem Datum von morgen) in derselben Kartenform. Steht Kraft an und kennt der Plan das nächste Workout, stehen Name und Übungen gedämpft darunter. Es gibt keinen Startknopf und kein „Etwas anderes heute?“.
- **Essen morgen:** die Mahlzeiten des Plans für morgen. Ist morgen Montag, kommen sie aus dem Plan der nächsten Woche. Gibt es keinen Plan, steht dort „Für morgen gibt es noch keinen Essensplan.“.
- Es gibt keinen Coach-Satz, kein „Dein Körper“ und kein Gemeinsam.

## Der Satz vom Coach

- Der Coach-Server schreibt **einmal am Tag je Profil** einen Satz und legt ihn als Record ab, den die Web-App liest.
- **Eingaben:**
  - Aktivitäten der letzten vier Wochen,
  - Wochenplan von heute und dieser Woche,
  - die Beweggründe der Person (`motives`),
  - der Text des Gesundheitsbefunds,
  - die offenen Beschwerden.
  - Alles geht als Datenblock in den Prompt, wie beim Gesundheitstext.
- **Ton:** 1–2 kurze Sätze, auf Deutsch, motivierend, du-Form, ehrlich.
  - Bezug auf echten Fortschritt oder die Woche, wenn es einen gibt.
  - Kein Druck, keine Schuld, kein Vergleich mit anderen Personen, keine Diagnose.
  - Nur Zahlen, die in den Daten stehen.
  - Ist heute Ruhetag, lobt der Satz die Erholung.
  - Gibt es Beschwerden, schont der Satz und treibt nicht an.
- **Prüfung ohne KI:** Die bestehenden Regeln aus `guardCoachText` gelten sinngemäß: keine fremden Zahlen und keine Diagnosewörter. Dazu kommt eine Liste von Druckwörtern (zum Beispiel „musst“, „endlich“, „keine Ausrede“). Höchstlänge 220 Zeichen. Fällt der Text durch, gilt die Ausweichlösung.
- **Ausweichlösung ohne KI oder ohne Daten:** ein Spruch aus einer festen Liste von etwa 30 kurzen, ruhigen Motivationssprüchen im Code. Er wechselt täglich, bestimmt durch Datum und Profil. So gibt es immer einen Satz.
- **Wann:**
  - Der erste Satz entsteht beim ersten Coach-Durchlauf eines neuen Tages.
  - **Nach jedem fertigen Training des Tages** (Kraft, Rad, Lauf oder eine Garmin-Aktivität) schreibt der Coach einen neuen Satz. Er bezieht sich auf genau dieses Training, zum Beispiel was gut lief oder was es für die Woche bringt. Das ist Wunsch des Nutzers.
  - Auslöser ist eine neue fertige Aktivität mit heutigem Datum. Der Coach merkt sich die Schlüssel der Aktivitäten, für die er schon geschrieben hat. So entsteht pro Training nur ein Satz, auch nach einem Neustart.
  - Höchstens 4 KI-Aufrufe pro Profil und Tag. Danach bleibt der letzte Satz stehen.
  - Kein KI-Aufruf während einer offenen Fahrt. Nach der Fahrt kommt der Satz zu dieser Fahrt.
  - Fällt die KI aus, kommt ein fester Lob-Satz zum Training, zum Beispiel „Training geschafft. Schön, dass du drangeblieben bist.“. Erst wenn auch der fehlt, kommt der Tagesspruch.

## Rahmen und Vorgaben

- Die Web-App ist die Hauptapp. Der Mac bleibt fürs Rad, die Mac-App bekommt diese Seite nicht.
- Hell und dunkel funktionieren, von 360 px bis 1440 px Breite. Es gelten die bestehenden Farb-Tokens, keine neuen festen Farben.
- Ein Training und eine Fahrt gehen nie verloren. Die Seite funktioniert offline mit den Daten, die schon da sind. Ohne Coach-Satz-Record zeigt sie die Ausweichlösung.
- Das Repo ist öffentlich. Es kommen keine persönlichen Daten in Tests oder Beispiele.
- `scripts/web-shots.ts` und `scripts/web-smoke.ts` müssen weiter laufen. Sie bekommen Aufnahmen von Gestern und Morgen dazu.

## Entscheidungen des Nutzers

- Mockup A: Pfeile im Kopf, Wischen, nur gestern, heute und morgen.
- Der Spruch kommt vom Coach und ist persönlich. Er nimmt Bezug auf den Fortschritt (Nutzer: „ja das passt“).
- Nach einem Training hat der Coach einen neuen Satz zu diesem Training.
- „Der Coach hat alles im Blick“ und „Absprachen gehalten“ fallen weg, weil sie eher kontrollieren als motivieren.
- Gestern verwendet die Karten wieder und zeigt rein faktisch, was gemacht wurde.
- Morgen zeigt Training und Essen, ohne Spruch und ohne Coach.
- Gemeinsam kommt nach unten.

## Meine Entscheidungen (zum Prüfen)

- „Dein Körper“ als eigene Karte mit dem Link „Mit dem Coach reden“. Ohne Gesundheitsdaten gibt es diese Karte nicht.
- Essen gestern zeigt den Plan, denn gegessene Mahlzeiten werden nicht erfasst.
- Die Ausweichlösung ist eine feste Spruchliste. So hat auch ein Profil ohne Daten oder ohne KI jeden Tag einen wechselnden Spruch.
- Der gewählte Tag springt immer auf Heute zurück.

## Klärungen nach der Builder-Prüfung (meine Entscheidungen)

1. **Essen gestern an einem Montag:** `mealWeeks` lädt zusätzlich die Vorwoche, wenn es sie gibt. Gibt es keinen Plan für gestern, fällt die Essenskarte auf Gestern weg.
2. **Training gestern:** Die Titel kommen im selben Format wie in der Aktivitätenliste (`activityText` oder Gleichwertiges). Die Übungen stehen nur da, wenn ein lokaler `workout`-Record sie hat, sonst fehlt die Zeile.
3. **Coach-Satz, technisch:**
   - Es gibt einen eigenen Record je Profil mit `{ date, text, atMs, about? }`. `about` ist der Schlüssel der Aktivität, auf die sich der Satz bezieht.
   - Die Web-App zeigt `text` nur, wenn `date` der heutige Kalendertag ist. Sonst zeigt sie die Ausweichlösung.
   - Erzeugt wird der Satz im Coach-Durchlauf von `runtime.ts`, nur wenn `coachHere` gilt und keine Fahrt offen ist (`noOpenRide`). Die geschriebenen Sätze und die schon besprochenen Aktivitäten merkt er sich in einer eigenen Datei unter `coachDir`, so wie `CoachTexts`.
4. **`TodayMeals`:**
   - Die Komponente bekommt einen Tag als Parameter. Die Überschrift lautet „Essen gestern“, „Essen heute“ oder „Essen morgen“.
   - „Rest von …“ gilt relativ zum gezeigten Tag. „Heute vorkochen“ erscheint nur auf Heute.
   - Das Sheet „Wer isst mit“ bleibt auf Heute und Morgen änderbar und ist auf Gestern nur lesbar.
5. **Training morgen:** Es zeigt nur den Tag aus `planFor` mit dem Label wie in `TodayCard`. Es nutzt keinen Rat (`useTodayAdvice`), hat keinen Startknopf und kein „Etwas anderes heute?“.
6. **Gestern ohne Daten:** Ist der `activities`-Record unbekannt (`known: false`) und gibt es auch keinen lokalen Eintrag, steht dort „Für gestern sind noch keine Daten da.“. „Gestern war ein Ruhetag.“ steht nur, wenn die Daten bekannt sind und leer sind.
7. **Nur auf Heute:** die Karte für das laufende Training, „Was soll Pandafit für dich planen?“, der wartende Vorschlag und das Beweglichkeitsangebot. Alle stehen nach der Trainingskarte, in der heutigen Reihenfolge.
8. **„Dein Körper“:**
   - Je Bereich steht der Titel mit dem `word` aus `healthRows`. Der `sentence` steht nicht da, weil er Zahlen enthalten kann.
   - Ein Befund mit Ton `arzt` steht als erste Zeile mit seinem Text da, so wie im Gesundheits-Sheet.
9. **Prüfung des Coach-Satzes:** Er muss „ärztlich“ nicht enthalten. Der Arzt-Hinweis steht in „Dein Körper“. Gibt es einen Arzt-Befund, schont der Satz und treibt nicht an.

## Offen für den Bauenden

- Wie der Coach-Satz gespeichert wird: als neue Record-Art oder in einem bestehenden Record. Eine neue Art ändert `RECORD_KINDS_SIGNATURE` und lädt dann einmal alles neu, das ist erlaubt.
- Wie die Wischgeste umgesetzt wird. Sie darf Scrollen, Sheets und Knöpfe nicht stören.
- Die genaue Spruchliste und die Druckwort-Liste.
