/** Which screen is open besides the start screen. The Mac is for riding: Fahren (start) and Profil. */
export type Views = {
  profile: boolean;
  review: boolean;
};
export type MenuItem = 'start' | 'profil';

export const HOME: Views = { profile: false, review: false };
export const MENU_LABEL: Record<MenuItem, string> = { start: 'Fahren', profil: 'Profil' };

/** The screen a menu item opens, with every other view closed. */
export function open(item: MenuItem): Views {
  return item === 'profil' ? { ...HOME, profile: true } : HOME;
}

export function activeItem(v: Views): MenuItem {
  return v.profile || v.review ? 'profil' : 'start';
}

/** The items of the left side; Profil sits with the profile name on the right. */
export function menuItems(): MenuItem[] { return ['start']; }

/** Only once a profile is chosen. Never during a ride. */
export const showMenu = (s: { profile: boolean; riding: boolean; film: boolean; waiting: boolean }): boolean => s.profile && !s.riding && !s.film && !s.waiting;
