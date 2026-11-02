/**
 * Expiry highlighting for the PBG grid.
 *
 * Expired guarantees are highlighted red and those expiring within
 * `EXPIRING_SOON_DAYS` are highlighted amber. The comparison is done on
 * date-only strings so it is independent of the server/client timezone.
 *
 * A guarantee that expires today (0 days left) counts as expired, matching the
 * reminder job's existing convention.
 */

import { normalizeStatus } from "@/lib/pbg/reminder-rules";

export const EXPIRING_SOON_DAYS = 30;

export type ExpiryHighlight = "expired" | "expiring" | null;

function toUtcDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const time = Date.UTC(+match[1], +match[2] - 1, +match[3]);
  return Number.isNaN(time) ? null : time;
}

/** Whole calendar days from `todayIso` to `expiryDate`; negative means past. */
export function daysBetweenDateOnly(
  expiryDate: string | null | undefined,
  todayIso: string,
): number | null {
  const expiry = toUtcDay(expiryDate);
  const today = toUtcDay(todayIso);
  if (expiry === null || today === null) return null;
  return Math.round((expiry - today) / 86_400_000);
}

export function isClosedStatus(status: string | null | undefined): boolean {
  const key = normalizeStatus(status);
  return key === "closed" || key === "close";
}

/**
 * Returns the highlight state for a guarantee, or null when it should not be
 * highlighted (blank/invalid date, closed status, or more than 30 days out).
 */
export function getExpiryHighlight(
  expiryDate: string | null | undefined,
  todayIso: string,
  status?: string | null,
): ExpiryHighlight {
  if (isClosedStatus(status)) return null;
  const days = daysBetweenDateOnly(expiryDate, todayIso);
  if (days === null) return null;
  if (days <= 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring";
  return null;
}
