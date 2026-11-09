/** The one icon registry. Stroke icons, 24 px grid, currentColor only. Later milestones add names here and nowhere else. */
export type IconName = 'heute' | 'woche' | 'kraft' | 'essen' | 'ausdauer' | 'profil'
  | 'lauf' | 'herz' | 'spross' | 'mond' | 'ziel' | 'stift' | 'sprechen' | 'senden' | 'zurueck' | 'haken' | 'rueckblick' | 'regeln' | 'aenderung'
  | 'studio' | 'wechsel' | 'mehr' | 'info' | 'pause' | 'plus' | 'verkleinern' | 'routinen' | 'uebungen' | 'entwicklung'
  | 'rezepte' | 'einkauf' | 'favorit' | 'blatt' | 'uhr' | 'brief' | 'glocke' | 'laterne';

const SCROLL = <><path d="M8 6 H25 Q27 6 27 8 V24 Q27 26 25 26 H10" /><path d="M8 6 Q5 6 5 9 V11 H11 V9 Q11 6 8 6 Z" /><path d="M10 26 Q7 26 7 23 V21 H13 V23 Q13 26 10 26 Z" /></>;

const PATHS: Record<IconName, React.ReactNode> = {
  heute: <><path d="M2 10.5 Q5 10.5 7 7.5 Q12 2.5 17 7.5 Q19 10.5 22 10.5" /><path d="M5.5 10 V19.5 H18.5 V10" /><path d="M10 19.5 V15 Q12 13 14 15 V19.5" /></>,
  woche: <><path d="M7 4 H18 Q20 4 20 6 V7 H7" /><path d="M7 4 Q4.5 4 4.5 6.5 V17.5 Q4.5 20 7 20 H17 Q19.5 20 19.5 17.5 V7" /><path d="M9 11 H10 M12 11 H13 M15 11 H16 M9 15 H10 M12 15 H13" /></>,
  kraft: <><rect x="2" y="7.5" width="4.5" height="9" rx="2.2" /><rect x="17.5" y="7.5" width="4.5" height="9" rx="2.2" /><path d="M6.5 12 H17.5" /></>,
  essen: <><path d="M3 12 H21 Q20.5 19.5 12 20 Q3.5 19.5 3 12 Z" /><path d="M13 9.5 L19.5 3 M10 9.5 L16 3.5" /></>,
  ausdauer: <><circle cx="5.5" cy="16.5" r="3.5" /><circle cx="18.5" cy="16.5" r="3.5" /><path d="M5.5 16.5 L9.5 9 H15 L18.5 16.5 M9.5 9 L12.5 16.5 H5.5 M14 6.5 H16.5" /></>,
  profil: <><circle cx="6.5" cy="6.5" r="2.6" fill="currentColor" stroke="none" /><circle cx="17.5" cy="6.5" r="2.6" fill="currentColor" stroke="none" /><circle cx="12" cy="13" r="7" /><ellipse cx="9.3" cy="12.3" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /><ellipse cx="14.7" cy="12.3" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /><path d="M10.8 16.2 Q12 17.2 13.2 16.2" /></>,
  lauf: <><path d="M3 15.5 Q3 8.5 6 7.8 L8.8 7.8 Q9.8 10.8 13 11 L17 11.8 Q21 12.8 21 15.5 Z" /><path d="M3 15.5 H21 V17 Q21 18.5 19.5 18.5 H4.5 Q3 18.5 3 17 Z" fill="currentColor" stroke="none" /><path d="M12 9 L13.5 8.2 M14.2 10.4 L15.7 9.6" strokeWidth="1.6" /></>,
  herz: <><path d="M12 20 Q4 14.5 3.2 9.6 Q2.8 5.2 7 4.6 Q10.2 4.3 12 7.4 Q13.8 4.3 17 4.6 Q21.2 5.2 20.8 9.6 Q20 14.5 12 20 Z" /><path d="M5 11 H9 L10.5 8.5 L12.5 13.5 L14 11 H19" strokeWidth="1.6" /></>,
  spross: <><path d="M12 21 V11" /><path d="M12 12 Q5 12 4 5 Q11 5 12 12 Z" /><path d="M12 10 Q18 10 20 3 Q13 3 12 10 Z" /></>,
  mond: <><path d="M15 3 Q8 4 7.5 11 Q8 19 16 20 Q11 21 7 18 Q3 14 4 9 Q6 3 15 3 Z" /><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="20" cy="12" r=".8" fill="currentColor" stroke="none" /></>,
  ziel: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></>,
  stift: <><path d="M4 20 L5 15.5 L15.5 5 Q17 3.5 18.5 5 L19 5.5 Q20.5 7 19 8.5 L8.5 19 Z" /><path d="M13.5 7 L17 10.5" /></>,
  sprechen: <path d="M4 5 H20 Q21 5 21 6 V15 Q21 16 20 16 H10 L5 20 V16 H4 Q3 16 3 15 V6 Q3 5 4 5 Z" />,
  senden: <><path d="M4 12 L20 4 L15 20 L11.5 13 Z" /><path d="M11.5 13 L20 4" /></>,
  zurueck: <path d="M15 5 L8 12 L15 19" strokeWidth="2.4" />,
  haken: <path d="M5 12.5 L10 17 L19 7" strokeWidth="3" />,
  rueckblick: <g transform="scale(.75)" strokeWidth="2.667">{SCROLL}<path d="M14 12 H23 M14 16 H21 M14 20 H19" /></g>,
  regeln: <g transform="scale(.75)" strokeWidth="2.667"><path d="M7 5 H22 Q25 5 25 8 V27 L19 23 L13 27 V8" /><path d="M7 5 Q4 5 4 8 V11 H13" /><path d="M16 11 Q19 9 21 12 Q19 16 16 11 Z" /></g>,
  studio: <><path d="M3 10 L12 4 L21 10" /><path d="M5 10 V20 H19 V10" /><rect x="8" y="13" width="2.4" height="4" rx="1" /><rect x="13.6" y="13" width="2.4" height="4" rx="1" /><path d="M10.4 15 H13.6" /></>,
  wechsel: <><path d="M4 7 H16 M13 4 L16 7 L13 10" /><path d="M20 17 H8 M11 14 L8 17 L11 20" /></>,
  mehr: <g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></g>,
  info: <><path d="M4 5 Q8 3.5 12 6 Q16 3.5 20 5 V19 Q16 17.5 12 20 Q8 17.5 4 19 Z" /><path d="M12 6 V20" /></>,
  pause: <><path d="M9 6 V18" strokeWidth="3" /><path d="M15 6 V18" strokeWidth="3" /></>,
  plus: <path d="M12 5 V19 M5 12 H19" strokeWidth="2.2" />,
  verkleinern: <path d="M6 9 L12 15 L18 9" strokeWidth="2.2" />,
  routinen: <><rect x="5" y="4" width="14" height="17" rx="3" /><rect x="9" y="2" width="6" height="4" rx="2" /><path d="M9 11 H15 M9 14.5 H15 M9 18 H12.5" /></>,
  uebungen: <><path d="M3 20 Q8 19 10 14 Q12 10 15 9 Q18 8 21 4" /><path d="M15 9 Q12.5 6 13.5 3 Q16 5.5 15 9 Z M10 14 Q6 13 5 10 Q9 10 10 14 Z" /></>,
  entwicklung: <><path d="M5 20 V16 M11 20 V12 M17 20 V14" strokeWidth="3" /><path d="M4 10 Q9 5 13 7 Q16.5 4.5 20 2.5" /><path d="M17.5 2.5 H20 V5" /></>,
  rezepte: <><path d="M3.5 6 Q8 4.5 12 7 V20 Q8 17.5 3.5 19 Z" /><path d="M20.5 6 Q16 4.5 12 7 V20 Q16 17.5 20.5 19 Z" /><path d="M6 10.5 Q8 10 9.5 10.8 M14.5 10.8 Q16 10 18 10.5" /></>,
  einkauf: <><path d="M3.5 10 H20.5 L19 19.5 Q18.8 20.5 17.8 20.5 H6.2 Q5.2 20.5 5 19.5 Z" /><path d="M8 10 Q8 4 12 4 Q16 4 16 10" /><path d="M9.5 13.5 V17 M14.5 13.5 V17" /></>,
  favorit: <path d="M12 20 Q4 14.5 3.2 9.6 Q2.8 5.2 7 4.6 Q10.2 4.3 12 7.4 Q13.8 4.3 17 4.6 Q21.2 5.2 20.8 9.6 Q20 14.5 12 20 Z" />,
  blatt: <><path d="M12 3 Q18 7 18 12.5 Q18 18 12 21 Q6 18 6 12.5 Q6 7 12 3 Z" /><path d="M12 7 V19 M12 11 L15 9 M12 14.5 L9 12.5" /></>,
  uhr: <><path d="M9 7.5 L9.8 3 H14.2 L15 7.5 M9 16.5 L9.8 21 H14.2 L15 16.5" /><circle cx="12" cy="12" r="5.5" /><path d="M12 9 V12 L14 13.5" /></>,
  brief: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3.8 7 L12 13 L20.2 7" /></>,
  glocke: <><path d="M6 16.5 V11 Q6 5.5 12 5 Q18 5.5 18 11 V16.5 L20 18 H4 Z" /><path d="M12 3 V5 M10 20.5 Q12 22 14 20.5" /></>,
  laterne: <><path d="M4 4 H20 M12 4 V6.5" /><path d="M7 8 H17 Q18.5 12 17 16.5 H7 Q5.5 12 7 8 Z" /><path d="M9 16.5 V19 M15 16.5 V19 M8.5 19 H15.5" /><circle cx="12" cy="12.3" r="1.8" /></>,
  aenderung: <g transform="scale(.75)" strokeWidth="2.667">{SCROLL}<path d="M14 13 L16 15 L20 10" /><path d="M14 20 H21" /></g>,
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg data-icon={name} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
  );
}
