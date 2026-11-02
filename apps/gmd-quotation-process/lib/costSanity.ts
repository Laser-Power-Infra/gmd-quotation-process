import { Prisma } from "@gmd/db-quotation";

/**
 * Cost sanity warnings for quotation items. SQL on an EnquiryItem alias so the
 * same rules drive the per-item warning and the dashboard filter. Warn only.
 *
 * 1. SIZE: in one docket, items of the same type + MOC + PN + operation sorted
 *    by size; a smaller size whose product cost is above 80% of the NEXT larger
 *    size's cost flags BOTH items of that pair.
 * 2. ACTUATOR: operation type contains "ACT" and contract review rate is at
 *    least 3x the product cost (both > 0): the actuator cost looks missing.
 * 3. NEGATIVE_VA: VA% below 0.
 *
 * Each warning is its own reason text (with the figures). evaluateCostWarnings
 * is a plain-TS mirror of the same rules, used by the tests (no DB there).
 */

const sql = Prisma.sql;

export const COST_WARNING = {
  NEGATIVE_VA: "VA% below 0",
} as const;

export const SIZE_COST_RATIO = 0.8;
export const ACTUATOR_RATE_MULTIPLE = 3;

const norm = (expr: Prisma.Sql) => sql`upper(btrim(coalesce(${expr}, '')))`;
// First number in the size text ("50", "DN 50", "50MM"); NULL when there is none.
const sizeNum = (a: Prisma.Sql) => sql`substring(${a}."size" from '[0-9]+(?:[.][0-9]+)?')::numeric`;
const money = (expr: Prisma.Sql) => sql`to_char(round(${expr}), 'FM999,999,999,990')`;
// contractReviewRate is free text ("70,700", "Rs 70700"): keep digits and the dot.
const rateNum = (i: Prisma.Sql) =>
  sql`nullif(regexp_replace(coalesce(${i}."contractReviewRate", ''), '[^0-9.]', '', 'g'), '')::numeric`;

// Sibling in the same docket and group; the caller adds the size comparison.
const sameGroup = (i: Prisma.Sql) => sql`w."enquiryId" = ${i}."enquiryId" AND w.id <> ${i}.id
      AND ${norm(sql`w."itemType"`)} = ${norm(sql`${i}."itemType"`)}
      AND ${norm(sql`w."moc"`)} = ${norm(sql`${i}."moc"`)}
      AND ${norm(sql`w."pnRating"`)} = ${norm(sql`${i}."pnRating"`)}
      AND ${norm(sql`w."operationType"`)} = ${norm(sql`${i}."operationType"`)}
      AND w."productCost" > 0 AND ${i}."productCost" > 0`;

/** Reason text when the item is half of an out-of-order size pair, else NULL. */
function sizeReasonSql(i: Prisma.Sql): Prisma.Sql {
  const text = (small: Prisma.Sql, large: Prisma.Sql) =>
    sql`format('%s costs ₹%s vs %s ₹%s (same type/MOC/PN)', ${small}."size", ${money(sql`${small}."productCost"`)}, ${large}."size", ${money(sql`${large}."productCost"`)})`;
  return sql`(CASE WHEN ${norm(sql`${i}."itemType"`)} = '' THEN NULL ELSE coalesce(
    (SELECT CASE WHEN ${i}."productCost" > ${SIZE_COST_RATIO} * w."productCost" THEN ${text(i, sql`w`)} END
       FROM "EnquiryItem" w WHERE ${sameGroup(i)} AND ${sizeNum(sql`w`)} > ${sizeNum(i)}
       ORDER BY ${sizeNum(sql`w`)}, w.id LIMIT 1),
    (SELECT CASE WHEN w."productCost" > ${SIZE_COST_RATIO} * ${i}."productCost" THEN ${text(sql`w`, i)} END
       FROM "EnquiryItem" w WHERE ${sameGroup(i)} AND ${sizeNum(sql`w`)} < ${sizeNum(i)}
       ORDER BY ${sizeNum(sql`w`)} DESC, w.id LIMIT 1)
  ) END)`;
}

function actuatorReasonSql(i: Prisma.Sql): Prisma.Sql {
  return sql`(CASE WHEN ${norm(sql`${i}."operationType"`)} LIKE '%ACT%'
      AND ${i}."productCost" > 0 AND ${rateNum(i)} >= ${ACTUATOR_RATE_MULTIPLE} * ${i}."productCost"
    THEN format('Motorised item: cost ₹%s vs contract ₹%s, actuator cost looks missing', ${money(sql`${i}."productCost"`)}, ${money(rateNum(i))}) END)`;
}

function negativeVaSql(i: Prisma.Sql): Prisma.Sql {
  const va = sql`btrim(${i}."vaPercent")`;
  return sql`(CASE WHEN ${va} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${va}::numeric < 0 ELSE false END)`;
}

/** text[] of warning reasons that apply to the item (empty when none). */
export function costWarningsSql(i: Prisma.Sql): Prisma.Sql {
  return sql`array_remove(ARRAY[
    ${sizeReasonSql(i)},
    ${actuatorReasonSql(i)},
    CASE WHEN ${negativeVaSql(i)} THEN ${COST_WARNING.NEGATIVE_VA} END
  ]::text[], NULL)`;
}

/** Predicate: the item has at least one cost warning. */
export function hasCostWarningSql(i: Prisma.Sql): Prisma.Sql {
  return sql`cardinality(${costWarningsSql(i)}) > 0`;
}

export interface CostItem {
  id: string;
  enquiryId: string;
  itemType?: string | null;
  moc?: string | null;
  pnRating?: string | null;
  operationType?: string | null;
  size?: string | null;
  productCost?: number | null;
  contractReviewRate?: string | null;
  vaPercent?: string | null;
}

/** Plain-TS mirror of costWarningsSql; returns warnings per item id. */
export function evaluateCostWarnings(items: CostItem[]): Map<string, string[]> {
  const n = (v?: string | null) => (v ?? "").trim().toUpperCase();
  const num = (v?: string | null) => parseFloat(/[0-9]+(?:\.[0-9]+)?/.exec(v ?? "")?.[0] ?? "");
  const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  const out = new Map<string, string[]>();
  const add = (id: string, w: string) => out.set(id, [...(out.get(id) ?? []), w]);
  const groups = new Map<string, CostItem[]>();
  for (const it of items) {
    if (!n(it.itemType) || !(it.productCost! > 0) || isNaN(num(it.size))) continue;
    const k = [it.enquiryId, it.itemType, it.moc, it.pnRating, it.operationType].map(n).join("|");
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => num(a.size) - num(b.size));
    for (let x = 0; x + 1 < g.length; x++) {
      const [s, l] = [g[x], g[x + 1]];
      if (num(s.size) === num(l.size) || !(s.productCost! > SIZE_COST_RATIO * l.productCost!)) continue;
      const why = `${s.size} costs ${inr(s.productCost!)} vs ${l.size} ${inr(l.productCost!)} (same type/MOC/PN)`;
      add(s.id, why);
      add(l.id, why);
    }
  }
  for (const it of items) {
    const rate = parseFloat((it.contractReviewRate ?? "").replace(/[^0-9.]/g, ""));
    if (n(it.operationType).includes("ACT") && it.productCost! > 0 && rate >= ACTUATOR_RATE_MULTIPLE * it.productCost!)
      add(it.id, `Motorised item: cost ${inr(it.productCost!)} vs contract ${inr(rate)}, actuator cost looks missing`);
    if (parseFloat(it.vaPercent ?? "") < 0) add(it.id, COST_WARNING.NEGATIVE_VA);
  }
  return out;
}
