import { useRef, useState } from 'react';
import { Env, LOGGED_OUT_KEY, post } from './env';

export function LoginForm({ env, onDone, note, before, failed }: { env: Env; onDone: (name: string) => void; note?: string; before?: () => Promise<void>; failed?: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!name.trim() || !password) { setMsg('Bitte gib deinen Namen und dein Passwort ein.'); (name.trim() ? passRef : nameRef).current?.focus(); return; }
    setBusy(true); setMsg(null);
    try {
      await before?.(); // no sync may run while the login changes under it
      const res = await post(env, '/login', { name: name.trim(), password });
      if (res.ok) { setPassword(''); env.storage.removeItem(LOGGED_OUT_KEY); onDone(name.trim().toLowerCase()); return; }
      failed?.();
      setMsg(res.status === 429 ? 'Das waren gerade zu viele Versuche. Warte bitte einen Moment.' : res.status === 401 ? 'Name oder Passwort stimmt nicht. Versuch es gern nochmal.' : 'Das hat gerade nicht geklappt. Versuch es gleich nochmal.');
    } catch (e) {
      failed?.();
      setMsg((e as { name?: string }).name === 'TimeoutError' ? 'Der Server antwortet gerade nicht. Deine Einträge auf diesem Gerät sind sicher. Versuch es gleich nochmal.' : 'Es gibt gerade keine Verbindung. Deine Einträge auf diesem Gerät sind sicher. Versuch es gleich nochmal.');
    } finally { setBusy(false); }
  };
  return (
    <form className="web-login tk-screen" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <img className="web-login-panda" src="/brand/panda-still.svg" alt="" width={198} height={164} />
      <h1 className="tk-title">Pandafit</h1>
      <p className="muted">Ein Konto bekommst du von der Person, die Pandafit eingerichtet hat.</p>
      {note && <p role="status" className="tk-note">{note}</p>}
      <label>Name<input ref={nameRef} aria-label="Name" autoComplete="username" autoCapitalize="none" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Passwort<input ref={passRef} aria-label="Passwort" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {msg && <p role="status" className="tk-note">{msg}</p>}
      <button type="submit" className="primary" disabled={busy}>Anmelden</button>
    </form>
  );
}
