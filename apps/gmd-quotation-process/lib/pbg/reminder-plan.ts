import { extractEmailsFromValue } from "@/lib/enquiryEmailParty";
import {
  groupByPartyRecipient,
  normalizePartyKey,
  normalizePoKey,
  parseRecipientEmails,
  recipientKey,
  type PartyRecipientGroup,
} from "@/lib/pbg/reminder-recipients";
import {
  isPostExpiryDue,
  isPreExpiryDue,
  POST_EXPIRY_INTERVAL_DAYS,
  type ReminderStage,
} from "@/lib/pbg/reminder-rules";
import type { ReminderEmailRow } from "@/lib/pbg/reminder-template";

export type PlannerRow = ReminderEmailRow & {
  id: string;
  daysUntilExpiry: number;
  contactPerson: string | null;
};

export type PlannerLog = {
  pbgId: string;
  stage: string;
  status: string;
  poNumber: string | null;
  recipientKey: string | null;
  emails: string;
  sentAt: Date;
  messageId?: string | null;
  pbgClientName?: string | null;
};

export type ExpiredReminderContext = {
  reminderNumber: number;
  earlierMailDates: string[];
};

export type PlannedTaskRow = ReminderEmailRow & {
  id: string;
  daysUntilExpiry: number;
};

export type PlannedTask = {
  stage: ReminderStage;
  partyName: string;
  partyKey: string;
  poNumbers: string[];
  recipientKey: string;
  emails: string[];
  onExpiryDate: boolean;
  lastSentAt: Date | null;
  nextDueAt: Date | null;
  reminderNumber?: number | null;
  earlierMailDates?: string[];
  rows: PlannedTaskRow[];
};

export type ReminderPlanResult = {
  tasks: PlannedTask[];
  skippedNoEmail: number;
  dueRows: number;
};

const DAY_MS = 86_400_000;

/** Per-BG state used by the one-time 30-day reminder. */
export function buildPreExpiryLogState(logs: PlannerLog[]): {
  sent: Set<string>;
  failed: Set<string>;
} {
  const sent = new Set<string>();
  const failed = new Set<string>();

  for (const log of logs) {
    if (log.stage !== "BEFORE_30_DAYS") continue;
    if (log.status === "SENT") sent.add(log.pbgId);
    else if (log.status === "FAILED") failed.add(log.pbgId);
  }

  return { sent, failed };
}

function logGroupKey(log: PlannerLog): string | null {
  const party = normalizePartyKey(log.pbgClientName);
  const prefix = party || normalizePoKey(log.poNumber);
  if (!prefix) return null;

  const rKey =
    log.recipientKey?.trim() ||
    recipientKey(extractEmailsFromValue(log.emails ?? ""));
  if (!rKey) return null;

  return `${prefix}|${rKey}`;
}

/** Latest successful EXPIRED send per party + recipient group. */
export function buildLastExpiredSentByGroup(
  logs: PlannerLog[],
): Map<string, Date> {
  const lastSent = new Map<string, Date>();

  for (const log of logs) {
    if (log.stage !== "EXPIRED" || log.status !== "SENT") continue;
    const key = logGroupKey(log);
    if (!key) continue;

    const current = lastSent.get(key);
    if (!current || log.sentAt > current) lastSent.set(key, log.sentAt);
  }

  return lastSent;
}

export function buildExpiredReminderContext(
  logs: PlannerLog[],
  partyName: string,
  emails: string[],
): ExpiredReminderContext {
  const party = normalizePartyKey(partyName);
  const recipients = recipientKey(emails);
  const groups = new Map<string, Date>();

  for (const log of logs) {
    if (log.stage !== "EXPIRED" || log.status !== "SENT") continue;
    if (normalizePartyKey(log.pbgClientName) !== party) continue;

    const logRecipients =
      log.recipientKey?.trim() ||
      recipientKey(extractEmailsFromValue(log.emails ?? ""));
    if (logRecipients !== recipients) continue;

    const key =
      String(log.messageId ?? "").trim() ||
      log.sentAt.toISOString().slice(0, 10);
    const current = groups.get(key);
    if (!current || log.sentAt < current) groups.set(key, log.sentAt);
  }

  const dates = Array.from(groups.values()).sort(
    (a, b) => a.getTime() - b.getTime(),
  );

  return {
    reminderNumber: Math.max(1, dates.length),
    earlierMailDates: dates.map((date) => date.toISOString().slice(0, 10)),
  };
}

function buildTask(
  stage: ReminderStage,
  group: PartyRecipientGroup<PlannerRow>,
  lastSentAt: Date | null,
  context?: ExpiredReminderContext | null,
): PlannedTask {
  const poNumbers = Array.from(
    new Set(
      group.rows
        .map((row) => String(row.poNumber ?? "").trim())
        .filter((value) => value !== ""),
    ),
  ).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  return {
    stage,
    partyName: group.partyName,
    partyKey: group.partyKey,
    poNumbers,
    recipientKey: group.recipientKey,
    emails: group.emails,
    onExpiryDate:
      stage === "EXPIRED" &&
      group.rows.every((row) => row.daysUntilExpiry === 0),
    lastSentAt,
    nextDueAt: lastSentAt
      ? new Date(lastSentAt.getTime() + POST_EXPIRY_INTERVAL_DAYS * DAY_MS)
      : null,
    reminderNumber: context?.reminderNumber ?? null,
    earlierMailDates: context?.earlierMailDates ?? [],
    rows: group.rows.map((row) => ({
      id: row.id,
      bgNo: row.bgNo,
      bgDate: row.bgDate,
      bgAmtFc: row.bgAmtFc,
      expiryDate: row.expiryDate,
      poNumber: row.poNumber,
      project: row.project,
      clientName: row.clientName,
      invoiceNos: row.invoiceNos,
      daysUntilExpiry: row.daysUntilExpiry,
    })),
  };
}

function countNoEmail(rows: PlannerRow[]): number {
  return rows.filter(
    (row) => parseRecipientEmails(row.contactPerson).length === 0,
  ).length;
}

export function planReminderTasks(input: {
  rows: PlannerRow[];
  preSent: Set<string>;
  preFailed: Set<string>;
  lastExpiredSent: Map<string, Date>;
  expiredLogs?: PlannerLog[];
  now: Date;
}): ReminderPlanResult {
  const preDue = input.rows.filter((row) =>
    isPreExpiryDue({
      days: row.daysUntilExpiry,
      hasSent: input.preSent.has(row.id),
      hasFailed: input.preFailed.has(row.id),
    }),
  );
  const preGroups = groupByPartyRecipient(
    preDue,
    (row) => row.clientName,
    (row) => row.contactPerson,
  );

  const expired = input.rows.filter((row) => row.daysUntilExpiry <= 0);
  const expiredGroups = groupByPartyRecipient(
    expired,
    (row) => row.clientName,
    (row) => row.contactPerson,
  );

  const tasks: PlannedTask[] = [];
  for (const group of preGroups.values()) {
    tasks.push(buildTask("BEFORE_30_DAYS", group, null));
  }

  for (const group of expiredGroups.values()) {
    const lastSent = input.lastExpiredSent.get(group.key) ?? null;
    if (
      !isPostExpiryDue(lastSent, input.now, POST_EXPIRY_INTERVAL_DAYS)
    ) {
      continue;
    }
    const context = buildExpiredReminderContext(
      input.expiredLogs ?? [],
      group.partyName,
      group.emails,
    );
    tasks.push(buildTask("EXPIRED", group, lastSent, context));
  }

  return {
    tasks,
    skippedNoEmail: countNoEmail(preDue) + countNoEmail(expired),
    dueRows: tasks.reduce((total, task) => total + task.rows.length, 0),
  };
}
