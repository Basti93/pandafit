import { apiFetch, jsonInit } from '../../tracking/ui/data/api';
import type { OpenState } from '../register';
import type { PushEnv } from '../push';
import { type LiveSocket } from '../live';

export type Env = {
  fetchFn: typeof fetch;
  /** Undefined: the browser's own. Null: none available. */
  idbFactory?: IDBFactory | null;
  now: () => number;
  newId: () => string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  persist: () => Promise<boolean>;
  ua: string;
  standalone: boolean;
  /** Tells the update logic whether a workout is open on this device. */
  onWorkoutOpen?: (state: OpenState) => void;
  /** Push notifications; undefined where there is no service worker (dev). */
  push?: PushEnv;
  /** The tab a notification opened the app with. */
  startTab?: string | null;
  /** A notification tapped while the app is open asks for a tab. Returns the unsubscribe. */
  onOpenTab?: (f: (tab: string) => void) => () => void;
  /** Opens the account's coach socket for the ride companion; undefined where there is none (tests, dev). */
  openLive?: () => LiveSocket;
};

export const ACCOUNT_KEY = 'pandafit.account';
export const HINT_KEY = 'pandafit.installHint';
export const LOGGED_OUT_KEY = 'pandafit.loggedOut';
export const OPEN_MAX_AGE_MS = 12 * 3600_000;
export const ME_TIMEOUT_MS = 5000;
export const LOGIN_TIMEOUT_MS = 15_000;
export const NO_STORAGE = 'In diesem Browser können Einträge nicht gespeichert werden. Darum ist das Training hier nicht verfügbar. Versuch es in einem anderen Browser oder vom Home-Bildschirm aus.';
export const STORAGE_FAILED = 'Der Speicher auf diesem Gerät antwortet gerade nicht. Deine Einträge sind nicht verloren. Versuch es gleich nochmal.';
/** Only an answer from the server ends the session: 2xx, or 401 (already gone). Errors and 5xx leave it open. */
export const loggedOut = (res: Response): boolean => res.ok || res.status === 401;
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const post = (env: Env, path: string, body?: unknown, timeoutMs = LOGIN_TIMEOUT_MS) => apiFetch(env.fetchFn, path, jsonInit('POST', body ?? {}, timeoutMs));
export const get = (env: Env, path: string, timeoutMs = ME_TIMEOUT_MS) => apiFetch(env.fetchFn, path, { timeoutMs });
