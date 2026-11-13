// Real-browser smoke test of the web app: build, start the real server on localhost with a temporary database, then
// log in, look at the next planned workout in its sheet, track and finish a workout, reload offline, and read the workout from a second browser context.
// Usage: npm run test:web-smoke  (needs a Chromium that playwright-core finds, e.g. from ~/Library/Caches/ms-playwright)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createAccount } from '../web-server/auth';
import { openDb } from '../web-server/db';
import { buildServer } from '../web-server/index';
import { putRecords } from '../web-server/records';

const PASSWORD = 'smoke test pass 1';
const fail = (msg: string): never => { throw new Error(`smoke: ${msg}`); };
const step = (msg: string) => console.log(`ok  ${msg}`);

async function launch(): Promise<Browser> {
  try { return await chromium.launch({ headless: true }); }
  catch (e) { return fail(`no browser could be launched (${(e as Error).message.split('\n')[0]}). Install one with: npx playwright-core install chromium`); }
}

const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-smoke-')), 'smoke.db');
const db = openDb(dbPath);
const accountId = await createAccount(db, 'smoke', PASSWORD);
// A plan from the coach, so the sheet "Nächstes Training" can be opened.
const planSet = { type: 'normal', weightKg: 40, reps: 8 };
const seeded = putRecords(db, accountId, [{ kind: 'plan', id: 'current', updatedMs: Date.now(), deleted: false, body: {
  workout: { name: 'Smoke-Plan', exercises: [{ templateId: 'pf-squat', title: 'Kniebeuge', restS: null, supersetId: null, notes: '', sets: [planSet, planSet] }] },
  reason: 'Zum Testen.', source: 'rules', note: null, questions: [], atMs: Date.now(), mobility: null } }], Date.now());
if (seeded.refused.length) fail(`plan seed refused: ${JSON.stringify(seeded.refused)}`);
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
  await page.getByRole('heading', { level: 1, name: 'Heute' }).waitFor();
  // The week path: a day opens its sheet, which closes again.
  await page.getByRole('list', { name: 'Wochenweg' }).getByRole('button').first().click();
  const daySheet = page.getByRole('dialog');
  await daySheet.waitFor({ timeout: 5000 });
  await daySheet.getByRole('button', { name: 'Schließen' }).click();
  await daySheet.waitFor({ state: 'detached', timeout: 5000 });
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

  // Heute: "Ansehen und anpassen" opens the next workout in its sheet in Kraft; × closes it.
  await page.getByRole('button', { name: 'Ansehen und anpassen' }).click();
  const planSheet = page.getByRole('dialog', { name: 'Nächstes Training' });
  await planSheet.getByLabel('Wiederholungen Satz 1').first().waitFor();
  await planSheet.getByRole('button', { name: 'Schließen' }).click();
  await planSheet.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Ansehen', exact: true }).waitFor(); // Kraft says "Ansehen" (Heute: "Ansehen und anpassen")
  step('the next workout opens in its sheet and closes');

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
  await page.getByRole('button', { name: 'Satz geschafft' }).click(); // the fields above are the big ones in the focus card
  await page.getByRole('button', { name: 'Training beenden', exact: true }).click();
  // Everything is confirmed, so the summary shows; an end sheet only appears when sets are open.
  const endSheet = page.getByRole('button', { name: 'Trotzdem als gemacht eintragen' });
  const summary = page.getByRole('region', { name: 'Zusammenfassung' });
  await endSheet.or(summary).first().waitFor();
  if (await endSheet.count() > 0) await endSheet.click();
  await summary.getByRole('button', { name: 'Schließen' }).click(); // the summary sits on Heute now
  const nav = (p: Page) => p.getByRole('navigation').getByRole('button', { name: 'Kraft', exact: true });
  const seeWorkout = async (p: Page, timeout = 15_000) => {
    await nav(p).click();
    await p.getByRole('button', { name: /Deine Übungen/ }).click();
    await p.getByRole('list', { name: 'Deine Übungen' }).getByText(pickedTitle, { exact: true }).waitFor({ timeout });
  };
  await seeWorkout(page);
  step('workout tracked and finished');

  // The upload runs by itself; wait until it is no longer pending (the note disappears).
  await page.waitForFunction(() => !document.body.innerText.includes('Noch nicht auf dem Server'), null, { timeout: 15_000 });
  await page.waitForTimeout(2500);

  await ctx1.setOffline(true);
  await page.reload();
  await page.getByRole('navigation').waitFor();
  const panda = page.locator('.tk-coachline .tk-panda[data-drawn] canvas');
  await panda.waitFor();
  // Bo holds one pose per opening (no glide), so the check is that the player drew him offline: the canvas is not blank.
  const drew = await panda.evaluate((canvas: HTMLCanvasElement) => {
    const blank = document.createElement('canvas');
    blank.width = canvas.width; blank.height = canvas.height;
    return canvas.toDataURL() !== blank.toDataURL();
  });
  if (!drew) throw new Error('Panda canvas stayed blank offline');
  await seeWorkout(page);
  step('offline reload: Panda draws and the workout is available');
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
