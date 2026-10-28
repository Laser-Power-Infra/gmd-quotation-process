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
} from "../columns";
import { NEW_ITEM_FIELDS } from "../types";
import type { ActionResult, FieldUpdate, NewItemInput, PhysicalStockRow } from "../types";

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

export async function listPhysicalStock(): Promise<PhysicalStockRow[]> {
  const items = await stockPrisma.physicalStock.findMany({
    orderBy: [{ form_date: "desc" }, { created_at: "desc" }],
  });
  return items.map(({ created_at: _c, updated_at: _u, form_date, ...rest }) => ({
    ...rest,
    form_date: form_date ? form_date.toISOString() : null,
  }));
}

/**
 * Writes one field. `allowed` comes from editableFieldsFor(flags) and is
 * checked before any DB access. Side effects:
 *   - received/dispatch qty recompute available_qty (when both are present)
 *   - rate/unit or available qty recompute item_wise_value
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
    const row = await stockPrisma.physicalStock.findUnique({ where: { id } });
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
    if ("rate_unit" in changes || "available_qty" in changes) {
      changes.item_wise_value = computeItemWiseValue(next.rate_unit, next.available_qty);
    }

    await stockPrisma.physicalStock.update({ where: { id }, data: changes });

    // A blank-ERP row whose location + L columns now equal exactly one
    // coded row is folded into it. Zero or several matches: leave it alone.
    if (erpBlank && IDENTITY_FIELDS.has(field) && String(next.location ?? "").trim()) {
      const key = itemKey(next);
      const targets = (await stockPrisma.physicalStock.findMany({ where: { erp_code: { not: null } } })).filter(
        (r) => String(r.erp_code).trim() && r.id !== id && itemKey(r) === key,
      );
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
    return changes as FieldUpdate;
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
    const data: Record<string, string | boolean | null> = {};
    for (const f of NEW_ITEM_FIELDS) data[f] = input[f]?.trim().toUpperCase() || null;

    const key = itemKey(data);
    const generated = await stockPrisma.physicalStock.findMany({
      where: { erp_code: { not: null } },
      orderBy: { created_at: "asc" },
    });
    const match = generated.find((r) => isGeneratedErpCode(r.erp_code) && itemKey(r) === key);
    if (match) {
      const received_qty = addQty(match.received_qty, data.received_qty);
      const dispatch_qty = addQty(match.dispatch_qty, data.dispatch_qty);
      const changes: Record<string, string | null> = { received_qty, dispatch_qty };
      const available = computeAvailableQty(received_qty, dispatch_qty);
      if (available !== null) {
        changes.available_qty = available;
        changes.item_wise_value = computeItemWiseValue(match.rate_unit, available);
      }
      await stockPrisma.physicalStock.update({ where: { id: match.id }, data: changes });
      return { erp_code: match.erp_code!, merged: true };
    }

    const erp_code = await generateUniqueErpCode();
    data.erp_code = erp_code;
    const available = computeAvailableQty(data.received_qty, data.dispatch_qty);
    if (available !== null) data.available_qty = available;
    const marking = computeMajorMinorMarking(data.l8_item_category as string | null);
    if (marking !== null) data.majorminor_marking = marking;
    await stockPrisma.physicalStock.create({ data });
    return { erp_code, merged: false };
  });
}
