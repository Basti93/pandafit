import { useEffect, useRef, useState } from 'react';
import { localSocketUrl } from './local-token';
import { SERVICE_PORT, type ClientMessage, type RecoveryOffer, type StateMessage } from '../shared/protocol';

export const useRide = () => {
  const [state, setState] = useState<StateMessage | null>(null);
  const [click, setClick] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);
  const [offer, setOffer] = useState<RecoveryOffer | null>(null);
  const [connected, setConnected] = useState(false);
  /** True once a state arrived on the current socket; a restarted service may have recovered a ride. */
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const open = () => {
      const ws = new WebSocket(localSocketUrl(SERVICE_PORT));
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.type === 'state') { setState(m); setFresh(true); }
        if (m.type === 'click') setClick((c) => ({ dir: m.dir, n: (c?.n ?? 0) + 1 }));
        if (m.type === 'recovery-offer') setOffer(m);
        if (m.type === 'error') setError(m.message);
        if (m.type === 'report-saved') setReportPath(m.path);
      };
      ws.onclose = () => {
        setConnected(false);
        // Keep the last state on screen during a ride, but it no longer counts as known.
        setFresh(false);
        if (!closed) timer = setTimeout(open, 500);
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); socket.current?.close(); };
  }, []);

  /** Whether the socket took the message. */
  const send = (m: ClientMessage): boolean => {
    setError(null);
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    socket.current.send(JSON.stringify(m));
    return true;
  };
  return { click, state, offer, clearOffer: () => setOffer(null), connected, fresh, send, error, reportPath };
};
