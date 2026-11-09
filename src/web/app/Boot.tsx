import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from '../AppContext';
import { RecordsProvider } from '../../tracking/ui/data/RecordsProvider';
import { openIdb } from '../idbStore';
import { createWebPort, type WebPort } from '../webPort';
import { Env, ACCOUNT_KEY, LOGGED_OUT_KEY, ME_TIMEOUT_MS, NO_STORAGE, STORAGE_FAILED, loggedOut, sleep, post, get } from './env';
import { LoginForm } from './LoginForm';
import { Shell } from './Shell';

export type Phase = { kind: 'loading' } | { kind: 'login' } | { kind: 'offline' } | { kind: 'nostorage' } | { kind: 'storagefail' } | { kind: 'in'; account: string };

export const factoryOf = (env: Env): IDBFactory | null => (env.idbFactory === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : env.idbFactory);

/** Lets the unmounted screens flush their last write, waits for it, then stops and closes the port. */
export async function retire(p: WebPort): Promise<void> {
  await sleep(0); await sleep(0);
  await p.idle();
  await p.pause();
  p.dispose();
}

export function App({ env }: { env: Env }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [port, setPort] = useState<{ account: string; port: WebPort } | null>(null);
  const portRef = useRef<WebPort | null>(null);
  portRef.current = port?.port ?? null;

  /** Opens the account's local data. Without a usable IndexedDB nothing can be stored, and that is said plainly. */
  const enter = useCallback(async (account: string): Promise<boolean> => {
    const factory = factoryOf(env);
    if (!factory) { setPhase({ kind: 'nostorage' }); return false; }
    env.storage.setItem(ACCOUNT_KEY, account); // so a retry after a failed open still finds the account
    let store;
    try { store = await openIdb(account, factory); } catch { setPhase({ kind: 'storagefail' }); return false; } // may pass; not the same as unavailable
    const old = portRef.current;
    const p = createWebPort({ store, account, fetchFn: env.fetchFn, now: env.now, push: env.push });
    setPort({ account, port: p });
    if (old) void retire(old); // after its screens have unmounted and flushed
    setPhase({ kind: 'in', account });
    return true;
  }, [env]);

  /** Tell the server about a logout that could not be sent while offline. */
  const retryLogout = useCallback(() => {
    void post(env, '/logout', undefined, ME_TIMEOUT_MS).then((res) => { if (loggedOut(res)) env.storage.removeItem(LOGGED_OUT_KEY); }, () => {});
  }, [env]);

  const boot = useCallback(async () => {
    setPhase({ kind: 'loading' });
    if (!factoryOf(env)) { setPhase({ kind: 'nostorage' }); return; }
    if (env.storage.getItem(LOGGED_OUT_KEY) === '1') { retryLogout(); setPhase({ kind: 'login' }); return; }
    // The last account on this device opens at once from its local data; its login is checked in the background.
    const last = env.storage.getItem(ACCOUNT_KEY);
    if (last) { await enter(last); return; } // a failure to open is the storage message
    try {
      const res = await get(env, '/me');
      if (res.ok) {
        const me = (await res.json()) as { name?: unknown };
        if (typeof me.name === 'string') { await enter(me.name.toLowerCase()); return; }
      }
      if (res.status === 401) { setPhase({ kind: 'login' }); return; }
      throw new Error('unexpected');
    } catch { setPhase({ kind: 'offline' }); }
  }, [env, enter, retryLogout]);

  useEffect(() => { void boot(); }, [boot]);
  useEffect(() => () => portRef.current?.dispose(), []);
  // Without a workout page (login, offline start, no storage) there is nothing to protect; while loading it stays unknown.
  useEffect(() => { if (phase.kind !== 'in' && phase.kind !== 'loading') env.onWorkoutOpen?.('none'); }, [phase.kind, env]);

  const afterLogin = async (name: string) => {
    void env.persist().catch(() => false); // requested at login, while the tap counts as a gesture
    try {
      const res = await get(env, '/me');
      const me = res.ok ? ((await res.json()) as { name?: unknown }) : null;
      await enter(typeof me?.name === 'string' ? me.name.toLowerCase() : name);
    } catch { await enter(name); }
  };
  const logout = async () => {
    const p = portRef.current;
    setPort(null); // the screens unmount first and flush what is still typed
    setPhase({ kind: 'login' });
    env.storage.removeItem(ACCOUNT_KEY); // the data stays on the device; the login does not
    if (p) await retire(p);
    try { if (!loggedOut(await post(env, '/logout', undefined, ME_TIMEOUT_MS))) env.storage.setItem(LOGGED_OUT_KEY, '1'); } catch { env.storage.setItem(LOGGED_OUT_KEY, '1'); } // not answered: asked again at the next start
  };

  if (phase.kind === 'loading') return <main className="web-main"><p className="muted tk-screen">Einen Moment …</p></main>;
  if (phase.kind === 'nostorage') return <main className="web-main tk-screen"><p role="status" className="tk-note">{NO_STORAGE}</p></main>;
  if (phase.kind === 'storagefail') return <main className="web-main tk-screen"><p role="status" className="tk-note">{STORAGE_FAILED}</p><button type="button" onClick={() => void boot()}>Nochmal versuchen</button></main>;
  if (phase.kind === 'offline') return <main className="web-main tk-screen"><p role="status" className="tk-note">Keine Verbindung. Zum ersten Anmelden braucht Pandafit kurz Internet.</p><button type="button" onClick={() => void boot()}>Nochmal versuchen</button></main>;
  if (phase.kind === 'login' || !port) return <main className="web-main"><LoginForm env={env} onDone={(n) => void afterLogin(n)} /></main>;
  return <Session key={port.account} account={port.account} env={env} port={port.port} onLogout={() => void logout()} onRelogin={(n) => void afterLogin(n)} />;
}

/** The signed-in session: one records cache and one app context for everything below. */
export function Session({ account, env, port, onLogout, onRelogin }: { account: string; env: Env; port: WebPort; onLogout: () => void; onRelogin: (name: string) => void }) {
  const value = useMemo(() => ({ port, env, account, fetchFn: env.fetchFn }), [port, env, account]);
  return <AppContext.Provider value={value}><RecordsProvider port={port}><Shell account={account} env={env} port={port} onLogout={onLogout} onRelogin={onRelogin} /></RecordsProvider></AppContext.Provider>;
}
