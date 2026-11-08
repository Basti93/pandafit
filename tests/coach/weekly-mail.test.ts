import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mailConfigOf, sendMail } from '../../src/coach/mail-client';
import { MAIL_RETRY_MS, WeeklyMailer, weeklyMailOf, type WeeklyMailBase } from '../../src/coach/weekly-mail';
import type { PlanDay } from '../../src/shared/week-plan';

const day = (date: string, sport: PlanDay['sport'], hardness: PlanDay['hardness'] = 'moderate'): PlanDay => ({ date, sport, hardness, fixed: false });
const week: PlanDay[] = [day('2026-11-09', 'gym'), day('2026-11-10', 'rest', 'easy'), day('2026-11-11', 'bike', 'easy'), day('2026-11-12', 'rest', 'easy'), day('2026-11-13', 'run', 'easy'), day('2026-11-14', 'bike', 'hard'), day('2026-11-15', 'rest', 'easy')];
const base = { profileName: 'Anna', monday: '2026-11-09', lastWeek: { sessions: 4, minutes: 190 }, nextWeek: week, notes: [], openProposals: 0 };

describe('weeklyMailOf', () => {
  it('subject, greeting, last week and one line per day as in the app', () => {
    const m = weeklyMailOf({ ...base, appUrl: 'https://app.example.org' });
    expect(m.subject).toBe('Deine Woche ab Mo., 9. Nov.');
    const lines = m.text.split('\n');
    expect(lines[0]).toBe('Hallo Anna,');
    expect(lines).toContain('Letzte Woche: 4 Einheiten, 3 Std 10 Min');
    expect(lines).toContain('Nächste Woche:');
    expect(lines).toContain('Mo., 9. Nov.: Kraft · mittel');
    expect(lines).toContain('Di., 10. Nov.: Ruhetag');
    expect(lines).toContain('Sa., 14. Nov.: Rad · hart');
    expect(lines.at(-1)).toBe('Zur App: https://app.example.org');
    expect(m.text).not.toContain('Zuletzt geändert');
    expect(m.text).not.toContain('Offen:');
  });

  it('has no plan: says so; no link without a URL; singular session; no sessions', () => {
    const m = weeklyMailOf({ ...base, nextWeek: null, lastWeek: { sessions: 1, minutes: 40 } });
    expect(m.text).toContain('Es gibt noch keinen Plan. Frag Bo in der App.');
    expect(m.text).toContain('Letzte Woche: 1 Einheit, 40 Min');
    expect(m.text).not.toContain('Zur App');
    expect(m.html).not.toContain('<a ');
    expect(weeklyMailOf({ ...base, lastWeek: { sessions: 0, minutes: 0 } }).text).toContain('Letzte Woche hattest du keine Einheit.');
  });

  it('up to three change notes, and the open proposal line', () => {
    const notes = [1, 2, 3, 4].map((n) => ({ atMs: n, coach: 'gym' as const, text: `Änderung ${n}`, reason: 'weil' }));
    const m = weeklyMailOf({ ...base, notes, openProposals: 1 });
    expect(m.text).toContain('Zuletzt geändert:\n- Änderung 1\n- Änderung 2\n- Änderung 3');
    expect(m.text).not.toContain('Änderung 4');
    expect(m.text).toContain('In der App wartet ein Vorschlag auf dich.');
    expect(weeklyMailOf({ ...base, openProposals: 2 }).text).toContain('In der App warten 2 Vorschläge auf dich.');
  });

  it('the HTML carries the same content, escaped, with no images', () => {
    const m = weeklyMailOf({ ...base, profileName: '<b>A</b>', openProposals: 1, appUrl: 'https://app.example.org/?a=1&b=2' });
    expect(m.html).toContain('&lt;b&gt;A&lt;/b&gt;');
    expect(m.html).toContain('Mo., 9. Nov.: Kraft · mittel');
    expect(m.html).toContain('In der App wartet ein Vorschlag auf dich.');
    expect(m.html).toContain('href="https://app.example.org/?a=1&amp;b=2"');
    expect(m.html).not.toMatch(/<img|<script|<style/);
  });
});

const CFG = { url: 'http://mail.example.org:8080', token: 'tok' };
const res = (status: number, body: unknown = { status: 'ok' }) => new Response(JSON.stringify(body), { status });

describe('mail client', () => {
  it('is off without url or token', () => {
    expect(mailConfigOf({})).toBeNull();
    expect(mailConfigOf({ MAIL_URL: 'http://m:8080' })).toBeNull();
    expect(mailConfigOf({ MAIL_TOKEN: 'x' })).toBeNull();
    expect(mailConfigOf({ MAIL_URL: 'http://m:8080/', MAIL_TOKEN: 'x', PANDAFIT_APP_URL: 'https://a.example.org' })).toEqual({ url: 'http://m:8080', token: 'x', appUrl: 'https://a.example.org' });
  });
  it('posts to /v1/send with the bearer token and the body', async () => {
    const f = vi.fn(async () => res(200));
    expect(await sendMail(CFG, { subject: 's', text: 't', html: 'h', to: 'a@example.org' }, f as never)).toBe('ok');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://mail.example.org:8080/v1/send');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual({ subject: 's', text: 't', html: 'h', to: 'a@example.org' });
  });
  it.each([[400, 'rejected'], [413, 'rejected'], [401, 'retry'], [429, 'retry'], [502, 'retry'], [503, 'retry']] as const)('HTTP %i is %s', async (status, want) => {
    expect(await sendMail(CFG, { subject: 's', text: 't', to: 'a@example.org' }, (async () => res(status, { status: 'error' })) as never)).toBe(want);
  });
  it('a network error or an odd answer is a retry', async () => {
    expect(await sendMail(CFG, { subject: 's', text: 't', to: 'a@example.org' }, (async () => { throw new TypeError('down'); }) as never)).toBe('retry');
    expect(await sendMail(CFG, { subject: 's', text: 't', to: 'a@example.org' }, (async () => res(200, { status: 'queued' })) as never)).toBe('retry');
  });
});

describe('the weekly schedule', () => {
  // Local times: Sunday 2026-11-15, the week of Monday 2026-11-09.
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
  const contact = { email: 'a@example.org', weekly: true };
  const build = (): WeeklyMailBase => base;
  function setup(answer: () => Response | Promise<Response> = () => res(200)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mail-'));
    const f = vi.fn(async () => answer());
    const logs: string[] = [];
    const clock = { now: at(15, 18) };
    const make = (mail: typeof CFG | null = CFG) => new WeeklyMailer({ mail, file: path.join(dir, 'mail-sent.json'), nowMs: () => clock.now, fetchFn: f as never, log: (l) => logs.push(l) });
    return { dir, f, logs, clock, make, mailer: make() };
  }

  it('not before 18:00 on Sunday, and not on other days', async () => {
    const s = setup();
    s.clock.now = at(15, 17, 59);
    expect(await s.mailer.tick('p1', contact, build)).toBe('not-due');
    s.clock.now = at(14, 20);
    expect(await s.mailer.tick('p1', contact, build)).toBe('not-due');
    s.clock.now = at(15, 18);
    expect(await s.mailer.tick('p1', contact, build)).toBe('sent');
    expect(s.f).toHaveBeenCalledTimes(1);
  });

  it('once per week, also after a restart; the next Sunday sends again', async () => {
    const s = setup();
    expect(await s.mailer.tick('p1', contact, build)).toBe('sent');
    expect(await s.mailer.tick('p1', contact, build)).toBe('not-due');
    expect(await s.make().tick('p1', contact, build)).toBe('not-due');
    s.clock.now = at(22, 19);
    expect(await s.make().tick('p1', contact, build)).toBe('sent');
    expect(s.f).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String((s.f.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, string>;
    expect(body.to).toBe('a@example.org');
    expect(body.subject).toBe('Deine Woche ab Mo., 9. Nov.');
  });

  it('no address or the switch off: nothing is sent', async () => {
    const s = setup();
    expect(await s.mailer.tick('p1', { email: null, weekly: true }, build)).toBe('not-due');
    expect(await s.mailer.tick('p1', { email: 'a@example.org', weekly: false }, build)).toBe('not-due');
    expect(s.f).not.toHaveBeenCalled();
  });

  it('without settings mail is off and builds nothing', async () => {
    const s = setup();
    const b = vi.fn(build);
    expect(await s.make(null).tick('p1', contact, b)).toBe('off');
    expect(b).not.toHaveBeenCalled();
    expect(s.f).not.toHaveBeenCalled();
  });

  it('a refusal (400) is recorded and logged once, without the address', async () => {
    const s = setup(() => res(400, { status: 'bad_request' }));
    expect(await s.mailer.tick('p1', contact, build)).toBe('rejected');
    expect(await s.mailer.tick('p1', contact, build)).toBe('not-due');
    expect(s.f).toHaveBeenCalledTimes(1);
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).not.toContain('example.org');
  });

  it('a 5xx or a network error is tried again, at most every 30 minutes, and logged once', async () => {
    let answer: () => Response = () => res(503, { status: 'unavailable' });
    const s = setup(() => answer());
    expect(await s.mailer.tick('p1', contact, build)).toBe('retry');
    s.clock.now += MAIL_RETRY_MS - 1000;
    expect(await s.mailer.tick('p1', contact, build)).toBe('waiting');
    expect(s.f).toHaveBeenCalledTimes(1);
    s.clock.now += 2000;
    expect(await s.mailer.tick('p1', contact, build)).toBe('retry');
    expect(s.f).toHaveBeenCalledTimes(2);
    expect(s.logs).toHaveLength(1);
    answer = () => res(200);
    s.clock.now += MAIL_RETRY_MS;
    expect(await s.mailer.tick('p1', contact, build)).toBe('sent');
    expect(await s.mailer.tick('p1', contact, build)).toBe('not-due');
  });

  it('a throwing build never reaches the caller and counts as a retry', async () => {
    const s = setup();
    expect(await s.mailer.tick('p1', contact, () => { throw new Error('x'); })).toBe('retry');
  });
});
