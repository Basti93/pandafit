export const MIN_FTP_FRACTION = 0.3;
export const MAX_FTP_FRACTION = 1.5;
/** A request that is not a finite number never reaches the trainer: the base value (FTP) is used instead. */
export const clampTargetW = (requestedW: number, ftpW: number): number =>
  !Number.isFinite(requestedW) ? ftpW : Math.min(ftpW * MAX_FTP_FRACTION, Math.max(ftpW * MIN_FTP_FRACTION, requestedW));
