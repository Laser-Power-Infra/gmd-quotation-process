export type ReminderStage = "BEFORE_30_DAYS" | "EXPIRED";

export const ELIGIBLE_STATUSES = ["open", "running", "expired"] as const;

export const PRE_EXPIRY_DAYS = 30;
export const POST_EXPIRY_INTERVAL_DAYS = 7;

export const REMINDER_STAGES: Record<ReminderStage, string> = {
  BEFORE_30_DAYS: "BEFORE_30_DAYS",
  EXPIRED: "EXPIRED",
};

export function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

/** OPEN, Running and Expired are eligible; CLOSED is never eligible. */
export function isEligibleStatus(status: string | null | undefined): boolean {
  return (ELIGIBLE_STATUSES as readonly string[]).includes(
    normalizeStatus(status),
  );
}

/** Only an explicit CONTINUE allows mail; HOLD, blank and unknown mean no. */
export function isMailTriggerContinue(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toUpperCase() === "CONTINUE";
}

/** Today's calendar date in India, formatted as YYYY-MM-DD. */
export function istDateOnly(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toUtcDay(value: string | Date): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
      ),
    );
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

/**
 * Whole calendar days from today (IST) to the BG expiry date. 0 means the BG
 * expires today, a positive number means it expires in the future.
 */
export function daysUntilExpiry(
  expiryDate: string | Date,
  now: Date = new Date(),
): number | null {
  const expiry = toUtcDay(expiryDate);
  const today = toUtcDay(istDateOnly(now));
  if (!expiry || !today) return null;
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

/**
 * The pre-expiry mail goes out exactly once, on day 30. If that attempt failed,
 * it is retried on later days while the BG is still unexpired so a transient
 * SMTP error does not silently drop the reminder.
 */
export function isPreExpiryDue(input: {
  days: number;
  hasSent: boolean;
  hasFailed: boolean;
}): boolean {
  if (input.hasSent) return false;
  if (input.days === PRE_EXPIRY_DAYS) return true;
  return input.hasFailed && input.days > 0 && input.days < PRE_EXPIRY_DAYS;
}

/**
 * Post-expiry reminders repeat every `intervalDays` days. A failed attempt does
 * not advance the clock because only successful sends are recorded as SENT.
 */
export function isPostExpiryDue(
  lastSentAt: Date | null | undefined,
  now: Date = new Date(),
  intervalDays: number = POST_EXPIRY_INTERVAL_DAYS,
): boolean {
  if (!lastSentAt) return true;
  const elapsed = now.getTime() - lastSentAt.getTime();
  return elapsed >= intervalDays * 86_400_000;
}

/** Human-readable number of days until expiry for the email body. */
export function describeDaysUntilExpiry(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  const past = Math.abs(days);
  return past === 1 ? "yesterday" : `${past} days ago`;
}
