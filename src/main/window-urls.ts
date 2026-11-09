/** The page a window may show: the same file or dev server page as the main window, whatever the query or hash. */
export const sameApp = (candidate: string, base: string): boolean => {
  try {
    const a = new URL(candidate);
    const b = new URL(base);
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname;
  } catch { return false; }
};
