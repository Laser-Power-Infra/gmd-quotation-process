import "server-only";
import { resolvePhysicalStockFlags, type PhysicalStockFlags } from "@gmd/physical-stock/flags";
import { BLANK_ONLY_HEADERS } from "@gmd/physical-stock/columns";
import { isPrivileged } from "@/lib/auth-helpers";
import {
  physicalStockDuplicateErpHighlight,
  physicalStockEditableColumns,
  physicalStockHiddenColumns,
  physicalStockHiddenSidebar,
  physicalStockNewItem,
} from "@/flags";

/** Evaluates this app's Physical Stock flags for the current request. */
export async function getPhysicalStockFlags(): Promise<PhysicalStockFlags> {
  const [hiddenColumns, editableColumns, hiddenSidebar, newItem, duplicateErpHighlight, privileged] = await Promise.all([
    physicalStockHiddenColumns(),
    physicalStockEditableColumns(),
    physicalStockHiddenSidebar(),
    physicalStockNewItem(),
    physicalStockDuplicateErpHighlight(),
    isPrivileged(),
  ]);
  // Blank ERP CODE + L/Dia dropdowns: admin/developer only.
  return resolvePhysicalStockFlags({
    hiddenColumns,
    editableColumns: privileged ? [...editableColumns, ...BLANK_ONLY_HEADERS] : editableColumns,
    hiddenSidebar,
    newItem,
    duplicateErpHighlight,
  });
}
