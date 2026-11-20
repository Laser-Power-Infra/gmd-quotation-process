import "server-only";
import { Prisma, prisma as tenderPrisma, type ContractReview } from "@gmd/db-tender";
import { BOM_ID_COLUMN } from "@gmd/dashboard/lib/bomCategory";
import {
  FLOW_HAS_VALUE,
  FLOW_NO_VALUE,
  FLOW_NON_ZERO,
  FLOW_ZERO,
} from "@gmd/dashboard/lib/flowFilter";
import { squish } from "@gmd/dashboard/lib/squish";
import type { ContractReviewImage } from "@gmd/dashboard/lib/types";
import { cBatchFilter } from "@gmd/dashboard/lib/verify-bom-columns";
import { ALLOCATION_HEADERS, incompleteFilter, nBatchFilter } from "../lib/columns";
import { CR_COLUMNS, crColumn, type CrColumn } from "../lib/crColumns";
import {
  EXTRA_ITEM_OPTION,
  PENDING_ACTUATIONS_FILTER,
  RM_CODE_PENDING_FILTER,
  SIDEBAR_EXCLUDE_BY_HEADER,
  UPLOAD_DRAWING_COLUMN,
  byNumericLocale,
  fmt,
  graphPathColumns,
  statusTitle,
  withBlankLast,
  type Aggregate,
  type ContractNoMeta,
  type ContractReviewView,
  type RateTileKey,
  type SidebarExclude,
  type SortSpec,
  type TileOption,
} from "../lib/view";
import { enabledTrees, type FlowFilter, type FlowNode } from "../ui/graph_flow/tree";
import { columnAccess, type ContractReviewFlags } from "../flags";
import type {
  ContractReviewData,
  ContractReviewViewQuery,
  ContractReviewViewResult,
  StockAllocationLine,
} from "../types";
import { applyColumnFlags, toContractReviewData } from "./index";

// Contract Review in SQL: one filtered, sorted page plus the sidebar and
// flow-diagram aggregates, so the app never holds more than a page of rows.
// Column rules come from CR_COLUMNS; this file only knows how they read in SQL.

const sql = Prisma.sql;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_PAGE_SIZE = 25;
const FACET_LIMIT = 1000;
const BLANK = "(Blank)";

const TABLE = sql`"ContractReview" c`;
const DEFAULT_ORDER = sql`c."syncedAt" DESC, c.id ASC`;

/** Tender's row scope (STATUS never set), the same rows as its Prisma write scope. */
export const BLANK_STATUS_SCOPE = sql`(c."status" IS NULL OR c."status" = '')`;

const col = (field: string) => Prisma.raw(`c."${field}"`);
const trimmed = (e: Prisma.Sql) => sql`btrim(coalesce(${e}, ''))`;

/** Number in a text cell ("1,200", quoted) or NULL when it is not one. */
function num(e: Prisma.Sql): Prisma.Sql {
  const s = sql`replace(btrim(btrim(coalesce(${e}, '')), '"'''), ',', '')`;
  return sql`(CASE WHEN ${s} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${s}::numeric END)`;
}
const numField = (field: string) => num(col(field));

/**
 * yyyymmdd of a text date, NULL when the cell is not one. The sheet holds
 * "05-Mar-2026", "5-Mar-26", "14-July-2025", day-first "13-02-2025" and
 * "13/02/2025", and ISO. Built from the parts rather than to_date(), which
 * raises on a bad cell.
 */
function dateKey(t: Prisma.Sql): Prisma.Sql {
  const u = sql`replace(${t}, '/', '-')`;
  const part = (n: number) => sql`split_part(${u}, '-', ${Prisma.raw(String(n))})`;
  const year = sql`((CASE WHEN length(${part(3)}) = 2 THEN 2000 ELSE 0 END) + ${part(3)}::int)`;
  return sql`(CASE
    WHEN ${u} ~* '^[0-9]{1,2}-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-([0-9]{2}|[0-9]{4})$'
      THEN ${year} * 10000
        + ((position(lower(left(${part(2)}, 3)) in 'janfebmaraprmayjunjulaugsepoctnovdec') + 2) / 3) * 100
        + ${part(1)}::int
    WHEN ${u} ~ '^[0-9]{1,2}-(0?[1-9]|1[0-2])-([0-9]{2}|[0-9]{4})$'
      THEN ${year} * 10000 + ${part(2)}::int * 100 + ${part(1)}::int
    WHEN ${u} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN replace(left(${u}, 10), '-', '')::int
  END)`;
}

/** Trimmed display text of each column. */
function cellSql(c: CrColumn): Prisma.Sql {
  if (c.field) {
    return c.kind === "list"
      ? sql`coalesce(array_to_string(${col(c.field)}, ', '), '')`
      : trimmed(col(c.field));
  }
  const rate = numField("rate");
  const quoted = numField("quotedRate");
  const entry = sql`${numField("prodOrdQty")} - ${numField("balanceToProdEnt")}`;
  switch (c.header) {
    case "RATE DIFF %":
      return sql`coalesce(trim_scale(round((${rate} - ${quoted}) / nullif(${quoted}, 0) * 100, 2))::text, '')`;
    case "PROD ENTRY QTY":
      return sql`coalesce((CASE WHEN ${entry} >= 0 THEN trim_scale(${entry}) END)::text, '')`;
    default: // DATA INCOMPLETE
      return sql`(CASE WHEN ${trimmed(col("dateOfContract"))} = '' OR ${trimmed(col("partyNameDump"))} = '' OR ${rate} = 0 THEN ${incompleteFilter().value} ELSE '' END)`;
  }
}
const CELL = new Map(CR_COLUMNS.map((c) => [c.header, cellSql(c)]));

/** The cell a date filter / sort reads: DI DATE is a list, its first date counts. */
const dateCell = (c: CrColumn) =>
  c.field === "diDate" ? trimmed(sql`(${col("diDate")})[1]`) : CELL.get(c.header)!;

/** Helper columns and link cells are not worth searching. */
const NOT_SEARCHED = new Set(["C BATCH", "N BATCH", "DATA INCOMPLETE", UPLOAD_DRAWING_COLUMN, "Mails / Documents"]);

const escapeLike = (v: string) => v.replace(/([\\%_])/g, "\\$1");
const like = (v: string) => `%${escapeLike(squish(v))}%`;
const squished = (e: Prisma.Sql) => sql`regexp_replace(lower(${e}), '\\s', '', 'g')`;

/** At least one comma part that is neither blank nor "0". */
const hasValue = (t: Prisma.Sql) =>
  sql`EXISTS (SELECT 1 FROM unnest(string_to_array(${t}, ',')) part WHERE btrim(part) NOT IN ('', '0'))`;
const isZero = (t: Prisma.Sql) => sql`coalesce(${num(t)} = 0, false)`;
const IS_ACTUATOR_ITEM = (() => {
  const name = squished(sql`coalesce(${col("itemName")}, '')`);
  return sql`(position('actuator' in ${name}) > 0 OR position('_act' in ${name}) > 0 OR position('act+gb' in ${name}) > 0)`;
})();

const or = (parts: Prisma.Sql[]) => sql`(${Prisma.join(parts, " OR ")})`;

/** A multi-select / flow-node match: exact trimmed values plus the sentinels. */
function valuesMatch(t: Prisma.Sql, values: string[], extra: Prisma.Sql[] = []): Prisma.Sql {
  const parts = [...extra];
  if (values.includes(BLANK)) parts.push(sql`${t} = ''`);
  if (values.includes(FLOW_HAS_VALUE)) parts.push(hasValue(t));
  if (values.includes(FLOW_NO_VALUE)) parts.push(sql`NOT ${hasValue(t)}`);
  if (values.includes(FLOW_ZERO)) parts.push(isZero(t));
  if (values.includes(FLOW_NON_ZERO)) parts.push(sql`NOT ${isZero(t)}`);
  parts.push(sql`${t} = ANY(${values}::text[])`);
  return or(parts);
}

/** Quotation-DB data the tender DB cannot join to; a host without it leaves this out. */
export interface ContractReviewLookups {
  /** BOM ids per item code (every code present as a key). */
  bomIds(itemCodes: string[]): Promise<Map<string, string[]>>;
  /** Images per item code, only for codes that have any. */
  images(itemCodes: string[]): Promise<Record<string, ContractReviewImage[]>>;
  /** Stock allocation per line id, only for lines the engine covers. Omit to leave the allocation columns out. */
  allocation?(ids: string[]): Promise<Map<string, StockAllocationLine>>;
}

export interface ContractReviewQueryOptions {
  flags: ContractReviewFlags;
  /** Rows the host app may see; omit for every row. */
  scope?: Prisma.Sql;
  lookups?: ContractReviewLookups;
}

export interface QueryContext {
  isEnabled: (header: string) => boolean;
  scope: Prisma.Sql;
  /** Item codes with exactly one / several BOMs, when a BOM ID category filter is on. */
  bom?: { single: string[]; multi: string[] };
  /** Item codes that have an image, when "Image present" is on. */
  imageCodes?: string[];
}

const toArr = (x: unknown): string[] =>
  Array.isArray(x) ? x.map(String) : x && x !== "all" ? [String(x)] : [];

/** Client input is untrusted: fill in anything missing so the builders cannot throw. */
export function normalizeQuery(q: ContractReviewViewQuery): ContractReviewViewQuery {
  return {
    columnFilters: q?.columnFilters ?? {},
    multiFilters: q?.multiFilters ?? {},
    batchFilters: q?.batchFilters ?? {},
    dateRanges: q?.dateRanges ?? {},
    globalSearch: String(q?.globalSearch ?? ""),
    balBillFilter: q?.balBillFilter ?? "all",
    statusFilter: toArr(q?.statusFilter),
    tileItems: toArr(q?.tileItems),
    tileSize: toArr(q?.tileSize),
    activeRateTile: q?.activeRateTile ?? null,
    presence: { drawing: !!q?.presence?.drawing, image: !!q?.presence?.image },
    sort: q?.sort ?? null,
    page: Number.isFinite(q?.page) ? q.page : 1,
    pageSize: Number.isFinite(q?.pageSize) ? q.pageSize : DEFAULT_PAGE_SIZE,
  };
}

const BOM_CATEGORIES = ["Blanks", "Single", "Dropdown"];
const bomCategoriesOf = (q: ContractReviewViewQuery) =>
  String(q.columnFilters[BOM_ID_COLUMN] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => BOM_CATEGORIES.includes(s));

const RATE_TILE_HEADERS: Record<RateTileKey, string[]> = {
  rateXOrderQty: ["RATE", "ORDER QTY"],
  rateXBalBillAgCont: ["RATE", "BAL BILL AG CONT"],
  rateXMcQty: ["RATE", "MC QTY"],
  rateXBalDiQty: ["RATE", "DI QTY", "BILLED QTY"],
  rateXBalMcQty: ["RATE", "MC QTY", "DI QTY"],
  balBillAgContSum: ["BAL BILL AG CONT"],
  totalCostExcGst: ["COST FROM QUOTATION"],
  totalCostIncGst: ["COST FROM QUOTATION"],
  totalVaPct: ["VA % FROM COST"],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoKey = (d: string) => (ISO_DATE.test(d) ? Number(d.replaceAll("-", "")) : null);

const BATCH_FILTERS = [cBatchFilter(), nBatchFilter(), incompleteFilter()];

/** The sidebar's blank-or-value multi-selects: [exclude key, header]. */
const SIDEBAR_MULTI: [SidebarExclude, string][] = [
  ["clearance", "CLEARANCE STATUS"],
  ["pn", "PN RATING"],
  ["mc", "MC Received/Pending"],
  ["inspection", "Inspection"],
];

export interface WhereSkip {
  /** Drop this column's own table filter (facets and option counts cascade). */
  header?: string;
  /** Drop the table filters of these columns (the flow diagram's own columns). */
  ignore?: ReadonlySet<string>;
  /** Drop one sidebar filter, or all of them. */
  sidebar?: SidebarExclude | "all";
}

/** WHERE for the filters in `q`. Disabled columns never filter. */
export function buildWhere(q: ContractReviewViewQuery, ctx: QueryContext, skip: WhereSkip = {}): Prisma.Sql {
  const parts: Prisma.Sql[] = [ctx.scope];
  const cell = (header: string) => (ctx.isEnabled(header) ? CELL.get(header) : undefined);
  const skipped = (header: string) => header === skip.header || !!skip.ignore?.has(header);

  if (q.globalSearch.trim()) {
    const cells = CR_COLUMNS.filter((c) => !NOT_SEARCHED.has(c.header) && ctx.isEnabled(c.header)).map(
      (c) => CELL.get(c.header)!,
    );
    if (cells.length) parts.push(sql`${squished(Prisma.join(cells, " || ' ' || "))} LIKE ${like(q.globalSearch)}`);
  }

  for (const [header, value] of Object.entries(q.columnFilters)) {
    if (skipped(header) || !value || value === "All") continue;
    const t = cell(header);
    if (!t) continue;
    if (header === BOM_ID_COLUMN) {
      // Category of the row's item code (how many BOMs it has), not the cell text.
      if (!ctx.bom) continue;
      const single = sql`c."itemCode" = ANY(${ctx.bom.single}::text[])`;
      const multi = sql`c."itemCode" = ANY(${ctx.bom.multi}::text[])`;
      const byCategory: Record<string, Prisma.Sql> = {
        Single: single,
        Dropdown: multi,
        Blanks: sql`NOT (${single} OR ${multi})`,
      };
      const picked = bomCategoriesOf(q).map((c) => byCategory[c]);
      if (picked.length) parts.push(or(picked));
      continue;
    }
    if (value === BLANK || value === "-" || value === "—") parts.push(sql`${t} = ''`);
    else if (value.trim()) parts.push(sql`${squished(t)} LIKE ${like(value)}`);
  }

  for (const [header, selected] of Object.entries(q.multiFilters)) {
    if (skipped(header) || !selected?.length) continue;
    const t = cell(header);
    if (!t) continue;
    if (header === UPLOAD_DRAWING_COLUMN) {
      const picked: Prisma.Sql[] = [];
      if (selected.includes("Has Drawing")) picked.push(sql`${t} <> ''`);
      if (selected.includes("No Drawing")) picked.push(sql`${t} = ''`);
      parts.push(picked.length ? or(picked) : sql`FALSE`);
      continue;
    }
    const extra: Prisma.Sql[] = [];
    const pendingActuator =
      (header === "Actuator" && selected.includes(PENDING_ACTUATIONS_FILTER)) ||
      (header === "RM CODE FOR ACTUATOR" && selected.includes(RM_CODE_PENDING_FILTER));
    if (pendingActuator) extra.push(sql`(${IS_ACTUATOR_ITEM} AND ${t} = '')`);
    parts.push(valuesMatch(t, selected, extra));
  }

  for (const [header, range] of Object.entries(q.dateRanges)) {
    if (skipped(header) || !range || (!range.from && !range.to && !range.blank)) continue;
    const column = crColumn(header);
    if (!column || !ctx.isEnabled(header)) continue;
    if (range.blank) {
      parts.push(sql`${CELL.get(header)!} IN ('', '-', '—')`);
      continue;
    }
    const key = dateKey(dateCell(column));
    const from = range.from ? isoKey(range.from) : null;
    const to = range.to ? isoKey(range.to) : null;
    // A row with no readable date never falls inside a range.
    parts.push(sql`${key} IS NOT NULL`);
    if (from !== null) parts.push(sql`${key} >= ${from}`);
    if (to !== null) parts.push(sql`${key} <= ${to}`);
  }

  for (const bf of BATCH_FILTERS) {
    if (!q.batchFilters[bf.key]) continue;
    const t = cell(bf.column);
    if (t) parts.push(sql`${t} = ${bf.value}`);
  }

  if (q.activeRateTile && RATE_TILE_HEADERS[q.activeRateTile]) {
    for (const header of RATE_TILE_HEADERS[q.activeRateTile]) {
      const t = cell(header);
      parts.push(t ? sql`${num(t)} IS NOT NULL` : sql`FALSE`);
    }
  }

  if (skip.sidebar !== "all") {
    const balBill = cell("BAL BILL AG CONT");
    if (skip.sidebar !== "balBill" && q.balBillFilter !== "all" && balBill) {
      parts.push(q.balBillFilter === "yes" ? isZero(balBill) : sql`NOT ${isZero(balBill)}`);
    }
    const status = cell("STATUS");
    if (skip.sidebar !== "status" && q.statusFilter.length && status) {
      const picked = [sql`lower(${status}) = ANY(${q.statusFilter.map((s) => s.toLowerCase())}::text[])`];
      if (q.statusFilter.includes("Blanks")) picked.push(sql`${status} = ''`);
      parts.push(or(picked));
    }
    for (const [key, header] of SIDEBAR_MULTI) {
      const selected = q.multiFilters[header] ?? [];
      const t = cell(header);
      if (skip.sidebar === key || !selected.length || !t) continue;
      const picked = [sql`${t} = ANY(${selected}::text[])`];
      if (selected.includes(BLANK)) picked.push(sql`${t} = ''`);
      parts.push(or(picked));
    }
    const item = cell("Item");
    if (skip.sidebar !== "item" && q.tileItems.length && item) parts.push(sql`${item} = ANY(${q.tileItems}::text[])`);
    const size = cell("SIZE");
    if (skip.sidebar !== "size" && q.tileSize.length && size) parts.push(sql`${size} = ANY(${q.tileSize}::text[])`);
  }

  return Prisma.join(parts, " AND ");
}

/** The table's "Drawing present" / "Image present" checkboxes: they narrow the rows, not the aggregates. */
export function buildPresence(q: ContractReviewViewQuery, ctx: QueryContext): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (q.presence.drawing) {
    const t = ctx.isEnabled(UPLOAD_DRAWING_COLUMN) ? CELL.get(UPLOAD_DRAWING_COLUMN) : undefined;
    parts.push(t ? sql`${t} <> ''` : sql`FALSE`);
  }
  if (q.presence.image) {
    parts.push(ctx.imageCodes ? sql`btrim(c."itemCode") = ANY(${ctx.imageCodes}::text[])` : sql`FALSE`);
  }
  return parts.length ? Prisma.join(parts, " AND ") : sql`TRUE`;
}

/** Dates by date, everything else numbers first then text; blanks last either way. */
export function buildOrderBy(sort: SortSpec | null, isEnabled: (header: string) => boolean): Prisma.Sql {
  const column = sort && crColumn(sort.header);
  if (!sort || !column || !isEnabled(column.header)) return DEFAULT_ORDER;
  const dir = Prisma.raw(sort.direction === "desc" ? "DESC" : "ASC");
  if (column.kind === "date" || column.field === "diDate") {
    return sql`${dateKey(dateCell(column))} ${dir} NULLS LAST, ${DEFAULT_ORDER}`;
  }
  const t = CELL.get(column.header)!;
  return sql`(${t} = '') ASC, ${num(t)} ${dir} NULLS LAST, lower(${t}) ${dir}, ${DEFAULT_ORDER}`;
}

/** Flags, scope and (only when a filter needs them) the quotation-DB item-code lists. */
async function resolveContext(q: ContractReviewViewQuery, opts: ContractReviewQueryOptions): Promise<QueryContext> {
  const { isEnabled } = columnAccess(opts.flags);
  const ctx: QueryContext = { isEnabled, scope: opts.scope ?? sql`TRUE` };
  const lookups = opts.lookups;
  const needBom = !!lookups && isEnabled(BOM_ID_COLUMN) && bomCategoriesOf(q).length > 0;
  const needImages = !!lookups && q.presence.image;
  if (!lookups || (!needBom && !needImages)) return ctx;

  const rows = await tenderPrisma.$queryRaw<{ code: string }[]>(
    sql`SELECT DISTINCT c."itemCode" AS code FROM ${TABLE} WHERE ${ctx.scope}`,
  );
  const codes = rows.map((r) => r.code).filter(Boolean);
  const [bomIds, images] = await Promise.all([
    needBom ? lookups.bomIds(codes) : null,
    needImages ? lookups.images(codes) : null,
  ]);
  if (bomIds) {
    ctx.bom = { single: [], multi: [] };
    for (const [code, ids] of bomIds) {
      if (ids.length === 1) ctx.bom.single.push(code);
      else if (ids.length > 1) ctx.bom.multi.push(code);
    }
  }
  if (images) ctx.imageCodes = Object.keys(images).map((c) => c.trim());
  return ctx;
}

// --- Aggregates ---------------------------------------------------------------

const AGGREGATES = [
  "rateMcCont",
  "rateOrderQty",
  "rateBalBillCont",
  "rateBalDiQty",
  "rateBalMspQty",
  "balBillAgContTotal",
  "totalCostExcGst",
  "totalCostIncGst",
  "totalVaPct",
] as const;
type AggregateKey = (typeof AGGREGATES)[number];

/** The summed expression behind each tile; a disabled column reads as NULL so it never leaks into a sum. */
function aggregateSql(ctx: QueryContext): Record<AggregateKey, Prisma.Sql> {
  const n = (header: string) => (ctx.isEnabled(header) ? num(CELL.get(header)!) : sql`NULL::numeric`);
  const rate = n("RATE");
  const mc = n("MC QTY");
  const di = n("DI QTY");
  const bal = n("BAL BILL AG CONT");
  const cost = n("COST FROM QUOTATION");
  return {
    rateMcCont: sql`${rate} * ${mc}`,
    rateOrderQty: sql`${rate} * ${n("ORDER QTY")}`,
    rateBalBillCont: sql`${rate} * ${bal}`,
    rateBalDiQty: sql`${rate} * (${di} - ${n("BILLED QTY")})`,
    rateBalMspQty: sql`${rate} * (${mc} - ${di})`,
    balBillAgContTotal: bal,
    totalCostExcGst: cost,
    totalCostIncGst: sql`${cost} * 1.18`,
    totalVaPct: n("VA % FROM COST"),
  };
}

interface FlowNodeSql {
  id: string;
  where: Prisma.Sql;
  metric?: FlowNode["metric"];
}

function flowFilterSql(filter: FlowFilter): Prisma.Sql {
  const t = CELL.get(filter.column);
  // A column that does not exist yet passes, so a half-built level keeps its subtree.
  return t ? valuesMatch(t, filter.values) : sql`TRUE`;
}

/** Every flow node with the predicate of its whole path (scope, ancestors, itself). */
export function flowNodes(isEnabled: (header: string) => boolean): FlowNodeSql[] {
  const out: FlowNodeSql[] = [];
  const walk = (node: FlowNode, path: Prisma.Sql[]) => {
    const own = [...path, flowFilterSql(node.filter)];
    out.push({ id: node.id, where: Prisma.join(own, " AND "), metric: node.metric });
    for (const kid of node.children ?? []) walk(kid, own);
  };
  for (const { tree, scope } of enabledTrees(isEnabled)) walk(tree, scope ? [flowFilterSql(scope)] : []);
  return out;
}

interface GroupRow {
  k: string;
  v: string;
  n: number;
  s: number | null;
}

/** The statements behind one page. Exported for the SQL tests. */
export function pageSql(q: ContractReviewViewQuery, ctx: QueryContext) {
  const matched = buildWhere(q, ctx);
  const presence = buildPresence(q, ctx);
  const order = buildOrderBy(q.sort, ctx.isEnabled);
  const pageSize = Math.min(Math.max(1, Math.floor(q.pageSize)), MAX_PAGE_SIZE);
  const cellOrBlank = (header: string) => (ctx.isEnabled(header) ? CELL.get(header)! : sql`''::text`);
  const agg = aggregateSql(ctx);

  const rows = (page: number) =>
    sql`SELECT c.* FROM ${TABLE} WHERE ${matched} AND ${presence} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(Math.max(1, page) - 1) * pageSize}`;

  const totals = sql`SELECT count(*) FILTER (WHERE ${presence})::int AS total,
      count(*)::int AS matched,
      count(DISTINCT nullif(${cellOrBlank("CONTRACT NO")}, ''))::int AS contracts,
      (SELECT max(c."syncedAt") FROM ${TABLE} WHERE ${ctx.scope}) AS synced_at,
      ${Prisma.join(
        AGGREGATES.map(
          (k) =>
            sql`coalesce(sum(${agg[k]}), 0)::float8 AS ${Prisma.raw(`"${k}_sum"`)}, count(${agg[k]})::int AS ${Prisma.raw(`"${k}_count"`)}`,
        ),
        ", ",
      )}
    FROM ${TABLE} WHERE ${matched}`;

  // One row per distinct value of a column under `where`, tagged with `kind`.
  const group = (kind: string, value: Prisma.Sql, where: Prisma.Sql, sum: Prisma.Sql = sql`NULL::float8`) =>
    sql`(SELECT ${kind}::text AS k, ${value} AS v, count(*)::int AS n, ${sum} AS s FROM ${TABLE} WHERE ${where} GROUP BY 2)`;
  const own = (header: string, sidebar: SidebarExclude) => buildWhere(q, ctx, { header, sidebar });
  const balBillSum = sql`coalesce(sum(${agg.balBillAgContTotal}), 0)::float8`;
  const groups = Prisma.join(
    [
      group("status", cellOrBlank("STATUS"), buildWhere(q, ctx, { sidebar: "status" })),
      group("clearance", cellOrBlank("CLEARANCE STATUS"), own("CLEARANCE STATUS", "clearance")),
      group("mc", cellOrBlank("MC Received/Pending"), own("MC Received/Pending", "mc")),
      group("inspection", cellOrBlank("Inspection"), own("Inspection", "inspection")),
      group("pn", cellOrBlank("PN RATING"), own("PN RATING", "pn")),
      group("item", cellOrBlank("Item"), own("Item", "item"), balBillSum),
      group("size", cellOrBlank("SIZE"), buildWhere(q, ctx, { sidebar: "size" })),
      // "All" tile counts keep the column's own table filter, unlike the option lists above.
      group("itemAll", sql`''::text`, buildWhere(q, ctx, { sidebar: "item" }), balBillSum),
      group("pnAll", sql`''::text`, buildWhere(q, ctx, { sidebar: "pn" })),
      // Category pick-lists cover every row in scope, whatever the filters.
      group("cat:Item", cellOrBlank("Item"), ctx.scope),
      group("cat:CLEARANCE STATUS", cellOrBlank("CLEARANCE STATUS"), ctx.scope),
      group("cat:PN RATING", cellOrBlank("PN RATING"), ctx.scope),
    ],
    " UNION ALL ",
  );

  // The diagram ignores the sidebar and the table filters on its own columns,
  // so picking one branch never zeroes its siblings.
  const nodes = flowNodes(ctx.isEnabled);
  const graph = nodes.length
    ? sql`SELECT ${Prisma.join(
        nodes.flatMap((node, i) => [
          sql`count(*) FILTER (WHERE ${node.where})::int AS ${Prisma.raw(`"g${i}"`)}`,
          ...(node.metric === "diBalance"
            ? [sql`coalesce(sum(${agg.rateBalDiQty}) FILTER (WHERE ${node.where}), 0)::float8 AS ${Prisma.raw(`"m${i}"`)}`]
            : []),
        ]),
        ", ",
      )} FROM ${TABLE} WHERE ${buildWhere(q, ctx, { ignore: graphPathColumns(enabledTrees(ctx.isEnabled)), sidebar: "all" })}`
    : null;

  const contractNo = cellOrBlank("CONTRACT NO");
  const party = cellOrBlank("PARTY NAME");
  const contracts = sql`SELECT ${contractNo} AS v, count(*)::int AS n,
      coalesce(sum(${agg.rateBalBillCont}), 0)::float8 AS s,
      coalesce((array_agg(${party} ORDER BY ${DEFAULT_ORDER}) FILTER (WHERE ${party} <> ''))[1], '') AS party
    FROM ${TABLE} WHERE ${buildWhere(q, ctx, { header: "CONTRACT NO" })} AND ${contractNo} <> '' GROUP BY 1`;

  return { rows, totals, groups, graph, contracts, nodes, pageSize };
}

interface TotalsRow {
  total: number;
  matched: number;
  contracts: number;
  synced_at: Date | null;
  /** `<aggregate>_sum` / `<aggregate>_count`. */
  [key: string]: number | Date | null;
}

function buildView(
  q: ContractReviewViewQuery,
  totals: TotalsRow,
  groups: GroupRow[],
  graph: Record<string, number> | undefined,
  contracts: { v: string; n: number; s: number; party: string }[],
  nodes: FlowNodeSql[],
): { view: ContractReviewView; categoryOptions: Record<string, string[]> } {
  const of = (kind: string) => groups.filter((g) => g.k === kind);
  const counts = (kind: string, blank: string, label: (v: string) => string = (v) => v) => {
    const out: Record<string, number> = { all: 0 };
    for (const g of of(kind)) {
      const key = g.v === "" ? blank : label(g.v);
      out[key] = (out[key] ?? 0) + g.n;
      out.all += g.n;
    }
    return out;
  };

  const statusCounts = counts("status", "Blanks", statusTitle);
  const statusOptions = Object.keys(statusCounts)
    .filter((k) => k !== "all")
    .sort((a, b) => (a === "Blanks" ? -1 : b === "Blanks" ? 1 : byNumericLocale(a, b)));
  const clearanceCounts = counts("clearance", BLANK);
  const mcCounts = counts("mc", BLANK);
  const inspectionCounts = counts("inspection", BLANK);

  const itemOptions: TileOption[] = of("item")
    .filter((g) => g.v)
    .map((g) => ({ value: g.v, count: g.n, sum: g.s ?? 0 }));
  for (const value of [...q.tileItems, EXTRA_ITEM_OPTION]) {
    if (!itemOptions.some((o) => o.value === value)) itemOptions.push({ value, count: 0, sum: 0 });
  }
  itemOptions.sort((a, b) => byNumericLocale(a.value, b.value));

  const sizeOptions: TileOption[] = of("size")
    .filter((g) => g.v)
    .map((g) => ({ value: g.v, count: g.n }))
    .sort((a, b) => byNumericLocale(a.value, b.value));

  const pnOptions: TileOption[] = of("pn").map((g) => ({ value: g.v === "" ? BLANK : g.v, count: g.n }));
  for (const value of [BLANK, ...(q.multiFilters["PN RATING"] ?? [])]) {
    if (!pnOptions.some((o) => o.value === value)) pnOptions.push({ value, count: 0 });
  }
  pnOptions.sort((a, b) => (a.value === BLANK ? 1 : b.value === BLANK ? -1 : byNumericLocale(a.value, b.value)));

  const aggregate = (k: AggregateKey): Aggregate => ({
    sum: Number(totals[`${k}_sum`]),
    count: Number(totals[`${k}_count`]),
  });
  const itemAll = of("itemAll")[0];

  const graphCounts: Record<string, number> = {};
  const graphValues: Record<string, string> = {};
  nodes.forEach((node, i) => {
    graphCounts[node.id] = graph?.[`g${i}`] ?? 0;
    if (node.metric === "diBalance") graphValues[node.id] = fmt(graph?.[`m${i}`] ?? 0);
  });

  const contractNoMeta: Record<string, ContractNoMeta> = {};
  for (const c of contracts) contractNoMeta[c.v] = { count: c.n, sum: c.s, partyName: c.party };

  const distinct = (kind: string, extra: string[] = []) =>
    [...new Set([...of(kind).map((g) => g.v).filter(Boolean), ...extra])].sort(byNumericLocale);
  const categoryOptions: Record<string, string[]> = {
    Item: distinct("cat:Item", [EXTRA_ITEM_OPTION]),
    "CLEARANCE STATUS": distinct("cat:CLEARANCE STATUS"),
    "PN RATING": distinct("cat:PN RATING"),
  };

  return {
    view: {
      statusCounts,
      statusOptions,
      clearanceCounts,
      clearanceOptions: withBlankLast(clearanceCounts, q.multiFilters["CLEARANCE STATUS"] ?? []),
      mcCounts,
      mcOptions: withBlankLast(mcCounts, q.multiFilters["MC Received/Pending"] ?? []),
      inspectionCounts,
      inspectionOptions: withBlankLast(inspectionCounts, q.multiFilters["Inspection"] ?? []),
      itemOptions,
      sizeOptions,
      pnOptions,
      rateMcCont: aggregate("rateMcCont"),
      rateOrderQty: aggregate("rateOrderQty"),
      rateBalBillCont: aggregate("rateBalBillCont"),
      rateBalDiQty: aggregate("rateBalDiQty"),
      rateBalMspQty: aggregate("rateBalMspQty"),
      balBillAgContTotal: aggregate("balBillAgContTotal"),
      totalCostExcGst: aggregate("totalCostExcGst"),
      totalCostIncGst: aggregate("totalCostIncGst"),
      totalVaPct: aggregate("totalVaPct"),
      tileRowsCount: totals.matched,
      contractCount: totals.contracts,
      tileAllCounts: {
        item: itemAll?.n ?? 0,
        itemBalBill: itemAll?.s ?? 0,
        size: of("size").reduce((sum, g) => sum + g.n, 0),
        pn: of("pnAll")[0]?.n ?? 0,
      },
      graphCounts,
      graphValues,
      contractNoMeta,
    },
    categoryOptions,
  };
}

/** One line's allocation cells in ALLOCATION_HEADERS order, as plain text (also for the Excel export); all blank when the engine does not cover the line. */
export function allocationCells(line: StockAllocationLine | undefined): string[] {
  if (!line) return ALLOCATION_HEADERS.map(() => "");
  // Actuated lines only: the engine also sets gbFree on manual-gearbox lines.
  const free = line.actuatorFree !== null
    ? [`ACT ${fmt(line.actuatorFree)}`, line.gbFree !== null ? `GB ${fmt(line.gbFree)}` : ""]
    : [];
  const notes = [
    // The wiring-change status already says what its flag says.
    ...line.flags.filter((f) => f.toLowerCase() !== line.status.toLowerCase()),
    ...line.suggestions.map((s) => `${s.erpCode}: ${fmt(s.qty)} ${s.note}`),
  ];
  return [
    fmt(line.balanceToOffer),
    fmt(line.fgQty),
    fmt(line.rmRouteQty),
    line.incomingQty > 0 && line.eta ? `${fmt(line.incomingQty)} (ETA ${line.eta})` : fmt(line.incomingQty),
    fmt(line.shortfall),
    free.filter(Boolean).join(" / "),
    line.status,
    notes.join(" · "),
  ];
}

/** Appends the allocation columns when the host supplies the lookup: one lookup call for all these rows. */
async function withAllocation(data: ContractReviewData, lookups?: ContractReviewLookups): Promise<ContractReviewData> {
  if (!lookups?.allocation) return data;
  const byId = data.ids.length ? await lookups.allocation(data.ids) : new Map<string, StockAllocationLine>();
  return {
    ...data,
    headers: [...data.headers, ...ALLOCATION_HEADERS],
    rows: data.rows.map((row, i) => [...row, ...allocationCells(byId.get(data.ids[i]))]),
  };
}

/** One filtered, sorted page plus the sidebar / flow-diagram aggregates for the same filters. */
export async function listContractReviewPage(
  rawQuery: ContractReviewViewQuery,
  opts: ContractReviewQueryOptions,
): Promise<ContractReviewViewResult> {
  const q = normalizeQuery(rawQuery);
  const ctx = await resolveContext(q, opts);
  const s = pageSql(q, ctx);
  const requested = Math.max(1, Math.floor(q.page));
  const [firstRows, [totals], groups, graphRows, contracts] = await Promise.all([
    tenderPrisma.$queryRaw<ContractReview[]>(s.rows(requested)),
    tenderPrisma.$queryRaw<TotalsRow[]>(s.totals),
    tenderPrisma.$queryRaw<GroupRow[]>(s.groups),
    s.graph ? tenderPrisma.$queryRaw<Record<string, number>[]>(s.graph) : Promise.resolve([]),
    tenderPrisma.$queryRaw<{ v: string; n: number; s: number; party: string }[]>(s.contracts),
  ]);

  // A page past the end (filters narrowed since) is served as the last page.
  const page = Math.min(requested, Math.max(1, Math.ceil(totals.total / s.pageSize)));
  const items = page === requested ? firstRows : await tenderPrisma.$queryRaw<ContractReview[]>(s.rows(page));
  const data = applyColumnFlags(await withAllocation(toContractReviewData(items), opts.lookups), opts.flags);

  // Quotation-DB extras, for the rows on this page only.
  const bomIdOptions: Record<string, string[]> = {};
  let itemImages: Record<string, ContractReviewImage[]> = {};
  if (opts.lookups && items.length) {
    const codes = [...new Set(items.map((i) => i.itemCode).filter(Boolean))];
    const [bomIds, images] = await Promise.all([
      ctx.isEnabled(BOM_ID_COLUMN) ? opts.lookups.bomIds(codes) : null,
      ctx.isEnabled("ITEM_CODE") ? opts.lookups.images(codes) : null,
    ]);
    if (bomIds) for (const item of items) bomIdOptions[item.id] = bomIds.get(item.itemCode) ?? [];
    if (images) itemImages = images;
  }

  const { view, categoryOptions } = buildView(q, totals, groups, graphRows[0], contracts, s.nodes);
  return {
    headers: data.headers,
    rows: data.rows,
    ids: data.ids,
    total: totals.total,
    page,
    syncedAt: totals.synced_at?.toISOString() ?? null,
    view,
    categoryOptions,
    bomIdOptions,
    itemImages,
    diagramVerdicts: data.diagramVerdicts ?? {},
  };
}

/** Distinct non-blank values of one column under every other active filter. */
export async function listContractReviewFacet(
  rawQuery: ContractReviewViewQuery,
  header: string,
  opts: ContractReviewQueryOptions,
): Promise<string[]> {
  const q = normalizeQuery(rawQuery);
  const ctx = await resolveContext(q, opts);
  const t = ctx.isEnabled(header) ? CELL.get(header) : undefined;
  if (!t) return [];
  const where = buildWhere(q, ctx, { header, sidebar: SIDEBAR_EXCLUDE_BY_HEADER[header] });
  const rows = await tenderPrisma.$queryRaw<{ v: string }[]>(
    sql`SELECT DISTINCT ${t} AS v FROM ${TABLE} WHERE ${where} AND ${t} <> '' ORDER BY 1 LIMIT ${FACET_LIMIT}`,
  );
  return rows.map((r) => r.v).sort(byNumericLocale);
}

/** Every row matching the filters, in table order (Excel export). */
export async function listContractReviewAllRows(
  rawQuery: ContractReviewViewQuery,
  opts: ContractReviewQueryOptions,
): Promise<unknown[][]> {
  const q = normalizeQuery(rawQuery);
  const ctx = await resolveContext(q, opts);
  const items = await tenderPrisma.$queryRaw<ContractReview[]>(
    sql`SELECT c.* FROM ${TABLE} WHERE ${buildWhere(q, ctx)} AND ${buildPresence(q, ctx)} ORDER BY ${buildOrderBy(q.sort, ctx.isEnabled)}`,
  );
  return applyColumnFlags(await withAllocation(toContractReviewData(items), opts.lookups), opts.flags).rows;
}
