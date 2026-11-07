export type GarminDay = {
  date: string; restingHrBpm: number | null; hrvMs: number | null; sleepS: number | null; deepS: number | null; remS: number | null; sleepScore: number | null;
  bodyBatteryMax: number | null; stressAvg: number | null; vo2max: number | null; steps: number | null; readinessScore: number | null; acuteLoad: number | null; recoveryHours: number | null;
  /** Moderate minutes plus twice the vigorous ones, as Garmin and the WHO count them. Old data has none. */
  intensityMin?: number | null;
};
export type GarminActivity = {
  id: string; startMs: number; sport: string; name: string | null; durationS: number; distanceM: number | null; avgHr: number | null; maxHr: number | null;
  avgPowerW: number | null; normPowerW: number | null; trainingLoad: number | null; aerobicEffect: number | null; fromBikeCoach: boolean;
};
export type GarminBody = { birthDate: string | null; sex: 'male' | 'female' | 'unknown'; heightCm: number | null; weightKg: number | null; ftpW: number | null; ftpStale: boolean; maxHrSeen: number | null };
export type GarminProgress = { activities: number; activitiesComplete: boolean; daysDone: number; daysTotal: number; filesDone: number; filesTotal: number };
export type GarminReadiness = { level: 'normal' | 'careful' | 'unknown'; reasons: string[] };
export type HealthPoint = { date: string; restingHrBpm: number | null; vo2max: number | null; sleepS: number | null; hrvMs: number | null; stressAvg: number | null; bodyBatteryMax: number | null; load: number | null };
export type HealthYear = { jahr: string; sport: string; anzahl: number; stunden: number };
export type GarminHealth = { points: HealthPoint[]; years: HealthYear[]; progress: GarminProgress; pulseBeforeRides: { hard: number; other: number; rides: number } | null;
  /** Start, duration and sport of the last 13 weeks, for the combined week view. */
  activities?: Pick<GarminActivity, 'id' | 'startMs' | 'durationS' | 'sport' | 'name' | 'fromBikeCoach'>[] };
