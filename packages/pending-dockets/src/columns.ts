import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";

// Pending Dockets: mails asking for a GMD docket that nobody has created yet. Every per-column rule
// (label, kind, filter, sort) lives here; the SQL accepts only these keys.
// Plain TS: imported by the SQL builder, the slice and the client page.

/** Where a thread's AI check stands. The host decides it (verdict, "please create docket" wording, queue). */
export const AI_CHECKS = ["Verified", "Verifying", "Not verified"] as const;
export type AiCheck = (typeof AI_CHECKS)[number];

/**
 * The pending set as the host's docket rules pick it (lib/docketPending in the quotation app). Those
 * rules are regexes over the mail text, so they run in the host; this package pages, sorts, filters
 * and counts the set in SQL.
 */
export interface PendingScope {
  rows: { id: number; ai: AiCheck }[];
  aiEnabled: boolean;
  aiMaxAttempts: number;
}

export interface PendingAttachment {
  name: string;
  /** Null when the file has no link (kept in the mail store only). */
  link: string | null;
}

/** One pending request; its fields are the column keys. */
export interface PendingDocketRow {
  id: string;
  /** ISO timestamp of the mail. */
  date: string | null;
  requester: string;
  email: string;
  /** "Team" (one of our own addresses) or "Client". */
  senderType: string;
  subject: string;
  /** GeM bid / tender id found in the subject; "" when none. */
  tenderRef: string;
  mailType: string;
  msgCount: number;
  /** "Yes" when the mail carries at least one file. */
  files: string;
  aiCheck: AiCheck;
  /** "1/3" while Verifying; why it is Not verified otherwise. */
  aiNote: string | null;
  /** Start of the first message of the thread. */
  snippet: string;
  attachments: PendingAttachment[];
}

export interface PendingDocketsMeta {
  /** Over every request the filters keep, counted in SQL. */
  kpi: { notVerified: number; verifying: number; withFiles: number };
  /** Every pending request, before any filter (the tab badge). */
  all: number;
  /** AI verdicts still to come, before any filter: the page polls while this is above 0. */
  aiPending: number;
  aiEnabled: boolean;
}
export type PendingDocketsPage = TablePage<PendingDocketRow, PendingDocketsMeta>;

/** The whole conversation, loaded when a row is opened. */
export interface PendingThread {
  /** Laser Entry answered on the thread. */
  replied: boolean;
  messages: { num: number; sender: string; body: string }[];
}

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth and the pending rules. */
export interface PendingDocketsActions {
  loadPage: (query: TableQuery) => Promise<Result<PendingDocketsPage>>;
  loadFacet: (key: string, query: TableQuery) => Promise<Result<string[]>>;
  loadThread: (id: string) => Promise<Result<PendingThread>>;
}

export const PENDING_COLUMNS: DataColumn<PendingDocketRow>[] = [
  { key: "date", label: "Received", kind: "date", filter: true, sortable: true, sticky: true, width: 150 },
  { key: "requester", label: "Requester", kind: "text", filter: true, sortable: true, sticky: true, width: 190 },
  { key: "senderType", label: "Team / client", kind: "text", filter: true, sortable: true, width: 120 },
  { key: "email", label: "Email", kind: "text", filter: true, sortable: true, width: 230 },
  { key: "subject", label: "Subject", kind: "text", filter: true, sortable: true, width: 340 },
  { key: "tenderRef", label: "Tender / GeM ref", kind: "text", filter: true, sortable: true, width: 170 },
  { key: "mailType", label: "Mail type", kind: "text", filter: true, sortable: true, width: 110 },
  { key: "msgCount", label: "Messages", kind: "number", sortable: true, align: "right", width: 100 },
  { key: "files", label: "Files", kind: "text", filter: true, sortable: true, width: 240 },
  { key: "aiCheck", label: "AI check", kind: "text", filter: true, sortable: true, width: 150 },
  { key: "snippet", label: "Request snippet", kind: "text", width: 380 },
];
