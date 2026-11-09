import { linkedWebOrigins, opensExternally } from './external-links';
import { app, BrowserWindow, dialog, nativeImage, powerSaveBlocker, utilityProcess, type UtilityProcess, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { guiPath, unpacked } from './app-paths';
import { restartDelayMs } from './backoff';
import { openFilmWindow } from './film-window';
import { sameApp } from './window-urls';
import { ensureLocalToken } from '../shared/node/local-token';

let blocker: number | null = null;
let riding = false;
let quitting = false;
let localToken = '';
const STABLE_RUN_MS = 60_000;

/** Ride service and coach run independently of the windows and of each other, and each restarts after a crash. */
const supervise = (file: string, onMessage?: (m: { riding?: boolean }) => void, failures = { count: 0 }): UtilityProcess => {
  const startedAt = Date.now();
  const child = utilityProcess.fork(path.join(__dirname, file), [], {
    env: { ...process.env, PATH: guiPath(process.env.PATH ?? '', app.getPath('home')), BIKE_GARMIN_SCRIPT: unpacked(path.join(app.getAppPath(), 'scripts', 'garmin', 'bridge.py')), BIKE_DATA_DIR: path.join(app.getPath('userData'), 'rides'), BIKE_COACH_DIR: path.join(app.getPath('userData'), 'coach'), PANDAFIT_LOCAL_TOKEN: localToken },
    stdio: 'inherit',
  });
  if (onMessage) child.on('message', onMessage);
  child.on('exit', () => {
    if (quitting) return;
    failures.count = Date.now() - startedAt > STABLE_RUN_MS ? 0 : failures.count + 1;
    setTimeout(() => supervise(file, onMessage, failures), restartDelayMs(failures.count));
  });
  return child;
};

const onServiceMessage = (m: { riding?: boolean }): void => {
  if (typeof m.riding !== 'boolean') return;
  riding = m.riding;
  if (riding && blocker === null) blocker = powerSaveBlocker.start('prevent-display-sleep');
  if (!riding && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
};

let mainWindow: BrowserWindow | null = null;
let appUrl = '';
const showMain = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) { openMain(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  app.focus({ steal: true });
};
const openMain = (): void => {
  const win = new BrowserWindow({ width: 1200, height: 800, title: 'Pandafit', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  mainWindow = win;
  // The window gets the machine's token in its URL; the local WebSockets need it.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) { appUrl = `${devUrl}${devUrl.includes('?') ? '&' : '?'}t=${localToken}`; void win.loadURL(appUrl); }
  else {
    const file = path.join(__dirname, '../renderer/index.html');
    appUrl = `${pathToFileURL(file).href}?t=${localToken}`;
    void win.loadFile(file, { query: { t: localToken } });
  }
  win.webContents.on('will-navigate', (e, u) => {
    if (sameApp(u, appUrl)) return;
    e.preventDefault();
    if (opensExternally(u, linkedWebOrigins(path.join(app.getPath('userData'), 'accounts')))) void shell.openExternal(u);
  });
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.endsWith('#film')) { openFilmWindow(u, appUrl, showMain); return { action: 'deny' }; }
    if (opensExternally(u, linkedWebOrigins(path.join(app.getPath('userData'), 'accounts')))) void shell.openExternal(u);
    return { action: 'deny' };
  });
};

// The data folder does not depend on the app name: the packaged app and npm run dev use the same rides.
app.setName('Pandafit');
app.setPath('userData', path.join(app.getPath('appData'), 'bike-coach'));

// Two instances would write to the same ride.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.focus(); else openMain();
});

void app.whenReady().then(() => {
  // A missing image must never prevent startup.
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'icon.png'));
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
  localToken = ensureLocalToken(app.getPath('userData'));
  supervise('service.js', onServiceMessage);
  supervise('coach.js');
  openMain();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) openMain(); });
});
// Closing the windows ends neither the service nor the app, so that a running ride continues.
app.on('window-all-closed', () => { if (!riding && process.platform !== 'darwin') app.quit(); });
app.on('before-quit', (e) => {
  if (riding) {
    e.preventDefault();
    dialog.showErrorBox('Fahrt läuft', 'Bitte beende zuerst die Fahrt. Sie bleibt gespeichert, auch wenn der Mac ausgeht.');
    return;
  }
  quitting = true;
});
