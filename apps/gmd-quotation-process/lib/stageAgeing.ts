/**
 * Ageing (days since enquiry) and per-stage ownership for the dashboard tiles.
 * Pure helpers so the bucketing and stage→owner mapping are unit-testable.
 */

export const AGE_BUCKETS = ["0-2", "3-7", "8-15", "16+"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function ageBucket(days: number): AgeBucket {
  if (days <= 2) return "0-2";
  if (days <= 7) return "3-7";
  if (days <= 15) return "8-15";
  return "16+";
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const istDay = (d: Date) => Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);

/** Whole IST calendar days from `from` to `now` (the server runs UTC). */
export function istDaysSince(from: Date | string, now: Date = new Date()): number {
  return istDay(now) - istDay(new Date(from));
}

/** Which Enquiry column owns each open stage. "sent" (awaiting reply) has no owner. */
export const STAGE_ASSIGNEE_FIELD = {
  details: "detailsAssigneeId",
  cost: "costAssigneeId",
  validation: "validationAssigneeId",
  ready: "sendAssigneeId",
} as const;

export type AssigneeStage = keyof typeof STAGE_ASSIGNEE_FIELD;
export type AssigneeField = (typeof STAGE_ASSIGNEE_FIELD)[AssigneeStage];

export const ASSIGNEE_FIELDS = Object.values(STAGE_ASSIGNEE_FIELD) as AssigneeField[];

export const STAGE_ASSIGNEE_LABEL: Record<AssigneeStage, string> = {
  details: "Details",
  cost: "Cost",
  validation: "Validation",
  ready: "Send",
};
