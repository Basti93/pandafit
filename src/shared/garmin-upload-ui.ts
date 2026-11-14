/** Texts and the remembered project-link choice shared by the Mac's ride button and the web's workout button. */
export const UPLOAD_REASON: Record<string, string> = {
  reauth: 'Die Garmin-Anmeldung ist abgelaufen, bitte neu anmelden.',
  'rate-limit': 'Garmin blockt gerade zu viele Anfragen, bitte später erneut versuchen.',
  'missing-file': 'Zu dieser Fahrt gibt es keine FIT-Datei.',
  failed: 'Das Hochladen hat nicht geklappt. Die Fahrt bleibt hier gespeichert.',
};
const WORKOUT_REASON: Record<string, string> = {
  'missing-file': 'Zu diesem Training gibt es keine Datei.',
  failed: 'Das Hochladen hat nicht geklappt. Das Training bleibt hier gespeichert.',
};

/** The text for a failed upload; `kind` picks "Fahrt" (default) or "Training". */
export const reasonText = (reason: string | undefined, kind: 'ride' | 'workout' = 'ride'): string => {
  const key = reason ?? 'failed';
  return (kind === 'workout' ? WORKOUT_REASON[key] : undefined) ?? UPLOAD_REASON[key] ?? (kind === 'workout' ? WORKOUT_REASON.failed : UPLOAD_REASON.failed);
};

const REPO_KEY = 'bike-coach.garmin-repo-link';
export const repoLinkStored = (): boolean => { try { return localStorage.getItem(REPO_KEY) === 'on'; } catch { return false; } };
export const storeRepoLink = (on: boolean): void => {
  try { localStorage.setItem(REPO_KEY, on ? 'on' : 'off'); } catch { /* then it only applies now */ }
};
