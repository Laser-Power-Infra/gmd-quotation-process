import type { EnquiryData, FiltersState } from "./types";
import { initialFiltersState } from "./filtersSlice";
import { PENDING_CLOSURE_STATUS } from "./closureStatus";

/** Sort requested by the table header. `null` = newest first, like today. */
export type EnquirySort = { field: string; direction: "asc" | "desc" } | null;

/**
 * Everything the quotation dashboard needs to load one page of enquiries.
 * `filters` is the same serializable object the client already keeps.
 */
export interface EnquiryQuery {
  filters: FiltersState;
  globalSearch: string;
  projectReference: string;
  pendingOnly: boolean;
  /** Only dockets with a blank Contact person, Email, Phone or Utility. */
  contactMissingOnly: boolean;
  closedBomOnly: boolean;
  incompleteOnly: boolean;
  /** Only items with a cost sanity warning (lib/costSanity.ts). */
  costWarningOnly: boolean;
  /** Status-tile filter; "" = all stages. */
  stage: EnquiryStage;
  selectedEnquiryIds: string[];
  sort: EnquirySort;
  page: number;
  pageSize: number;
}

export type EnquiryStage = "" | "details" | "cost" | "validation" | "ready" | "sent";

export interface ClosureCounts {
  [status: string]: number;
}

export interface EnquirySummary {
  filteredEnquiries: number;
  analyticsItems: number;
  totalValueGst: number;
  totalValueExclGst: number;
  totalCost: number;
  totalQuantity: number;
  closureCounts: ClosureCounts;
  notSentCount: number;
  totalEnquiries: number;
  stageCounts: Record<string, number>;
  /** stage → age bucket (days since enquiry) → docket count. */
  stageAgeing: Record<string, Record<string, number>>;
  /** Open dockets per owner of their current stage; userId null = unassigned. */
  assigneePending: { userId: string | null; name: string; stage: string; count: number }[];
  /** Sidebar field → value → docket count over the full filtered set (own filter skipped). */
  facetCounts: Record<string, Record<string, number>>;
}

export interface EnquiryPageResult {
  enquiries: EnquiryData[];
  total: number;
  /** Null when the request only paged/sorted; the previous totals still stand. */
  summary: EnquirySummary | null;
}

export const EMPTY_ENQUIRY_SUMMARY: EnquirySummary = {
  filteredEnquiries: 0,
  analyticsItems: 0,
  totalValueGst: 0,
  totalValueExclGst: 0,
  totalCost: 0,
  totalQuantity: 0,
  closureCounts: {},
  notSentCount: 0,
  totalEnquiries: 0,
  stageCounts: {},
  stageAgeing: {},
  assigneePending: [],
  facetCounts: {},
};

export interface EnquiryFacetResult {
  field: string;
  options: string[];
}

export interface FilteredIds {
  enquiryIds: string[];
  itemIds: string[];
}

export function emptyEnquiryQuery(): EnquiryQuery {
  return {
    filters: initialFiltersState,
    globalSearch: "",
    projectReference: "",
    pendingOnly: false,
    contactMissingOnly: false,
    closedBomOnly: false,
    incompleteOnly: false,
    costWarningOnly: false,
    stage: "",
    selectedEnquiryIds: [],
    sort: null,
    page: 1,
    pageSize: 25,
  };
}

/** Stable key so the page only reloads when something the server cares about changed. */export function enquiryQueryKey(q: EnquiryQuery): string {
  return JSON.stringify({
    filters: Object.entries(q.filters)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, v]),
    globalSearch: q.globalSearch,
    projectReference: q.projectReference,
    pendingOnly: q.pendingOnly,
    contactMissingOnly: q.contactMissingOnly,
    closedBomOnly: q.closedBomOnly,
    incompleteOnly: q.incompleteOnly,
    costWarningOnly: q.costWarningOnly,
    stage: q.stage,
    selectedEnquiryIds: [...q.selectedEnquiryIds].sort(),
    sort: q.sort,
    page: q.page,
    pageSize: q.pageSize,
  });
}

/**
 * The blank contact fields of a docket whose offer has not gone out yet (closure
 * blank or Pending); [] once it is Sent, Not Sent ("-" is its legacy form), Rejected or anything else.
 * The row badge for `contactMissingOnly`; the SQL twin is in lib/enquiry-query.ts.
 */
export function missingContactFields(
  e: Pick<EnquiryData, "closureStatus" | "contactPerson" | "senderEmail" | "contactNo" | "utility">,
): string[] {
  const closure = (e.closureStatus ?? "").trim().toLowerCase();
  if (closure && closure !== PENDING_CLOSURE_STATUS.toLowerCase()) return [];
  const fields = [
    ["Contact person", e.contactPerson],
    ["Email", e.senderEmail],
    ["Phone", e.contactNo],
    ["Utility", e.utility],
  ] as const;
  return fields.filter(([, value]) => !value?.trim() || value.trim() === "-").map(([label]) => label);
}

/** Facet options only depend on the filters, never on the page or the sort. */
export function enquiryFilterKey(q: EnquiryQuery): string {
  return enquiryQueryKey({ ...q, page: 1, pageSize: 0, sort: null });
}
