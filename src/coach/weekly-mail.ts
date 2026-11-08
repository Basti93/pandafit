import fs from 'node:fs';
import path from 'node:path';
import { durationText } from '../shared/duration';
import { shortDateOfKey } from '../shared/dates';
import type { ChangeNote } from '../shared/change-notes';
import { mondayOf, type PlanDay } from '../shared/week-plan';
import { planDayText } from '../tracking/ui/plan-text';
import { ruleNumber } from '../shared/training-policy';
import { sendMail, type MailConfig, type SendResult } from './mail-client';
import { dateKey } from '../shared/day-rating';

export type WeeklyMailInput = {
  profileName: string;
  /** The Monday the next week starts on (YYYY-MM-DD). */
  monday: string;
  lastWeek: { sessions: number; minutes: number };
  /** The accepted plan of the next week, seven days; null without one. */
  nextWeek: PlanDay[] | null;
  notes: ChangeNote[];
  openProposals: number;
  /** Without it there is no link line. */
  appUrl?: string | null;
};
/** What the runtime gathers; the link comes from the mail settings. */
export type WeeklyMailBase = Omit<WeeklyMailInput, 'appUrl'>;
export type WeeklyMail = { subject: string; text: string; html: string };

const NOTES_SHOWN = 3;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The weekly overview in plain German: the subject, the text and the same content as minimal HTML (no images, no tracking). Pure. */
export function weeklyMailOf(i: WeeklyMailInput): WeeklyMail {
  const { sessions, minutes } = i.lastWeek;
  const last = sessions === 0 && minutes === 0 ? 'Letzte Woche hattest du keine Einheit.'
    : `Letzte Woche: ${sessions} ${sessions === 1 ? 'Einheit' : 'Einheiten'}, ${durationText(minutes)}`;
  const notes = i.notes.slice(0, NOTES_SHOWN).map((n) => n.text);
  const days = i.nextWeek?.map((d) => `${shortDateOfKey(d.date)}: ${planDayText(d, { legs: true })}`) ?? null;
  const open = i.openProposals === 1 ? 'In der App wartet ein Vorschlag auf dich.'
    : i.openProposals > 1 ? `In der App warten ${i.openProposals} Vorschläge auf dich.` : null;
  const link = i.appUrl ? i.appUrl : null;

  const text = [
    `Hallo ${i.profileName},`, '',
    last,
    ...(notes.length > 0 ? ['', 'Zuletzt geändert:', ...notes.map((n) => `- ${n}`)] : []),
    '', 'Nächste Woche:',
    ...(days ?? ['Es gibt noch keinen Plan. Frag den Coach in der App.']),
    ...(open ? ['', open] : []),
    ...(link ? ['', `Zur App: ${link}`] : []),
  ].join('\n');

  const p = (s: string, style = 'margin:0 0 12px') => `<p style="${style}">${s}</p>`;
  const html = [
    '<div style="font-family:sans-serif;font-size:16px;line-height:1.5;color:#222;max-width:34em">',
    p(`Hallo ${esc(i.profileName)},`),
    p(esc(last)),
    ...(notes.length > 0 ? [p('<strong>Zuletzt geändert</strong>', 'margin:0 0 4px'), `<ul style="margin:0 0 12px;padding-left:1.2em">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`] : []),
    p('<strong>Nächste Woche</strong>', 'margin:0 0 4px'),
    days ? `<ul style="margin:0 0 12px;padding-left:1.2em">${days.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : p('Es gibt noch keinen Plan. Frag den Coach in der App.'),
    ...(open ? [p(esc(open))] : []),
    ...(link ? [p(`<a href="${esc(link)}">Zur App</a>`)] : []),
    '</div>',
  ].join('');

  return { subject: `Deine Woche ab ${shortDateOfKey(i.monday)}`, text, html };
}

/** Which week was mailed to which profile, in a file (a restart does not send again). */
export class MailSent {
  private sent: Record<string, string> | null = null;
  constructor(private file: string) {}
  private load(): Record<string, string> {
    if (this.sent) return this.sent;
    try { const x = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown; this.sent = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, string> : {}; } catch { this.sent = {}; }
    return this.sent;
  }
  has(profileId: string, week: string): boolean { return this.load()[profileId] === week; }
  mark(profileId: string, week: string): void {
    const s = this.load();
    s[profileId] = week;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = `${this.file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, this.file); } catch { /* sent again at worst once more */ }
  }
}

/** A failing send is tried again at most this often. */
export const MAIL_RETRY_MS = 30 * 60_000;

export type WeeklyMailerOptions = {
  /** null: mail is off. */
  mail: MailConfig | null;
  file: string;
  nowMs: () => number;
  fetchFn?: typeof fetch;
  log?: (line: string) => void;
};
export type TickResult = 'off' | 'not-due' | 'waiting' | 'sent' | 'rejected' | 'retry';

/**
 * Sunday evening: for a profile with an address and the weekly switch on, one overview per week. A problem never reaches the caller:
 * a refusal of this very mail is remembered (not asked again), anything else is tried again on a later scan.
 */
export class WeeklyMailer {
  private readonly sent: MailSent;
  private readonly tried = new Map<string, number>();
  private readonly logged = new Set<string>();
  constructor(private readonly o: WeeklyMailerOptions) { this.sent = new MailSent(o.file); }

  /** `build` runs only when a mail is due. */
  async tick(profileId: string, contact: { email: string | null; weekly: boolean }, build: () => WeeklyMailBase): Promise<TickResult> {
    const cfg = this.o.mail;
    if (!cfg) return 'off';
    const now = this.o.nowMs();
    const d = new Date(now);
    if (!contact.weekly || !contact.email) return 'not-due';
    if (d.getDay() !== 0 || d.getHours() < ruleNumber('mail.weekly-hour')) return 'not-due';
    const week = mondayOf(dateKey(now));
    if (this.sent.has(profileId, week)) return 'not-due';
    const last = this.tried.get(profileId);
    if (last !== undefined && now >= last && now - last < MAIL_RETRY_MS) return 'waiting';
    this.tried.set(profileId, now);
    let result: SendResult;
    try { result = await sendMail(cfg, { ...weeklyMailOf({ ...build(), appUrl: cfg.appUrl ?? null }), to: contact.email }, this.o.fetchFn); } catch { result = 'retry'; }
    if (result === 'ok' || result === 'rejected') this.sent.mark(profileId, week);
    if (result !== 'ok') this.logOnce(`${profileId}:${week}:${result}`, result === 'rejected' ? `Wochenmail für ${profileId}: vom Mail-Dienst abgelehnt` : `Wochenmail für ${profileId}: nicht gesendet, neuer Versuch später`);
    return result === 'ok' ? 'sent' : result;
  }

  private logOnce(key: string, line: string): void {
    if (this.logged.has(key)) return;
    this.logged.add(key);
    (this.o.log ?? ((l) => console.error(l)))(line);
  }
}
