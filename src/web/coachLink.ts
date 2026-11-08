import type { GarminUploadSettings } from '../coach/garmin-upload';
import type { CoachClientMessage, CoachStateMessage, GarminStatus, GarminSyncInfo, HevyStatus } from '../shared/coach-protocol';
import type { MealSettings } from '../shared/meals';
import type { LiveSocket } from './live';

/** What the Profil page needs from the account's coach: the connections and the two switches. */
export type CoachSettingsView = {
  profileId: string;
  hevy: HevyStatus;
  garmin: GarminStatus;
  garminSync: GarminSyncInfo | null;
  upload: GarminUploadSettings | undefined;
  gymOn: boolean;
  meals: MealSettings | null;
  /** The recipe collection's size and the size it is planned from; null when there is none. */
  recipes: { collection: number; unlock: number } | null;
};
export type CoachLinkSnapshot = { view: CoachSettingsView | null; /** The account has no coach on the server (yet): nothing to show. */ unavailable: boolean };
type Without<T> = T extends { profileId: string } ? Omit<T, 'profileId'> : never;
export type SettingsMessage = Without<Extract<CoachClientMessage, { type: 'hevy-connect' | 'hevy-disconnect' | 'garmin-login' | 'garmin-mfa' | 'garmin-disconnect' | 'garmin-upload-settings' | 'gym-start' | 'meals-settings' }>>;

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

/**
 * The web side of the settings the Mac used to hold: one socket to the account's coach, opened while Profil is shown
 * and once at the app start until the first answer (so the tabs know the switches on every device).
 * It asks `/coach/status` which profile the account's coach keeps, subscribes, and keeps the last view. Never throws.
 */
export class CoachLink {
  private ws: LiveSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = MIN_BACKOFF_MS;
  private stopped = true;
  /** Who holds the link open: Profil while shown, and the app start until the first answer. It closes when the last lets go. */
  private users = 0;
  private profileId: string | null = null;
  private snap: CoachLinkSnapshot = { view: null, unavailable: false };
  private subs = new Set<() => void>();

  constructor(private o: { open: () => LiveSocket; status: () => Promise<{ profileId: string | null; moved: boolean } | null> }) {}

  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  snapshot = (): CoachLinkSnapshot => this.snap;
  private set(s: CoachLinkSnapshot): void { this.snap = s; for (const f of [...this.subs]) { try { f(); } catch { /* a listener never stops the link */ } } }

  start(): void {
    this.users++;
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0) return;
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* gone */ }
  }

  private later(): void {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; void this.connect(); }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.ws) return;
    let status: Awaited<ReturnType<typeof this.o.status>> = null;
    try { status = await this.o.status(); } catch { status = null; }
    if (this.stopped || this.ws) return;
    if (!status) { this.later(); return; }
    if (!status.moved || !status.profileId) { this.set({ view: null, unavailable: true }); return; }
    const profileId = status.profileId;
    this.profileId = profileId;
    let ws: LiveSocket;
    try { ws = this.o.open(); } catch { this.later(); return; }
    this.ws = ws;
    ws.onopen = () => { if (this.ws === ws) { this.backoff = MIN_BACKOFF_MS; try { ws.send(JSON.stringify({ type: 'subscribe', profileId })); } catch { /* the close follows */ } } };
    ws.onmessage = (e) => { if (this.ws === ws) { try { this.received(String(e.data)); } catch { /* a bad message changes nothing */ } } };
    ws.onerror = () => { /* the close follows */ };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.later(); };
  }

  private received(raw: string): void {
    const m = JSON.parse(raw) as CoachStateMessage | null;
    if (!m || typeof m !== 'object' || m.type !== 'coach-state' || !this.profileId) return;
    this.set({ unavailable: false, view: {
      profileId: this.profileId,
      hevy: m.hevy ?? { state: 'idle' },
      garmin: m.garmin ?? { state: 'idle' },
      garminSync: m.garminSync ?? null,
      upload: m.state?.garminUpload,
      gymOn: m.gym != null,
      meals: m.meals?.settings ?? null,
      recipes: m.meals?.recipes ?? null,
    } });
  }

  /** One settings change. True when it went out; false without a link, so the page can say so. */
  send(m: SettingsMessage): boolean {
    const ws = this.ws;
    if (!ws || !this.profileId) return false;
    try { ws.send(JSON.stringify({ ...m, profileId: this.profileId })); return true; } catch { return false; }
  }
}
