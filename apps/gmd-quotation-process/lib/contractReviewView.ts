import "server-only";
import { applyColumnFlags } from "@gmd/contract-review/server";
import { columnAccess } from "@gmd/contract-review/flags";
import { nBatchFilter } from "@gmd/contract-review/columns";
import { enabledTrees } from "@gmd/contract-review/tree";
import {
  CLEARANCE_STATUS_IDX,
  ITEM_CODE_IDX,
  applyPresence,
  buildCategoryOptions,
  computeFacet,
  computeView,
  sortRowIndexes,
  type ViewContext,
} from "@gmd/contract-review/view";
import type {
  ContractReviewData,
  ContractReviewViewQuery,
  ContractReviewViewResult,
} from "@gmd/contract-review/types";
import { getBomIdCategory, type BomIdCategory } from "@gmd/dashboard/lib/bomCategory";
import { cBatchFilter } from "@gmd/dashboard/lib/verify-bom-columns";
import { GET } from "@/app/api/contract-review/route";
import { getContractReviewFlags } from "@/lib/contract-review-flags";

// Contract Review holds ~4k rows x ~70 columns. Rather than ship them all to
// the browser and filter there, the page asks for one filtered, sorted page.
// The full dataset lives here, in memory, for a few seconds at a time, so
// paging / filtering / typing in a filter doesn't reload it from the database.

// Older than this, a request still gets the cached rows at once and a rebuild
// runs in the background (stale-while-revalidate), so paging never waits on the DB.
const CACHE_TTL_MS = 30_000;
const VIEW_CACHE_SIZE = 8;
const MAX_PAGE_SIZE = 1000;
const TIMING = !!process.env.CR_TIMING;
const DEFAULT_PAGE_SIZE = 25;

interface Dataset {
  data: ContractReviewData;
  bomIdOptions: Record<string, string[]>;
  itemImages: NonNullable<ContractReviewData["itemImages"]>;
  ctx: ViewContext;
  categoryOptions: Record<string, string[]>;
  /** Computed views by filter set; a page change reuses one instead of rescanning every row. */
  views: Map<string, ComputedView>;
}

interface ComputedView {
  view: ReturnType<typeof computeView>["view"];
  matchedIdx: number[];
  /** Presence-filtered and sorted row indexes, by sort key. */
  ordered: Map<string, number[]>;
}

let cache: { at: number; promise: Promise<Dataset> } | null = null;
let revalidating = false;

/** Drops the cached rows so the next request reloads from the database. */
export function invalidateContractReviewCache() {
  cache = null;
}

async function buildDataset(): Promise<Dataset> {
  const flags = await getContractReviewFlags();
  const res = await GET();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  const raw = body as ContractReviewData;
  const data = applyColumnFlags(raw, flags);
  // applyColumnFlags drops BOM options when BOM ID is disabled; images are only
  // ever keyed by item code so they pass through untouched.
  const bomIdOptions = data.bomIdOptions ?? {};
  const itemImages = data.itemImages ?? {};

  const bomCategoryByRow = new WeakMap<unknown[], BomIdCategory>();
  data.rows.forEach((row, i) => {
    const id = data.ids[i];
    if (id) bomCategoryByRow.set(row, getBomIdCategory(bomIdOptions[id]));
  });

  const { isEnabled } = columnAccess(flags);
  const ctx: ViewContext = {
    headers: data.headers,
    rows: data.rows,
    bomCategoryByRow,
    trees: enabledTrees(isEnabled),
    batchPresenceFilters: [
      ...(isEnabled("C BATCH") ? [cBatchFilter()] : []),
      ...(isEnabled("N BATCH") ? [nBatchFilter()] : []),
    ],
    hasImage: (code) => (itemImages[code]?.length ?? 0) > 0,
  };
  return {
    data,
    bomIdOptions,
    itemImages,
    ctx,
    categoryOptions: buildCategoryOptions(data.rows, CLEARANCE_STATUS_IDX),
    views: new Map(),
  };
}

export function getContractReviewDataset(fresh = false): Promise<Dataset> {
  const now = Date.now();
  if (!fresh && cache) {
    if (now - cache.at >= CACHE_TTL_MS && !revalidating) {
      // Serve what we have; swap in a new copy once it has loaded.
      revalidating = true;
      const stale = cache;
      buildDataset()
        .then((next) => {
          // Skip if a fresher load (or an invalidation) replaced the cache meanwhile.
          if (cache === stale) cache = { at: Date.now(), promise: Promise.resolve(next) };
        })
        .catch((error) => console.error("contract review revalidate failed", error))
        .finally(() => {
          revalidating = false;
        });
    }
    return cache.promise;
  }
  const promise = buildDataset();
  const entry = { at: now, promise };
  cache = entry;
  // A failed load must not be served from cache.
  promise.catch(() => {
    if (cache === entry) cache = null;
  });
  return promise;
}

/** Client input is untrusted: fill in anything missing so the pipeline can't throw. */
function normalizeQuery(q: ContractReviewViewQuery): ContractReviewViewQuery {
  return {
    columnFilters: q?.columnFilters ?? {},
    multiFilters: q?.multiFilters ?? {},
    batchFilters: q?.batchFilters ?? {},
    dateRanges: q?.dateRanges ?? {},
    globalSearch: q?.globalSearch ?? "",
    balBillFilter: q?.balBillFilter ?? "all",
    statusFilter: q?.statusFilter ?? "all",
    tileItems: q?.tileItems ?? [],
    tileSize: q?.tileSize ?? "",
    activeRateTile: q?.activeRateTile ?? null,
    presence: {
      drawing: !!q?.presence?.drawing,
      image: !!q?.presence?.image,
    },
    sort: q?.sort ?? null,
    page: Number.isFinite(q?.page) ? q.page : 1,
    pageSize: Number.isFinite(q?.pageSize) ? q.pageSize : DEFAULT_PAGE_SIZE,
  };
}

/**
 * The view for these filters plus the row order for this sort. Both are cached
 * on the dataset, so changing only the page (or going back to a recent filter
 * set) costs a slice, not a scan of every row.
 */
function resolveView(ds: Dataset, query: ContractReviewViewQuery) {
  // Everything that affects the filtered set, nothing that only orders / pages it.
  const { sort, page: _page, pageSize: _pageSize, ...filters } = query;
  void _page;
  void _pageSize;
  const filterKey = JSON.stringify(filters);
  let entry = ds.views.get(filterKey);
  if (entry) {
    // Refresh recency (Map keeps insertion order).
    ds.views.delete(filterKey);
  } else {
    const { view, matchedIdx } = computeView(ds.ctx, query);
    entry = { view, matchedIdx, ordered: new Map() };
    if (ds.views.size >= VIEW_CACHE_SIZE)
      ds.views.delete(ds.views.keys().next().value as string);
  }
  ds.views.set(filterKey, entry);

  const sortKey = JSON.stringify(sort ?? null);
  let ordered = entry.ordered.get(sortKey);
  if (!ordered) {
    const shown = applyPresence(ds.ctx, entry.matchedIdx, query.presence);
    ordered = sortRowIndexes(ds.ctx.rows, shown, ds.ctx.headers, sort);
    entry.ordered.set(sortKey, ordered);
  }
  return { view: entry.view, ordered };
}

export async function buildContractReviewView(
  rawQuery: ContractReviewViewQuery,
  fresh = false,
): Promise<ContractReviewViewResult> {
  const t0 = TIMING ? performance.now() : 0;
  const ds = await getContractReviewDataset(fresh);
  const t1 = TIMING ? performance.now() : 0;
  const query = normalizeQuery(rawQuery);
  const { view, ordered } = resolveView(ds, query);
  const t2 = TIMING ? performance.now() : 0;

  const pageSize = Math.min(
    Math.max(1, Math.floor(query.pageSize)),
    MAX_PAGE_SIZE,
  );
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page)), pageCount);
  const slice = ordered.slice((page - 1) * pageSize, page * pageSize);

  const rows = slice.map((i) => ds.data.rows[i]);
  const ids = slice.map((i) => ds.data.ids[i]);

  const bomIdOptions: Record<string, string[]> = {};
  const diagramVerdicts: Record<string, string> = {};
  const itemImages: ContractReviewViewResult["itemImages"] = {};
  rows.forEach((row, n) => {
    const id = ids[n];
    bomIdOptions[id] = ds.bomIdOptions[id] ?? [];
    const verdict = ds.data.diagramVerdicts?.[id];
    if (verdict) diagramVerdicts[id] = verdict;
    const code = String(row[ITEM_CODE_IDX] ?? "");
    if (code && ds.itemImages[code]) itemImages[code] = ds.itemImages[code];
  });

  if (TIMING) {
    console.log(
      `[contract-review view] dataset ${(t1 - t0).toFixed(0)}ms, view+order ${(t2 - t1).toFixed(0)}ms, slice ${(performance.now() - t2).toFixed(0)}ms, rows ${ordered.length}, page ${page}`,
    );
  }
  return {
    headers: ds.data.headers,
    rows,
    ids,
    total: ordered.length,
    page,
    syncedAt: ds.data.syncedAt,
    view,
    categoryOptions: ds.categoryOptions,
    bomIdOptions,
    itemImages,
    diagramVerdicts,
  };
}

export async function buildContractReviewFacet(
  rawQuery: ContractReviewViewQuery,
  header: string,
): Promise<string[]> {
  const ds = await getContractReviewDataset();
  return computeFacet(ds.ctx, normalizeQuery(rawQuery), header);
}

export async function buildContractReviewAllRows(
  rawQuery: ContractReviewViewQuery,
): Promise<unknown[][]> {
  const ds = await getContractReviewDataset();
  const { ordered } = resolveView(ds, normalizeQuery(rawQuery));
  return ordered.map((i) => ds.data.rows[i]);
}
