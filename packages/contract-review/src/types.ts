import type { ContractReviewImage } from "@gmd/dashboard/lib/types";
import type { ContractReviewView, SortSpec, ViewQuery } from "./lib/view";

/**
 * Loose on purpose: host apps return `{ success, data }` / `{ success, error }`
 * objects whose `data` shape is read field-by-field by the page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActionResult<T = any> = { success: boolean; data?: T; error?: string };

/** Per-row field values written by a batch action. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RowPatch = { id: string } & Record<string, any>;
type BatchAction = (ids: string[]) => Promise<ActionResult<RowPatch[]>>;

export interface ContractReviewData {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  totalRows: number;
  syncedAt: string | null;
  bomIdOptions?: Record<string, string[]>;
  itemImages?: Record<string, ContractReviewImage[]>;
  diagramVerdicts?: Record<string, string>;
}

/** Filters + sort + paging the page sends to a server view. */
export interface ContractReviewViewQuery extends ViewQuery {
  sort: SortSpec | null;
  page: number;
  pageSize: number;
}

/** One page of rows plus the aggregates for the current filters. */
export interface ContractReviewViewResult {
  headers: string[];
  /** Only the rows of the requested page. */
  rows: unknown[][];
  ids: string[];
  /** Rows matching every filter, across all pages. */
  total: number;
  /** The page actually served (the request is clamped to the last page). */
  page: number;
  syncedAt: string | null;
  view: ContractReviewView;
  /** Distinct Item / CLEARANCE STATUS / PN RATING over the whole dataset. */
  categoryOptions: Record<string, string[]>;
  /** The three maps below only carry entries for the rows on this page. */
  bomIdOptions: Record<string, string[]>;
  itemImages: Record<string, ContractReviewImage[]>;
  diagramVerdicts: Record<string, string>;
}

export interface DiagramFileMeta {
  name: string;
  type: string;
  size: number;
}

/**
 * Server Actions the host app passes to <ContractReviewPage />. Each app owns
 * these (auth, logging, DB wiring); the page only calls them.
 *
 * Required actions only touch the ContractReview table. Optional ones need
 * extra data sources (quotation DB, Google Sheets); when an app leaves one out,
 * the page hides the matching UI and skips the matching auto-backfill.
 */
export interface ContractReviewActions {
  load: () => Promise<ActionResult<ContractReviewData>>;
  updateContractReviewFieldAction: (
    id: string,
    field: string,
    value: string | null,
  ) => Promise<ActionResult>;
  createDiagramUploadAction: (
    id: string,
    file: DiagramFileMeta,
  ) => Promise<ActionResult<{ uploadUrl: string; key: string }>>;
  confirmDiagramUploadAction: (id: string, key: string) => Promise<ActionResult>;
  clearContractReviewDiagramAction: (id: string) => Promise<ActionResult>;
  setContractReviewDiagramVerdictAction: (
    id: string,
    verdict: string | null,
  ) => Promise<ActionResult>;
  backfillContractReviewOfferPendingDoneBatchAction: BatchAction;
  backfillContractReviewInspectionBatchAction: BatchAction;
  backfillContractReviewPnRatingBatchAction: BatchAction;
  backfillContractReviewClearanceMcPendingBatchAction: BatchAction;

  /**
   * Server view. When provided, the page stops loading every row: it asks the
   * server for one filtered, sorted page plus the sidebar / flow-diagram
   * aggregates, and the table runs in server mode. `fresh` bypasses the
   * server's row cache (after a mutation or sync).
   */
  loadView?: (
    query: ContractReviewViewQuery,
    opts?: { fresh?: boolean },
  ) => Promise<ActionResult<ContractReviewViewResult>>;
  /** Distinct values for one column's filter dropdown under the current filters. */
  loadFacet?: (
    query: ContractReviewViewQuery,
    header: string,
  ) => Promise<ActionResult<string[]>>;
  /** Every row matching the filters (Excel export). */
  loadAllRows?: (
    query: ContractReviewViewQuery,
  ) => Promise<ActionResult<unknown[][]>>;
  /**
   * Runs the derived-column backfills over every row on the server, once the
   * first page has painted. The page refreshes its view afterwards.
   */
  runBackfillsAction?: () => Promise<ActionResult>;
  /** Route to POST instead of calling runBackfillsAction, so it is not queued behind view requests. */
  backfillEndpoint?: string;

  sync?: () => Promise<ActionResult>;
  recomputeIndentListingVersionsAction?: () => Promise<ActionResult>;
  syncContractReviewEnquiryFieldsAllAction?: () => Promise<ActionResult>;
  syncContractReviewEnquiryFieldsBatchAction?: BatchAction;
  syncContractReviewRmAvailAction?: () => Promise<ActionResult>;
  selectContractReviewBomIdAction?: (id: string, bomId: string | null) => Promise<ActionResult>;
  autoAssignContractReviewBomIdFromActuator?: BatchAction;
  backfillContractReviewNoUseBatchAction?: BatchAction;
  backfillContractReviewCostFromQuotationAction?: BatchAction;
  getActuatorOptionsAction?: () => Promise<ActionResult>;
  saveActuatorWithRmCodeAction?: (id: string, value: string | null) => Promise<ActionResult>;
}
