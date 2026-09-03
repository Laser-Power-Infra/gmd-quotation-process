import type { EnquiryData, EnquiryItemData, FiltersState } from "./types";

export const BLANK = "__blank__";

export function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === "" || value === "-";
}

export function isBlankSize(value: unknown): boolean {
  return isBlankValue(value) || value === "Not detectable" || value === "Not mentioned/cant detect size";
}

export function getPdCostValidation(item: EnquiryItemData): string | null {
  if (item.contractReviewRate && item.productCost != null) {
    const cr = parseFloat(String(item.contractReviewRate).replace(/,/g, ""));
    const pc = Number(item.productCost);
    if (!isNaN(cr) && !isNaN(pc) && pc !== 0) {
      const val = ((cr - pc) / pc) * 100;
      return `${val.toFixed(2)}%`;
    }
  }
  const pdCostValidation = (item as unknown as Record<string, unknown>)?.pdcostValidation;
  return typeof pdCostValidation === "string" ? pdCostValidation : null;
}

export function matchesMulti(values: string[], actual: unknown, blankCheck: (v: unknown) => boolean = isBlankValue): boolean {
  if (!values || values.length === 0) return true;
  if (values.includes(BLANK) && blankCheck(actual)) return true;
  return values.includes(actual as string);
}

export function matchesMultiCI(values: string[], actual: unknown, blankCheck: (v: unknown) => boolean = isBlankValue): boolean {
  if (!values || values.length === 0) return true;
  if (values.includes(BLANK) && blankCheck(actual)) return true;
  const actualLower = typeof actual === "string" ? actual.toLowerCase() : null;
  return values.some((v) => v.toLowerCase() === actualLower);
}

export function matchesText(filterVal: string, actual: unknown): boolean {
  if (!filterVal) return true;
  if (actual == null) return false;
  return String(actual).toLowerCase().includes(filterVal.toLowerCase());
}

export function enquiryPassesFilters(
  enquiry: EnquiryData,
  filters: FiltersState,
  globalSearch?: string
): boolean {
  if (filters.partyNames.length > 0 && !filters.partyNames.includes(enquiry.partyName)) return false;
  if (filters.enquiryType.length > 0 && !matchesMulti(filters.enquiryType, enquiry.enquiryType)) return false;
  if (filters.state.length > 0 && !matchesMulti(filters.state, enquiry.state)) return false;
  if (filters.utility.length > 0 && !matchesMulti(filters.utility, enquiry.utility)) return false;
  if (filters.paymentTerms.length > 0 && !matchesMulti(filters.paymentTerms, enquiry.paymentTerms)) return false;
  if (filters.inspection.length > 0 && !matchesMulti(filters.inspection, enquiry.inspection)) return false;
  if (filters.pbg.length > 0 && !matchesMulti(filters.pbg, enquiry.pbg)) return false;
  if (filters.orderStatus.length > 0 && !matchesMulti(filters.orderStatus, enquiry.orderStatus)) return false;
  if (filters.closureStatus.length > 0 && !matchesMultiCI(filters.closureStatus, enquiry.closureStatus)) return false;

  if (filters.docketNumber && !matchesText(filters.docketNumber, enquiry.docketNumber)) return false;
  if (filters.enquiryDateFrom) {
    const from = new Date(filters.enquiryDateFrom);
    if (new Date(enquiry.enquiryDate) < from) return false;
  }
  if (filters.enquiryDateTo) {
    const to = new Date(filters.enquiryDateTo);
    const limit = new Date(to);
    limit.setDate(limit.getDate() + 1);
    if (new Date(enquiry.enquiryDate) > limit) return false;
  }
  if (filters.attachment) {
    if (!enquiry.attachments || enquiry.attachments.length === 0) return false;
    const match = enquiry.attachments.some((a) => a.name.toLowerCase().includes(filters.attachment.toLowerCase()));
    if (!match) return false;
  }

  if (globalSearch && globalSearch.trim()) {
    const q = globalSearch.trim().toLowerCase();
    const matches =
      enquiry.docketNumber.toLowerCase().includes(q) ||
      enquiry.partyName.toLowerCase().includes(q) ||
      enquiry.items.some((it) => it.itemName.toLowerCase().includes(q));
    if (!matches) return false;
  }

  return true;
}

export function itemPassesFilters(item: EnquiryItemData, filters: FiltersState): boolean {
  if (filters.itemName && !matchesText(filters.itemName, item.itemName)) return false;
  if (filters.quantity && !matchesText(filters.quantity, String(item.quantity))) return false;
  if (!matchesMulti(filters.itemType, item.itemType)) return false;
  if (filters.itemTypeSearch && !matchesText(filters.itemTypeSearch, item.itemType || "")) return false;
  if (!matchesMulti(filters.moc, item.moc)) return false;
  if (filters.mocSearch && !matchesText(filters.mocSearch, item.moc || "")) return false;
  if (!matchesMulti(filters.size, item.size, isBlankSize)) return false;
  if (!matchesMulti(filters.pnRating, item.pnRating)) return false;
  if (!matchesMulti(filters.operationType, item.operationType)) return false;
  if (!matchesMulti(filters.extension, item.extension)) return false;
  if (!matchesMulti(filters.bypass, item.bypass)) return false;
  if (!matchesMulti(filters.erpItemCode, item.erpItemCode)) return false;
  if (filters.erpItemCodeSearch && !matchesText(filters.erpItemCodeSearch, item.erpItemCode || "")) return false;
  if (!matchesMulti(filters.bomId as any, (item as any).bomId)) return false;
  if (filters.bomIdSearch && !matchesText(filters.bomIdSearch, (item as any).bomId || "")) return false;
  if (!matchesMulti(filters.contractReviewRate, item.contractReviewRate)) return false;
  if (filters.contractReviewRateSearch && !matchesText(filters.contractReviewRateSearch, item.contractReviewRate || "")) return false;
  if (!matchesMulti(filters.pdcostValidation, getPdCostValidation(item))) return false;
  if (filters.pdcostValidationSearch && !matchesText(filters.pdcostValidationSearch, getPdCostValidation(item) || "")) return false;
  if (filters.productCost.length > 0 && !matchesMulti(filters.productCost, item.productCost != null ? String(item.productCost) : null)) return false;
  if (filters.costRefCode && !matchesText(filters.costRefCode, item.costRefCode || "")) return false;
  if (filters.cost.length > 0 && !matchesMulti(filters.cost, item.cost != null ? String(item.cost) : null)) return false;
  if (filters.stockStatus && !matchesText(filters.stockStatus, item.stockStatus || "")) return false;
  if (filters.discount && !matchesText(filters.discount, item.discount != null ? String(item.discount) : "")) return false;
  if (filters.vaPercent.length > 0 && !matchesMulti(filters.vaPercent, item.vaPercent?.toString() ?? null)) return false;
  if (filters.itemNameMerge && !matchesText(filters.itemNameMerge, item.itemNameMerge || "")) return false;
  if (filters.totalValue && !matchesText(filters.totalValue, item.totalValue || "")) return false;
  if (filters.itemWiseTotalValue && !matchesText(filters.itemWiseTotalValue, item.itemWiseTotalValue || "")) return false;
  if (filters.validation.length > 0 && !matchesMulti(filters.validation, item.validation)) return false;

  return true;
}

export function filterEnquiries(
  enquiries: EnquiryData[],
  filters: FiltersState,
  globalSearch?: string
): EnquiryData[] {
  return enquiries.filter((enquiry) => {
    if (!enquiryPassesFilters(enquiry, filters, globalSearch)) return false;
    if (!enquiry.items || enquiry.items.length === 0) return true;
    return enquiry.items.some((item) => itemPassesFilters(item, filters));
  });
}

export function filterEnquiryItems(
  items: EnquiryItemData[],
  filters: FiltersState
): EnquiryItemData[] {
  return items.filter((item) => itemPassesFilters(item, filters));
}
