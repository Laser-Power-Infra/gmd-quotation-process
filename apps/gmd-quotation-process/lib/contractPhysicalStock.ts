/**
 * The PHYSICAL STOCK column of a Contract Review row: the total quantity of the
 * row's own item code (its finished-goods code) in the stock DB `PhysicalStock`
 * table (the Physical Stock page), summed over locations / duplicate rows.
 * When the table has no usable row for that code, the `stock-phys` sheet's
 * figure for the same code is used; otherwise `null` (a blank cell).
 *
 * Never looked up through `costCodeRef`: that is one RM code shared by a whole
 * item family / size / PN. The RM / BOM route is the separate RM AVAIL column.
 */

export interface ContractPhysicalStockRow {
  id: string;
  itemCode: string;
}

export type PhysicalStockSource = "table" | "sheet";

const codeKey = (code: string | null | undefined) => (code ?? "").trim().toUpperCase();

// Same reading as the Stock Allocation engine's `qty` (packages/stock-allocation/src/server/index.ts):
// commas stripped, blank / non-numeric = no figure.
function parseStock(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function formatStock(total: number): string {
  // Drop floating-point noise without forcing decimals onto whole numbers.
  return String(Number(total.toFixed(3)));
}

/** Sums `available_qty` (the field the engine reads as a stock row's physical quantity) per normalised code. */
export function sumTablePhysicalStock(
  rows: { erp_code: string | null; available_qty: string | null }[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const code = codeKey(r.erp_code);
    const qty = parseStock(r.available_qty);
    if (code && qty !== null) totals[code] = (totals[code] ?? 0) + qty;
  }
  return totals;
}

type Resolved = { value: string | null; source: PhysicalStockSource | null };

export function resolveContractPhysicalStock(
  rows: ContractPhysicalStockRow[],
  sheetByErpCode: Record<string, string>,
  tableByErpCode: Record<string, number> = {},
): Map<string, Resolved> {
  const result = new Map<string, Resolved>();

  for (const row of rows) {
    const code = codeKey(row.itemCode);
    const fromTable = Object.hasOwn(tableByErpCode, code) ? tableByErpCode[code] : null;
    const fromSheet = fromTable === null && code ? parseStock(sheetByErpCode[code]) : null;
    result.set(
      row.id,
      fromTable !== null
        ? { value: formatStock(fromTable), source: "table" }
        : fromSheet !== null
          ? { value: formatStock(fromSheet), source: "sheet" }
          : { value: null, source: null },
    );
  }

  return result;
}

export function planContractPhysicalStock(
  rows: ContractPhysicalStockRow[],
  sheetByErpCode: Record<string, string>,
  tableByErpCode: Record<string, number> = {},
): Map<string, string | null> {
  const resolved = resolveContractPhysicalStock(rows, sheetByErpCode, tableByErpCode);
  return new Map([...resolved].map(([id, r]) => [id, r.value]));
}
