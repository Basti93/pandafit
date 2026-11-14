/** Texts and the remembered project-link choice shared by the Mac's ride button and the web's workout button. */
export const UPLOAD_REASON: Record<string, string> = {
  reauth: 'Die Garmin-Anmeldung ist abgelaufen, bitte neu anmelden.',
  'rate-limit': 'Garmin blockt gerade zu viele Anfragen, bitte später erneut versuchen.',
  'missing-file': 'Zu dieser Fahrt gibt es keine FIT-Datei.',
  failed: 'Das Hochladen hat nicht geklappt. Die Fahrt bleibt hier gespeichert.',
};

export const reasonText = (reason: string | undefined): string => UPLOAD_REASON[reason ?? 'failed'] ?? UPLOAD_REASON.failed;

const REPO_KEY = 'bike-coach.garmin-repo-link';
export const repoLinkStored = (): boolean => { try { return localStorage.getItem(REPO_KEY) === 'on'; } catch { return false; } };
export const storeRepoLink = (on: boolean): void => {
  try { localStorage.setItem(REPO_KEY, on ? 'on' : 'off'); } catch { /* then it only applies now */ }
};
