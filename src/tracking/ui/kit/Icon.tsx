/** The one icon registry. Stroke icons, 24 px grid, currentColor only. Later milestones add names here and nowhere else. */
export type IconName = 'heute' | 'woche' | 'kraft' | 'essen' | 'ausdauer' | 'profil'
  | 'lauf' | 'herz' | 'spross' | 'mond' | 'ziel' | 'stift' | 'sprechen' | 'senden' | 'zurueck' | 'haken' | 'rueckblick' | 'regeln' | 'aenderung';

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
  rueckblick: <g transform="scale(.75)" strokeWidth="2.667"><path d="M8 6 H25 Q27 6 27 8 V24 Q27 26 25 26 H10" /><path d="M8 6 Q5 6 5 9 V11 H11 V9 Q11 6 8 6 Z" /><path d="M10 26 Q7 26 7 23 V21 H13 V23 Q13 26 10 26 Z" /><path d="M14 12 H23 M14 16 H21 M14 20 H19" /></g>,
  regeln: <g transform="scale(.75)" strokeWidth="2.667"><path d="M7 5 H22 Q25 5 25 8 V27 L19 23 L13 27 V8" /><path d="M7 5 Q4 5 4 8 V11 H13" /><path d="M16 11 Q19 9 21 12 Q19 16 16 11 Z" /></g>,
  aenderung: <g transform="scale(.75)" strokeWidth="2.667"><path d="M8 6 H25 Q27 6 27 8 V24 Q27 26 25 26 H10" /><path d="M8 6 Q5 6 5 9 V11 H11 V9 Q11 6 8 6 Z" /><path d="M10 26 Q7 26 7 23 V21 H13 V23 Q13 26 10 26 Z" /><path d="M14 13 L16 15 L20 10" /><path d="M14 20 H21" /></g>,
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg data-icon={name} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
  );
}
