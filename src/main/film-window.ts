import { BrowserWindow } from 'electron';
import { sameApp } from './window-urls';

let film: BrowserWindow | null = null;

/** Only the main window's own page may open here (`appUrl` is its URL); anything else is refused. */
export const openFilmWindow = (url: string, appUrl: string, showMain: () => void): BrowserWindow | null => {
  if (!sameApp(url, appUrl)) return null;
  if (film && !film.isDestroyed()) { film.focus(); return film; }
  const win = new BrowserWindow({ width: 320, height: 200, alwaysOnTop: true, resizable: true, title: 'Pandafit Film-Modus', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.webContents.on('will-navigate', (e, u) => { if (!sameApp(u, appUrl)) e.preventDefault(); });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.endsWith('#main')) showMain();
    return { action: 'deny' };
  });
  void win.loadURL(url);
  win.on('closed', () => { film = null; });
  film = win;
  return win;
};
