/** The one icon registry. Stroke icons, 24 px grid, currentColor only. Later milestones add names here and nowhere else. */
export type IconName = 'heute' | 'woche' | 'kraft' | 'essen' | 'ausdauer' | 'profil';

const PATHS: Record<IconName, React.ReactNode> = {
  heute: <><path d="M2 10.5 Q5 10.5 7 7.5 Q12 2.5 17 7.5 Q19 10.5 22 10.5" /><path d="M5.5 10 V19.5 H18.5 V10" /><path d="M10 19.5 V15 Q12 13 14 15 V19.5" /></>,
  woche: <><path d="M7 4 H18 Q20 4 20 6 V7 H7" /><path d="M7 4 Q4.5 4 4.5 6.5 V17.5 Q4.5 20 7 20 H17 Q19.5 20 19.5 17.5 V7" /><path d="M9 11 H10 M12 11 H13 M15 11 H16 M9 15 H10 M12 15 H13" /></>,
  kraft: <><rect x="2" y="7.5" width="4.5" height="9" rx="2.2" /><rect x="17.5" y="7.5" width="4.5" height="9" rx="2.2" /><path d="M6.5 12 H17.5" /></>,
  essen: <><path d="M3 12 H21 Q20.5 19.5 12 20 Q3.5 19.5 3 12 Z" /><path d="M13 9.5 L19.5 3 M10 9.5 L16 3.5" /></>,
  ausdauer: <><circle cx="5.5" cy="16.5" r="3.5" /><circle cx="18.5" cy="16.5" r="3.5" /><path d="M5.5 16.5 L9.5 9 H15 L18.5 16.5 M9.5 9 L12.5 16.5 H5.5 M14 6.5 H16.5" /></>,
  profil: <><circle cx="6.5" cy="6.5" r="2.6" fill="currentColor" stroke="none" /><circle cx="17.5" cy="6.5" r="2.6" fill="currentColor" stroke="none" /><circle cx="12" cy="13" r="7" /><ellipse cx="9.3" cy="12.3" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /><ellipse cx="14.7" cy="12.3" rx="1.7" ry="2.1" fill="currentColor" stroke="none" /><path d="M10.8 16.2 Q12 17.2 13.2 16.2" /></>,
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg data-icon={name} aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>
  );
}
