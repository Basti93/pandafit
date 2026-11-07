import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { askClaude, findClaude } from '../claude-client';
import { askRemote } from '../remote-claude-client';
import { secretKeyFrom } from '../secrets/secret-box';
import { buildCoachServer } from './http';
import type { FastifyInstance } from 'fastify';
import { AiGate } from '../ai-gate';
import { mailConfigOf, type MailConfig } from '../mail-client';
import { Household, type HouseholdOptions } from './household';

const SCAN_MS = 10_000;
/** tmpfs: opened Garmin tokens live here only while a Python run lasts. */
const RUN_DIR = '/run/pandafit-secrets';
const HEX_TOKEN = /^[0-9a-f]{64}$/i;

export type CoachServerConfig = {
  port: number; host: string; root: string; secretKey: Buffer; internalToken: string; apiUrl: string;
  claudeBin: string | undefined; python: string; garminScripts: string;
  /** The home server's AI service (heimserver ki/). When set, Claude never runs in this container. */
  aiUrl?: string; aiToken?: string;
  /** The home server's mail service (MAIL_URL, MAIL_TOKEN, PANDAFIT_APP_URL); absent: no mail. */
  mail?: MailConfig;
  /** The restore drill: no scan, no Claude, no Hevy and no Garmin. */
  dry: boolean;
};

/** The coach container's settings. Throws without a valid key or internal token; the message never contains a value. */
export const readCoachServerConfig = (env: Record<string, string | undefined>): CoachServerConfig => {
  const secretKey = secretKeyFrom(env.PANDAFIT_SECRET_KEY);
  const internalToken = env.PANDAFIT_INTERNAL_TOKEN;
  if (typeof internalToken !== 'string' || !HEX_TOKEN.test(internalToken)) throw new Error('PANDAFIT_INTERNAL_TOKEN fehlt oder ist ungültig (64 Hex-Zeichen)');
  const port = Number(env.PORT ?? 8090);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT ist ungültig');
  const aiUrl = env.PANDAFIT_AI_URL || undefined;
  const aiToken = env.PANDAFIT_AI_TOKEN;
  const mail = mailConfigOf(env);
  if (aiUrl && (typeof aiToken !== 'string' || !HEX_TOKEN.test(aiToken))) throw new Error('PANDAFIT_AI_TOKEN fehlt oder ist ungültig (64 Hex-Zeichen)');
  return {
    port, host: env.HOST ?? '0.0.0.0',
    root: env.PANDAFIT_COACH_DATA ?? '/data',
    secretKey, internalToken,
    apiUrl: env.PANDAFIT_API_INTERNAL ?? 'http://api:8081',
    claudeBin: env.BIKE_CLAUDE_BIN || undefined,
    python: env.PANDAFIT_GARMIN_PYTHON ?? '/opt/garmin-venv/bin/python',
    garminScripts: env.PANDAFIT_GARMIN_SCRIPTS ?? '/app/scripts/garmin',
    dry: env.PANDAFIT_COACH_DRY === '1',
    ...(aiUrl ? { aiUrl, aiToken } : {}),
    ...(mail ? { mail } : {}),
  };
};

const gates = new Map<string, AiGate>();
/** One gate per data root, shared by every caller of the process (the options may be built more than once). */
const gateOf = (root: string): AiGate => {
  let g = gates.get(root);
  if (!g) { g = new AiGate(path.join(root, 'ai-gate.json')); gates.set(root, g); }
  return g;
};

/** The household's options. In the dry run Claude, Garmin and Hevy refuse at once, so nothing reaches the network. */
export const householdOptions = (config: CoachServerConfig): HouseholdOptions => {
  const workDir = path.join(config.root, 'work');
  const refuse = (what: string) => (): never => { throw new Error(`${what} ist im Probelauf aus`); };
  return {
    root: config.root, secretKey: config.secretKey, runDir: RUN_DIR,
    python: config.python, garminScripts: config.garminScripts,
    apiUrl: config.apiUrl, internalToken: config.internalToken,
    // In the dry run nothing leaves the container.
    ...(config.mail && !config.dry ? { mail: config.mail } : {}),
    // askClaude ends every call at its timeout, so the household's one-at-a-time lock never stays held.
    ask: config.dry ? async () => refuse('Claude')()
      : gateOf(config.root).wrap(config.aiUrl ? async (input) => askRemote(input, { url: config.aiUrl as string, token: config.aiToken as string })
        : async (input) => askClaude({ ...input, workDir, bin: config.claudeBin ?? (await findClaude()) })),
    ...(config.dry ? { spawnFn: refuse('Garmin') as never, fetchFn: (async () => refuse('Hevy')()) as never } : {}),
  };
};

export type RunningCoachServer = { app: FastifyInstance; household: Household; stop(): Promise<void> };

/** Listens, then scans at once and every `scanMs` (never in the dry run). stop() ends the scan and closes every socket. */
export const startCoachServer = async (config: CoachServerConfig, opts: { scanMs?: number } = {}): Promise<RunningCoachServer> => {
  if (!config.dry) fs.mkdirSync(path.join(config.root, 'work'), { recursive: true, mode: 0o700 });
  const household = new Household(householdOptions(config));
  const app = buildCoachServer({ household, internalToken: config.internalToken });
  await app.listen({ port: config.port, host: config.host });
  let timer: NodeJS.Timeout | null = null;
  if (!config.dry) {
    household.scan();
    timer = setInterval(() => household.scan(), opts.scanMs ?? SCAN_MS);
  }
  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (timer) clearInterval(timer);
      timer = null;
      await app.close();
    })();
    return stopping;
  };
  return { app, household, stop };
};

type Proc = { env: Record<string, string | undefined>; on: (signal: 'SIGTERM' | 'SIGINT', fn: () => void) => void; exit: (code: number) => void; log: (line: string) => void };

/** The container's entry: refuses a bad config with exit code 1, and on SIGTERM or SIGINT stops the scan, closes the server and exits 0. */
export const run = async (proc: Proc): Promise<void> => {
  let config: CoachServerConfig;
  try { config = readCoachServerConfig(proc.env); } catch (e) {
    proc.log(`Coach startet nicht: ${(e as Error).message}`);
    proc.exit(1);
    return;
  }
  let server: RunningCoachServer;
  try { server = await startCoachServer(config); } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    proc.log(`Coach startet nicht: ${typeof code === 'string' ? code : 'Fehler beim Start'}`);
    proc.exit(1);
    return;
  }
  const shutdown = (): void => { void server.stop().catch(() => {}).finally(() => proc.exit(0)); };
  proc.on('SIGTERM', shutdown);
  proc.on('SIGINT', shutdown);
  process.stdout.write(`Coach bereit auf Port ${config.port}${config.dry ? ' (Probelauf)' : ''}\n`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void run({ env: process.env, on: (signal, fn) => { process.once(signal, fn); }, exit: (code) => process.exit(code), log: (line) => console.error(line) });
}
