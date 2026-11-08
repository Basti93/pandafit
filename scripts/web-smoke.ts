// Real-browser smoke test of the web app: build, start the real server on localhost with a temporary database, then
// log in, track and finish a workout, reload offline, and read the workout from a second browser context.
// Usage: npm run test:web-smoke  (needs a Chromium that playwright-core finds, e.g. from ~/Library/Caches/ms-playwright)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createAccount } from '../web-server/auth';
import { openDb } from '../web-server/db';
import { buildServer } from '../web-server/index';

const PASSWORD = 'smoke test pass 1';
const fail = (msg: string): never => { throw new Error(`smoke: ${msg}`); };
const step = (msg: string) => console.log(`ok  ${msg}`);

async function launch(): Promise<Browser> {
  try { return await chromium.launch({ headless: true }); }
  catch (e) { return fail(`no browser could be launched (${(e as Error).message.split('\n')[0]}). Install one with: npx playwright-core install chromium`); }
}

const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-smoke-')), 'smoke.db');
const db = openDb(dbPath);
await createAccount(db, 'smoke', PASSWORD);
db.close();
const app = buildServer({ dbPath, staticDir: resolve('out/web') });
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
const browser = await launch();

const login = async (page: Page) => {
  await page.goto(base);
  await page.getByLabel('Name').fill('smoke');
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByRole('heading', { level: 1, name: /^\p{L}+, \d+\. \p{L}+$/u }).waitFor();
};

try {
  const ctx1 = await browser.newContext();
  const page = await ctx1.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });
  await login(page);
  step('login');

  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  if (scope !== `${base}/`) fail(`service worker scope is ${scope}`);
  step('service worker controls the page');

  await page.getByRole('navigation').getByRole('button', { name: 'Kraft', exact: true }).click();
  // Start an empty workout: directly, or through the "Anderes Training" sheet when a plan or routines exist.
  const anderes = page.getByRole('button', { name: 'Anderes Training' });
  const empty = page.getByRole('button', { name: 'Leeres Training starten' });
  await empty.or(anderes).first().waitFor();
  if (await anderes.count() > 0 && await empty.count() === 0) await anderes.click();
  await page.getByRole('button', { name: 'Leeres Training starten' }).click();
  await page.getByRole('button', { name: 'Übung hinzufügen' }).click();
  const picker = page.getByRole('dialog', { name: 'Übung wählen' });
  await picker.getByLabel('Suchen').fill('Bank');
  const pickedTitle = (await picker.locator('.tk-row-title').first().innerText()).trim();
  await picker.locator('.tk-rowbtn').first().click();
  await page.getByLabel('Gewicht Satz 1').fill('40');
  await page.getByLabel('Gewicht Satz 1').blur();
  await page.getByLabel('Wiederholungen Satz 1').fill('8');
  await page.getByLabel('Wiederholungen Satz 1').blur();
  await page.getByRole('button', { name: 'Satz 1 erledigt' }).click();
  await page.getByRole('button', { name: 'Training beenden', exact: true }).click();
  // Everything is confirmed, so the summary shows; an end sheet only appears when sets are open.
  const endSheet = page.getByRole('button', { name: 'Als erledigt zählen' });
  const summary = page.getByRole('region', { name: 'Zusammenfassung' });
  await endSheet.or(summary).first().waitFor();
  if (await endSheet.count() > 0) await endSheet.click();
  await summary.getByRole('button', { name: 'Fertig' }).click();
  const seg = (p: Page, label: string) => p.getByRole('group', { name: 'Kraft' }).getByRole('button', { name: label, exact: true });
  const nav = (p: Page) => p.getByRole('navigation').getByRole('button', { name: 'Kraft', exact: true });
  const seeWorkout = async (p: Page, timeout = 15_000) => {
    await nav(p).click();
    await seg(p, 'Entwicklung').click();
    await p.getByRole('button', { name: pickedTitle, exact: true }).waitFor({ timeout });
  };
  await seeWorkout(page);
  step('workout tracked and finished');

  // The upload runs by itself; wait until it is no longer pending (the note disappears).
  await page.waitForFunction(() => !document.body.innerText.includes('Noch nicht auf dem Server'), null, { timeout: 15_000 });
  await page.waitForTimeout(2500);

  await ctx1.setOffline(true);
  await page.reload();
  await page.getByRole('navigation').waitFor();
  await seeWorkout(page);
  step('offline reload: app shell and data come from the device');
  await ctx1.setOffline(false);

  const ctx2 = await browser.newContext();
  const second = await ctx2.newPage();
  await login(second);
  await seeWorkout(second, 20_000);
  step('a second browser sees the workout');
  console.log('SMOKE PASSED');
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  await app.close();
}
