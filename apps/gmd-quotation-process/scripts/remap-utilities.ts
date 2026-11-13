/**
 * Remap of stored utility text to the standard utility list: the active UTILITY
 * LookupOption values, with the master full names and
 * data/utility-old-new-mapping.csv as aliases (loadUtilityResolver).
 *
 * Tables: Enquiry, SupplyHistoryItem (quotation DB); SupplyHistory,
 * SmartsheetTender (tender DB). ContractReview.utility is NOT touched here; it
 * is recomputed from Enquiry by `pnpm cr:backfill-enquiry:apply` afterwards.
 *
 * - Match: trimmed, case/space-insensitive.
 * - "Move to Project Reference" rows: Enquiry.projectReference gets the sheet's
 *   project reference (blank → set, else append "; <ref>").
 * - VERIFY rows are never updated; they are written to a CSV for manual review.
 * - Unmatched values are never updated; the dry run lists them per table. That
 *   list is the unknown-utilities report to review before --apply.
 * - --apply: per DB, one transaction that first creates backup tables
 *   "_bak_utility_YYYYMMDD_<Table>" (id, utility, projectReference).
 *
 * Usage:
 *   npx tsx scripts/remap-utilities.ts                      # dry run
 *   npx tsx scripts/remap-utilities.ts --apply
 *   npx tsx scripts/remap-utilities.ts --verify-out=path.csv
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { prisma as quotation } from "../lib/prisma";
import { prisma as tender } from "@gmd/db-tender";
import { mergeProjectReference } from "@gmd/contract-review/utility-master";
import { loadUtilityResolver } from "@gmd/contract-review/server/utility";

const APPLY = process.argv.includes("--apply");
const DATA = path.join(__dirname, "..", "data");
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const VERIFY_OUT =
  process.argv.find((a) => a.startsWith("--verify-out="))?.split("=")[1] ??
  path.join(DATA, `utility-verify-${STAMP}.csv`);

type Row = { id: string; utility: string | null; projectReference?: string | null; ref: string };
type Table = {
  db: "quotation" | "tender";
  table: string;
  hasProjectReference: boolean;
  load: () => Promise<Row[]>;
};

const TABLES: Table[] = [
  {
    db: "quotation",
    table: "Enquiry",
    hasProjectReference: true,
    load: async () =>
      (await quotation.enquiry.findMany({
        where: { utility: { not: null } },
        select: { id: true, utility: true, projectReference: true, docketNumber: true },
      })).map((r) => ({ ...r, ref: `docket ${r.docketNumber}` })),
  },
  {
    db: "quotation",
    table: "SupplyHistoryItem",
    hasProjectReference: false,
    load: async () =>
      (await quotation.supplyHistoryItem.findMany({
        where: { utility: { not: null } },
        select: { id: true, utility: true, erpContractNo: true },
      })).map((r) => ({ ...r, ref: `contract ${r.erpContractNo ?? ""}` })),
  },
  {
    db: "tender",
    table: "SupplyHistory",
    hasProjectReference: false,
    load: async () =>
      (await tender.supplyHistory.findMany({
        where: { utility: { not: null } },
        select: { id: true, utility: true, docketNo: true, contractVrNo: true },
      })).map((r) => ({ ...r, ref: `docket ${r.docketNo ?? ""} / contract ${r.contractVrNo ?? ""}` })),
  },
  {
    db: "tender",
    table: "SmartsheetTender",
    hasProjectReference: false,
    load: async () =>
      (await tender.smartsheetTender.findMany({
        where: { utility: { not: null } },
        select: { id: true, utility: true, docketNumber: true },
      })).map((r) => ({ ...r, ref: `docket ${r.docketNumber ?? ""}` })),
  },
];

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  console.log(`\n=== REMAP UTILITIES [${APPLY ? "APPLY" : "DRY RUN"}] ===\n`);
  const resolve = await loadUtilityResolver();

  const verifyLines = ["table,id,ref,oldValue"];
  const plans = new Map<Table, { id: string; utility: string; projectReference?: string | null }[]>();

  for (const t of TABLES) {
    const rows = await t.load();
    const counts = new Map<string, number>();
    const unmatched = new Map<string, number>();
    const updates: { id: string; utility: string; projectReference?: string | null }[] = [];
    for (const r of rows) {
      const old = r.utility ?? "";
      const res = resolve(old);
      if (res.kind === "verify") {
        verifyLines.push([t.table, r.id, r.ref, old].map(csvCell).join(","));
        continue;
      }
      if (res.kind === "unmatched") {
        if (old.trim()) unmatched.set(old, (unmatched.get(old) ?? 0) + 1);
        continue;
      }
      const projectReference = t.hasProjectReference
        ? mergeProjectReference(r.projectReference, res.projectReference)
        : undefined;
      const changed =
        res.utility !== old || (t.hasProjectReference && projectReference !== (r.projectReference ?? null));
      if (!changed) continue;
      updates.push({ id: r.id, utility: res.utility, projectReference });
      const key = `${old} -> ${res.utility}${res.projectReference && t.hasProjectReference ? ` (+ref "${res.projectReference}")` : ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    plans.set(t, updates);

    console.log(`--- ${t.db}.${t.table}: ${rows.length} rows with utility, ${updates.length} to update ---`);
    for (const [k, n] of [...counts].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);
    if (unmatched.size) {
      console.log(`  unmatched distinct values (${unmatched.size}):`);
      for (const [k, n] of [...unmatched].sort()) console.log(`  ${String(n).padStart(5)}  ${JSON.stringify(k)}`);
    }
    console.log();
  }

  writeFileSync(VERIFY_OUT, verifyLines.join("\n") + "\n", "utf8");
  console.log(`VERIFY records (not updated): ${verifyLines.length - 1} -> ${VERIFY_OUT}\n`);

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write.");
    return;
  }

  for (const [db, client] of [["quotation", quotation], ["tender", tender]] as const) {
    const tables = TABLES.filter((t) => t.db === db && plans.get(t)!.length > 0);
    if (!tables.length) continue;
    await (client as any).$transaction(
      async (tx: any) => {
        for (const t of tables) {
          const bak = `_bak_utility_${STAMP}_${t.table}`;
          const pr = t.hasProjectReference ? `"projectReference"` : `NULL::text AS "projectReference"`;
          // IF NOT EXISTS: a same-day re-run keeps the first (pre-remap) backup.
          await tx.$executeRawUnsafe(
            `CREATE TABLE IF NOT EXISTS "${bak}" AS SELECT "id", "utility", ${pr} FROM "${t.table}"`,
          );
          const delegate = tx[t.table[0].toLowerCase() + t.table.slice(1)];
          for (const u of plans.get(t)!) {
            await delegate.update({
              where: { id: u.id },
              data: t.hasProjectReference
                ? { utility: u.utility, projectReference: u.projectReference }
                : { utility: u.utility },
            });
          }
          console.log(`Applied ${plans.get(t)!.length} updates to ${db}.${t.table} (backup "${bak}")`);
        }
      },
      { timeout: 600_000, maxWait: 30_000 },
    );
  }

  console.log("\nNext: pnpm cr:backfill-enquiry (dry run), then pnpm cr:backfill-enquiry:apply");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await quotation.$disconnect();
    await tender.$disconnect();
  });
