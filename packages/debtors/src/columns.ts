import type { ColumnKind, EditMode } from "@gmd/ui/components/data-table/types";
import { BUCKET_KEYS, BUCKETS } from "./types";

// Per-column rules of the Debtors table. The server reads key/kind/filter/sortable;
// the page adds the cell renderers and the legal status options.

export type ColumnGroup = "ageing" | "msme" | "followUp" | "legal";

export interface DebtorColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  group: ColumnGroup;
  filter?: boolean;
  sortable: boolean;
  edit?: EditMode;
  width?: number;
}

const money = (key: string, label: string): DebtorColumn => ({ key, label, kind: "number", group: "ageing", sortable: true, width: 120 });
const follow = (key: string, label: string, kind: ColumnKind = "text", filter = false): DebtorColumn => ({ key, label, kind, group: "followUp", sortable: true, edit: "text", filter, width: kind === "date" ? 130 : 150 });
const legal = (key: string, label: string, kind: ColumnKind = "text", filter = false): DebtorColumn => ({ key, label, kind, group: "legal", sortable: true, edit: "text", filter, width: kind === "date" ? 130 : 150 });

export const DEBTOR_COLUMNS: DebtorColumn[] = [
  { key: "accName", label: "Party", kind: "text", group: "ageing", sortable: true, width: 240 },
  money("totalDues", "Total dues"),
  money("overdue", "Overdue"),
  ...BUCKETS.map((b) => money(BUCKET_KEYS[b], b === "Not due" ? b : `${b} days`)),
  money("credits", "Unadjusted credit"),
  money("net", "Net (dues minus credits)"),
  money("bg", "BG exposure (open BGs)"),
  { key: "msmeStage", label: "Follow-up stage", kind: "number", group: "msme", sortable: true, filter: true, width: 110 },
  { key: "msmeDays", label: "Days past MSME due", kind: "number", group: "msme", sortable: true, width: 110 },
  { key: "msmeInterest", label: "MSME interest", kind: "number", group: "msme", sortable: true, width: 120 },
  { key: "msmeClaimable", label: "Claimable (dues + interest)", kind: "number", group: "msme", sortable: true, width: 130 },
  // shortcut: there is no receipts feed, so "paid" is inferred from dues still overdue after the promised date, upgrade when receipts are synced
  { key: "promise", label: "Promise vs paid", kind: "text", group: "msme", sortable: true, filter: true, width: 120 },
  { key: "provision", label: "Provision", kind: "number", group: "legal", sortable: true, width: 120 },
  { key: "carried", label: "Carried after provision", kind: "number", group: "legal", sortable: true, width: 130 },
  follow("owner", "Accounts owner", "text", true),
  follow("contactName", "Contact name"),
  follow("contactPhone", "Contact phone"),
  follow("contactEmail", "Contact email"),
  follow("lastFollowUp", "Last follow-up", "date", true),
  follow("promisedDate", "Promised date", "date", true),
  follow("promisedAmount", "Promised amount", "number"),
  follow("status", "Follow-up status", "text", true),
  follow("remarks", "Remarks"),
  follow("creditDays", "Agreed credit days", "number"),
  follow("clientType", "Client type", "text", true),
  follow("udyamOnInvoice", "Udyam on invoice", "text", true),
  follow("nextActionDate", "Next action date", "date", true),
  follow("samadhaanNo", "Samadhaan case no."),
  follow("samadhaanStatus", "Samadhaan status", "text", true),
  { ...legal("legalStatus", "Legal status", "text", true), edit: "select", width: 190 },
  legal("forum", "Forum", "text", true),
  legal("caseNo", "Case no."),
  legal("filingDate", "Filing date", "date", true),
  legal("nextHearingDate", "Next hearing", "date", true),
  legal("advocate", "Advocate", "text", true),
  legal("claimAmount", "Claim amount", "number"),
  legal("interestClaimed", "Interest claimed", "number"),
  legal("provisionPct", "Provision %", "number"),
  legal("provisionAmount", "Provision amount", "number"),
  legal("documentLink", "Document link"),
  legal("lastUpdate", "Legal last update"),
];

export const FOLLOW_UP_FIELDS = DEBTOR_COLUMNS.filter((c) => c.group === "followUp").map((c) => c.key);
/** Legal columns the user edits (provision / carried are computed). */
export const LEGAL_FIELDS = DEBTOR_COLUMNS.filter((c) => c.group === "legal" && c.edit).map((c) => c.key);
/** Shown only in the "Under litigation" view. */
export const LITIGATION_ONLY = new Set(["provision", "carried"]);
