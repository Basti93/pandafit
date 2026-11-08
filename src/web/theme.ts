/** The look the rider chose on this device: light, dark or the system's setting (the default). */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'pandafit.theme';

export function readTheme(storage: Pick<Storage, 'getItem'>): Theme {
  try {
    const v = storage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

/** Sets `data-theme` on <html>: the CSS follows the system without it, and the chosen look with it. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function saveTheme(storage: Pick<Storage, 'setItem' | 'removeItem'>, theme: Theme): void {
  try {
    if (theme === 'system') storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, theme);
  } catch { /* private mode: the choice holds until the page closes */ }
  applyTheme(theme);
}
