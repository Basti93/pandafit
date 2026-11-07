import type { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseProfile, type Profile } from '../../shared/profiles';
import { cleanSettings, MealCoach } from '../meals/meal-coach';
import { createCoachRuntime, type CoachRuntime } from '../runtime';
import { sealedTokens } from '../secrets/garmin-tokens';
import { sealedCodec } from '../secrets/secret-box';
import { computeTogether, type Together } from '../together';
import type { RecordStore } from '../tracking/store';
import { mirrorExercises } from '../tracking/mirror-exercises';
import { errorKind } from '../error-kind';
import { ChangeClock } from './change-clock';
import type { MailConfig } from '../mail-client';
import { HeavyLock, inQuietHours } from './heavy';
import { internalLinks } from './internal-links';
import { MigrationDesk } from './migration';

type Ask = (input: { prompt: string; systemPrompt: string; schema: object; timeoutMs?: number }) => Promise<unknown>;

export type HouseholdOptions = {
  /** Holds `accounts/<id>/` and `household/meals/`. */
  root: string;
  secretKey: Buffer;
  /** tmpfs for opened Garmin tokens; each account gets its own folder inside. */
  runDir: string;
  python: string;
  garminScripts: string;
  /** The api's internal listener, e.g. `http://api:8081`. */
  apiUrl: string;
  internalToken: string;
  ask: Ask;
  nowMs?: () => number;
  /** For tests: Garmin runs, Hevy requests and how long a finished ride waits for feedback. */
  spawnFn?: typeof spawn;
  fetchFn?: typeof fetch;
  waitMs?: number;
  /** The mail service for the weekly overview; null or missing: no mail. */
  mail?: MailConfig | null;
};

export type AccountCoach = {
  accountId: number;
  profileId: string;
  /** `<root>/accounts/<id>`: everything of this account and nothing else. */
  dir: string;
  runtime: CoachRuntime;
  profile(): Profile;
  /** Keeps `profile.json`. The profile id stays the one bound to the account. */
  setProfile(p: Profile): void;
};

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const ACCOUNT_DIR = /^[1-9][0-9]{0,15}$/;

const readProfile = (file: string): Profile | null => {
  try {
    const p = parseProfile(JSON.parse(fs.readFileSync(file, 'utf8')));
    return SAFE_ID.test(p.id) ? p : null;
  } catch { return null; }
};

const writeJson = (file: string, data: unknown): void => {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
};

/**
 * The server's coach: one runtime per moved account, each in its own folder, so one account never reads the other's rides, health data,
 * notes, complaints or secrets. Only the meal plan and the together page are shared, and they return only their combined result.
 * Every Claude call of every coach goes through one lock; Hevy and Garmin wait while it is busy, and scan-driven runs pause at night.
 */
export class Household {
  private readonly accounts = new Map<number, AccountCoach>();
  private readonly lock = new HeavyLock();
  private readonly nowMs: () => number;
  private readonly ask: Ask;
  private mealCoach: MealCoach | null = null;
  private clock: ChangeClock | null = null;
  private desk: MigrationDesk | null = null;
  /** Accounts whose start failed, so the log says it once. */
  private readonly failed = new Set<number>();

  constructor(private readonly opts: HouseholdOptions) {
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.ask = (input) => this.lock.run(() => opts.ask(input));
  }

  /** `<root>/accounts`: one folder per account. */
  accountsDir(): string { return path.join(this.opts.root, 'accounts'); }
  private accountDir(accountId: number): string { return path.join(this.accountsDir(), String(accountId)); }
  private mealsDir(): string { return path.join(this.opts.root, 'household', 'meals'); }
  private quiet(): boolean { return inQuietHours(this.nowMs()); }

  /** The account's coach, started on first use once the account moved. Null otherwise. */
  account(accountId: number): AccountCoach | null {
    const known = this.accounts.get(accountId);
    if (known) return known;
    this.tryStart(accountId);
    return this.accounts.get(accountId) ?? null;
  }

  /** start() that never throws: a broken account is logged once, without content, and tried again on the next call. */
  private tryStart(accountId: number): void {
    try {
      this.start(accountId);
      this.failed.delete(accountId);
    } catch (e) {
      // The message can quote an account's file, so only its kind goes to the log.
      if (!this.failed.has(accountId)) console.error(`Konto ${accountId}: Coach startet nicht (${errorKind(e)})`);
      this.failed.add(accountId);
    }
  }

  /** Starts the account's coach when it moved and has a valid profile. Safe to repeat. */
  start(accountId: number): void {
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || this.accounts.has(accountId)) return;
    const dir = this.accountDir(accountId);
    if (!fs.existsSync(path.join(dir, 'moved.json'))) return;
    const profileFile = path.join(dir, 'profile.json');
    const first = readProfile(profileFile);
    if (!first) return;
    const profileId = first.id;
    // One profile belongs to one account: a second account with the same id gets no coach.
    if (this.byProfile(profileId)) return;
    let current = first;
    const { secretKey, runDir } = this.opts;
    const runtime = createCoachRuntime({
      root: dir,
      profiles: () => [current],
      // No ride is ever open on the server.
      noOpenRide: () => true,
      scheduled: () => !this.quiet(),
      heavyBusy: () => this.lock.busy(),
      ask: this.ask,
      python: this.opts.python,
      garminScripts: this.opts.garminScripts,
      links: internalLinks({ apiUrl: this.opts.apiUrl, token: this.opts.internalToken, accountId, profileId, dir: path.join(dir, 'links'), nowMs: this.nowMs }),
      // Asked on every use: null until the household's meals moved, then the one shared MealCoach.
      meals: () => this.openMeals(),
      together: () => this.together(),
      nowMs: this.nowMs,
      hevyCodec: () => sealedCodec(secretKey, `${accountId}:hevy`),
      garminTokens: sealedTokens({
        garminDir: path.join(dir, 'garmin'),
        runDir: path.join(runDir, String(accountId)),
        codec: () => sealedCodec(secretKey, `${accountId}:garmin`),
      }),
      ...(this.opts.spawnFn ? { spawnFn: this.opts.spawnFn } : {}),
      ...(this.opts.fetchFn ? { fetchFn: this.opts.fetchFn } : {}),
      ...(this.opts.mail ? { mail: this.opts.mail } : {}),
      ...(this.opts.waitMs !== undefined ? { waitMs: this.opts.waitMs } : {}),
    });
    this.accounts.set(accountId, {
      accountId, profileId, dir, runtime,
      profile: () => current,
      setProfile: (p) => {
        const next = parseProfile(p);
        if (next.id !== profileId) throw new Error('Anderes Profil');
        writeJson(profileFile, next);
        current = next;
      },
    });
  }

  /** "Last change wins" for the items of the shared meal plan: one clock for every account, in `household/meals/clock.json`. */
  mealClock(): ChangeClock {
    this.clock ??= new ChangeClock(path.join(this.mealsDir(), 'clock.json'));
    return this.clock;
  }

  /** Every moved account with a valid profile, read from the disk only: starts nothing. */
  movedAccounts(): { accountId: number; profileId: string; dir: string }[] {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(this.opts.root, 'accounts')); } catch { /* no account yet */ }
    return names.filter((n) => ACCOUNT_DIR.test(n)).sort((x, y) => Number(x) - Number(y)).flatMap((name) => {
      const dir = this.accountDir(Number(name));
      if (!fs.existsSync(path.join(dir, 'moved.json'))) return [];
      const p = readProfile(path.join(dir, 'profile.json'));
      return p ? [{ accountId: Number(name), profileId: p.id, dir }] : [];
    });
  }

  /** The desk that takes a profile over from the Mac. One per household; a finished move starts the account's coach. */
  migrationDesk(): MigrationDesk {
    this.desk ??= new MigrationDesk({
      root: this.opts.root, secretKey: this.opts.secretKey, nowMs: this.nowMs,
      onMoved: (accountId) => { this.tryStart(accountId); this.settleMeals(); },
      meals: (profileId, upload) => this.importMeals(profileId, upload),
    });
    return this.desk;
  }

  /**
   * A moved person's meal file from the Mac. The household's first one is taken whole; after that only the person's own settings,
   * and only when the household has none for them. Once the meal plan is open, that goes through it, so its cached file stays the truth.
   */
  importMeals(profileId: string, upload: Record<string, unknown>): void {
    const settings = upload.settings;
    const own = isRecord(settings) && Object.prototype.hasOwnProperty.call(settings, profileId) ? settings[profileId] : undefined;
    const open = this.openMeals();
    if (open) {
      if (own !== undefined) open.adoptSettings(profileId, own);
    } else {
      // Not moved yet: no meal plan is open, so nobody holds the file in memory.
      const file = path.join(this.mealsDir(), 'household.json');
      fs.mkdirSync(this.mealsDir(), { recursive: true, mode: 0o700 });
      let current: unknown = null;
      try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        // Every person's settings cut to the known shape, as the open meal plan would; the rest of the file as it came.
        const cleaned = isRecord(settings) ? Object.fromEntries(Object.entries(settings).map(([id, raw]) => [id, cleanSettings(raw)])) : {};
        writeJson(file, { ...upload, settings: cleaned });
        // The stamps of the shared items belong to the file they were made on; a new file starts a new clock.
        this.clock = null;
        fs.rmSync(path.join(this.mealsDir(), 'clock.json'), { force: true });
      } else if (own !== undefined) {
        const d = current as Record<string, unknown>;
        const have = isRecord(d.settings) ? d.settings : {};
        if (!Object.prototype.hasOwnProperty.call(have, profileId)) writeJson(file, { ...d, settings: { ...have, [profileId]: cleanSettings(own) } });
      }
    }
    this.settleMeals();
  }

  /** Writes `household/meals/moved.json` once every person in the meal file has moved; from then on the meal plan runs. */
  settleMeals(): void {
    const dir = this.mealsDir();
    if (fs.existsSync(path.join(dir, 'moved.json'))) return;
    let d: unknown;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, 'household.json'), 'utf8')); } catch { return; }
    const settings = (d as { settings?: unknown } | null)?.settings;
    const people = isRecord(settings) ? Object.keys(settings) : [];
    // A file with nobody in it counts as everyone moved: the meal plan opens empty, and people join later only through
    // `adoptSettings` (a later upload) or their own settings change, both through the open meal plan.
    const moved = new Set(this.movedAccounts().map((a) => a.profileId));
    if (people.every((id) => moved.has(id))) writeJson(path.join(dir, 'moved.json'), { atMs: this.nowMs() });
  }

  /** Starts every moved account that is not running yet, and returns all running ones. Starts no run of its own. */
  startAll(): AccountCoach[] {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(this.opts.root, 'accounts')); } catch { /* no account yet */ }
    for (const name of names) if (ACCOUNT_DIR.test(name)) this.tryStart(Number(name));
    return [...this.accounts.values()];
  }

  /** Starts every moved account, then runs each coach's scan and the shared meal plan. */
  scan(): void {
    for (const a of this.startAll()) a.runtime.scan();
    // One exercise catalog across the accounts: mirrored on every scan. Touches no workout.
    this.mirrorCatalog();
    // Separate safeguard: the meal plan must never disturb the coaches. It runs only once moved. At night it answers a person's
    // chat message but does not make the scheduled weekly plan.
    const mc = this.openMeals();
    if (mc) void mc.tick({ plan: !this.quiet() }).catch(() => {});
  }

  private mirrorCatalog(): void {
    try {
      const store: Pick<RecordStore, 'all' | 'putMany'> = {
        all: (id, kind) => { const a = this.byProfile(id); return a ? a.runtime.records.all(id, kind) : []; },
        putMany: (id, records, from) => {
          const a = this.byProfile(id);
          if (!a) throw new Error('Unbekanntes Profil');
          return a.runtime.records.putMany(id, records, from);
        },
      };
      for (const id of mirrorExercises(store, [...this.accounts.values()].map((a) => a.profileId))) {
        const a = this.byProfile(id);
        if (!a) continue;
        a.runtime.accountSync.touch(id);
        a.runtime.notify(id);
      }
    } catch { /* next scan */ }
  }

  /** Both accounts' derived values only: no note, complaint, ride id or health value. */
  together(): Together {
    const people: Profile[] = [];
    const states = [];
    for (const a of this.accounts.values()) {
      const s = a.runtime.coachState(a.profileId);
      people.push(a.profile());
      if (s) states.push(s);
    }
    return computeTogether(people, states, this.nowMs());
  }

  private byProfile(profileId: string): AccountCoach | null {
    for (const a of this.accounts.values()) if (a.profileId === profileId) return a;
    return null;
  }

  /** The shared MealCoach once `household/meals/moved.json` exists, else null. Made on first use, so nothing is read before the move. */
  /** The household's meal coach, once its meals moved; null before. */
  meals(): MealCoach | null { return this.openMeals(); }
  private openMeals(): MealCoach | null {
    if (!fs.existsSync(path.join(this.mealsDir(), 'moved.json'))) return null;
    if (this.mealCoach) return this.mealCoach;
    // Each profile's records go to its own account's store, never another's.
    const store: Pick<RecordStore, 'all' | 'putMany'> = {
      all: (id, kind) => { const a = this.byProfile(id); return a ? a.runtime.records.all(id, kind) : []; },
      putMany: (id, records, from) => {
        const a = this.byProfile(id);
        if (!a) throw new Error('Unbekanntes Profil');
        return a.runtime.records.putMany(id, records, from);
      },
    };
    this.mealCoach = new MealCoach({
      dir: this.mealsDir(), nowMs: this.nowMs, recipesDir: path.join(this.opts.root, 'recipes'),
      profiles: () => [...this.accounts.values()].map((a) => { const { id, name, avatar } = a.profile(); return { id, name, ...(avatar ? { avatar } : {}) }; }),
      noOpenRide: () => true,
      ask: this.ask,
      trainingDays: (id) => this.byProfile(id)?.runtime.trainingDays(id) ?? [],
      store,
      // Every moved account syncs its records with the api.
      linked: (id) => this.byProfile(id) !== null,
      // The records sync goes soon, and subscribers get the new view at once.
      onExport: (touched) => {
        for (const id of touched) {
          const a = this.byProfile(id);
          if (!a) continue;
          a.runtime.accountSync.touch(id);
          a.runtime.notify(id);
        }
      },
    });
    return this.mealCoach;
  }
}
