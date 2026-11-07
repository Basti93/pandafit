/** The web app's address as the Mac may open it: the origin of an https link, nothing else (no path, no login part, no plain http). */
export const webOrigin = (raw: string | null | undefined): string | null => {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return u.origin;
};
