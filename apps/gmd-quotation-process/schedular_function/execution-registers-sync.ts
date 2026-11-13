/**
 * Step 2 of the `execution-tracking` job: the copies behind /execution_registers.
 *
 *   - MC tab (`mcRegisterGid()`) -> `McRegisterLine`; party from `acc_master`, item name from the ERP masters.
 *   - PROD ORDER DUMP + PROD ENTRY DUMP -> `ProductionRegisterLine`; item name from the ERP masters.
 *
 * The rules live in `lib/executionRegisters.ts`. Neither tab has a unique key, so each table is a
 * snapshot copy: deleted and re-inserted in one transaction, in chunks of 1000, so a failed insert
 * leaves it as it was. A renamed column or a tab with no lines throws before anything is written.
 * Each register reports its own `error` and this never throws, so it cannot fail the SALE BILL step.
 * Dispatch / LR has no copy: it reads `SupplyHistoryItem`, which step 1 keeps current.
 */

import { prisma } from "@/lib/prisma";
import { readSheetTabByGid } from "@/lib/gmd_lib/bomMastErp";
import {
  executionTrackingSpreadsheetId,
  mcRegisterGid,
  normalizeKey,
  prodEntryDumpGid,
  prodOrderDumpGid,
} from "@/lib/gmd_lib/execution-tracking-columns";
import { getAccNameMap } from "@/lib/accMasterLookup";
import { resolveMasterNames } from "@/lib/erpItemNameLookup";
import { buildMcLines, buildProductionLines } from "@/lib/executionRegisters";

const CHUNK = 1000;
const TX = { timeout: 120_000, maxWait: 30_000 };

export type RegisterSyncPart = {
  /** Data rows on the (order) tab. */
  sheetRows: number;
  lines: number;
  /** Blank or repeated-header rows. */
  skipped: number;
  /** 0 on a dry run or a failure. */
  written: number;
  /** Production only: PROD ENTRY DUMP rows whose order + item is not on PROD ORDER DUMP. */
  unmatchedEntries?: number;
  /** Set when the register failed; its table was left as it was. */
  error?: string;
};

export type ExecutionRegistersReport = { mc: RegisterSyncPart; production: RegisterSyncPart };

async function part(name: string, run: () => Promise<RegisterSyncPart>): Promise<RegisterSyncPart> {
  try {
    return await run();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[execution-registers] ${name} failed, table left as it was: ${error}`);
    return { sheetRows: 0, lines: 0, skipped: 0, written: 0, error };
  }
}

export async function runExecutionRegistersSync(options: { dryRun?: boolean } = {}): Promise<ExecutionRegistersReport> {
  const dryRun = options.dryRun ?? false;

  const mc = await part("MC", async () => {
    const tab = await readSheetTabByGid(executionTrackingSpreadsheetId(), mcRegisterGid());
    const { lines, skipped } = buildMcLines(tab);
    const [accNames, itemNames] = await Promise.all([getAccNameMap(), resolveMasterNames(lines.map((l) => l.itemCode ?? ""))]);
    const data = lines.map((l) => ({
      ...l,
      party: accNames.get(normalizeKey(l.accCode)) ?? null,
      itemName: itemNames.get(normalizeKey(l.itemCode)) ?? null,
    }));
    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        await tx.mcRegisterLine.deleteMany();
        for (let i = 0; i < data.length; i += CHUNK) await tx.mcRegisterLine.createMany({ data: data.slice(i, i + CHUNK) });
      }, TX);
    }
    return { sheetRows: tab.rows.length, lines: data.length, skipped, written: dryRun ? 0 : data.length };
  });

  const production = await part("production", async () => {
    const spreadsheetId = executionTrackingSpreadsheetId();
    const [orders, entries] = await Promise.all([
      readSheetTabByGid(spreadsheetId, prodOrderDumpGid()),
      readSheetTabByGid(spreadsheetId, prodEntryDumpGid()),
    ]);
    const { lines, skipped, unmatchedEntries } = buildProductionLines(orders, entries);
    const itemNames = await resolveMasterNames(lines.map((l) => l.itemCode));
    const data = lines.map((l) => ({ ...l, itemName: itemNames.get(normalizeKey(l.itemCode)) ?? null }));
    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        await tx.productionRegisterLine.deleteMany();
        for (let i = 0; i < data.length; i += CHUNK) await tx.productionRegisterLine.createMany({ data: data.slice(i, i + CHUNK) });
      }, TX);
    }
    return { sheetRows: orders.rows.length, lines: data.length, skipped, unmatchedEntries, written: dryRun ? 0 : data.length };
  });

  console.log(
    `[scheduler] execution-registers ${dryRun ? "DRY RUN" : "APPLY"} ` +
      `mc lines=${mc.lines} written=${mc.written}${mc.error ? ` ERROR=${mc.error}` : ""} ` +
      `production lines=${production.lines} written=${production.written} unmatchedEntries=${production.unmatchedEntries ?? 0}` +
      `${production.error ? ` ERROR=${production.error}` : ""}`,
  );
  return { mc, production };
}
