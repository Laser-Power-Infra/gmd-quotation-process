export const SYNC_MAX_AGE_HOURS = 24;

// undefined = not loaded / not applicable (never stale); null or unparseable = never synced.
export function isSyncStale(
  syncedAt: string | Date | null | undefined,
  now = Date.now(),
  maxAgeHours = SYNC_MAX_AGE_HOURS,
): boolean {
  if (syncedAt === undefined) return false;
  if (syncedAt === null) return true;
  const t = new Date(syncedAt).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > maxAgeHours * 3_600_000;
}
