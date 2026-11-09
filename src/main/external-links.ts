import fs from 'node:fs';
import path from 'node:path';
import { webOrigin } from '../shared/web-origin';

/**
 * Links the app may open in the system browser: Hevy (API key), wger (picture and text sources), a YouTube search, and the
 * web app itself. The web app's origin is never typed in here: it comes from the account links the coach keeps (`webOrigins`),
 * and only that exact origin opens.
 */
export function opensExternally(u: string, webOrigins: readonly string[] = []): boolean {
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'hevy.com' || url.hostname === 'wger.de') return true;
  if (webOrigins.includes(url.origin)) return true;
  return url.hostname === 'www.youtube.com' && url.pathname === '/results';
}

/** The https origins of the account links in the data folder's `accounts/` (one file per profile). Unreadable files count for nothing. */
export function linkedWebOrigins(accountsDir: string): string[] {
  const found = new Set<string>();
  let names: string[];
  try { names = fs.readdirSync(accountsDir); } catch { return []; }
  for (const name of names) {
    if (!/^[A-Za-z0-9-]+$/.test(name)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(accountsDir, name), 'utf8')) as { url?: unknown };
      const o = webOrigin(typeof d.url === 'string' ? d.url : null);
      if (o) found.add(o);
    } catch { /* not a link file */ }
  }
  return [...found];
}
