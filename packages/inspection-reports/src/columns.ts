import type { DataColumn, TablePage, TableQuery } from "@gmd/ui/components/data-table/types";

// Inspection Reports list: one row per inspection offer synced from the ERP dump, with its report.
// Every per-column rule (label, kind, filter, sort) lives here; the SQL accepts only these keys.
// Plain TS: imported by the SQL builder, the slice and the client page.

/** Report statuses in workflow order (mirrors REPORT_STATUSES of the app's lib/inspectionReport.ts). */
export const REPORT_STATUSES = ["draft", "readings_entered", "reviewed", "final"] as const;

/** Header fields and team member fields the checks need filled (mirror HEADER_FIELDS / TEAM_FIELDS there). */
export const HEADER_KEYS = [
  "client",
  "kindAttn",
  "reference",
  "projectName",
  "contractNo",
  "mcNo",
  "poNo",
  "contractDate",
  "offerNo",
  "offerDate",
  "inspectionNo",
  "inspectionDate",
  "jirDate",
  "utility",
  "state",
  "witness",
] as const;
export const TEAM_KEYS = ["agency", "name", "designation"] as const;

/** Values of the Checks filter; the cell shows passed / total. */
export const CHECKS_PASSED = "All passed";
export const CHECKS_FAILING = "Failing";

/** One offer. Text is trimmed and never null; report fields are blank / null when the offer has no report. */
export interface InspectionOfferRow {
  id: string;
  reportId: string | null;
  vrno: string;
  /** yyyy-mm-dd when readable, else the text as synced. */
  vrDate: string;
  contractVrno: string;
  contractNo: string;
  accCode: string;
  lines: number;
  /** "150 serials: S-0001 – S-0100 …"; "" when no serial is filled. */
  serials: string;
  /** "item: from – to" per item with a serial. */
  serialRanges: string[];
  /** Members joined with "; ". */
  team: string;
  /** "agency, name, designation" per member. */
  teamMembers: string[];
  status: string;
  /** CHECKS_PASSED / CHECKS_FAILING / "". */
  checks: string;
  checksPassed: number | null;
  checksTotal: number | null;
}

export type InspectionPageData = TablePage<InspectionOfferRow>;

type Result<T> = { success: true; data: T } | { success: false; error: string };

/** Server actions the host passes in; the host owns auth. */
export interface InspectionReportsActions {
  loadPage: (query: TableQuery) => Promise<Result<InspectionPageData>>;
  loadFacet: (key: string, query: TableQuery) => Promise<Result<string[]>>;
}

export const INSPECTION_COLUMNS: DataColumn<InspectionOfferRow>[] = [
  { key: "vrno", label: "Offer no.", kind: "text", filter: true, sortable: true, sticky: true, width: 130 },
  { key: "vrDate", label: "Offer date", kind: "date", filter: true, sortable: true, width: 130 },
  { key: "contractVrno", label: "MC no.", kind: "text", filter: true, sortable: true, width: 130 },
  { key: "contractNo", label: "Contract no.", kind: "text", filter: true, sortable: true, width: 150 },
  { key: "accCode", label: "Client code", kind: "text", filter: true, sortable: true, width: 140 },
  { key: "lines", label: "Lines", kind: "number", filter: true, sortable: true, align: "right", width: 110 },
  // Found through the search box, which also finds a serial inside a range.
  { key: "serials", label: "Serial nos.", kind: "text", width: 190 },
  // Filters by member; sorts and "contains" by the joined text.
  { key: "team", label: "Inspecting team", kind: "text", filter: true, sortable: true, width: 210 },
  // Sorts in workflow order.
  { key: "status", label: "Report", kind: "text", filter: true, sortable: true, width: 140 },
  // Filters by all passed / failing; sorts by the share passed.
  { key: "checks", label: "Checks", kind: "text", filter: true, sortable: true, align: "right", width: 120 },
];
