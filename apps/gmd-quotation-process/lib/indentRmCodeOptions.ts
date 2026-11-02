import { valveTypesForIndentItem } from "@/lib/indentItemValveTypes";
import { rmCodeSizeKey } from "@/lib/indentRmCodeResolver";

export interface RmCodeOption {
  code: string;
  name: string;
  valveType: string;
  size: string;
}

/**
 * True when a raw material may be offered / saved for an indent row: same
 * L2 valve type and same L3 size. An item with no mapped type (CF, DV, blank)
 * is matched on size only. Shared by the dropdown and the save-time check.
 */
export function rmOptionFitsIndentRow(
  option: Pick<RmCodeOption, "valveType" | "size">,
  item: string | null | undefined,
  size: string | null | undefined,
): boolean {
  const types = valveTypesForIndentItem(item);
  if (
    types.length > 0 &&
    !types.includes(option.valveType.trim().replace(/\s+/g, " ").toUpperCase())
  )
    return false;
  const optionSize = rmCodeSizeKey(option.size);
  const rowSize = rmCodeSizeKey(size);
  // Puja: TPAV 20/25 use the 12.5 small-orifice model (RZR030019).
  if (optionSize === "12.5" && (rowSize === "20" || rowSize === "25") && types.includes("TPAV")) return true;
  return optionSize === rowSize;
}
