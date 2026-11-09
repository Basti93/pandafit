import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch } from '../../tracking/ui/kit';
import { useApp } from '../AppContext';
import type { PushEnv, SubJson } from '../push';
import { UpdatesSwitch } from '../ContactSettings';
import { Env, post, get } from './env';

export const pushKey = (account: string) => `pandafit.push.${account}`;
export const cardKey = (account: string) => `pandafit.pushCard.${account}`;
export const PUSH_INSTALL = 'Auf dem iPhone gibt es Benachrichtigungen, wenn Pandafit auf dem Home-Bildschirm liegt (ab iOS 16.4): unten auf Teilen tippen, dann auf „Zum Home-Bildschirm“, und Pandafit von dort öffnen.';
export const PUSH_DENIED = 'Benachrichtigungen sind für Pandafit nicht erlaubt. Du kannst sie in den Einstellungen erlauben und dann im Profil einschalten.';
export const PUSH_FAILED = 'Das Einschalten hat gerade nicht geklappt. Versuch es später im Profil nochmal.';

export type PushState = { env: PushEnv; on: boolean; busy: boolean; showCard: boolean; enable: () => Promise<void>; disable: () => Promise<void>; closeCard: () => void };

/** One on/off per account and device for both notices. A subscription is sent again at every start, so it follows the login. */
export function usePush(env: Env, account: string): { state: PushState | null; msg: string | null } {
  const p = env.push;
  const [on, setOn] = useState(() => env.storage.getItem(pushKey(account)) === 'on');
  const [cardDone, setCardDone] = useState(() => env.storage.getItem(cardKey(account)) === '1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const getKey = useCallback(async (): Promise<string> => {
    if (key.current) return key.current;
    const res = await get(env, '/push/key');
    const k = res.ok ? ((await res.json()) as { key?: unknown }).key : null;
    if (typeof k !== 'string') throw new Error('no key');
    return (key.current = k);
  }, [env]);
  const send = useCallback(async (s: SubJson) => {
    const res = await post(env, '/push/subscribe', { endpoint: s.endpoint, keys: s.keys });
    if (!res.ok) throw new Error('not stored');
  }, [env]);

  useEffect(() => {
    if (!p || p.support !== 'ok') return;
    void getKey().catch(() => {}); // ready before the tap, so subscribing follows the permission at once
    if (env.storage.getItem(pushKey(account)) === 'on' && p.permission() === 'granted') {
      void (async () => send((await p.current()) ?? (await p.subscribe(await getKey()))))().catch(() => {});
    }
  }, [env, p, account, getKey, send]);

  if (!p) return { state: null, msg };
  const closeCard = () => { env.storage.setItem(cardKey(account), '1'); setCardDone(true); };
  const enable = async () => {
    setBusy(true); setMsg(null);
    try {
      if ((await p.requestPermission()) !== 'granted') { setMsg(PUSH_DENIED); return; } // first: iOS asks only during the tap
      await send(await p.subscribe(await getKey()));
      env.storage.setItem(pushKey(account), 'on'); setOn(true);
    } catch { setMsg(PUSH_FAILED); } finally { setBusy(false); closeCard(); }
  };
  const disable = async () => {
    setBusy(true); setMsg(null);
    env.storage.setItem(pushKey(account), 'off'); setOn(false);
    try {
      const endpoint = await p.unsubscribe();
      if (endpoint) await post(env, '/push/unsubscribe', { endpoint });
    } catch { /* the push service answers 410 next time, and the server drops it */ } finally { setBusy(false); }
  };
  const showCard = !cardDone && !on && (p.support === 'install' || (p.support === 'ok' && p.permission() === 'default'));
  return { state: { env: p, on, busy, showCard, enable, disable, closeCard }, msg };
}

export function PushCard({ push }: { push: PushState }) {
  return (
    <div className="tk-screen">
      <section className="card" aria-label="Benachrichtigungen einschalten">
        <h2>Benachrichtigungen einschalten</h2>
        {push.env.support === 'install' ? (
          <>
            <p>{PUSH_INSTALL}</p>
            <button type="button" className="link" onClick={push.closeCard}>Verstanden</button>
          </>
        ) : (
          <>
            <p>Pandafit sagt dir Bescheid, wenn eine neue Version da ist, wenn dein Essensplan für die Woche kommt und wenn dein Laufplan da ist. Sonst nichts.</p>
            <div className="tk-row">
              <button type="button" disabled={push.busy} onClick={() => void push.enable()}>Einschalten</button>
              <button type="button" className="link" onClick={push.closeCard}>Nicht jetzt</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function PushSettings({ push, now }: { push: PushState; now: () => number }) {
  const { port } = useApp();
  const p = push.env;
  const granted = p.support === 'ok' && p.permission() === 'granted';
  return (
    <>
      {p.support === 'install' && <p className="muted">{PUSH_INSTALL}</p>}
      {p.support === 'none' && <p className="muted">In diesem Browser gibt es keine Benachrichtigungen.</p>}
      {p.support === 'ok' && (
        <>
          <Switch label="Benachrichtigungen" hint="Für neue Essens- und Laufpläne, Antworten vom Coach und neue Versionen." checked={push.on && granted} disabled={push.busy}
            onChange={(on) => void (on ? push.enable() : push.disable())} />
          {push.on && granted && <UpdatesSwitch port={port} now={now} />}
          {push.on && !granted && <p className="muted">{PUSH_DENIED}</p>}
        </>
      )}
    </>
  );
}
