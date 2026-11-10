import type { Scenario } from './types';

const c = (id: string, situation: string, expectation: string, task: number): Scenario => ({ id, situation, expectation, task });

/**
 * Acceptance scenarios: foundation §11 (F01–F14) and general exercise-identity rules behind concept §18 "Übungswissen" (U01–U04; the concrete exercises named there are test cases, not scenarios), each owned by the follow-up
 * task of the concept §19 that will test it. Tests check these agreements, not the biological effect of the app.
 */
export const SCENARIOS: Scenario[] = [
  c('F01', 'Gleiches Zeitbudget, Kraftziel gegenüber Muskelaufbauziel', 'Nachvollziehbar andere Prioritäten und Last-/Wiederholungsbereiche, ohne exklusive biologische Wiederholungsgrenzen.', 5),
  c('F02', 'Schwere Sätze mit guten Ergebnissen und RIR 0', 'Keine automatische Bestrafung trotz positiver Entwicklung.', 4),
  c('F03', '18 Wiederholungen ohne RIR', 'Arbeit bleibt sichtbar; Anstrengung unbekannt.', 2),
  c('F04', 'Bereits viel indirekte Armarbeit, begrenzte Wochenzeit', 'Zusätzliche Isolation wird bewusst begründet oder zugunsten anderer Ziele reduziert.', 2),
  c('F05', 'Kleine Ausdauerwoche eines Freizeitprofils', 'Keine erzwungene 80/20-Quote und kein automatisches HIIT gegen den Wunsch.', 6),
  c('F06', 'HIIT bei gleichem FTP-Anker, unterschiedlicher Erfahrung', 'Nicht ungeprüft identisches Protokoll; vollständige Dosis und Herkunft der Intensität.', 7),
  c('F07', 'Kurzes Intervall, Puls noch niedrig', 'Kein automatisches Hochregeln zur Jagd nach einer Pulszone.', 7),
  c('F08', '4 × 4 ist zeitlich zu lang einschließlich Vorbereitung/Pausen', 'Passender anderer Umfang oder anderes Protokoll; kein Weglassen der Nebenzeiten in der Schätzung.', 7),
  c('F09', 'Profil mit „Laufen: Distanz vor Tempo“', 'Bleibt bei dieser Ausrichtung, bis die Person sie ändert.', 5),
  c('F10', 'Warm-up-only Beine, danach gewünschte Ausdauer', 'Keine pauschale harte Beinvorbelastung.', 6),
  c('F11', 'Mehrere anspruchsvolle Unterkörper- und Intervallpläne', 'Gemeinsame Abwägung und sichtbarer Zielkonflikt; kein unabhängiges Aufaddieren.', 7),
  c('F12', 'Eine ungewöhnliche Einheit oder alte Readiness', 'Keine dauerhafte Zieländerung und keine unbegrenzte Blockierung.', 12),
  c('F13', 'Laufdistanzsprung', 'Einzelne Einheit und Wochenänderung werden unterschieden; keine Garantie „unter 10 % sicher“.', 12),
  c('F14', 'Literatur- oder Policywechsel', 'Versionierter, nachvollziehbarer Übergang; laufende Einheit bleibt stabil.', 12),
  c('M01', 'Rückblick über drei Monate bei Person mit regelmäßigem Training und stabiler Entwicklung', 'Bo nennt höchstens drei Beobachtungen, ohne Zahlenflut, und schlägt nur Änderungen vor, die sich rückgängig machen lassen.', 12),
  c('M02', 'Anfängerin, eine Einheit pro Woche, Härte vorsichtig, abheilende Beschwerde', 'Nie Versagenssätze; Rückblick fragt nach der Beschwerde.', 12),
  c('M03', 'Zu wenige Einheiten oder zu kurzer Abstand zum letzten Rückblick', 'Kein Rückblick und kein stiller Vorschlag; die Gründe bleiben nachvollziehbar.', 12),
  c('M04', 'Lange Pause oder Rückkehr nach Unterbrechung im Rückblickszeitraum', 'Die Pause wird nicht als Versagen gewertet; der Rückblick wertet nur die Zeit mit Training und schlägt vorsichtig vor.', 12),
  c('U01', 'Übung mit anderem Gerät oder anderer Ausführung als eine bekannte Übung', 'Bekommt keine Anleitung, Bilder oder Muskeln der anderen Variante.', 1),
  c('U02', 'Jede Übung im Katalog', 'Hat eine zum Gerät passende Beschreibung.', 1),
  c('U03', 'Importierte Übung, deren Muskel eine andere Quelle kennt', 'Zeigt diesen Muskel.', 1),
  c('U04', 'Übung ohne bekannte Zuordnung', 'Der Muskel ist als unbekannt gekennzeichnet und erscheint nicht als unbelastet.', 1),
];
