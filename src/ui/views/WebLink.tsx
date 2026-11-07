/** Opens the web app in the system browser. The window handler lets exactly the linked server's origin through. */
export const openWebApp = (origin: string): void => { window.open(origin, '_blank', 'noopener'); };

/** "Mehr in der Web-App ›": a quiet text link, only with a link to a server. */
export const MoreInWeb = ({ origin }: { origin: string | null | undefined }) => (
  origin ? <main><button type="button" className="ghost" onClick={() => openWebApp(origin)}>Mehr in der Web-App ›</button></main> : null
);
