import type { TablePage, TableQuery } from "@gmd/ui/components/data-table/types";
import type { DebtorQueryExtra } from "./state/tableSlice";

export const BUCKETS = ["Not due", "0-30", "31-60", "61-90", "91-180", "180+"] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Row key of each ageing bucket. */
export const BUCKET_KEYS: Record<Bucket, string> = {
  "Not due": "bNotDue",
  "0-30": "b0_30",
  "31-60": "b31_60",
  "61-90": "b61_90",
  "91-180": "b91_180",
  "180+": "b180",
};

/** One party of the debtor ledger: ageing, MSME position, follow-up and legal case, all computed in SQL. */
export interface DebtorPartyRow {
  accCode: string;
  accName: string;
  totalDues: number;
  overdue: number;
  over90: number;
  bNotDue: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b91_180: number;
  b180: number;
  credits: number;
  net: number;
  bg: number;
  msmeStage: number | null;
  msmeDays: number | null;
  msmeInterest: number;
  msmeClaimable: number;
  promise: string | null;
  litigating: boolean;
  provision: number;
  carried: number;
  // Follow-up (party-level LedgerFollowUp row), as the strings the editors show.
  owner: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  lastFollowUp: string | null;
  promisedDate: string | null;
  promisedAmount: string | null;
  status: string | null;
  remarks: string | null;
  creditDays: string | null;
  clientType: string | null;
  udyamOnInvoice: string | null;
  nextActionDate: string | null;
  samadhaanNo: string | null;
  samadhaanStatus: string | null;
  // Legal case (PartyLegalCase).
  legalStatus: string | null;
  forum: string | null;
  caseNo: string | null;
  filingDate: string | null;
  nextHearingDate: string | null;
  advocate: string | null;
  claimAmount: string | null;
  interestClaimed: string | null;
  provisionPct: string | null;
  provisionAmount: string | null;
  documentLink: string | null;
  lastUpdate: string | null;
}

export interface DebtorPageMeta {
  /** Sums over every party matching the filters, not just this page. */
  totals: { totalDues: number; overdue: number; net: number; bg: number };
}

export interface DebtorSummary {
  /** Debtor ledger rows synced; 0 = nothing synced yet. */
  ledgerRows: number;
  syncedAt: string | null;
  totalDues: number;
  overdue: number;
  over90: number;
  credits: number;
  net: number;
  parties: number;
  buckets: Record<Bucket, number>;
  promised: { count: number; total: number };
  split: { gross: number; underLitigation: number; provision: number; netCollectable: number };
  stages: { stage: number; count: number; value: number }[];
  top10: { accCode: string; accName: string; overdue: number }[];
}

export interface DebtorBill {
  id: string;
  vrNo: string | null;
  vrDate: string | null;
  dueDate: string | null;
  orderNo: string | null;
  poRef: string | null;
  items: string | null;
  drAmt: number | null;
  drAllocAmt: number | null;
  bal: number;
  days: number | null;
  creditNote: string;
  /** Order copy / invoice / inspection / Drive: a URL renders as a link, anything else as text. */
  links: { label: string; value: string }[];
}

export interface FollowUpHistoryRow {
  changedAt: string | Date;
  owner: string | null;
  lastFollowUp: string | null;
  promisedDate: string | null;
  promisedAmount: string | null;
  nextActionDate: string | null;
  status: string | null;
  remarks: string | null;
}

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };
export type DebtorQuery = TableQuery & { extra?: Partial<DebtorQueryExtra> };
export type DebtorPageData = TablePage<DebtorPartyRow, DebtorPageMeta>;

/** Server Actions the host app passes in; the host owns auth. */
export interface DebtorsActions {
  loadPage: (query: TableQuery) => Promise<ActionResult<DebtorPageData>>;
  loadFacet: (field: string, query: TableQuery) => Promise<ActionResult<string[]>>;
  loadSummary: () => Promise<ActionResult<DebtorSummary>>;
  loadBills: (accCode: string, bucket: Bucket | null) => Promise<ActionResult<DebtorBill[]>>;
  loadHistory: (accCode: string) => Promise<ActionResult<FollowUpHistoryRow[]>>;
  /** Saves one follow-up or legal field of a party; the host validates. */
  saveField: (row: DebtorPartyRow, field: string, value: string) => Promise<ActionResult<null>>;
}
