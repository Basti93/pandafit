/** The window gets the machine's token in its URL (`?t=`); the local WebSockets need it. */
export const localSocketUrl = (port: number): string => {
  const t = new URLSearchParams(window.location.search).get('t');
  return `ws://127.0.0.1:${port}/${t ? `?t=${encodeURIComponent(t)}` : ''}`;
};
