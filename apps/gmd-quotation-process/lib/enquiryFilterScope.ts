import type { FiltersState } from "./types";

/**
 * Filters that live on the Enquiry itself. Everything else in `FiltersState`
 * is an item field, so only those force a docket to have a matching item.
 */
const ENQUIRY_LEVEL_FILTERS = new Set([
  "globalSearch",
  "enquiryDateFrom",
  "enquiryDateTo",
  "docketNumber",
  "partyNames",
  "enquiryType",
  "state",
  "paymentTerms",
  "inspection",
  "pbg",
  "utility",
  "orderStatus",
  "closureStatus",
  "duplicate",
  "emailAddress",
  "contactNo",
  "attachment",
  "contractNo",
  "apm",
]);

/**
 * True when an item-level filter is active. The pending view uses this so an
 * enquiry-level filter (docket number, party, date, …) does not hide a docket
 * that has no items yet, while an item filter still requires a matching row.
 */
export function hasActiveItemFilters(
  filters: FiltersState,
  closedBomOnly = false,
): boolean {
  if (closedBomOnly) return true;
  return Object.entries(filters).some(([key, value]) => {
    if (ENQUIRY_LEVEL_FILTERS.has(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== "" && value !== "All";
  });
}
