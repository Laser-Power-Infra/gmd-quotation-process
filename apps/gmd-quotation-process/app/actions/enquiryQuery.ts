"use server";
import { requireAccess } from "@/lib/access";

import { Prisma } from "@gmd/db-quotation";
import { prisma } from "@/lib/prisma";
import {
  buildEnquiryOrderBySql,
  buildEnquiryWhereSql,
  buildItemWhereSql,
  facetCountSql,
  facetExpression,
  FIRST_ITEM_JOIN_SQL,
  SIDEBAR_COUNT_FIELDS,
  STAGE_SQL,
} from "@/lib/enquiry-query";
import type {
  ClosureCounts,
  EnquiryFacetResult,
  EnquiryPageResult,
  EnquiryQuery,
  EnquirySummary,
  FilteredIds,
} from "@/lib/enquiryQuery";
import {
  getBatchDistinctBomIds,
  getClosedBomIdSet,
  getNoUseBomIdSet,
} from "@/lib/verifyBomLookup";
import { ageBucket, STAGE_ASSIGNEE_FIELD } from "@/lib/stageAgeing";
import { costWarningsSql } from "@/lib/costSanity";

// Owner column of the docket's current stage, from STAGE_ASSIGNEE_FIELD.
const STAGE_ASSIGNEE_SQL = Prisma.sql`(CASE t.stage ${Prisma.join(
  Object.entries(STAGE_ASSIGNEE_FIELD).map(
    ([stage, field]) => Prisma.sql`WHEN ${stage} THEN t.${Prisma.raw(`"${field}"`)}`,
  ),
  " ",
)} END)`;

const MAX_PAGE_SIZE = 500;
const FACET_LIMIT = 500;

function clampPage(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(String(value).replace(/,/g, "").trim());
  return Number.isNaN(n) ? null : n;
}

/**
 * One page of the quotation dashboard: filtered/sorted enquiry ids from SQL,
 * then only those enquiries hydrated with their items.
 */
export async function fetchEnquiryPage(
  query: EnquiryQuery,
  includeSummary = true,
): Promise<EnquiryPageResult> {
  await requireAccess();
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const offset = (page - 1) * pageSize;

  const where = buildEnquiryWhereSql({ ...query, selectedEnquiryIds: [] });
  const itemWhere = buildItemWhereSql(query);
  // Docket selection scopes the cards and facet options, never the table itself.
  const scopedWhere =
    query.selectedEnquiryIds.length > 0
      ? buildEnquiryWhereSql(query)
      : where;
  const { orderBy, needsFirstItem } = buildEnquiryOrderBySql(query);

  // Tiles keep their counts while one is active, so drop the stage filter here.
  const stageWhere = buildEnquiryWhereSql({ ...query, selectedEnquiryIds: [] }, { skipField: "stage" });

  const [idRows, countRows, scopedCountRows, totalRows, itemRows, closureRows, stageRows, ageRows, ownerRows, facetRows] =
    await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT e.id FROM "Enquiry" e
        ${needsFirstItem ? FIRST_ITEM_JOIN_SQL : Prisma.empty}
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM "Enquiry" e WHERE ${where}
      `,
      includeSummary && query.selectedEnquiryIds.length > 0
        ? prisma.$queryRaw<{ count: number }[]>`
            SELECT count(*)::int AS count FROM "Enquiry" e WHERE ${scopedWhere}
          `
        : Promise.resolve(undefined),
      includeSummary ? prisma.enquiry.count() : Promise.resolve(undefined),
      includeSummary
        ? prisma.$queryRaw<
            { gst: string | null; excl: string | null; cost: string | null; qty: string | null }[]
          >`
            SELECT i."totalValue" AS gst, i."itemWiseTotalValue" AS excl, i."cost" AS cost, i."quantity" AS qty
            FROM "EnquiryItem" i
            JOIN "Enquiry" e ON e.id = i."enquiryId"
            WHERE ${scopedWhere} AND ${itemWhere}
              AND coalesce(btrim(e."duplicate"), '') <> 'Yes'
              AND coalesce(btrim(i."cBatch"), '') <> 'C'
              AND coalesce(btrim(i."nBatch"), '') <> 'N'
          `
        : Promise.resolve(undefined),
      includeSummary
        ? prisma.$queryRaw<{ status: string | null; count: number }[]>`
            SELECT btrim(coalesce(e."closureStatus", '')) AS status, count(*)::int AS count
            FROM "Enquiry" e WHERE ${where}
            GROUP BY 1
          `
        : Promise.resolve(undefined),
      includeSummary
        ? prisma.$queryRaw<{ stage: string | null; count: number }[]>`
            SELECT ${STAGE_SQL} AS stage, count(*)::int AS count
            FROM "Enquiry" e WHERE ${stageWhere}
            GROUP BY 1
          `
        : Promise.resolve(undefined),
      // Whole IST days since enquiry; bucketed in JS by ageBucket().
      includeSummary
        ? prisma.$queryRaw<{ stage: string | null; days: number; count: number }[]>`
            SELECT ${STAGE_SQL} AS stage,
              ((now() AT TIME ZONE 'Asia/Kolkata')::date
                - (e."enquiryDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date)::int AS days,
              count(*)::int AS count
            FROM "Enquiry" e WHERE ${stageWhere}
            GROUP BY 1, 2
          `
        : Promise.resolve(undefined),
      includeSummary
        ? prisma.$queryRaw<{ stage: string; userId: string | null; name: string | null; count: number }[]>`
            SELECT t.stage, u.id AS "userId", coalesce(u.name, u.email) AS name, count(*)::int AS count
            FROM (
              SELECT ${STAGE_SQL} AS stage, e."detailsAssigneeId", e."costAssigneeId",
                e."validationAssigneeId", e."sendAssigneeId"
              FROM "Enquiry" e WHERE ${stageWhere}
            ) t
            LEFT JOIN "User" u ON u.id = ${STAGE_ASSIGNEE_SQL}
            WHERE t.stage IN (${Prisma.join(Object.keys(STAGE_ASSIGNEE_FIELD))})
            GROUP BY 1, 2, 3
          `
        : Promise.resolve(undefined),
      // Sidebar option counts over every filtered (selection-scoped) docket, not just this page.
      includeSummary
        ? Promise.all(
            SIDEBAR_COUNT_FIELDS.map((field) =>
              prisma.$queryRaw<{ value: string | null; count: number }[]>(facetCountSql(query, field)!),
            ),
          )
        : Promise.resolve(undefined),
    ]);

  const total = Number(countRows[0]?.count ?? 0);
  const ids = idRows.map((r) => r.id);

  let enquiries: EnquiryPageResult["enquiries"] = [];
  if (ids.length > 0) {
    // Cost sanity warnings for this page's items only; runs alongside the loads below.
    const warnRowsPromise = prisma.$queryRaw<{ id: string; warnings: string[] }[]>`
      SELECT i.id, ${costWarningsSql(Prisma.sql`i`)} AS warnings
      FROM "EnquiryItem" i WHERE i."enquiryId" = ANY(${ids}::text[])
    `.catch((error) => {
      console.warn("[enquiryQuery] cost warnings failed:", error);
      return [];
    });
    const rows = await prisma.enquiry.findMany({
      where: { id: { in: ids } },
      include: {
        items: { orderBy: { position: "asc" } },
        attachments: true,
      },
    });
    const order = new Map(ids.map((id, index) => [id, index]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    // BOM availability / NO-USE / closed lookups, for this page's item codes only.
    let bomMap: Map<string, string[]> = new Map();
    let noUseSet: Set<string> = new Set();
    let closedBomSet: Set<string> = new Set();
    try {
      const codes = [
        ...new Set(
          rows.flatMap((e) =>
            e.items
              .map((i) => i.erpItemCode)
              .filter((c): c is string => !!c && c.trim() !== ""),
          ),
        ),
      ];
      if (codes.length > 0) {
        bomMap = await getBatchDistinctBomIds(codes);
        const bomIds = [...new Set([...bomMap.values()].flat())];
        noUseSet = await getNoUseBomIdSet(bomIds);
        closedBomSet = await getClosedBomIdSet(bomIds);
      }
    } catch (error) {
      console.warn("[enquiryQuery] BOM availability batch failed:", error);
    }

    const costWarnings = new Map<string, string[]>();
    for (const r of await warnRowsPromise) if (r.warnings.length > 0) costWarnings.set(r.id, r.warnings);

    enquiries = rows.map((enquiry) => ({
      ...enquiry,
      items: enquiry.items.map((item) => {
        const code = item.erpItemCode;
        const availableBomIds = code
          ? (bomMap.get(code) ?? []).filter((id) => !noUseSet.has(id))
          : (item.availableBomIds ?? []);
        const selectedBomId = item.bomId;
        const visibleBomIds = [
          ...new Set([
            ...(availableBomIds ?? []),
            ...(selectedBomId ? [selectedBomId] : []),
          ]),
        ];
        return {
          ...item,
          availableBomIds,
          closedBomIds: visibleBomIds.filter((id) => closedBomSet.has(id)),
          costWarnings: costWarnings.get(item.id) ?? [],
          quantity: item.quantity != null ? Number(item.quantity) : 0,
          productCost: item.productCost != null ? Number(item.productCost) : null,
          cost: item.cost != null ? Number(item.cost) : null,
          discount: item.discount != null ? Number(item.discount) : null,
          vaPercent: item.vaPercent != null ? Number(item.vaPercent) : null,
          quotedRate: item.quotedRate || null,
        };
      }),
    }));
  }

  let summary: EnquirySummary | null = null;
  if (includeSummary && itemRows && closureRows) {
    let totalValueGst = 0;
    let totalValueExclGst = 0;
    let totalCost = 0;
    let totalQuantity = 0;
    for (const row of itemRows) {
      const gst = toNumber(row.gst);
      if (gst !== null && gst !== 0) totalValueGst += gst;
      const excl = toNumber(row.excl);
      if (excl !== null && excl !== 0) totalValueExclGst += excl;

      const cost = toNumber(row.cost);
      if (cost !== null && cost > 0) {
        const qty = toNumber(row.qty);
        totalCost += cost * (qty !== null && qty > 0 ? qty : 1);
      }
      const qty = toNumber(row.qty);
      if (qty !== null && qty > 0) totalQuantity += qty;
    }

    const closureCounts: ClosureCounts = {};
    let notSentCount = 0;
    for (const row of closureRows) {
      const status = (row.status ?? "").trim();
      const count = Number(row.count ?? 0);
      if (status === "" || status === "-") {
        notSentCount += count;
        continue;
      }
      closureCounts[status] = (closureCounts[status] ?? 0) + count;
    }

    const stageAgeing: EnquirySummary["stageAgeing"] = {};
    for (const row of ageRows ?? []) {
      if (!row.stage) continue;
      const buckets = (stageAgeing[row.stage] ??= {});
      const bucket = ageBucket(Number(row.days));
      buckets[bucket] = (buckets[bucket] ?? 0) + Number(row.count);
    }

    summary = {
      filteredEnquiries: scopedCountRows ? Number(scopedCountRows[0]?.count ?? 0) : total,
      analyticsItems: itemRows.length,
      totalValueGst,
      totalValueExclGst,
      totalCost,
      totalQuantity,
      closureCounts,
      notSentCount,
      totalEnquiries: totalRows ?? 0,
      stageCounts: Object.fromEntries(
        (stageRows ?? []).filter((r) => r.stage).map((r) => [r.stage, Number(r.count)]),
      ),
      stageAgeing,
      assigneePending: (ownerRows ?? []).map((r) => ({
        userId: r.userId,
        name: r.name ?? "Unassigned",
        stage: r.stage,
        count: Number(r.count),
      })),
      facetCounts: Object.fromEntries(
        SIDEBAR_COUNT_FIELDS.map((field, i) => [
          field,
          Object.fromEntries(
            (facetRows?.[i] ?? [])
              .filter((r) => r.value != null && r.value.trim() !== "")
              .map((r) => [r.value!.trim(), Number(r.count)]),
          ),
        ]),
      ),
    };
  }

  return { enquiries, total, summary };
}

/**
 * Every docket number, unfiltered - for the "original docket" picker, which
 * must reach dockets outside the table's current page and filters.
 */
export async function fetchDocketNumbers(): Promise<string[]> {
  await requireAccess();
  const rows = await prisma.$queryRaw<{ docketNumber: string }[]>`
    SELECT "docketNumber" FROM "Enquiry" ORDER BY "createdAt" DESC
  `;
  return rows.map((r) => r.docketNumber);
}

/** Distinct values for one cascading dropdown, excluding its own filter. */
export async function fetchEnquiryFacet(
  query: EnquiryQuery,
  field: string,
): Promise<EnquiryFacetResult> {
  await requireAccess();
  const facet = facetExpression(field);
  if (!facet) return { field, options: [] };

  const rows =
    facet.level === "enquiry"
      ? await prisma.$queryRaw<{ value: string | null }[]>`
          SELECT DISTINCT ${facet.expr} AS value
          FROM "Enquiry" e
          WHERE ${buildEnquiryWhereSql(query, { skipField: field })}
            AND EXISTS (
              SELECT 1 FROM "EnquiryItem" i
              WHERE i."enquiryId" = e.id
                AND ${buildItemWhereSql(query, { skipField: field })}
            )
            AND ${facet.expr} IS NOT NULL
          ORDER BY 1
          LIMIT ${FACET_LIMIT + 1}
        `
      : await prisma.$queryRaw<{ value: string | null }[]>`
          SELECT DISTINCT ${facet.expr} AS value
          FROM "EnquiryItem" i
          JOIN "Enquiry" e ON e.id = i."enquiryId"
          WHERE ${buildEnquiryWhereSql(query, { skipField: field })}
            AND ${buildItemWhereSql(query, { skipField: field })}
            AND ${facet.expr} IS NOT NULL
          ORDER BY 1
          LIMIT ${FACET_LIMIT + 1}
        `;

  const options = rows
    .map((r) => (r.value == null ? "" : String(r.value).trim()))
    .filter((v) => v !== "" && v !== "undefined" && v !== "null")
    .slice(0, FACET_LIMIT);
  return { field, options };
}

/** Every enquiry (and item) id matching the filters - for select-all / bulk actions. */
export async function fetchFilteredEnquiryIds(query: EnquiryQuery): Promise<FilteredIds> {
  await requireAccess();
  const tableQuery = { ...query, selectedEnquiryIds: [] };
  const where = buildEnquiryWhereSql(tableQuery);
  const itemWhere = buildItemWhereSql(tableQuery);
  const [enquiryRows, itemRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM "Enquiry" e WHERE ${where}
    `,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM "EnquiryItem" i
      JOIN "Enquiry" e ON e.id = i."enquiryId"
      WHERE ${where} AND ${itemWhere}
    `,
  ]);
  return {
    enquiryIds: enquiryRows.map((r) => r.id),
    itemIds: itemRows.map((r) => r.id),
  };
}

/** Every matching enquiry with its items - used by the Excel export. */
export async function fetchFilteredEnquiryExport(
  query: EnquiryQuery,
): Promise<EnquiryPageResult["enquiries"]> {
  await requireAccess();
  const tableQuery = { ...query, selectedEnquiryIds: [] };
  const where = buildEnquiryWhereSql(tableQuery);
  const { orderBy, needsFirstItem } = buildEnquiryOrderBySql(tableQuery);
  const idRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM "Enquiry" e
    ${needsFirstItem ? FIRST_ITEM_JOIN_SQL : Prisma.empty}
    WHERE ${where}
    ORDER BY ${orderBy}
  `;
  const ids = idRows.map((r) => r.id);
  if (ids.length === 0) return [];

  const rows = await prisma.enquiry.findMany({
    where: { id: { in: ids } },
    include: {
      items: { orderBy: { position: "asc" } },
      attachments: true,
    },
  });
  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return rows.map((enquiry) => ({
    ...enquiry,
    items: enquiry.items.map((item) => ({
      ...item,
      quantity: item.quantity != null ? Number(item.quantity) : 0,
      productCost: item.productCost != null ? Number(item.productCost) : null,
      cost: item.cost != null ? Number(item.cost) : null,
      discount: item.discount != null ? Number(item.discount) : null,
      vaPercent: item.vaPercent != null ? Number(item.vaPercent) : null,
      quotedRate: item.quotedRate || null,
    })),
  }));
}
