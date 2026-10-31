"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import SyncStaleBanner from "@gmd/dashboard/components/SyncStaleBanner";
import GMDUpdateTable, {
  type ServerTableMode,
} from "@gmd/dashboard/components/GMDUpdateTable";
import ErrorState from "@gmd/dashboard/components/ErrorState";
import GMDUpdateSkeleton from "@gmd/dashboard/components/skeletons/GMDUpdateSkeleton";
import { toast } from "sonner";
import { parseAndValidateProdOrderNumber } from "../lib/contractValidation";
import type { ContractReviewActions, ContractReviewData } from "../types";
import { columnAccess, type ContractReviewFlags, type SidebarSection } from "../flags";
import {
  CONTRACT_REVIEW_HEADER_TO_DB_FIELD,
  CONTRACT_REVIEW_HEADERS,
  CONTRACT_REVIEW_COLUMN_GROUPS,
  CONTRACT_REVIEW_COLUMN_WIDTHS,
  nBatchBadges,
  nBatchFilter,
} from "../lib/columns";
import { cBatchBadges, cBatchFilter } from "@gmd/dashboard/lib/verify-bom-columns";
import type { ContractReviewImage } from "@gmd/dashboard/lib/types";
import {
  getBomIdCategory,
  type BomIdCategory,
} from "@gmd/dashboard/lib/bomCategory";
import {
  ACTUATOR_IDX,
  BAL_BILL_AG_CONT_IDX,
  BOM_ID_IDX,
  CLEARANCE_STATUS_IDX,
  CONTRACT_NO_IDX,
  INSPECTION_IDX,
  ITEM_CODE_IDX,
  MC_IDX,
  NO_USE_IDX,
  OFFER_PENDING_DONE_IDX,
  ORDER_LIST_IDX,
  PENDING_ACTUATIONS_FILTER,
  PN_IDX,
  PROJECT_REFERENCE_IDX,
  RM_CODE_FOR_ACTUATOR_IDX,
  STATE_IDX,
  UTILITY_IDX,
  VA_PCT_FROM_COST_IDX,
  buildCategoryOptions,
  computeView,
  fmt,
  isActuatorItemRow,
  pathToColumnFilters,
  type BalBillFilter,
  type ContractReviewView,
  type RateTileKey,
  type SortSpec,
  type ViewQuery,
} from "../lib/view";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@gmd/ui/components/resizable";
import { useDefaultLayout } from "react-resizable-panels";
import { FlowDiagram } from "./graph_flow/FlowDiagram";
import {
  enabledTrees,
  flatten,
  pathTo,
  type FlowFilter,
} from "./graph_flow/tree";

const layoutStorage = {
  getItem: (key: string) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
};


const UPLOAD_DIAGRAM_COLUMN = "Upload Drawing";
const UPLOAD_DIAGRAM_IDX =
  CONTRACT_REVIEW_HEADERS.indexOf(UPLOAD_DIAGRAM_COLUMN);

const EMPTY_VIEW: ContractReviewView = {
  statusCounts: { all: 0 },
  statusOptions: [],
  clearanceCounts: { all: 0 },
  clearanceOptions: ["(Blank)"],
  mcCounts: { all: 0 },
  mcOptions: ["(Blank)"],
  inspectionCounts: { all: 0 },
  inspectionOptions: ["(Blank)"],
  itemOptions: [],
  sizeOptions: [],
  pnOptions: [],
  rateMcCont: { sum: 0, count: 0 },
  rateOrderQty: { sum: 0, count: 0 },
  rateBalBillCont: { sum: 0, count: 0 },
  rateBalDiQty: { sum: 0, count: 0 },
  rateBalMspQty: { sum: 0, count: 0 },
  balBillAgContTotal: { sum: 0, count: 0 },
  totalCostExcGst: { sum: 0, count: 0 },
  totalCostIncGst: { sum: 0, count: 0 },
  totalVaPct: { sum: 0, count: 0 },
  tileRowsCount: 0,
  contractCount: 0,
  tileAllCounts: { item: 0, itemBalBill: 0, size: 0, pn: 0 },
  graphCounts: {},
  graphValues: {},
  contractNoMeta: {},
};

const EDITABLE_COLUMN_CANDIDATES = [
  "DATE OF CONTRACT",
  "PO NO",
  "bom formula trial",
  "Item",
  "BOM ID",
  "CLEARANCE STATUS",
  "Actuator",
  "MC Received/Pending",
  "Inspection",
  "OFFER PENDING/DONE",
  "Remarks",
  "PN RATING",
  "LC/RTGS REF NO",
  "LC DATE/RTGS DATE",
  "LAST DATE OF SHIPMENT/DATE OF LC",
  "Issuing bank name",
  "PAYMENT TERMS",
  "PROD ORDER NO",
  "VA % FROM COST",
];

const FIXED_DROPDOWN_OPTIONS: Record<string, string[]> = {
  "MC Received/Pending": ["Received", "Pending"],
  Inspection: ["DONE", "PENDING"],
  "OFFER PENDING/DONE": ["DONE", "PENDING"],
  "PAYMENT TERMS": [
    "CREDIT 45",
    "CREDIT 30",
    "CREDIT 90",
    "CREDIT LC-30",
    "100% ADVANCE",
    "CREDIT LC-60",
    "CREDIT LC-90",
    "CREDIT 15",
    "CREDIT LC-45",
    "Credit 21",
    "PDC 45",
    "Credit 7",
    "CREDIT 60",
    "10 ADV, BAL DELIVERY",
    "20 ADV, BAL DELIVERY",
    "20 ADV, BAL BEFORE DELIVERY",
    "15 ADV, BAL BEFORE DELIVERY",
    "25 ADV, BAL BEFORE DELIVERY",
    "NA",
    "20 ADV, BAL 30 DAYS DELIVERY",
    "CREDIT LC-150",
    "AFTER GRN",
    "5 ADV, BAL LC 30",
  ],
};

const HIDDEN_COLUMNS = [
  "VA %",
  "CV",
  "C BATCH",
  "N BATCH",
  "COST FROM QUOTATION",
  "FREE STOCK",
  "FINAL REQ",
  // "MC QTY",
  "Balance mc",
  "PROD ORD QTY",
  "BALANCE TO PROD ORD",
  "BALANCE TO PROD ENT",
  // "DI QTY",
  "BAL DI QTY",
  "BAL MC VAL",
  "BAL PROD ORD VAL",
  "BAL TO PROD ORD ENT VAL",
  "BAL BILL AG CONT VAL",
  "BAL BILL AG MC VAL",
  "BAL DI VAL",
  "DI VAL",
  "ERP PARTY NAME FROM GMD SUPPLY HISTORY",
  "JOB Code",
  "BAL BILL AG MC",
  "ic qty",
  "bom formula trial",
  "BILLED QTY",
  "DI QTY",
  "MC QTY",
  "OFFER NUMBER",
  "INSPECTION NUMBER",
  "DI DATE",
  "STATUS",
];

export function ContractReviewPage({
  actions,
  flags,
}: {
  actions: ContractReviewActions;
  /** Per-app switches, resolved on the server by the host app. */
  flags: ContractReviewFlags;
}) {
  const { isEnabled, isEditable, showSection } = useMemo(() => columnAccess(flags), [flags]);
  const trees = useMemo(() => enabledTrees(isEnabled), [isEnabled]);
  const tileOn = (section: SidebarSection, columns: string[]) =>
    showSection(section) && columns.every(isEnabled);
  const batchPresenceFilters = useMemo(
    () => [
      ...(isEnabled("C BATCH") ? [cBatchFilter()] : []),
      ...(isEnabled("N BATCH") ? [nBatchFilter()] : []),
    ],
    [isEnabled],
  );
  const {
    updateContractReviewFieldAction,
    clearContractReviewDiagramAction,
    setContractReviewDiagramVerdictAction,
    backfillContractReviewOfferPendingDoneBatchAction,
    backfillContractReviewInspectionBatchAction,
    backfillContractReviewPnRatingBatchAction,
    backfillContractReviewClearanceMcPendingBatchAction,
    syncContractReviewEnquiryFieldsAllAction,
    syncContractReviewEnquiryFieldsBatchAction,
    syncContractReviewRmAvailAction,
    selectContractReviewBomIdAction,
    autoAssignContractReviewBomIdFromActuator,
    backfillContractReviewNoUseBatchAction,
    backfillContractReviewCostFromQuotationAction,
    getActuatorOptionsAction,
    saveActuatorWithRmCodeAction,
    recomputeIndentListingVersionsAction,
  } = actions;
  const {
    load,
    sync,
    createDiagramUploadAction,
    confirmDiagramUploadAction,
    loadView,
    loadFacet,
    loadAllRows,
    runBackfillsAction,
    backfillEndpoint,
  } = actions;
  // With a server view the browser only ever holds one page of rows; the
  // filters, sidebar aggregates and flow-diagram counts are computed server-side.
  const serverMode = !!loadView;

  // Browser uploads straight to S3 via a presigned PUT, so large PDFs never
  // pass through a Server Action body.
  const uploadContractReviewDiagramAction = async (id: string, file: File) => {
    const start = await createDiagramUploadAction(id, {
      name: file.name,
      type: file.type,
      size: file.size,
    });
    if (!start.success || !start.data) return start;
    const put = await fetch(start.data.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (!put.ok) return { success: false, error: `Upload failed (${put.status})` };
    return confirmDiagramUploadAction(id, start.data.key);
  };

  const [data, setData] = useState<ContractReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [enquirySyncing, setEnquirySyncing] = useState(false);
  const [rmAvailSyncing, setRmAvailSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [balBillFilter, setBalBillFilter] = useState<BalBillFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clearanceOpen, setClearanceOpen] = useState(false);
  const clearanceRef = useRef<HTMLDivElement>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const itemMenuRef = useRef<HTMLDivElement>(null);
  const [tileItems, setTileItems] = useState<string[]>([]);
  const [tileSize, setTileSize] = useState("");
  const [pnOpen, setPnOpen] = useState(false);
  const pnRef = useRef<HTMLDivElement>(null);
  const pnMenuRef = useRef<HTMLDivElement>(null);
  const [mcOpen, setMcOpen] = useState(false);
  const mcRef = useRef<HTMLDivElement>(null);
  const mcMenuRef = useRef<HTMLDivElement>(null);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const inspectionRef = useRef<HTMLDivElement>(null);
  const inspectionMenuRef = useRef<HTMLDivElement>(null);
  const [activeRateTile, setActiveRateTile] = useState<RateTileKey | null>(
    null,
  );
  const [bomIdOptionsById, setBomIdOptionsById] = useState<
    Record<string, string[]>
  >({});
  const [itemImagesByCode, setItemImagesByCode] = useState<
    Record<string, ContractReviewImage[]>
  >({});
  const [diagramVerdictsById, setDiagramVerdictsById] = useState<
    Record<string, string>
  >({});
  // Server-view state: the aggregates for the current filters, the table's sort
  // and a refresh flag so a background reload never blanks the table.
  const [serverView, setServerView] = useState<ContractReviewView | null>(null);
  const [serverCategoryOptions, setServerCategoryOptions] = useState<
    Record<string, string[]>
  >({});
  const [serverTotal, setServerTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dataEpoch, setDataEpoch] = useState(0);
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [presence, setPresence] = useState({ drawing: false, image: false });
  const [facets, setFacets] = useState<
    Record<string, { values: string[]; key: string }>
  >({});
  // The BOM ID column filter is a category filter (Blanks / Single / Dropdown)
  // derived from the number of candidate BOM ids, not from the cell text. GMDUpdateTable
  // applies that rule via its own category-aware branch; without a matching branch
  // here, matchesTableFilters would fall through to a plain text match and reject every
  // row. Keyed on the row object so no call site has to thread a row id through.
  const bomCategoryByRow = useMemo(() => {
    const map = new WeakMap<unknown[], BomIdCategory>();
    const rows = data?.rows;
    const ids = data?.ids;
    if (rows && ids) {
      rows.forEach((row, i) => {
        const id = ids[i];
        if (id) map.set(row, getBomIdCategory(bomIdOptionsById[id]));
      });
    }
    return map;
  }, [data, bomIdOptionsById]);
  const [actuatorOptions, setActuatorOptions] = useState<string[]>([]);
  // Stable identity so GMDUpdateTable's filter memo isn't invalidated every render.
  const actuatorExtraFilterOptions = useMemo(
    () => ({
      Actuator: [
        {
          value: PENDING_ACTUATIONS_FILTER,
          label: "Pending Actuations",
          match: (row: unknown[]) =>
            isActuatorItemRow(row) &&
            String(row[ACTUATOR_IDX] ?? "").trim() === "",
        },
      ],
    }),
    [],
  );
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [multiFilters, setMultiFilters] = useState<Record<string, string[]>>(
    {},
  );
  const [batchFilters, setBatchFilters] = useState<Record<string, boolean>>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [dateRanges, setDateRanges] = useState<
    Record<string, { from: string; to: string; blank?: boolean }>
  >({});
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [activePath, setActivePath] = useState<string[]>([]);

  const {
    defaultLayout: verticalLayout,
    onLayoutChanged: onVerticalLayoutChanged,
  } = useDefaultLayout({
    id: "contract-review-vertical",
    panelIds: ["graph", "table"],
    storage: layoutStorage,
  });

  const filterState = useMemo(
    () => ({
      columnFilters,
      multiFilters,
      batchFilters,
      dateRanges,
      globalSearch,
      currentPage,
      pageSize,
    }),
    [
      columnFilters,
      multiFilters,
      batchFilters,
      dateRanges,
      globalSearch,
      currentPage,
      pageSize,
    ],
  );

  const filterActions = useMemo(
    () => ({
      onColumnFilter: (header: string, value: string) =>
        setColumnFilters((prev) => ({ ...prev, [header]: value })),
      onMultiFilter: (header: string, values: string[]) =>
        setMultiFilters((prev) => {
          const next = { ...prev };
          if (values.length) next[header] = values;
          else delete next[header];
          return next;
        }),
      onBatchFilter: (key: string, value: boolean) =>
        setBatchFilters((prev) => {
          const next = { ...prev };
          if (value) next[key] = true;
          else delete next[key];
          return next;
        }),
      onDateRange: (header: string, from: string, to: string) =>
        setDateRanges((prev) => {
          const next = { ...prev };
          if (from || to) next[header] = { from, to };
          else delete next[header];
          return next;
        }),
      onDateBlank: (header: string, blank: boolean) =>
        setDateRanges((prev) => {
          const next = { ...prev };
          if (blank) next[header] = { from: "", to: "", blank: true };
          else if (next[header]) {
            const { from, to } = next[header];
            if (from || to) next[header] = { from, to };
            else delete next[header];
          }
          return next;
        }),
      onGlobalSearch: setGlobalSearch,
      onResetFilters: () => {
        setColumnFilters({});
        setMultiFilters({});
        setBatchFilters({});
        setGlobalSearch("");
        setDateRanges({});
        setActiveRateTile(null);
      },
      onPageChange: setCurrentPage,
      onPageSizeChange: setPageSize,
    }),
    [],
  );

  const viewQuery = useMemo<ViewQuery>(
    () => ({
      columnFilters,
      multiFilters,
      batchFilters,
      dateRanges,
      globalSearch,
      balBillFilter,
      statusFilter,
      tileItems,
      tileSize,
      activeRateTile,
      presence,
    }),
    [
      columnFilters,
      multiFilters,
      batchFilters,
      dateRanges,
      globalSearch,
      balBillFilter,
      statusFilter,
      tileItems,
      tileSize,
      activeRateTile,
      presence,
    ],
  );
  const serverQuery = useMemo(
    () => ({ ...viewQuery, sort, page: currentPage, pageSize }),
    [viewQuery, sort, currentPage, pageSize],
  );
  const serverQueryKey = useMemo(() => JSON.stringify(serverQuery), [serverQuery]);
  // Filters only (no sort / page): dropdown options depend on these alone.
  const facetKey = useMemo(
    () => `${dataEpoch}:${JSON.stringify(viewQuery)}`,
    [viewQuery, dataEpoch],
  );
  const serverQueryRef = useRef(serverQuery);
  useEffect(() => {
    serverQueryRef.current = serverQuery;
  }, [serverQuery]);
  const viewRequestRef = useRef(0);

  const loadServerView = useCallback(
    async (fresh = false) => {
      if (!loadView) return;
      const request = ++viewRequestRef.current;
      setRefreshing(true);
      try {
        const res = await loadView(serverQueryRef.current, { fresh });
        // A newer request superseded this one; drop the late response.
        if (request !== viewRequestRef.current) return;
        if (!res.success || !res.data)
          throw new Error(res.error ?? "Failed to load contract review");
        const r = res.data;
        setData({
          headers: r.headers,
          rows: r.rows,
          ids: r.ids,
          totalRows: r.total,
          syncedAt: r.syncedAt,
        });
        setServerView(r.view);
        setServerCategoryOptions(r.categoryOptions);
        setServerTotal(r.total);
        setBomIdOptionsById(r.bomIdOptions);
        setItemImagesByCode(r.itemImages);
        setDiagramVerdictsById(r.diagramVerdicts);
        // The server clamps an out-of-range page (e.g. filters shrank the result).
        if (r.page !== serverQueryRef.current.page) setCurrentPage(r.page);
        if (fresh) setDataEpoch((n) => n + 1);
        setError(null);
      } catch (err) {
        if (request !== viewRequestRef.current) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        toast.error(message);
      } finally {
        if (request === viewRequestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [loadView],
  );

  const legacyFetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await load();
      if (!res.success || !res.data) throw new Error(res.error ?? "Failed to load contract review");
      const json = res.data;
      setData(json);
      if (json.bomIdOptions) setBomIdOptionsById(json.bomIdOptions);
      setItemImagesByCode(json.itemImages ?? {});
      if (json.diagramVerdicts) setDiagramVerdictsById(json.diagramVerdicts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [load]);

  /** Reload after a sync / mutation: bypasses the server's row cache. */
  const fetchData = useCallback(
    () => (serverMode ? loadServerView(true) : legacyFetchData()),
    [serverMode, loadServerView, legacyFetchData],
  );

  const handleSync = useCallback(async () => {
    if (!sync) return;
    if (
      !confirm(
        "Sync CONTRACTS + DUMP from the sheet into Contract Review? This writes to ContractReview and runs the RM AVAIL / Enquiry side effects.",
      )
    )
      return;
    setSyncing(true);
    setError(null);
    const toastId = toast.loading("Syncing Contract Review from CONTRACTS + DUMP...");
    try {
      const res = await sync();
      if (!res.success) throw new Error(res.error ?? "Sync failed");
      const summary = res.data ?? {};
      const syncSummary = `Synced: ${summary.created ?? 0} created, ${summary.updated ?? 0} updated, ${summary.unchanged ?? 0} unchanged`;

      // Refresh the Indent Listing V1..V4 split, the RM codes and the Contract
      // Review COST CODE REF so an NRV / SLV code affected by this sync is
      // published without a separate trip to the Indent Listing page.
      const recompute = await recomputeIndentListingVersionsAction?.();
      const rm = recompute?.data?.rmCode;
      const costRef = recompute?.data?.costCodeRef;
      const recomputeDetail = !recompute
        ? ""
        : recompute.success
        ? ` | RM codes: ${rm?.resolved ?? 0} linked, ${rm?.ambiguous ?? 0} multi, ${rm?.unmatched ?? 0} unmatched | cost code ref: ${costRef?.resolved ?? 0} filled`
        : ` | recompute failed: ${recompute?.error ?? "unknown error"}`;

      // The sync itself succeeded; surface a recompute failure without
      // discarding the sync result.
      if (!recompute || recompute.success) {
        toast.success(`${syncSummary}${recomputeDetail}`, { id: toastId });
      } else {
        toast.warning(`${syncSummary}${recomputeDetail}`, { id: toastId });
      }
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      setSyncing(false);
    }
  }, [fetchData, sync, recomputeIndentListingVersionsAction]);

  const handleEnquirySync = useCallback(async () => {
    if (!syncContractReviewEnquiryFieldsAllAction) return;
    setEnquirySyncing(true);
    const toastId = toast.loading(
      "Syncing State / Utility / Project Reference from Enquiry...",
    );
    try {
      const res = await syncContractReviewEnquiryFieldsAllAction();
      if (res?.success) {
        toast.success(
          `Synced ${res.data?.changed ?? 0} Contract Review row(s) from Enquiry`,
          { id: toastId },
        );
        await fetchData();
      } else {
        toast.error(res?.error || "Sync failed", { id: toastId });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Sync failed",
        { id: toastId },
      );
    } finally {
      setEnquirySyncing(false);
    }
  }, [fetchData, syncContractReviewEnquiryFieldsAllAction]);

  const handleRmAvailSync = useCallback(async () => {
    if (!syncContractReviewRmAvailAction) return;
    setRmAvailSyncing(true);
    const toastId = toast.loading(
      "Syncing RM AVAIL from stock-phys / VerifyBom...",
    );
    try {
      const res = await syncContractReviewRmAvailAction();
      if (res?.success) {
        const indent = res.data?.indentRecompute;
        const indentDetail = indent
          ? ` | RM codes: ${indent.rmCode?.resolved ?? 0} linked, ${indent.rmCode?.unmatched ?? 0} unmatched | cost code ref: ${indent.costCodeRef?.resolved ?? 0} filled`
          : "";
        toast.success(
          `RM AVAIL synced: ${res.data?.rmAvailUpdated ?? 0} updated, ${res.data?.stockFilled ?? 0} stock filled, ${res.data?.physicalStockUpdated ?? 0} physical stock updated${indentDetail}`,
          { id: toastId },
        );
        await fetchData();
      } else {
        toast.error(res?.error || "Sync failed", { id: toastId });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Sync failed",
        { id: toastId },
      );
    } finally {
      setRmAvailSyncing(false);
    }
  }, [fetchData, syncContractReviewRmAvailAction]);

  // Legacy mode loads everything once; server mode loads a page whenever the
  // filters / sort / page change.
  useEffect(() => {
    if (!serverMode) legacyFetchData();
  }, [serverMode, legacyFetchData]);

  useEffect(() => {
    if (serverMode) void loadServerView(false);
  }, [serverMode, serverQueryKey, loadServerView]);

  // First page is on screen: now fill the derived columns server-side (they
  // persist), then reload once so the aggregates include them.
  const backfillStartedRef = useRef(false);
  useEffect(() => {
    if (
      !serverMode ||
      !serverView ||
      !(backfillEndpoint || runBackfillsAction) ||
      backfillStartedRef.current
    )
      return;
    backfillStartedRef.current = true;
    const run = backfillEndpoint
      ? () =>
          fetch(backfillEndpoint, { method: "POST" }).then(
            (r) => r.json() as ReturnType<NonNullable<typeof runBackfillsAction>>,
          )
      : runBackfillsAction!;
    run()
      .then((res) => {
        // `ran: false` = the server skipped it (ran moments ago): nothing new.
        if (res?.success && res.data?.ran !== false) void loadServerView(true);
      })
      .catch((err) => console.error("contract review backfill failed", err));
  }, [serverMode, serverView, runBackfillsAction, backfillEndpoint, loadServerView]);

  useEffect(() => {
    getActuatorOptionsAction?.().then((res) => {
      if (res.success && res.data) setActuatorOptions(res.data);
    });
  }, [getActuatorOptionsAction]);

  const headers = data?.headers ?? [];
  const balBillIdx = data ? headers.indexOf("BAL BILL AG CONT") : -1;
  const effectiveBalBillIdx =
    balBillIdx !== -1 ? balBillIdx : BAL_BILL_AG_CONT_IDX;
  const clearanceIdx = data ? headers.indexOf("CLEARANCE STATUS") : -1;

  // Dropdown options for a column come from the server, cascaded on every
  // active filter except the column's own; cached until the filters change.
  const facetsRef = useRef(facets);
  useEffect(() => {
    facetsRef.current = facets;
  }, [facets]);
  const requestFacet = useCallback(
    (header: string) => {
      if (!loadFacet || facetsRef.current[header]?.key === facetKey) return;
      const key = facetKey;
      loadFacet(serverQueryRef.current, header)
        .then((res) => {
          if (!res.success || !res.data) return;
          const values = res.data;
          setFacets((prev) => ({ ...prev, [header]: { values, key } }));
        })
        .catch(() => {
          /* keep the previous options */
        });
    },
    [loadFacet, facetKey],
  );
  const getFacetOptions = useCallback(
    (header: string) => facets[header]?.values ?? null,
    [facets],
  );
  const getAllRows = useCallback(async () => {
    if (!loadAllRows) return [];
    const res = await loadAllRows(serverQueryRef.current);
    if (!res.success || !res.data)
      throw new Error(res.error ?? "Failed to export rows");
    return res.data;
  }, [loadAllRows]);
  const handlePresenceChange = useCallback(
    (next: { drawing: boolean; image: boolean }) =>
      setPresence((prev) =>
        prev.drawing === next.drawing && prev.image === next.image ? prev : next,
      ),
    [],
  );
  const tableServerMode = useMemo<ServerTableMode | undefined>(() => {
    if (!serverMode) return undefined;
    return {
      total: serverTotal,
      page: currentPage,
      pageSize,
      refreshing,
      sort: sort
        ? { column: headers.indexOf(sort.header), direction: sort.direction }
        : null,
      onSortChange: (next) => {
        setSort(
          next && headers[next.column]
            ? { header: headers[next.column], direction: next.direction }
            : null,
        );
        setCurrentPage(1);
      },
      onPageChange: setCurrentPage,
      onPageSizeChange: setPageSize,
      getFacetOptions,
      requestFacet,
      getAllRows,
      onPresenceFiltersChange: handlePresenceChange,
    };
  }, [
    serverMode,
    serverTotal,
    currentPage,
    pageSize,
    refreshing,
    sort,
    headers,
    getFacetOptions,
    requestFacet,
    getAllRows,
    handlePresenceChange,
  ]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        clearanceRef.current &&
        !clearanceRef.current.contains(e.target as Node)
      ) {
        setClearanceOpen(false);
      }
      if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
        setItemOpen(false);
      }
      if (pnRef.current && !pnRef.current.contains(e.target as Node)) {
        setPnOpen(false);
      }
      if (mcRef.current && !mcRef.current.contains(e.target as Node)) {
        setMcOpen(false);
      }
      if (
        inspectionRef.current &&
        !inspectionRef.current.contains(e.target as Node)
      ) {
        setInspectionOpen(false);
      }
    }
    if (clearanceOpen || itemOpen || pnOpen || mcOpen || inspectionOpen)
      document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [clearanceOpen, itemOpen, pnOpen, mcOpen, inspectionOpen]);

  // Bring the dropdown popover fully into the sidebar's visible area on open,
  // so its scrollable list (including the last value) is reachable.
  useEffect(() => {
    if (itemOpen) itemMenuRef.current?.scrollIntoView({ block: "nearest" });
  }, [itemOpen]);
  useEffect(() => {
    if (pnOpen) pnMenuRef.current?.scrollIntoView({ block: "nearest" });
  }, [pnOpen]);
  useEffect(() => {
    if (mcOpen) mcMenuRef.current?.scrollIntoView({ block: "nearest" });
  }, [mcOpen]);
  useEffect(() => {
    if (inspectionOpen)
      inspectionMenuRef.current?.scrollIntoView({ block: "nearest" });
  }, [inspectionOpen]);

  // Single source of truth: sidebar CLEARANCE STATUS mirrors column multiFilters["CLEARANCE STATUS"]
  const clearanceFilter = multiFilters["CLEARANCE STATUS"] ?? [];

  // Single source of truth: sidebar PN RATING mirrors column multiFilters["PN RATING"] (clearance-style)
  const tilePns = multiFilters["PN RATING"] ?? [];

  // Single source of truth: sidebar MC RECEIVED/PENDING mirrors column multiFilters["MC Received/Pending"]
  const mcFilter = multiFilters["MC Received/Pending"] ?? [];

  // Single source of truth: sidebar INSPECTION mirrors column multiFilters["Inspection"]
  const inspectionFilter = multiFilters["Inspection"] ?? [];

  const handleSelectBomId = useCallback(
    (id: string, bomId: string | null) => {
      if (!selectContractReviewBomIdAction) return;
      toast.promise(selectContractReviewBomIdAction(id, bomId), {
        loading: "Saving BOM ID...",
        success: (res) => {
          if (res?.success) {
            setData((prev) => {
              if (!prev) return prev;
              const itemTypeIdx = headers.indexOf("ITEM TYPE");
              const rows = prev.rows.map((row, i) => {
                if (prev.ids[i] !== id) return row;
                const next = [...row];
                next[BOM_ID_IDX] = bomId ?? "";
                const itemTypeVal = res.data?.itemType;
                if (itemTypeVal !== undefined && itemTypeIdx !== -1) {
                  next[itemTypeIdx] = itemTypeVal;
                }
                const noUseVal = res.data?.noUse ?? "";
                if (NO_USE_IDX !== -1) {
                  next[NO_USE_IDX] = noUseVal;
                }
                return next;
              });
              return { ...prev, rows };
            });
            // Filters, counts and the sort position may all have moved.
            if (serverMode) void loadServerView(true);
            return "BOM ID saved";
          }
          return res?.error || "Failed to save BOM ID";
        },
        error: (err) => err || "Failed to save BOM ID",
      });
    },
    [headers, serverMode, loadServerView],
  );

  const handleCellUpdate = useCallback(
    async (id: string, colIndex: number, value: string) => {
      const header = headers[colIndex];
      if (!header) return;
      const field = CONTRACT_REVIEW_HEADER_TO_DB_FIELD[header];
      if (!field) return;
      if (header === "PROD ORDER NO") {
        const validated = parseAndValidateProdOrderNumber(value);
        if (!validated.isValid) {
          toast.error(validated.error || "Invalid production order number.");
          return;
        }
        value = validated.contracts.length > 0 ? validated.contracts[0] : "";
      }
      const toastId = toast.loading(`Updating ${header}...`);
      try {
        if (header === "Actuator" && saveActuatorWithRmCodeAction) {
          const res = await saveActuatorWithRmCodeAction(id, value || null);
          if (res?.success && res.data) {
            const d = res.data;
            setData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                rows: prev.rows.map((row, i) => {
                  if (prev.ids[i] !== id) return row;
                  const next = [...row];
                  if (ACTUATOR_IDX !== -1)
                    next[ACTUATOR_IDX] = d.actuator ?? "";
                  if (RM_CODE_FOR_ACTUATOR_IDX !== -1)
                    next[RM_CODE_FOR_ACTUATOR_IDX] = d.rmCodeForActuator ?? "";
                  return next;
                }),
              };
            });
            toast.success(`${header} updated`, { id: toastId });
            if (serverMode) void loadServerView(true);
          } else {
            toast.error(res?.error || `Failed to update ${header}`, {
              id: toastId,
            });
          }
          return;
        }
        const res = await updateContractReviewFieldAction(
          id,
          field,
          value || null,
        );
        if (res?.success) {
          setData((prev) => {
            if (!prev) return prev;
            const rows = prev.rows.map((row, i) => {
              if (prev.ids[i] !== id) return row;
              const next = [...row];
              next[colIndex] = value;
              return next;
            });
            return { ...prev, rows };
          });
          toast.success(`${header} updated`, { id: toastId });
          if (serverMode) void loadServerView(true);
        } else {
          toast.error(res?.error || `Failed to update ${header}`, {
            id: toastId,
          });
        }
      } catch (err: any) {
        toast.error(err?.message || `Failed to update ${header}`, {
          id: toastId,
        });
      }
    },
    [headers, serverMode, loadServerView],
  );

  const handleUploadDiagram = useCallback(
    async (id: string, file: File) => {
      const toastId = toast.loading("Uploading drawing...");
      try {
        const res = await uploadContractReviewDiagramAction(id, file);
        if (!res?.success) {
          toast.error(res?.error || "Failed to upload drawing.", { id: toastId });
          return;
        }
        if (UPLOAD_DIAGRAM_IDX !== -1) {
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              rows: prev.rows.map((row, i) => {
                if (prev.ids[i] !== id) return row;
                const next = [...row];
                next[UPLOAD_DIAGRAM_IDX] = res.data?.diagramUrl ?? "";
                return next;
              }),
            };
          });
        }
        setDiagramVerdictsById((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast.success("Drawing uploaded", { id: toastId });
        if (serverMode) void loadServerView(true);
      } catch (err: any) {
        toast.error(err?.message || "Failed to upload drawing.", { id: toastId });
      }
    },
    [serverMode, loadServerView],
  );

  const handleClearDiagram = useCallback(async (id: string) => {
    const toastId = toast.loading("Removing diagram...");
    try {
      const res = await clearContractReviewDiagramAction(id);
      if (!res?.success) {
        toast.error(res?.error || "Failed to remove diagram.", { id: toastId });
        return;
      }
      if (UPLOAD_DIAGRAM_IDX !== -1) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((row, i) => {
              if (prev.ids[i] !== id) return row;
              const next = [...row];
              next[UPLOAD_DIAGRAM_IDX] = "";
              return next;
            }),
          };
        });
      }
      setDiagramVerdictsById((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast.success("Diagram removed", { id: toastId });
      if (serverMode) void loadServerView(true);
    } catch (err: any) {
      toast.error(err?.message || "Failed to remove diagram.", { id: toastId });
    }
  }, [serverMode, loadServerView]);

  const handleSetDiagramVerdict = useCallback(
    async (id: string, verdict: string | null) => {
      const prevVerdict = diagramVerdictsById[id] ?? null;
      if (prevVerdict === verdict) return;
      setDiagramVerdictsById((prev) => {
        const next = { ...prev };
        if (verdict === null) delete next[id];
        else next[id] = verdict;
        return next;
      });
      try {
        const res = await setContractReviewDiagramVerdictAction(id, verdict);
        if (!res?.success) {
          setDiagramVerdictsById((prev) => {
            const next = { ...prev };
            if (prevVerdict === null) delete next[id];
            else next[id] = prevVerdict;
            return next;
          });
          toast.error(res?.error || "Failed to save diagram verdict.");
          return;
        }
      } catch (err: any) {
        setDiagramVerdictsById((prev) => {
          const next = { ...prev };
          if (prevVerdict === null) delete next[id];
          else next[id] = prevVerdict;
          return next;
        });
        toast.error(err?.message || "Failed to save diagram verdict.");
      }
    },
    [diagramVerdictsById],
  );

  // Backfill results arrive from many independent server calls. Collect their
  // row patches and apply them in one pass so the page re-renders (and every
  // data-derived memo recomputes) once per burst instead of once per backfill.
  // A patch returns a modified copy of the row, or null when it doesn't apply.
  const rowPatchQueueRef = useRef<((row: unknown[], id: string) => unknown[] | null)[]>([]);
  const rowPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRowPatch = useCallback(
    (patch: (row: unknown[], id: string) => unknown[] | null) => {
      rowPatchQueueRef.current.push(patch);
      if (rowPatchTimerRef.current) return;
      rowPatchTimerRef.current = setTimeout(() => {
        rowPatchTimerRef.current = null;
        const patches = rowPatchQueueRef.current;
        rowPatchQueueRef.current = [];
        if (!patches.length) return;
        setData((prev) => {
          if (!prev) return prev;
          let changed = false;
          const rows = prev.rows.map((row, i) => {
            let cur = row;
            for (const p of patches) {
              const out = p(cur, prev.ids[i]);
              if (out) cur = out;
            }
            if (cur !== row) changed = true;
            return cur;
          });
          return changed ? { ...prev, rows } : prev;
        });
      }, 100);
    },
    [],
  );

  const autoSavedBomIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (serverMode || !data || !selectContractReviewBomIdAction || !isEditable("BOM ID")) return;
    const pending: { id: string; bomId: string }[] = [];
    const pendingActuator: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoSavedBomIdsRef.current.has(id)) return;
      const options = bomIdOptionsById[id];
      if (!options || options.length === 0) return;
      if (options.length === 1) {
        if (String(row[BOM_ID_IDX] ?? "").trim() === options[0]) return;
        autoSavedBomIdsRef.current.add(id);
        pending.push({ id, bomId: options[0] });
        return;
      }
      const actuator =
        ACTUATOR_IDX !== -1 ? String(row[ACTUATOR_IDX] ?? "") : "";
      if (actuator.includes("@")) {
        autoSavedBomIdsRef.current.add(id);
        pendingActuator.push(id);
      }
    });
    const itemTypeIdx = headers.indexOf("ITEM TYPE");
    for (const { id, bomId } of pending) {
      selectContractReviewBomIdAction(id, bomId).then((res) => {
        if (!res?.success) return;
        queueRowPatch((row, rowId) => {
          if (rowId !== id) return null;
          const next = [...row];
          next[BOM_ID_IDX] = bomId;
          if (res.data?.itemType !== undefined && itemTypeIdx !== -1) {
            next[itemTypeIdx] = res.data.itemType;
          }
          if (NO_USE_IDX !== -1) {
            next[NO_USE_IDX] = res.data?.noUse ?? "";
          }
          return next;
        });
      });
    }
    if (pendingActuator.length > 0 && autoAssignContractReviewBomIdFromActuator) {
      autoAssignContractReviewBomIdFromActuator(pendingActuator).then((res) => {
        if (!res?.success) return;
        const map = new Map((res.data ?? []).map((d) => [d.id, d]));
        queueRowPatch((row, rowId) => {
          const d = map.get(rowId);
          if (!d) return null;
          const next = [...row];
          next[BOM_ID_IDX] = d.bomId;
          if (itemTypeIdx !== -1) next[itemTypeIdx] = d.itemType;
          if (NO_USE_IDX !== -1) next[NO_USE_IDX] = d.noUse ?? "";
          return next;
        });
      });
    }
  }, [data, bomIdOptionsById, headers, queueRowPatch]);

  const autoNoUseRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (serverMode || !data) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoNoUseRef.current.has(id)) return;
      if (String(row[BOM_ID_IDX] ?? "").trim() === "") return;
      autoNoUseRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length || !backfillContractReviewNoUseBatchAction || !isEnabled("RM AVAIL")) return;
    backfillContractReviewNoUseBatchAction(pending).then((res) => {
      if (!res?.success) return;
      const map = new Map((res.data ?? []).map((d) => [d.id, d.noUse ?? ""]));
      queueRowPatch((row, rowId) => {
        const v = map.get(rowId);
        if (v === undefined || NO_USE_IDX === -1) return null;
        const next = [...row];
        next[NO_USE_IDX] = v;
        return next;
      });
    });
  }, [data, headers, queueRowPatch]);

  const autoOrderListRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (serverMode || !data || ORDER_LIST_IDX === -1) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoOrderListRef.current.has(id)) return;
      autoOrderListRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length) return;
    // backfillContractReviewOrderListBatchAction(pending).then((res) => {
    //   if (!res?.success) return;
    //   setData((prev) => {
    //     if (!prev) return prev;
    //     const map = new Map(
    //       (res.data ?? []).map((d) => [d.id, (d.orderList ?? []).join(", ")]),
    //     );
    //     return {
    //       ...prev,
    //       rows: prev.rows.map((row, i) => {
    //         const v = map.get(prev.ids[i]);
    //         if (v === undefined || v === "") return row;
    //         const next = [...row];
    //         next[ORDER_LIST_IDX] = v;
    //         return next;
    //       }),
    //     };
    //   });
    // });
  }, [data, headers]);

  const autoCostFromQuotationRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (serverMode || !data || VA_PCT_FROM_COST_IDX === -1) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoCostFromQuotationRef.current.has(id)) return;
      if (String(row[CONTRACT_NO_IDX] ?? "").trim() === "") return;
      autoCostFromQuotationRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length || !backfillContractReviewCostFromQuotationAction || !isEnabled("VA % FROM COST")) return;
    backfillContractReviewCostFromQuotationAction(pending).then((res) => {
      if (!res?.success) return;
      const map = new Map(
        (res.data ?? []).map((d) => [d.id, d.vaPercentfromcost ?? ""]),
      );
      queueRowPatch((row, rowId) => {
        const v = map.get(rowId);
        if (v === undefined) return null;
        const next = [...row];
        next[VA_PCT_FROM_COST_IDX] = v;
        return next;
      });
    });
  }, [data, headers, queueRowPatch]);

  const autoEnquiryFieldsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (serverMode || !data) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoEnquiryFieldsRef.current.has(id)) return;
      autoEnquiryFieldsRef.current.add(id);
      pending.push(id);
    });
    if (
      !pending.length ||
      !syncContractReviewEnquiryFieldsBatchAction ||
      !["STATE", "UTILITY", "PROJECT REFERENCE"].some(isEnabled)
    )
      return;
    syncContractReviewEnquiryFieldsBatchAction(pending).then((res) => {
      if (!res?.success || !res.data) return;
      const map = new Map((res.data ?? []).map((d) => [d.id, d]));
      queueRowPatch((row, rowId) => {
        const v = map.get(rowId);
        if (!v) return null;
        const next = [...row];
        if (STATE_IDX !== -1) next[STATE_IDX] = v.state ?? "";
        if (UTILITY_IDX !== -1) next[UTILITY_IDX] = v.utility ?? "";
        if (PROJECT_REFERENCE_IDX !== -1)
          next[PROJECT_REFERENCE_IDX] = v.projectReference ?? "";
        return next;
      });
    });
  }, [data, headers, queueRowPatch]);

  // Auto-backfill OFFER PENDING/DONE for ALL rows, rewriting when different
  // (DONE iff itemCode + mcNo + offerNumber present, else PENDING).
  const autoOfferPendingDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (serverMode || !data) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoOfferPendingDoneRef.current.has(id)) return;
      autoOfferPendingDoneRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length || !isEnabled("OFFER PENDING/DONE")) return;
    backfillContractReviewOfferPendingDoneBatchAction(pending).then((res) => {
      if (!res?.success || !res.data) return;
      const map = new Map(
        (res.data ?? []).map((d) => [d.id, d.offerPendingDone]),
      );
      queueRowPatch((row, rowId) => {
        const v = map.get(rowId);
        if (v === undefined) return null;
        const next = [...row];
        if (OFFER_PENDING_DONE_IDX !== -1)
          next[OFFER_PENDING_DONE_IDX] = v ?? "";
        return next;
      });
    });
  }, [data, headers, queueRowPatch]);

  // Auto-backfill Inspection for ALL rows, rewriting when different
  // (DONE iff offerNumber + inspectionNumber both have a value, else PENDING).
  const autoInspectionRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (serverMode || !data) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoInspectionRef.current.has(id)) return;
      autoInspectionRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length || !isEnabled("Inspection")) return;
    backfillContractReviewInspectionBatchAction(pending).then((res) => {
      if (!res?.success || !res.data) return;
      const map = new Map((res.data ?? []).map((d) => [d.id, d.inspection]));
      queueRowPatch((row, rowId) => {
        const v = map.get(rowId);
        if (v === undefined) return null;
        const next = [...row];
        if (INSPECTION_IDX !== -1) next[INSPECTION_IDX] = v ?? "";
        return next;
      });
    });
  }, [data, headers, queueRowPatch]);

  // Auto-backfill CLEARANCE STATUS and MC Received/Pending for rows whose field
  // is blank: CLEARANCE STATUS → "PENDING", MC Received/Pending → "Pending".
  // Also normalises a mixed-case "Pending" clearance placeholder to "PENDING".
  // Populated values are left untouched. Rows are marked processed regardless so
  // a deliberate later clear is not re-defaulted.
  const autoClearanceMcPendingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (serverMode || !data) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoClearanceMcPendingRef.current.has(id)) return;
      autoClearanceMcPendingRef.current.add(id);
      const clearance =
        CLEARANCE_STATUS_IDX === -1
          ? ""
          : String(row[CLEARANCE_STATUS_IDX] ?? "").trim();
      const clearanceBlank = clearance === "";
      const clearanceNeedsNormalize =
        clearance !== "" &&
        clearance.toUpperCase() === "PENDING" &&
        clearance !== "PENDING";
      const mcBlank =
        MC_IDX === -1 || String(row[MC_IDX] ?? "").trim() === "";
      if (clearanceBlank || clearanceNeedsNormalize || mcBlank)
        pending.push(id);
    });
    if (!pending.length) return;
    backfillContractReviewClearanceMcPendingBatchAction(pending).then((res) => {
      if (!res?.success || !res.data) return;
      const map = new Map(res.data.map((d) => [d.id, d]));
      queueRowPatch((row, rowId) => {
        const v = map.get(rowId);
        if (!v) return null;
        const next = [...row];
        if (CLEARANCE_STATUS_IDX !== -1)
          next[CLEARANCE_STATUS_IDX] = v.clearanceStatus ?? "";
        if (MC_IDX !== -1) next[MC_IDX] = v.mcReceivedPending ?? "";
        return next;
      });
    });
  }, [data, headers, queueRowPatch]);

  // Auto-derive PN RATING from ITEM_NAME for ALL rows (server action applies the
  // exact-match-against-dropdown rule and only updates mismatches). Ref guard runs once per load.
  const autoPnRatingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (serverMode || !data) return;
    const pending: string[] = [];
    data.rows.forEach((row, i) => {
      const id = data.ids[i];
      if (!id || autoPnRatingRef.current.has(id)) return;
      autoPnRatingRef.current.add(id);
      pending.push(id);
    });
    if (!pending.length || !isEnabled("PN RATING")) return;
    backfillContractReviewPnRatingBatchAction(pending).then((res) => {
      if (!res?.success || !res.data) return;
      const map = new Map((res.data ?? []).map((d) => [d.id, d.pnRating]));
      queueRowPatch((row, rowId) => {
        const v = map.get(rowId);
        if (v === undefined) return null;
        const next = [...row];
        if (PN_IDX !== -1) next[PN_IDX] = v ?? "";
        return next;
      });
    });
  }, [data, headers, queueRowPatch]);

  // Everything the sidebar, flow diagram and table need for the current
  // filters comes from one computeView pass - in the browser (legacy) or on the
  // server (serverMode), through the same code.
  const legacyResult = useMemo(() => {
    if (serverMode || !data) return null;
    return computeView(
      {
        headers: data.headers,
        rows: data.rows,
        bomCategoryByRow,
        trees,
        batchPresenceFilters,
      },
      viewQuery,
      { wantVisible: true },
    );
  }, [serverMode, data, bomCategoryByRow, trees, batchPresenceFilters, viewQuery]);

  const view: ContractReviewView = serverMode
    ? (serverView ?? EMPTY_VIEW)
    : (legacyResult?.view ?? EMPTY_VIEW);
  const {
    statusCounts,
    statusOptions,
    clearanceCounts,
    clearanceOptions,
    mcCounts,
    mcOptions,
    inspectionCounts,
    inspectionOptions,
    itemOptions,
    sizeOptions,
    pnOptions,
    rateMcCont,
    rateOrderQty,
    rateBalBillCont,
    rateBalDiQty,
    rateBalMspQty,
    balBillAgContTotal,
    totalCostExcGst,
    totalCostIncGst,
    totalVaPct,
    tileRowsCount,
    contractCount,
    tileAllCounts,
    graphCounts,
    graphValues,
    contractNoMeta,
  } = view;

  const categoryOptions = useMemo<Record<string, string[]>>(() => {
    if (serverMode) return serverCategoryOptions;
    return data ? buildCategoryOptions(data.rows, clearanceIdx) : {};
  }, [serverMode, serverCategoryOptions, data, clearanceIdx]);

  const hasTileFilter =
    tileItems.length > 0 ||
    tileSize !== "" ||
    tilePns.length > 0 ||
    mcFilter.length > 0 ||
    inspectionFilter.length > 0;

  // Rows handed to the table. Server mode: the page is already filtered and
  // sorted. Legacy: the sidebar + rate-tile survivors; the table filters on.
  const visibleData = useMemo(() => {
    if (!data || serverMode || !legacyResult) return data;
    const idx = legacyResult.visibleIdx;
    if (idx.length === data.rows.length) return data;
    return {
      ...data,
      rows: idx.map((i) => data.rows[i]),
      ids: idx.map((i) => data.ids[i]),
      totalRows: idx.length,
    };
  }, [data, serverMode, legacyResult]);

  const handleGraphToggle = useCallback(
    (id: string) => {
      for (const { tree, scope } of trees) {
        const node = flatten(tree).find((n) => n.id === id);
        if (!node) continue;
        const path = pathTo(tree, id);
        const byCol = pathToColumnFilters(path, scope);
        if (activePath.includes(id)) {
          for (const col of Object.keys(byCol)) {
            filterActions.onMultiFilter(col, []);
          }
          if (byCol["STATUS"]) {
            setStatusFilter("all");
          }
          setActivePath([]);
        } else {
          for (const [col, values] of Object.entries(byCol)) {
            filterActions.onMultiFilter(col, values);
          }
          if (byCol["STATUS"]) {
            setStatusFilter(
              byCol["STATUS"].includes("(Blank)")
                ? "Blanks"
                : byCol["STATUS"][0],
            );
          }
          // Real node ids only: a tree-level scope is not a node, so it must
          // not appear in the highlighted path.
          setActivePath(path.map((p) => p.id));
        }
        return;
      }
    },
    [activePath, filterActions],
  );

  const fmtLakhs = (n: number) => `${(n / 100000).toFixed(1)} lakhs`;

  const columnOptionMeta = useMemo(
    () => ({
      "CONTRACT NO": Object.fromEntries(
        Object.entries(contractNoMeta).map(([cn, m]) => [
          cn,
          { count: m.count, sumLabel: fmtLakhs(m.sum), partyName: m.partyName },
        ]),
      ),
    }),
    [contractNoMeta],
  );

  const handleRateTileClick = useCallback((key: RateTileKey) => {
    setActiveRateTile((prev) => (prev === key ? null : key));
  }, []);

  // Props handed to GMDUpdateTable are kept referentially stable so its
  // filter/option memos only recompute when their real inputs change.
  const tableEditableColumns = useMemo(
    () =>
      EDITABLE_COLUMN_CANDIDATES.filter(
        (c) =>
          isEditable(c) &&
          (c !== "BOM ID" || !!selectContractReviewBomIdAction) &&
          (c !== "Actuator" || !!saveActuatorWithRmCodeAction),
      ),
    [isEditable, selectContractReviewBomIdAction, saveActuatorWithRmCodeAction],
  );
  const tableFilterOptionsOverride = useMemo(
    () => ({
      "CLEARANCE STATUS": clearanceOptions.filter((o) => o !== "(Blank)"),
      "PN RATING": pnOptions
        .map((o) => o.value)
        .filter((v) => v !== "(Blank)"),
      Item: itemOptions.map((o) => o.value),
      "MC Received/Pending": mcOptions.filter((o) => o !== "(Blank)"),
      Inspection: inspectionOptions.filter((o) => o !== "(Blank)"),
    }),
    [clearanceOptions, pnOptions, itemOptions, mcOptions, inspectionOptions],
  );
  const tableFixedDropdownOptions = useMemo(
    () => ({ ...FIXED_DROPDOWN_OPTIONS, Actuator: actuatorOptions }),
    [actuatorOptions],
  );
  const tableCellBadges = useMemo(
    () => [
      ...(isEnabled("C BATCH") ? cBatchBadges("ITEM_CODE") : []),
      ...(isEnabled("N BATCH") ? nBatchBadges("ITEM_CODE") : []),
    ],
    [isEnabled],
  );
  const tableHiddenColumns = useMemo(
    () => [...flags.disabledColumns, ...HIDDEN_COLUMNS],
    [flags.disabledColumns],
  );

  if (loading) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="CONTRACT REVIEW" totalRows={0} />
          <GMDUpdateSkeleton />
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex flex-col p-6 min-h-0">
          <GMDUpdateHeader title="CONTRACT REVIEW" totalRows={0} />
          <ErrorState message={error} onRetry={fetchData} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background overflow-hidden">
      <div className="flex-1 flex p-6 min-h-0 gap-4">
        <aside className="w-64 shrink-0 self-stretch min-h-0 max-h-full overflow-y-auto overscroll-contain bg-[#0a2540] dark:bg-card border border-[#1e3d59] dark:border-border rounded-lg shadow-sm p-4 flex flex-col gap-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent hover:scrollbar-thumb-white/30 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent pr-3">
          {sync && (
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center justify-center gap-1.5 bg-[#38ef7d]/10 dark:bg-emerald-500/10 hover:bg-[#38ef7d]/20 dark:hover:bg-emerald-500/20 border border-[#38ef7d]/40 dark:border-emerald-500/30 rounded px-3 py-2 text-[11px] font-semibold text-[#38ef7d] dark:text-emerald-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Sync CONTRACTS + DUMP from the sheet into Contract Review"
          >
            {syncing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {syncing ? "Syncing..." : "Sync Contract Review"}
          </button>
          )}
          {syncContractReviewRmAvailAction && (
          <button
            type="button"
            onClick={handleRmAvailSync}
            disabled={rmAvailSyncing}
            className="flex items-center justify-center gap-1.5 bg-[#38ef7d]/10 dark:bg-emerald-500/10 hover:bg-[#38ef7d]/20 dark:hover:bg-emerald-500/20 border border-[#38ef7d]/40 dark:border-emerald-500/30 rounded px-3 py-2 text-[11px] font-semibold text-[#38ef7d] dark:text-emerald-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh stock from stock-phys, recompute VerifyBom, update RM AVAIL and PHYSICAL STOCK"
          >
            {rmAvailSyncing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {rmAvailSyncing ? "Syncing RM AVAIL..." : "Sync RM AVAIL"}
          </button>
          )}
          {showSection("contractCount") && (<>
          <div className="border rounded-lg p-3 bg-white/5 border-white/10">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              NUMBER OF CONTRACTS
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {contractCount}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              of {tileRowsCount} rows
            </span>
          </div>
          </>)}
          {showSection("filters") && (<>
          <span className="text-xs font-bold uppercase tracking-wider text-white dark:text-foreground">
            Filters
          </span>
          {/* <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              BAL BILL AG CONT
            </span>
            <select
              value={balBillFilter}
              onChange={(e) =>
                setBalBillFilter(e.target.value as BalBillFilter)
              }
              className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="all">All ({balBillCounts.all})</option>
              <option value="yes">Yes (0) ({balBillCounts.yes})</option>
              <option value="no">No ({balBillCounts.no})</option>
            </select>
          </div> */}
          {isEnabled("STATUS") && (<>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              STATUS
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="all">All ({statusCounts.all})</option>
              {statusOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt} ({statusCounts[opt] ?? 0})
                </option>
              ))}
            </select>
          </div>
          </>)}
          {isEnabled("CLEARANCE STATUS") && (<>
          <div className="flex flex-col gap-1.5" ref={clearanceRef}>
            <span className="text-[11px] font-semibold text-white/60">
              CLEARANCE STATUS
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setClearanceOpen((v) => !v)}
                className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 text-left outline-none cursor-pointer flex items-center justify-between gap-1"
              >
                <span className="truncate">
                  {clearanceFilter.length === 0
                    ? `All (${clearanceCounts.all ?? 0})`
                    : `${clearanceFilter.length} selected`}
                </span>
                <span className="text-[10px] text-[#0a2540]/60 dark:text-muted-foreground shrink-0">
                  {clearanceOpen ? "▲" : "▼"}
                </span>
              </button>
              {clearanceOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded shadow-lg overflow-hidden">
                  <div className="flex justify-between items-center px-2 py-1.5 text-[10px] border-b border-border bg-muted/50">
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter("CLEARANCE STATUS", [
                          ...clearanceOptions,
                        ])
                      }
                      className="text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter("CLEARANCE STATUS", [])
                      }
                      className="text-red-600 dark:text-red-300 font-semibold hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto py-1">
                    {clearanceOptions.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-muted-foreground">
                        No options
                      </div>
                    ) : (
                      clearanceOptions.map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60 cursor-pointer text-[11px] text-[#0a2540] dark:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={clearanceFilter.includes(opt)}
                            onChange={() => {
                              filterActions.onMultiFilter(
                                "CLEARANCE STATUS",
                                clearanceFilter.includes(opt)
                                  ? clearanceFilter.filter((v) => v !== opt)
                                  : [...clearanceFilter, opt],
                              );
                            }}
                            className="accent-blue-600 shrink-0"
                          />
                          <span
                            className={`truncate flex-1 ${opt === "(Blank)" ? "italic text-muted-foreground" : ""}`}
                          >
                            {opt}
                          </span>
                          <span className="text-[10px] text-[#0a2540]/50 dark:text-muted-foreground shrink-0">
                            ({clearanceCounts[opt] ?? 0})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </>)}
          </>)}

          {showSection("breakdown") && (<>
          <span className="text-xs font-bold uppercase tracking-wider text-white dark:text-foreground mt-2">
            Breakdown
          </span>

          {isEnabled("Item") && (<>
          <div className="flex flex-col gap-1.5" ref={itemRef}>
            <span className="text-[11px] font-semibold text-white/60">
              Item
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setItemOpen((v) => !v)}
                className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 text-left outline-none cursor-pointer flex items-center justify-between gap-1"
              >
                <span className="truncate">
                  {tileItems.length === 0
                    ? `All (${fmt(tileAllCounts.itemBalBill)})`
                    : `${tileItems.length} selected`}
                </span>
                <span className="text-[10px] text-[#0a2540]/60 dark:text-muted-foreground shrink-0">
                  {itemOpen ? "▲" : "▼"}
                </span>
              </button>
              {itemOpen && (
                <div
                  ref={itemMenuRef}
                  className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded shadow-lg overflow-hidden"
                >
                  <div className="flex justify-between items-center px-2 py-1.5 text-[10px] border-b border-border bg-muted/50">
                    <button
                      type="button"
                      onClick={() =>
                        setTileItems(itemOptions.map((o) => o.value))
                      }
                      className="text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setTileItems([])}
                      className="text-red-600 dark:text-red-300 font-semibold hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto overscroll-contain py-1">
                    {itemOptions.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-muted-foreground">
                        No options
                      </div>
                    ) : (
                      itemOptions.map((o) => (
                        <label
                          key={o.value}
                          className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60 cursor-pointer text-[11px] text-[#0a2540] dark:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={tileItems.includes(o.value)}
                            onChange={() => {
                              setTileItems((prev) =>
                                prev.includes(o.value)
                                  ? prev.filter((v) => v !== o.value)
                                  : [...prev, o.value],
                              );
                            }}
                            className="accent-blue-600 shrink-0"
                          />
                          <span className="truncate flex-1">{o.value}</span>
                          <span className="text-[10px] text-[#0a2540]/60 dark:text-muted-foreground font-mono shrink-0">
                            ({fmt(o.sum ?? 0)})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </>)}

          {isEnabled("SIZE") && (<>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-white/60">
              Size
            </span>
            <select
              value={tileSize}
              onChange={(e) => setTileSize(e.target.value)}
              className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 outline-none cursor-pointer"
            >
              <option value="">All ({tileAllCounts.size})</option>
              {sizeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.count})
                </option>
              ))}
            </select>
          </div>
          </>)}

          {isEnabled("PN RATING") && (<>
          <div className="flex flex-col gap-1.5" ref={pnRef}>
            <span className="text-[11px] font-semibold text-white/60">
              PN Rating
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setPnOpen((v) => !v)}
                className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 text-left outline-none cursor-pointer flex items-center justify-between gap-1"
              >
                <span className="truncate">
                  {tilePns.length === 0
                    ? `All (${tileAllCounts.pn})`
                    : `${tilePns.length} selected`}
                </span>
                <span className="text-[10px] text-[#0a2540]/60 dark:text-muted-foreground shrink-0">
                  {pnOpen ? "▲" : "▼"}
                </span>
              </button>
              {pnOpen && (
                <div
                  ref={pnMenuRef}
                  className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded shadow-lg overflow-hidden"
                >
                  <div className="flex justify-between items-center px-2 py-1.5 text-[10px] border-b border-border bg-muted/50">
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter(
                          "PN RATING",
                          pnOptions.map((o) => o.value),
                        )
                      }
                      className="text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => filterActions.onMultiFilter("PN RATING", [])}
                      className="text-red-600 dark:text-red-300 font-semibold hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto overscroll-contain py-1">
                    {pnOptions.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-muted-foreground">
                        No options
                      </div>
                    ) : (
                      pnOptions.map((o) => (
                        <label
                          key={o.value}
                          className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60 cursor-pointer text-[11px] text-[#0a2540] dark:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={tilePns.includes(o.value)}
                            onChange={() => {
                              filterActions.onMultiFilter(
                                "PN RATING",
                                tilePns.includes(o.value)
                                  ? tilePns.filter((v) => v !== o.value)
                                  : [...tilePns, o.value],
                              );
                            }}
                            className="accent-blue-600 shrink-0"
                          />
                          <span className="truncate flex-1">{o.value}</span>
                          <span className="text-[10px] text-[#0a2540]/50 dark:text-muted-foreground shrink-0">
                            ({o.count})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </>)}
          {isEnabled("MC Received/Pending") && (<>
          <div className="flex flex-col gap-1.5" ref={mcRef}>
            <span className="text-[11px] font-semibold text-white/60">
              MC Received/Pending
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMcOpen((v) => !v)}
                className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 text-left outline-none cursor-pointer flex items-center justify-between gap-1"
              >
                <span className="truncate">
                  {mcFilter.length === 0
                    ? `All (${mcCounts.all ?? 0})`
                    : `${mcFilter.length} selected`}
                </span>
                <span className="text-[10px] text-[#0a2540]/60 dark:text-muted-foreground shrink-0">
                  {mcOpen ? "▲" : "▼"}
                </span>
              </button>
              {mcOpen && (
                <div
                  ref={mcMenuRef}
                  className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded shadow-lg overflow-hidden"
                >
                  <div className="flex justify-between items-center px-2 py-1.5 text-[10px] border-b border-border bg-muted/50">
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter(
                          "MC Received/Pending",
                          mcOptions.map((o) => o),
                        )
                      }
                      className="text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter("MC Received/Pending", [])
                      }
                      className="text-red-600 dark:text-red-300 font-semibold hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto overscroll-contain py-1">
                    {mcOptions.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-muted-foreground">
                        No options
                      </div>
                    ) : (
                      mcOptions.map((o) => (
                        <label
                          key={o}
                          className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60 cursor-pointer text-[11px] text-[#0a2540] dark:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={mcFilter.includes(o)}
                            onChange={() => {
                              filterActions.onMultiFilter(
                                "MC Received/Pending",
                                mcFilter.includes(o)
                                  ? mcFilter.filter((v) => v !== o)
                                  : [...mcFilter, o],
                              );
                            }}
                            className="accent-blue-600 shrink-0"
                          />
                          <span
                            className={`truncate flex-1 ${o === "(Blank)" ? "italic text-muted-foreground" : ""}`}
                          >
                            {o}
                          </span>
                          <span className="text-[10px] text-[#0a2540]/50 dark:text-muted-foreground shrink-0">
                            ({mcCounts[o] ?? 0})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </>)}
          {isEnabled("Inspection") && (<>
          <div className="flex flex-col gap-1.5" ref={inspectionRef}>
            <span className="text-[11px] font-semibold text-white/60">
              Inspection
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setInspectionOpen((v) => !v)}
                className="w-full text-xs border border-border rounded bg-background text-[#0a2540] dark:text-foreground px-2 py-1.5 text-left outline-none cursor-pointer flex items-center justify-between gap-1"
              >
                <span className="truncate">
                  {inspectionFilter.length === 0
                    ? `All (${inspectionCounts.all ?? 0})`
                    : `${inspectionFilter.length} selected`}
                </span>
                <span className="text-[10px] text-[#0a2540]/60 dark:text-muted-foreground shrink-0">
                  {inspectionOpen ? "▲" : "▼"}
                </span>
              </button>
              {inspectionOpen && (
                <div
                  ref={inspectionMenuRef}
                  className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded shadow-lg overflow-hidden"
                >
                  <div className="flex justify-between items-center px-2 py-1.5 text-[10px] border-b border-border bg-muted/50">
                    <button
                      type="button"
                      onClick={() =>
                        filterActions.onMultiFilter(
                          "Inspection",
                          inspectionOptions.map((o) => o),
                        )
                      }
                      className="text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => filterActions.onMultiFilter("Inspection", [])}
                      className="text-red-600 dark:text-red-300 font-semibold hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto overscroll-contain py-1">
                    {inspectionOptions.length === 0 ? (
                      <div className="px-2 py-2 text-[11px] text-muted-foreground">
                        No options
                      </div>
                    ) : (
                      inspectionOptions.map((o) => (
                        <label
                          key={o}
                          className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60 cursor-pointer text-[11px] text-[#0a2540] dark:text-foreground"
                        >
                          <input
                            type="checkbox"
                            checked={inspectionFilter.includes(o)}
                            onChange={() => {
                              filterActions.onMultiFilter(
                                "Inspection",
                                inspectionFilter.includes(o)
                                  ? inspectionFilter.filter((v) => v !== o)
                                  : [...inspectionFilter, o],
                              );
                            }}
                            className="accent-blue-600 shrink-0"
                          />
                          <span
                            className={`truncate flex-1 ${o === "(Blank)" ? "italic text-muted-foreground" : ""}`}
                          >
                            {o}
                          </span>
                          <span className="text-[10px] text-[#0a2540]/50 dark:text-muted-foreground shrink-0">
                            ({inspectionCounts[o] ?? 0})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          </>)}
          </>)}
          {tileOn("rateOrderQty", ["RATE","ORDER QTY"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("rateXOrderQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXOrderQty"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × ORDER QTY
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(rateOrderQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateOrderQty.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("rateBalBill", ["RATE","BAL BILL AG CONT"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("rateXBalBillAgCont")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXBalBillAgCont"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × BAL BILL AG CONT
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(rateBalBillCont.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalBillCont.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("quantity", ["BAL BILL AG CONT"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("balBillAgContSum")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "balBillAgContSum"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              QUANTITY
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(balBillAgContTotal.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {balBillAgContTotal.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("rateMcQty", ["RATE","MC QTY"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("rateXMcQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXMcQty"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × MC QTY
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(rateMcCont.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateMcCont.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("rateBalDiQty", ["RATE","DI QTY","BILLED QTY"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("rateXBalDiQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXBalDiQty"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × BAL DI QTY
            </span>
            <span className="block text-[10px] font-semibold text-white/40">
              (DI QTY - BILLED QTY)
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(rateBalDiQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalDiQty.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("rateBalMcQty", ["RATE","MC QTY","DI QTY"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("rateXBalMcQty")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "rateXBalMcQty"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              RATE × BAL MC QTY
            </span>
            <span className="block text-[10px] font-semibold text-white/40">
              (MC QTY - DI QTY)
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(rateBalMspQty.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {rateBalMspQty.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("totalCostExGst", ["COST FROM QUOTATION"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("totalCostExcGst")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "totalCostExcGst"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              TOTAL COST (EXC GST)
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(totalCostExcGst.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {totalCostExcGst.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("totalCostIncGst", ["COST FROM QUOTATION"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("totalCostIncGst")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "totalCostIncGst"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              TOTAL COST (INC GST)
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(totalCostIncGst.sum)}
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {totalCostIncGst.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}

          {tileOn("totalVaPct", ["VA % FROM COST"]) && (<>
          <button
            type="button"
            onClick={() => handleRateTileClick("totalVaPct")}
            className={`w-full text-left border rounded-lg p-3 transition-all cursor-pointer ${
              activeRateTile === "totalVaPct"
                ? "bg-white/10 border-[#38ef7d] dark:border-emerald-400/50"
                : "bg-white/5 border-white/10 hover:border-white/25"
            }`}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">
              TOTAL VA %
            </span>
            <span className="block text-lg font-bold text-white dark:text-foreground mt-1">
              {fmt(totalVaPct.sum)}%
            </span>
            <span className="block text-[10px] font-medium text-white/50 mt-0.5">
              {totalVaPct.count} rows of {tileRowsCount}
            </span>
          </button>
          </>)}
        </aside>
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* <GMDUpdateHeader
            title="CONTRACT REVIEW"
            totalRows={data?.totalRows ?? 0}
            syncedAt={data?.syncedAt ?? undefined}
            onSync={sync ? handleSync : undefined}
            syncing={syncing}
            actions={
              syncContractReviewEnquiryFieldsAllAction ? (<button
                type="button"
                onClick={handleEnquirySync}
                disabled={enquirySyncing}
                className="flex items-center gap-1.5 bg-[#38ef7d]/10 dark:bg-emerald-500/10 hover:bg-[#38ef7d]/20 dark:hover:bg-emerald-500/20 border border-[#38ef7d]/40 dark:border-emerald-500/30 rounded px-3 py-1.5 text-[11px] font-semibold text-[#38ef7d] dark:text-emerald-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Backfill State / Utility / Project Reference from Enquiry"
              >
                {enquirySyncing ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                {enquirySyncing ? "Syncing..." : "Sync Enquiry Fields"}
              </button>) : undefined
            }
          />
          {error && <div className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</div>} */}
          <SyncStaleBanner syncedAt={data ? data.syncedAt : undefined} />
          <ResizablePanelGroup
            orientation="vertical"
            id="contract-review-vertical"
            defaultLayout={verticalLayout}
            onLayoutChanged={onVerticalLayoutChanged}
            className="flex-1 min-h-0 "
          >
            {flags.flowDiagram && trees.length > 0 && (
            <>
            <ResizablePanel id="graph" defaultSize="20" minSize="12" maxSize="24">
              <div className="h-full overflow-hidden rounded-lg border border-[#1e3d59] dark:border-border bg-[#0a2540] dark:bg-card">
                <FlowDiagram
                  trees={trees}
                  counts={graphCounts}
                  values={graphValues}
                  activePath={activePath}
                  onToggle={handleGraphToggle}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle className="my-2 bg-border" />
            </>
            )}
            <ResizablePanel id="table" defaultSize="68" minSize="25">
              <GMDUpdateTable
                headers={headers}
                rows={visibleData?.rows ?? []}
                ids={visibleData?.ids ?? []}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                title="Contract Review"
                editable
                fullHeight
                editableColumns={tableEditableColumns}
                dropdownRowCondition={(header, row) =>
                  header !== "Actuator" || isActuatorItemRow(row)
                }
                extraFilterOptions={actuatorExtraFilterOptions}
                categoryOptions={categoryOptions}
                filterOptionsOverride={tableFilterOptionsOverride}
                fixedDropdownOptions={tableFixedDropdownOptions}
                onCellUpdate={handleCellUpdate}
                columnGroups={CONTRACT_REVIEW_COLUMN_GROUPS}
                sortByType
                multilineEditableColumns={["Remarks"]}
                defaultColumnWidths={CONTRACT_REVIEW_COLUMN_WIDTHS}
                cellBadges={tableCellBadges}
                batchFilterHeader={batchPresenceFilters.length ? "ITEM_CODE" : undefined}
                batchPresenceFilters={batchPresenceFilters.length ? batchPresenceFilters : undefined}
                allowExport={flags.excelExport}
                wrapCells
                attachmentColumn={isEnabled(UPLOAD_DIAGRAM_COLUMN) ? UPLOAD_DIAGRAM_COLUMN : undefined}
                attachmentAccept=".pdf,application/pdf"
                filterAttachmentColumn
                onUploadAttachment={isEditable(UPLOAD_DIAGRAM_COLUMN) ? handleUploadDiagram : undefined}
                onClearAttachment={isEditable(UPLOAD_DIAGRAM_COLUMN) ? handleClearDiagram : undefined}
                verdictColumn={UPLOAD_DIAGRAM_COLUMN}
                verdictsById={diagramVerdictsById}
                onSetVerdict={isEditable(UPLOAD_DIAGRAM_COLUMN) ? handleSetDiagramVerdict : undefined}
                externalFiltersActive={
                  hasTileFilter ||
                  balBillFilter !== "all" ||
                  statusFilter !== "all" ||
                  clearanceFilter.length > 0
                }
                filterState={filterState}
                filterActions={filterActions}
                serverMode={tableServerMode}
                columnOptionMeta={columnOptionMeta}
                imageButtonColumn={CONTRACT_REVIEW_HEADERS[ITEM_CODE_IDX]}
                itemImagesByCode={itemImagesByCode}
                linkedDrawingColumn={isEnabled(UPLOAD_DIAGRAM_COLUMN) ? UPLOAD_DIAGRAM_COLUMN : undefined}
                linkedFilesColumn={isEnabled("ORDER LIST") ? "ORDER LIST" : undefined}
                linkedFilesIconColumn="CONTRACT NO"
                bomIdOptionsById={bomIdOptionsById}
                onSelectBomId={selectContractReviewBomIdAction ? handleSelectBomId : undefined}
                bomIdCategoryFilter
                onReset={() => {
                  setTileItems([]);
                  setTileSize("");
                  setActiveRateTile(null);
                  setBalBillFilter("all");
                  setStatusFilter("all");
                  setActivePath([]);
                  // Grouped columns render their filters inside the collapsed
                  // parent header, so every child must be cleared here too.
                  for (const group of CONTRACT_REVIEW_COLUMN_GROUPS) {
                    for (const child of group.children) {
                      filterActions.onMultiFilter(child.header, []);
                    }
                  }
                  // Graph clicks filter on their own columns, several of which
                  // are hidden or have no sidebar control (OFFER NUMBER, RM
                  // AVAIL, INSPECTION NUMBER, DI DATE, BAL BILL AG CONT), so
                  // clear every column any tree node can filter on - otherwise
                  // Reset empties activePath but leaves the table filtered.
                  const graphColumns = new Set<string>();
                  for (const { tree } of trees) {
                    for (const node of flatten(tree)) {
                      if (
                        (CONTRACT_REVIEW_HEADERS as readonly string[]).includes(
                          node.filter.column,
                        )
                      )
                        graphColumns.add(node.filter.column);
                    }
                  }
                  for (const col of graphColumns) {
                    filterActions.onMultiFilter(col, []);
                  }
                  filterActions.onMultiFilter("PN RATING", []);
                }}
                hiddenColumns={tableHiddenColumns}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </main>
  );
}
