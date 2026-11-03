import "server-only";
import { stockPrisma } from "@gmd/db-stock";
import {
  BLANK_ONLY_HEADERS,
  addQty,
  isGeneratedErpCode,
  itemKey,
  mergeRows,
  computeAvailableQty,
  computeItemWiseValue,
  computeMajorMinorMarking,
  fieldOf,
  buildSerial,
} from "../columns";
import { outOfTolerance } from "../dimensions";
import type { DimensionStandard, DimensionValues } from "../dimensions";
import { NEW_ITEM_FIELDS } from "../types";
import { fgMatcher, type CodeOptions } from "../codeOptions";
import type { ActionResult, FieldUpdate, HeatEntryRow, HeatQueueItem, HeatSerial, NewItemInput, PhysicalStockRow } from "../types";

// Pure operations on the PhysicalStock table (stock DB). No auth, no flags
// lookup: the host app's Server Actions own those and pass the allow-list in.

const BLANK_ONLY_FIELDS = new Set<string>(BLANK_ONLY_HEADERS.map((h) => fieldOf(h)!));
// location + L columns: what makes two rows the same item (see itemKey).
const IDENTITY_FIELDS = new Set<string>([...BLANK_ONLY_FIELDS].filter((f) => f !== "erp_code"));

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const HEAT_ENTRIES = { heat_entries: { orderBy: { created_at: "asc" as const } } };
type StockWithHeats = NonNullable<Awaited<ReturnType<typeof findStockWithHeats>>>;
const findStockWithHeats = (id: string) =>
  stockPrisma.physicalStock.findUnique({ where: { id }, include: HEAT_ENTRIES });

/** Comma-joined heat nos and serials for the grid; nulls when the row has no entries. */
function heatColumns(row: StockWithHeats): Pick<PhysicalStockRow, "heat_no" | "serial_no"> {
  if (!row.heat_entries.length) return { heat_no: null, serial_no: null };
  return {
    heat_no: [...new Set(row.heat_entries.map((e) => e.heat_no))].join(", "),
    serial_no: row.heat_entries.map((e) => buildSerial(row, e)).join(", "),
  };
}

export async function listPhysicalStock(): Promise<PhysicalStockRow[]> {
  const items = await stockPrisma.physicalStock.findMany({
    orderBy: [{ form_date: "desc" }, { created_at: "desc" }, { id: "asc" }],
    include: HEAT_ENTRIES,
  });
  // Table missing until the db-stock migration is deployed: no FG columns, the page still loads.
  const fg = await stockPrisma.fgBomOption.findMany({ orderBy: { fgCode: "asc" } }).catch(() => []);
  const matchFg = fgMatcher(fg);
  return items.map((item) => {
    const { created_at: _c, updated_at: _u, form_date, heat_entries: _h, ...rest } = item;
    return {
      ...rest,
      form_date: form_date ? form_date.toISOString() : null,
      ...heatColumns(item),
      ...matchFg(item),
      // Filled by the host app's load() from @gmd/purchase; null = not looked up.
      in_transit: null,
      incoming_from: null,
    };
  });
}

/** Synced ERP-code options for the New Item picker (empty until the first hourly sync after the migration). */
export async function listCodeOptions(): Promise<CodeOptions> {
  const [rm, bom] = await Promise.all([
    stockPrisma.rmCodeOption.findMany({
      select: { erpItemCode: true, itemName: true, l8Category: true },
      orderBy: { erpItemCode: "asc" },
    }),
    stockPrisma.bomCodeOption.findMany({
      select: { bomId: true, valveType: true, size: true, pn: true, bomType: true, erpItemCode: true },
    }),
  ]);
  return { rm, bom };
}

/**
 * Runs `write` with the next heat_seq for `heat_no` (highest + 1, shared by every
 * item under that heat). The unique (heat_no, heat_seq) index rejects a
 * concurrent writer that picked the same number (P2002): re-read and retry.
 */
async function withHeatSeq<T>(heatNo: string, write: (heatSeq: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { _max } = await stockPrisma.heatEntry.aggregate({
      where: { heat_no: heatNo },
      _max: { heat_seq: true },
    });
    try {
      return await write((_max.heat_seq ?? 0) + 1);
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }
  throw new Error("Could not assign a heat serial number.");
}

// ---- Heat entry (mobile form) -------------------------------------------

const toEntryRow = (row: StockWithHeats, e: StockWithHeats["heat_entries"][number]): HeatEntryRow => ({
  id: e.id,
  heat_no: e.heat_no,
  heat_seq: e.heat_seq,
  serial_no: buildSerial(row, e),
  sheet_file_id: e.sheet_file_id,
});

function toQueueItem(row: StockWithHeats): HeatQueueItem {
  return {
    id: row.id,
    erp_code: row.erp_code,
    location: row.location,
    description: [row.l2_valve_type, row.dimension, row.l4_component, row.l5_material, row.l6_std, row.l7_dimension]
      .filter((v) => String(v ?? "").trim())
      .join(" / "),
    entries: row.heat_entries.map((e) => toEntryRow(row, e)),
  };
}

/** Every assigned serial with its stock row's valve type and size, for screens that record details against a serial. */
export async function listHeatSerials(): Promise<HeatSerial[]> {
  const entries = await stockPrisma.heatEntry.findMany({ include: { physical_stock: true }, orderBy: { created_at: "desc" } });
  return entries.map((e) => ({
    id: e.id,
    serial_no: buildSerial(e.physical_stock, e),
    valve_type: e.physical_stock.l2_valve_type,
    size: e.physical_stock.dimension,
  }));
}

export async function listHeatCategories(): Promise<string[]> {
  const rows = await stockPrisma.physicalStock.findMany({
    where: { l8_item_category: { not: null }, erp_code: { not: null } },
    distinct: ["l8_item_category"],
    select: { l8_item_category: true },
    orderBy: { l8_item_category: "asc" },
  });
  return rows.map((r) => r.l8_item_category!).filter((c) => c.trim());
}

/** Coded rows of a category not yet marked done, oldest first: the form walks these in order. */
export async function listHeatQueue(category: string): Promise<HeatQueueItem[]> {
  const rows = await stockPrisma.physicalStock.findMany({
    where: { l8_item_category: category, heat_done: false, erp_code: { not: null } },
    orderBy: { created_at: "asc" },
    include: HEAT_ENTRIES,
  });
  return rows.filter((r) => String(r.erp_code).trim()).map(toQueueItem);
}

/** Reserves the next serial of `heatNo` for the row; the sheet is attached later. */
export async function addHeatEntry(stockId: string, heatNo: string): Promise<ActionResult<HeatEntryRow>> {
  return run(async () => {
    const heat = heatNo.trim().toUpperCase();
    if (!heat) throw new Error("Enter the heat no.");
    const row = await findStockWithHeats(stockId);
    if (!row) throw new Error("Physical stock row not found.");
    if (!String(row.erp_code ?? "").trim()) throw new Error("This row has no ERP CODE.");
    if (row.heat_entries.some((e) => !e.sheet_file_id)) throw new Error("Upload the sheet of the previous serial first.");
    const entry = await withHeatSeq(heat, (heat_seq) =>
      stockPrisma.heatEntry.create({ data: { physical_stock_id: stockId, heat_no: heat, heat_seq } }),
    );
    return toEntryRow(row, entry);
  });
}

export async function attachHeatSheet(entryId: string, sheetFileId: string): Promise<ActionResult<HeatEntryRow>> {
  return run(async () => {
    const entry = await stockPrisma.heatEntry.update({
      where: { id: entryId },
      data: { sheet_file_id: sheetFileId },
      include: { physical_stock: { include: HEAT_ENTRIES } },
    });
    return toEntryRow(entry.physical_stock, entry);
  });
}

/** Drops a reserved serial whose sheet was never uploaded (its number is left as a gap). */
export async function deletePendingHeatEntry(entryId: string): Promise<ActionResult<null>> {
  return run(async () => {
    const entry = await stockPrisma.heatEntry.findUnique({ where: { id: entryId } });
    if (!entry) return null;
    if (entry.sheet_file_id) throw new Error("A serial with an uploaded sheet cannot be removed.");
    await stockPrisma.heatEntry.delete({ where: { id: entryId } });
    return null;
  });
}

export async function setHeatDone(stockId: string): Promise<ActionResult<null>> {
  return run(async () => {
    const pending = await stockPrisma.heatEntry.count({ where: { physical_stock_id: stockId, sheet_file_id: null } });
    if (pending) throw new Error("Upload the sheet of every serial before Done.");
    await stockPrisma.physicalStock.update({ where: { id: stockId }, data: { heat_done: true } });
    return null;
  });
}

/**
 * Writes one field. `allowed` comes from editableFieldsFor(flags) and is
 * checked before any DB access. Side effects:
 *   - received/dispatch qty recompute available_qty (when both are present)
 *   - cost or available qty recompute item_wise_value
 *   - erp_code may only fill a blank code
 * Returns every field that changed so the page can merge it.
 */
export async function updatePhysicalStockField(
  id: string,
  field: string,
  value: string | null,
  allowed: ReadonlySet<string>,
): Promise<ActionResult<FieldUpdate>> {
  if (!allowed.has(field)) return { success: false, error: `Field "${field}" is not editable.` };
  return run(async () => {
    const row = await findStockWithHeats(id);
    if (!row) throw new Error("Physical stock row not found.");
    // Blank-only columns (ERP CODE, location, the L/Dia dropdowns) may be
    // filled but never overwritten, except on a row with a blank ERP CODE.
    const erpBlank = !String(row.erp_code ?? "").trim();
    const overwritable = erpBlank && field !== "erp_code";
    if (
      BLANK_ONLY_FIELDS.has(field) &&
      !overwritable &&
      String((row as Record<string, unknown>)[field] ?? "").trim()
    ) {
      throw new Error(`"${field}" is already filled.`);
    }

    const stored = field === "location" ? value?.trim().toUpperCase() || null : value ?? null;
    const next = { ...row, [field]: stored };
    const changes: Record<string, string | null> = { [field]: stored };

    if (field === "received_qty" || field === "dispatch_qty") {
      const available = computeAvailableQty(next.received_qty, next.dispatch_qty);
      if (available !== null) changes.available_qty = next.available_qty = available;
    }
    if ("cost" in changes || "available_qty" in changes) {
      changes.item_wise_value = computeItemWiseValue(next.cost, next.available_qty);
    }

    await stockPrisma.physicalStock.update({ where: { id }, data: changes });

    // A blank-ERP row whose location + L columns now equal exactly one
    // coded row is folded into it. Zero or several matches: leave it alone.
    if (erpBlank && IDENTITY_FIELDS.has(field) && String(next.location ?? "").trim()) {
      const key = itemKey(next);
      // A row with heat entries is its own serialised item: never merged into.
      const targets = (
        await stockPrisma.physicalStock.findMany({ where: { erp_code: { not: null }, heat_entries: { none: {} } } })
      ).filter((r) => String(r.erp_code).trim() && r.id !== id && itemKey(r) === key);
      if (targets.length === 1) {
        const [target] = targets;
        const merge = mergeRows(target, next);
        // No transaction (P2028 on this connection): update the target first so qty is never lost.
        await stockPrisma.physicalStock.update({ where: { id: target.id }, data: merge });
        await stockPrisma.physicalStock.delete({ where: { id } });
        return {
          merged: {
            erp_code: target.erp_code!,
            received_qty: merge.received_qty,
            dispatch_qty: merge.dispatch_qty,
            available_qty: merge.available_qty ?? target.available_qty,
          },
        } as FieldUpdate;
      }
    }
    // The serial embeds erp_code and l8_item_category: send the refreshed one with the edit.
    return { ...changes, ...(row.heat_entries.length ? heatColumns(next) : {}) } as FieldUpdate;
  });
}

const ERP_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function generateUniqueErpCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < 3; i++) code += ERP_LETTERS[Math.floor(Math.random() * ERP_LETTERS.length)];
    code += String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const exists = await stockPrisma.physicalStock.findFirst({ where: { erp_code: code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error("Could not generate a unique ERP code.");
}

/**
 * New row with an auto-generated unique ERP code; values saved in capitals.
 * If a generated-code row already has the same location + L columns, its
 * received/dispatch qty is added to instead and no new code is minted.
 */
export async function createPhysicalStock(
  input: NewItemInput,
): Promise<ActionResult<{ erp_code: string; merged: boolean }>> {
  return run(async () => {
    const data: Record<string, string | boolean | number | null> = {};
    for (const f of NEW_ITEM_FIELDS) data[f] = input[f]?.trim().toUpperCase() || null;

    // A row with heat entries is its own serialised item: never added into.
    const key = itemKey(data);
    // A picked code must be one of the synced RM / BOM options; none picked = generate one.
    const picked = input.erp_code?.trim() || null;
    if (picked) {
      const [rm, bom] = await Promise.all([
        stockPrisma.rmCodeOption.findUnique({ where: { erpItemCode: picked }, select: { id: true } }),
        stockPrisma.bomCodeOption.findFirst({ where: { erpItemCode: picked }, select: { id: true } }),
      ]);
      if (!rm && !bom) throw new Error(`ERP code ${picked} is not in the Raw Material list.`);
    }
    const generated = await stockPrisma.physicalStock.findMany({
      where: { erp_code: { not: null }, heat_entries: { none: {} } },
      orderBy: { created_at: "asc" },
    });
    const match = generated.find(
      (r) => (picked ? r.erp_code === picked : isGeneratedErpCode(r.erp_code)) && itemKey(r) === key,
    );
    if (match) {
      const received_qty = addQty(match.received_qty, data.received_qty);
      const dispatch_qty = addQty(match.dispatch_qty, data.dispatch_qty);
      const changes: Record<string, string | null> = { received_qty, dispatch_qty };
      const available = computeAvailableQty(received_qty, dispatch_qty);
      if (available !== null) {
        changes.available_qty = available;
        changes.item_wise_value = computeItemWiseValue(match.cost, available);
      }
      await stockPrisma.physicalStock.update({ where: { id: match.id }, data: changes });
      return { erp_code: match.erp_code!, merged: true };
    }

    const erp_code = picked ?? (await generateUniqueErpCode());
    data.erp_code = erp_code;
    const available = computeAvailableQty(data.received_qty, data.dispatch_qty);
    if (available !== null) data.available_qty = available;
    const marking = computeMajorMinorMarking(data.l8_item_category as string | null);
    if (marking !== null) data.majorminor_marking = marking;
    await stockPrisma.physicalStock.create({ data });
    return { erp_code, merged: false };
  });
}

/** Saved dimensional details of a serial no (null when none yet). */
export async function getSerialDimension(stockId: string) {
  return stockPrisma.serialDimension.findUnique({ where: { physical_stock_id: stockId } });
}

/** Saves the inspector's values; flags are recomputed against `standard` here, never trusted from the client. */
export async function saveSerialDimension(
  stockId: string,
  values: DimensionValues,
  standard: DimensionStandard | null,
): Promise<ActionResult<{ flags: string[] }>> {
  return run(async () => {
    const row = await stockPrisma.physicalStock.findUnique({
      where: { id: stockId },
      include: { heat_entries: true },
    });
    if (!row) throw new Error("Physical stock row not found.");
    // Serials now live per heat entry; dimensions need at least one serial on the row.
    if (row.heat_entries.length === 0) throw new Error("Assign a heat no (serial no) before capturing dimensions.");
    const flags = standard ? outOfTolerance(values, standard) : [];
    const data = { values, standard: standard ?? undefined, flags };
    await stockPrisma.serialDimension.upsert({
      where: { physical_stock_id: stockId },
      create: { physical_stock_id: stockId, ...data },
      update: data,
    });
    return { flags };
  });
}
