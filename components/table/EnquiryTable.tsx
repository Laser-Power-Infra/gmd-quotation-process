"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileText, ChevronDown, ChevronRight, Search, Download, Upload, Edit2, Sparkles, Percent, Plus, RefreshCw, DollarSign, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import ActionsDropdown from "./ActionsDropdown";
import Pagination from "./Pagination";
import MultiSelectFilter, { BLANK } from "./MultiSelectFilter";
import * as XLSX from "xlsx";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { selectAllEnquiries, selectAllItems, updateEnquiryField, updateItemField, addAttachments, fetchItemCodes, updateProductCost, fetchContractReviewRates, deleteEnquiryItems, bulkUpdateValidation } from "@/lib/enquiriesSlice";
import { setFilter, resetFilters } from "@/lib/filtersSlice";
import { setPage, setPageSize, resetPage } from "@/lib/paginationSlice";
import { toggleRow, setColumnWidth, setExpandedRows } from "@/lib/uiSlice";
import type { DropdownOptions, EnquiryData, EnquiryItemData, FiltersState } from "@/lib/types";
import { generateOfferPdfAction } from "@/lib/generate-offer-pdf";
import type { OfferLetterTemplateData } from "@/types/offer-lettter";
import { importExcelData, autoFillBlanks, updateVaPercent } from "@/lib/enquiriesSlice";
import { validateVaPercent } from "@/lib/vaValidation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface EnquiryTableProps {
  dropdownOptions: DropdownOptions;
}

// Helper to extract company name and branch
function parseParty(partyName: string) {
  const parts = partyName.split(",").map((s) => s.trim());
  return {
    company: parts[0] || "",
    branch: parts.slice(1).join(", ") || null,
  };
}

// Helper to generate initials for avatar
function getInitials(name: string) {
  const { company } = parseParty(name);
  const cleanName = company
    .replace(/[^a-zA-Z0-9\s]/g, "") // remove special chars
    .replace(/\b(Ltd|Limited|Inc|Corporation|Corp|Co|Pvt)\b/gi, "")
    .trim();

  const parts = cleanName.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return "EQ";
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(",")[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

function useFilterInput(reduxValue: string, field: keyof FiltersState) {
  const dispatch = useAppDispatch();
  const [local, setLocal] = useState(reduxValue);
  const [prevReduxValue, setPrevReduxValue] = useState(reduxValue);

  if (reduxValue !== prevReduxValue) {
    setPrevReduxValue(reduxValue);
    setLocal(reduxValue);
  }

  const debounced = useDebounce(local, 300);

  useEffect(() => {
    dispatch(setFilter({ field, value: debounced }));
  }, [debounced, field, dispatch]);

  return [local, setLocal] as const;
}

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === "" || value === "-";
}

function isBlankSize(value: unknown): boolean {
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

function matchesMulti(values: string[], actual: unknown, blankCheck: (v: unknown) => boolean = isBlankValue): boolean {
  if (!values || values.length === 0) return true;
  if (values.includes(BLANK) && blankCheck(actual)) return true;
  return values.includes(actual as string);
}

// Case-insensitive variant — used for fields like closureStatus where casing is inconsistent
function matchesMultiCI(values: string[], actual: unknown, blankCheck: (v: unknown) => boolean = isBlankValue): boolean {
  if (!values || values.length === 0) return true;
  if (values.includes(BLANK) && blankCheck(actual)) return true;
  const actualLower = typeof actual === "string" ? actual.toLowerCase() : null;
  return values.some((v) => v.toLowerCase() === actualLower);
}

// Helper for cascading filter evaluation
function itemFieldMatches(item: EnquiryItemData, field: string, filterValue: string[]): boolean {
  const blankCheck = field === "size" ? isBlankSize : isBlankValue;
  const actual = item[field as keyof EnquiryItemData] != null ? String(item[field as keyof EnquiryItemData]) : null;
  return matchesMulti(filterValue, actual, blankCheck);
}

function enquiryFieldMatches(enquiry: EnquiryData, field: string, filterValue: string[]): boolean {
  if (field === "closureStatus") return matchesMultiCI(filterValue, enquiry[field as keyof EnquiryData]);
  return matchesMulti(filterValue, enquiry[field as keyof EnquiryData]);
}

const ALL_DROPDOWN_FIELDS = [
  "enquiryType", "state", "paymentTerms", "inspection", "pbg", "utility", "orderStatus", "closureStatus",
  "itemType", "moc", "size", "pnRating", "operationType", "extension", "bypass",
  "validation", "vaPercent", "erpItemCode", "productCost", "contractReviewRate",
] as const;

const ENQUIRY_DROPDOWN_SET = new Set(["enquiryType", "state", "paymentTerms", "inspection", "pbg", "utility", "orderStatus", "closureStatus"]);

export default function EnquiryTable({ dropdownOptions }: EnquiryTableProps) {
  const dispatch = useAppDispatch();
  const enquiries = useAppSelector(selectAllEnquiries);
  const allItems = useAppSelector(selectAllItems);
  const filters = useAppSelector((s) => s.filters);
  const { currentPage, pageSize } = useAppSelector((s) => s.pagination);
  const { expandedRows, columnWidths } = useAppSelector((s) => s.ui);

  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [editingPartyEnquiryId, setEditingPartyEnquiryId] = useState<string | null>(null);

  const attachInputRefs = useRef<Record<string, HTMLInputElement>>({});

  const handleAddAttachments = async (e: React.ChangeEvent<HTMLInputElement>, enquiryId: string) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    e.target.value = "";
    try {
      const payload = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          size: file.size,
          type: file.type || file.name.split(".").pop() || "",
          content: await fileToBase64(file),
        }))
      );
      toast.promise(
        (async () => {
          await dispatch(addAttachments({ enquiryId, attachments: payload })).unwrap();
        })(),
        {
          loading: "Uploading attachments...",
          success: "Attachments added successfully.",
          error: (err) => err.message,
        }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add attachments.");
    }
  };

  // Debounced filter inputs
  const [filterEnquiryDateFrom, setFilterEnquiryDateFrom] = useFilterInput(filters.enquiryDateFrom, "enquiryDateFrom");
  const [filterEnquiryDateTo, setFilterEnquiryDateTo] = useFilterInput(filters.enquiryDateTo, "enquiryDateTo");
  const [filterDocketNumber, setFilterDocketNumber] = useFilterInput(filters.docketNumber, "docketNumber");
  const [filterItemName, setFilterItemName] = useFilterInput(filters.itemName, "itemName");
  const [filterQuantity, setFilterQuantity] = useFilterInput(filters.quantity, "quantity");
  const [filterCostRefCode, setFilterCostRefCode] = useFilterInput(filters.costRefCode, "costRefCode");
  const [filterCost, setFilterCost] = useFilterInput(filters.cost, "cost");
  const [filterStockStatus, setFilterStockStatus] = useFilterInput(filters.stockStatus, "stockStatus");
  const [filterDiscount, setFilterDiscount] = useFilterInput(filters.discount, "discount");
  const [filterQuotedRate, setFilterQuotedRate] = useFilterInput(filters.quotedRate, "quotedRate");
  const [filterQuotedRateGst, setFilterQuotedRateGst] = useFilterInput(filters.quotedRateGst || "", "quotedRateGst");
  const [filterItemNameMerge, setFilterItemNameMerge] = useFilterInput(filters.itemNameMerge, "itemNameMerge");
  const [filterTotalValue, setFilterTotalValue] = useFilterInput(filters.totalValue, "totalValue");
  const [filterItemWiseTotalValue, setFilterItemWiseTotalValue] = useFilterInput(filters.itemWiseTotalValue, "itemWiseTotalValue");
  const [filterAttachment, setFilterAttachment] = useFilterInput(filters.attachment, "attachment");
  const [filterItemTypeSearch, setFilterItemTypeSearch] = useFilterInput(filters.itemTypeSearch, "itemTypeSearch");
  const [filterMocSearch, setFilterMocSearch] = useFilterInput(filters.mocSearch, "mocSearch");
  const [filterErpItemCodeSearch, setFilterErpItemCodeSearch] = useFilterInput(filters.erpItemCodeSearch, "erpItemCodeSearch");
  const [filterContractReviewRateSearch, setFilterContractReviewRateSearch] = useFilterInput(filters.contractReviewRateSearch || "", "contractReviewRateSearch");
  const [filterPdcostValidationSearch, setFilterPdcostValidationSearch] = useFilterInput(filters.pdcostValidationSearch || "", "pdcostValidationSearch");
  const [filterProjectReference, setFilterProjectReference] = useState("");
  const [editingItemNameId, setEditingItemNameId] = useState<string | null>(null);
  const [autoFillStatus, setAutoFillStatus] = useState<"idle" | "running">("idle");
  const [vaStatus, setVaStatus] = useState<"idle" | "running">("idle");
  const [fetchCodesStatus, setFetchCodesStatus] = useState<"idle" | "running">("idle");
  const [updateCostStatus, setUpdateCostStatus] = useState<"idle" | "running">("idle");
  const [crRateStatus, setCrRateStatus] = useState<"idle" | "running">("idle");
  // Bulk delete selection: per enquiry constraint, filtered scope, persisted across pagination
  const [selectedEnquiryId, setSelectedEnquiryId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Reset pagination to first page when filters change
  useEffect(() => {
    dispatch(resetPage());
  }, [filters, dispatch]);

  // Prune selected ids that no longer exist (after delete) — persist otherwise
  useEffect(() => {
    if (selectedItemIds.size === 0) return;
    const existingIds = new Set(allItems.map((i) => i.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedItemIds) {
      if (existingIds.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) {
      if (next.size === 0) setSelectedEnquiryId(null);
      setSelectedItemIds(next);
    }
    // If selected enquiry itself was deleted, clear
    if (selectedEnquiryId && !enquiries.some((e) => e.id === selectedEnquiryId)) {
      setSelectedEnquiryId(null);
      setSelectedItemIds(new Set());
    }
  }, [allItems, enquiries, selectedItemIds, selectedEnquiryId]);

  const isItemSelected = (itemId: string) => selectedItemIds.has(itemId);

  const toggleItemSelection = (enquiryId: string, itemId: string) => {
    if (selectedEnquiryId && selectedEnquiryId !== enquiryId) {
      const prevDocket = enquiries.find((e) => e.id === selectedEnquiryId)?.docketNumber || selectedEnquiryId;
      const nextDocket = enquiries.find((e) => e.id === enquiryId)?.docketNumber || enquiryId;
      if (!confirm(`Selection is currently for docket "${prevDocket}". Clear selection and select items from "${nextDocket}" instead?`)) return;
      setSelectedEnquiryId(enquiryId);
      setSelectedItemIds(new Set([itemId]));
      return;
    }
    const next = new Set(selectedItemIds);
    if (next.has(itemId)) {
      next.delete(itemId);
      if (next.size === 0) setSelectedEnquiryId(null);
    } else {
      next.add(itemId);
      setSelectedEnquiryId(enquiryId);
    }
    setSelectedItemIds(next);
  };

  const toggleSelectAllForEnquiry = (enquiry: EnquiryData, filteredItems: EnquiryItemData[]) => {
    const ids = filteredItems.map((i) => i.id);
    if (ids.length === 0) return;
    if (selectedEnquiryId && selectedEnquiryId !== enquiry.id) {
      const prevDocket = enquiries.find((e) => e.id === selectedEnquiryId)?.docketNumber || selectedEnquiryId;
      if (!confirm(`Selection is currently for docket "${prevDocket}". Clear and select all ${ids.length} items from "${enquiry.docketNumber}"?`)) return;
      setSelectedEnquiryId(enquiry.id);
      setSelectedItemIds(new Set(ids));
      return;
    }
    const allSelected = ids.every((id) => selectedItemIds.has(id));
    if (allSelected) {
      const next = new Set(selectedItemIds);
      ids.forEach((id) => next.delete(id));
      setSelectedItemIds(next);
      if (next.size === 0) setSelectedEnquiryId(null);
    } else {
      setSelectedEnquiryId(enquiry.id);
      const next = new Set(selectedItemIds);
      ids.forEach((id) => next.add(id));
      setSelectedItemIds(next);
    }
  };

  const clearSelection = () => {
    setSelectedEnquiryId(null);
    setSelectedItemIds(new Set());
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedItemIds.size === 0 || !selectedEnquiryId) return;
    const ids = Array.from(selectedItemIds);
    setBulkDeleting(true);
    try {
      const result: any = await dispatch(deleteEnquiryItems(ids)).unwrap();
      toast.success(result.enquiryDeleted ? `Deleted ${ids.length} item(s) and enquiry was removed (no items left).` : `Deleted ${ids.length} item(s) successfully.`);
      clearSelection();
      setBulkConfirmOpen(false);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to delete selected items.";
      toast.error(msg);
    } finally {
      setBulkDeleting(false);
    }
  };

  const [bulkValidationRunning, setBulkValidationRunning] = useState<"Yes" | "No" | "Clear" | null>(null);
  const handleBulkValidation = async (val: "Yes" | "No" | "") => {
    const allFiltered = filteredEnquiries.flatMap((e) => getFilteredItems(e));
    if (allFiltered.length === 0) {
      toast.info("No items match current filters.");
      return;
    }
    const label = val === "" ? "Blank" : val;
    const differing = allFiltered.filter((i) => (i.validation || "") !== (val || "")).length;
    if (!confirm(`Set validation to "${label}" for ${allFiltered.length} filtered item(s) across all pages?${differing > 0 ? ` This will overwrite ${differing} differing value(s).` : ""}`)) return;
    const runKey = val === "" ? "Clear" : val;
    setBulkValidationRunning(runKey as any);
    try {
      const result: any = await dispatch(bulkUpdateValidation({ itemIds: allFiltered.map((i) => i.id), validation: val === "" ? null : val })).unwrap();
      toast.success(`Validation set to "${label}" for ${result.updated} item(s).`);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to update validation.";
      toast.error(msg);
    } finally {
      setBulkValidationRunning(null);
    }
  };

  const cascadedOptions = useMemo(() => {
    const result: Record<string, string[]> = {};

    const enquiryPasses = (enquiry: EnquiryData, excludeField: string | null): boolean => {
      if (excludeField !== "partyNames" && filters.partyNames.length > 0) {
        if (!filters.partyNames.includes(enquiry.partyName)) return false;
      }
      for (const other of ALL_DROPDOWN_FIELDS) {
        if (other === excludeField) continue;
        if (ENQUIRY_DROPDOWN_SET.has(other)) {
          const val = filters[other];
          if (val.length > 0 && !enquiryFieldMatches(enquiry, other, val)) return false;
        }
      }
      return true;
    };

    const itemPasses = (item: EnquiryItemData, excludeField: string | null): boolean => {
      for (const other of ALL_DROPDOWN_FIELDS) {
        if (other === excludeField) continue;
        if (!ENQUIRY_DROPDOWN_SET.has(other)) {
          const val = filters[other];
          if (val.length > 0 && !itemFieldMatches(item, other, val)) return false;
        }
      }
      return true;
    };

    for (const field of ALL_DROPDOWN_FIELDS) {
      if (ENQUIRY_DROPDOWN_SET.has(field)) {
        const available = enquiries
          .filter((enquiry) => {
            if (!enquiryPasses(enquiry, field)) return false;
            return enquiry.items.some((item) => itemPasses(item, field));
          })
          .map((enquiry) => {
            const val = (enquiry as unknown as Record<string, unknown>)[field];
            return val != null ? String(val) : "";
          })
          .filter((v) => v !== "")
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        result[field] = available;
      } else {
        const matchingEnquiryIds = new Set(
          enquiries
            .filter((enquiry) => enquiryPasses(enquiry, field))
            .map((e) => e.id)
        );
        const available = allItems
          .filter((item) => matchingEnquiryIds.has(item.enquiryId))
          .filter((item) => itemPasses(item, field))
          .map((item) => {
            const val = (item as unknown as Record<string, unknown>)[field];
            return val != null ? String(val) : "";
          })
          .filter((v) => v !== "" && v !== "undefined" && v !== "null")
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        result[field] = available;
      }
    }

    const availableParties = enquiries
      .filter((enquiry) => {
        for (const other of ALL_DROPDOWN_FIELDS) {
          if (ENQUIRY_DROPDOWN_SET.has(other)) {
            const val = filters[other];
            if (!enquiryFieldMatches(enquiry, other, val)) return false;
          }
        }
        return enquiry.items.some((item) => itemPasses(item, null));
      })
      .map((enquiry) => enquiry.partyName)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    result.partyNames = availableParties;

    return result;
  }, [enquiries, allItems, filters]);

  // VA% validation: compute set of item IDs where VA% exceeds allowed max
  const invalidVaItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of allItems) {
      const result = validateVaPercent(item.itemType, item.size, item.vaPercent);
      if (!result.isValid) ids.add(item.id);
    }
    return ids;
  }, [allItems]);



  // Auto-expand rows when docket number is searched
  useEffect(() => {
    if (filters.docketNumber) {
      const matchingIds: Record<string, boolean> = {};
      for (const enquiry of enquiries) {
        if (enquiry.docketNumber.toLowerCase().includes(filters.docketNumber.toLowerCase())) {
          matchingIds[enquiry.id] = true;
        }
      }
      dispatch(setExpandedRows(matchingIds));
    }
  }, [filters.docketNumber, enquiries, dispatch]);

  const hasActiveFilters = Object.values(filters).some((val) => {
    if (Array.isArray(val)) return val.length > 0;
    return val !== "" && val !== "All";
  });

  const handleResetAllFilters = () => {
    dispatch(resetFilters());
    toast.success("All filters reset successfully.");
  };

  const getFilteredItems = (enquiry: EnquiryData) => {
    if (!enquiry.items) return [];
    return enquiry.items.filter((item: EnquiryItemData) => {
      if (
        filters.itemName &&
        !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.quantity &&
        !item.quantity.toString().includes(filters.quantity)
      ) {
        return false;
      }
      if (!matchesMulti(filters.itemType, item.itemType)) {
        return false;
      }
      if (
        filters.itemTypeSearch &&
        !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.moc, item.moc)) {
        return false;
      }
      if (
        filters.mocSearch &&
        !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.size, item.size, isBlankSize)) {
        return false;
      }
      if (!matchesMulti(filters.pnRating, item.pnRating)) {
        return false;
      }
      if (!matchesMulti(filters.operationType, item.operationType)) {
        return false;
      }
      if (!matchesMulti(filters.extension, item.extension)) {
        return false;
      }
      if (!matchesMulti(filters.bypass, item.bypass)) {
        return false;
      }
      if (!matchesMulti(filters.erpItemCode, item.erpItemCode)) {
        return false;
      }
      if (
        filters.erpItemCodeSearch &&
        !(item.erpItemCode || "").toLowerCase().includes(filters.erpItemCodeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.contractReviewRate, item.contractReviewRate)) {
        return false;
      }
      if (
        filters.contractReviewRateSearch &&
        !(item.contractReviewRate || "").toLowerCase().includes(filters.contractReviewRateSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.pdcostValidationSearch &&
        !(getPdCostValidation(item) || "").toLowerCase().includes(filters.pdcostValidationSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.productCost.length > 0 &&
        !matchesMulti(filters.productCost, item.productCost != null ? String(item.productCost) : null)
      ) {
        return false;
      }
      if (
        filters.costRefCode &&
        !(item.costRefCode || "").toLowerCase().includes(filters.costRefCode.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.cost &&
        !(item.cost?.toString() || "").includes(filters.cost)
      ) {
        return false;
      }
      if (
        filters.stockStatus &&
        !(item.stockStatus || "").toLowerCase().includes(filters.stockStatus.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.discount &&
        !(item.discount?.toString() || "").includes(filters.discount)
      ) {
        return false;
      }
      if (
        filters.vaPercent.length > 0 &&
        !matchesMulti(filters.vaPercent, item.vaPercent?.toString() ?? null)
      ) {
        return false;
      }
      if (filters.vaPercent.length > 0) {
        const matchesBlank = filters.vaPercent.includes(BLANK) && item.vaPercent == null;
        const matchesValue = item.vaPercent != null && filters.vaPercent.includes(String(item.vaPercent));
        if (!matchesBlank && !matchesValue) {
          return false;
        }
      }
      if (filters.vaPercent.length > 0) {
        const matchesBlank = filters.vaPercent.includes(BLANK) && item.vaPercent == null;
        const matchesValue = item.vaPercent != null && filters.vaPercent.includes(String(item.vaPercent));
        if (!matchesBlank && !matchesValue) {
          return false;
        }
      }
      if (
        filters.itemNameMerge &&
        !(item.itemNameMerge || "").toLowerCase().includes(filters.itemNameMerge.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.totalValue &&
        !(item.totalValue || "").includes(filters.totalValue)
      ) {
        return false;
      }
      if (
        filters.itemWiseTotalValue &&
        !(item.itemWiseTotalValue || "").includes(filters.itemWiseTotalValue)
      ) {
        return false;
      }
      if (filters.validation.length > 0) {
        if (!matchesMulti(filters.validation, item.validation)) {
          return false;
        }
      }
      return true;
    });
  };

  const toggleExpand = (id: string) => {
    dispatch(toggleRow(id));
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
    dispatch(setPage(1));
  };

  const renderSortArrow = (field: string) => {
    const isSorted = sortField === field;
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="ml-1 inline-flex items-center justify-center hover:bg-muted/50 rounded cursor-pointer focus:outline-none shrink-0 transition-colors p-0.5"
        title={`Sort by ${field}`}
      >
        {isSorted ? (
          sortDirection === "asc" ? (
            <span className="text-[8px] text-[#0f62fe] dark:text-blue-400 font-bold leading-none">▲</span>
          ) : (
            <span className="text-[8px] text-[#0f62fe] dark:text-blue-400 font-bold leading-none">▼</span>
          )
        ) : (
          <span className="text-[8px] text-muted-foreground leading-none">▼</span>
        )}
      </button>
    );
  };

  // Mouse drag handler for column resizing
  const handleMouseDown = (columnIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[columnIndex];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(60, startWidth + deltaX);
      dispatch(setColumnWidth({ index: columnIndex, width: newWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };



  // Inline table cell dropdown update handlers
  const handleEnquiryFieldChange = async (enquiryId: string, field: string, val: string) => {
    const dbVal = val === "" ? null : val;
    console.log(`[Client] updateEnquiryField enquiry=${enquiryId} field=${field} val="${dbVal}"`);
    toast.promise(
      dispatch(updateEnquiryField({ enquiryId, field, value: dbVal })).unwrap(),
      {
        loading: `Saving ${field}...`,
        success: `Saved successfully.`,
        error: (err) => err || `Failed to save.`,
      }
    );
  };

  const getItemNameMerge = (item: EnquiryItemData) => {
    const orderedFields = [
      item.itemType,
      item.moc,
      item.size,
      item.pnRating,
      item.operationType,
      item.extension,
      item.bypass
    ];
    return orderedFields
      .map(val => (val || "").trim())
      .filter(Boolean)
      .join("-");
  };

  const handleItemFieldChange = async (itemId: string, field: string, val: string) => {
    const dbVal = val === "" ? null : val;
    console.log(`[Client] updateItemField item=${itemId} field=${field} val="${dbVal}"`);
    const toastId = toast.loading(`Saving ${field}...`);

    try {
      const result = await dispatch(updateItemField({ itemId, field, value: dbVal })).unwrap();
      toast.success(`Saved successfully.`, { id: toastId });

      // When updating item name, warn if size wasn't detected
      if (field === "itemName" && result && !result.size) {
        toast.info("Size not mentioned in item name — please add manually.", { id: undefined, duration: 5000 });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : err ? String(err) : `Failed to save.`, { id: toastId });
    }
  };

  // Paste a column of Cost / VA% / Quoted Rate values into a docket's items in order.
  const handleBulkFieldPaste = async (
    enquiry: EnquiryData,
    field: "cost" | "vaPercent" | "quotedRate",
    e: React.ClipboardEvent<HTMLInputElement>,
    startIndex: number
  ) => {
    const clipboardData = e.clipboardData.getData("text");
    if (!clipboardData) return;

    const lines = clipboardData
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length <= 1) {
      return; // Single value → allow the normal paste
    }

    e.preventDefault();

    const targets = getFilteredItems(enquiry).slice(startIndex);
    if (targets.length === 0) return;

    const updates: { item: { id: string }; cost?: number; vaPercent?: number; quotedRate?: number }[] = [];
    let invalid = false;

    lines.forEach((line, idx) => {
      const target = targets[idx];
      if (!target) return;
      const entry: { item: { id: string }; cost?: number; vaPercent?: number; quotedRate?: number } = { item: target };

      if (field === "cost") {
        const parts = line.split("\t").map((p) => p.trim());
        const costRaw = parts[0] || "";
        const vaRaw = parts.length > 1 ? parts[1] : "";
        if (costRaw) {
          const c = parseFloat(costRaw.replace(/,/g, ""));
          if (isNaN(c)) {
            invalid = true;
            return;
          }
          entry.cost = c;
        }
        if (vaRaw) {
          const v = parseFloat(vaRaw.replace(/%/g, ""));
          if (isNaN(v)) {
            invalid = true;
            return;
          }
          entry.vaPercent = v;
        }
      } else {
        const v = parseFloat(line.replace(/%/g, "").replace(/,/g, ""));
        if (isNaN(v)) {
          invalid = true;
          return;
        }
        if (field === "quotedRate") {
          entry.quotedRate = v;
        } else {
          entry.vaPercent = v;
        }
      }

      updates.push(entry);
    });

    if (invalid) {
      toast.error("Pasted values must be valid numbers.");
      return;
    }
    if (updates.length === 0) return;

    const toastId = toast.loading(`Updating ${updates.length} item(s)...`);
    try {
      await Promise.all(
        updates.map(({ item, cost, vaPercent, quotedRate }) => {
          const calls: Promise<unknown>[] = [];
          if (cost !== undefined) {
            calls.push(dispatch(updateItemField({ itemId: item.id, field: "cost", value: cost.toString() })).unwrap());
          }
          if (vaPercent !== undefined) {
            calls.push(dispatch(updateItemField({ itemId: item.id, field: "vaPercent", value: vaPercent.toString() })).unwrap());
          }
          if (quotedRate !== undefined) {
            calls.push(dispatch(updateItemField({ itemId: item.id, field: "quotedRate", value: quotedRate.toString() })).unwrap());
          }
          return Promise.all(calls);
        })
      );
      toast.success(`Updated ${updates.length} item(s).`, { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update items.", { id: toastId });
    }
  };

  // Filter logic matching dropdown selections exactly
  const filteredEnquiries = enquiries.filter((enquiry) => {
    // 1. Enquiry Date range
    if (filters.enquiryDateFrom) {
      const fromDate = new Date(filters.enquiryDateFrom);
      if (new Date(enquiry.enquiryDate) < fromDate) return false;
    }
    if (filters.enquiryDateTo) {
      const toDate = new Date(filters.enquiryDateTo);
      const toDateLimit = new Date(toDate);
      toDateLimit.setDate(toDateLimit.getDate() + 1);
      if (new Date(enquiry.enquiryDate) > toDateLimit) return false;
    }

    // 2. Docket Number (Text Search)
    if (
      filters.docketNumber &&
      !enquiry.docketNumber
        .toLowerCase()
        .includes(filters.docketNumber.toLowerCase())
    ) {
      return false;
    }

    // 3. Party Name (Multi-select Checklist Search)
    if (
      filters.partyNames.length > 0 &&
      !filters.partyNames.includes(enquiry.partyName)
    ) {
      return false;
    }

    // 4-10. Enquiry-level Metadata Dropdown Filters
    if (!matchesMulti(filters.enquiryType, enquiry.enquiryType)) {
      return false;
    }
    if (!matchesMulti(filters.state, enquiry.state)) {
      return false;
    }
    if (!matchesMulti(filters.paymentTerms, enquiry.paymentTerms)) {
      return false;
    }
    if (!matchesMulti(filters.inspection, enquiry.inspection)) {
      return false;
    }
    if (!matchesMulti(filters.pbg, enquiry.pbg)) {
      return false;
    }
    if (!matchesMulti(filters.utility, enquiry.utility)) {
      return false;
    }
    if (!matchesMulti(filters.orderStatus, enquiry.orderStatus)) {
      return false;
    }
    if (!matchesMultiCI(filters.closureStatus, enquiry.closureStatus)) {
      return false;
    }

    // 11. Project Reference (Text Search)
    if (
      filterProjectReference &&
      !(enquiry.projectReference || "").toLowerCase().includes(filterProjectReference.toLowerCase())
    ) {
      return false;
    }

    // 11-24. Item details (mix of text search and exact dropdown selections)
    const matchesItems = enquiry.items.some((item) => {
      if (
        filters.itemName &&
        !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.quantity &&
        !item.quantity.toString().includes(filters.quantity)
      ) {
        return false;
      }
      if (!matchesMulti(filters.itemType, item.itemType)) {
        return false;
      }
      if (
        filters.itemTypeSearch &&
        !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.moc, item.moc)) {
        return false;
      }
      if (
        filters.mocSearch &&
        !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.size, item.size, isBlankSize)) {
        return false;
      }
      if (!matchesMulti(filters.pnRating, item.pnRating)) {
        return false;
      }
      if (!matchesMulti(filters.operationType, item.operationType)) {
        return false;
      }
      if (!matchesMulti(filters.extension, item.extension)) {
        return false;
      }
      if (!matchesMulti(filters.bypass, item.bypass)) {
        return false;
      }
      if (!matchesMulti(filters.erpItemCode, item.erpItemCode)) {
        return false;
      }
      if (
        filters.erpItemCodeSearch &&
        !(item.erpItemCode || "").toLowerCase().includes(filters.erpItemCodeSearch.toLowerCase())
      ) {
        return false;
      }
      if (!matchesMulti(filters.contractReviewRate, item.contractReviewRate)) {
        return false;
      }
      if (
        filters.contractReviewRateSearch &&
        !(item.contractReviewRate || "").toLowerCase().includes(filters.contractReviewRateSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.pdcostValidationSearch &&
        !(getPdCostValidation(item) || "").toLowerCase().includes(filters.pdcostValidationSearch.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.productCost.length > 0 &&
        !matchesMulti(filters.productCost, item.productCost != null ? String(item.productCost) : null)
      ) {
        return false;
      }
      if (
        filters.costRefCode &&
        !(item.costRefCode || "").toLowerCase().includes(filters.costRefCode.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.cost &&
        !(item.cost?.toString() || "").includes(filters.cost)
      ) {
        return false;
      }
      if (
        filters.stockStatus &&
        !(item.stockStatus || "").toLowerCase().includes(filters.stockStatus.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.discount &&
        !(item.discount?.toString() || "").includes(filters.discount)
      ) {
        return false;
      }
      if (
        filters.vaPercent.length > 0 &&
        !matchesMulti(filters.vaPercent, item.vaPercent?.toString() ?? null)
      ) {
        return false;
      }
      if (
        filters.quotedRate &&
        !(item.quotedRate || "").toLowerCase().includes(filters.quotedRate.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.quotedRateGst &&
        !(item.quotedRateGst || "").toLowerCase().includes(filters.quotedRateGst.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.itemNameMerge &&
        !(item.itemNameMerge || "").toLowerCase().includes(filters.itemNameMerge.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.totalValue &&
        !(item.totalValue || "").toLowerCase().includes(filters.totalValue.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.itemWiseTotalValue &&
        !(item.itemWiseTotalValue || "").toLowerCase().includes(filters.itemWiseTotalValue.toLowerCase())
      ) {
        return false;
      }
      if (filters.validation.length > 0) {
        if (!matchesMulti(filters.validation, item.validation)) {
          return false;
        }
      }
      return true;
    });

    if (!matchesItems) return false;

    // 25. Attachment
    if (filters.attachment) {
      if (!enquiry.attachments || enquiry.attachments.length === 0) return false;
      const match = enquiry.attachments.some((att) =>
        att.name.toLowerCase().includes(filters.attachment.toLowerCase())
      );
      if (!match) return false;
    }

    return true;
  });

  const getSortValue = (enquiry: EnquiryData, field: string): string | number | Date | null | undefined => {
    const enquiryFields = [
      "enquiryDate", "docketNumber", "partyName", "enquiryType", "state", 
      "paymentTerms", "inspection", "pbg", "utility", "orderStatus"
    ];
    
    if (enquiryFields.includes(field)) {
      return (enquiry as unknown as Record<string, unknown>)[field] as string | number | Date | null | undefined;
    }
    
    if (field === "attachment") {
      return enquiry.attachments ? enquiry.attachments.length : 0;
    }
    
    const firstItem = enquiry.items && enquiry.items[0];
    if (!firstItem) return null;
    
    if (field === "pdcostValidation") {
      const val = getPdCostValidation(firstItem);
      return val ? parseFloat(val.replace("%", "")) : null;
    }

    return (firstItem as unknown as Record<string, unknown>)[field] as string | number | Date | null | undefined;
  };

  const sortedEnquiries = [...filteredEnquiries].sort((a, b) => {
    if (!sortField) return 0;
    
    const valA = getSortValue(a, sortField);
    const valB = getSortValue(b, sortField);
    
    if (valA === null || valA === undefined || valA === "") return 1;
    if (valB === null || valB === undefined || valB === "") return -1;
    
    if (typeof valA === "number" && typeof valB === "number") {
      return sortDirection === "asc" ? valA - valB : valB - valA;
    }
    
    if (valA instanceof Date && valB instanceof Date) {
      return sortDirection === "asc" 
        ? valA.getTime() - valB.getTime() 
        : valB.getTime() - valA.getTime();
    }
    
    if (sortField === "enquiryDate") {
      const timeA = new Date(valA).getTime();
      const timeB = new Date(valB).getTime();
      return sortDirection === "asc" ? timeA - timeB : timeB - timeA;
    }
    
    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    
    return sortDirection === "asc"
      ? strA.localeCompare(strB, undefined, { numeric: true })
      : strB.localeCompare(strA, undefined, { numeric: true });
  });

  const paginatedEnquiries = sortedEnquiries.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );


  const handleImportFromExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = toast.loading("Reading Excel file...");
    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        if (!data) {
          toast.error("Failed to read file data.", { id: toastId });
          return;
        }

        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

        if (rows.length === 0) {
          toast.error("No data rows found in the sheet.", { id: toastId });
          return;
        }

        const mappedRows = rows.map((row) => {
          let docketNumber = "";
          let itemName = "";
          let cost: number | null = null;
          let quotedRate: number | null = null;

          for (const key of Object.keys(row)) {
            const lowerKey = key.toLowerCase();
            const val = row[key];

            if (lowerKey.includes("docket") || lowerKey === "offer no" || lowerKey === "offerno") {
              docketNumber = String(val).trim();
            } else if (lowerKey.includes("item name") || lowerKey === "itemname") {
              itemName = String(val).trim();
            } else if (lowerKey === "cost" || lowerKey.includes("product cost")) {
              cost = val !== undefined && val !== null && val !== "" ? parseFloat(String(val)) : null;
            } else if (
              lowerKey.includes("quotation rate") ||
              lowerKey.includes("quoted rate") ||
              lowerKey === "rate" ||
              lowerKey === "rate/unit"
            ) {
              quotedRate = val !== undefined && val !== null && val !== "" ? parseFloat(String(val)) : null;
            }
          }

          return { docketNumber, itemName, cost, quotedRate };
        }).filter(r => r.docketNumber && r.itemName);

        if (mappedRows.length === 0) {
          toast.error("Could not find matching docket number and item name columns in the Excel sheet.", { id: toastId });
          return;
        }

        toast.loading(`Importing ${mappedRows.length} rows...`, { id: toastId });

        await dispatch(importExcelData(mappedRows)).unwrap();
        toast.success(`Imported successfully.`, { id: toastId });
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "An error occurred during parsing.", { id: toastId });
      } finally {
        e.target.value = "";
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleExportToExcel = () => {
    const toastId = toast.loading("Preparing Excel file...");
    try {
      const rows: Record<string, string | number>[] = [];

      sortedEnquiries.forEach((enquiry) => {
        if (!enquiry.items || enquiry.items.length === 0) {
          rows.push({
            "Enquiry Date": new Date(enquiry.enquiryDate).toLocaleDateString("en-GB"),
            "Docket No": enquiry.docketNumber,
            "Party Name": enquiry.partyName,
            "Enquiry Type": enquiry.enquiryType || "",
            "State": enquiry.state || "",
            "Payment Terms": enquiry.paymentTerms || "",
            "Inspection": enquiry.inspection || "",
            "PBG": enquiry.pbg || "",
            "Utility": enquiry.utility || "",
            "VA%": "",
            "Order Status": enquiry.orderStatus || "",
            "Closure Status": enquiry.closureStatus || "",
            "Project Reference": enquiry.projectReference || "",
            "Item Name": "",
            "Quantity": "",
            "Item Type": "",
            "MOC": "",
            "Size": "",
            "PN Rating": "",
            "Operation Type": "",
            "Extension": "",
            "Bypass": "",
            "Product Cost": "",
            "Cost Ref Code": "",
            "Cost": "",
            "Stock Status": "",
            "Discount": "",
            "Quotation Rate": "",
            "CR Rate": "",
            "PD Cost Validation": "",
            "Item Name Merge": "",
            "Total Value": "",
            "Itemwise Total Value": "",
            "Delivery Schedule": "",
            "Validation": "",
            "Attachments": enquiry.attachments ? enquiry.attachments.map(a => a.name).join(", ") : "",
            "Attachment Links": enquiry.attachments ? enquiry.attachments.map(a => a.url).join(" ; ") : "",
          });
        } else {
          enquiry.items.forEach((item) => {
            rows.push({
              "Enquiry Date": new Date(enquiry.enquiryDate).toLocaleDateString("en-GB"),
              "Docket No": enquiry.docketNumber,
              "Party Name": enquiry.partyName,
              "Enquiry Type": enquiry.enquiryType || "",
              "State": enquiry.state || "",
              "Payment Terms": enquiry.paymentTerms || "",
              "Inspection": enquiry.inspection || "",
              "PBG": enquiry.pbg || "",
              "Utility": enquiry.utility || "",
              "VA%": item.vaPercent !== null ? `${item.vaPercent}%` : "",
              "Order Status": enquiry.orderStatus || "",
              "Closure Status": enquiry.closureStatus || "",
              "Project Reference": enquiry.projectReference || "",
              "Item Name": item.itemName,
              "Quantity": item.quantity ? Number(item.quantity) : "",
              "Item Type": item.itemType || "",
              "MOC": item.moc || "",
              "Size": item.size || "",
              "PN Rating": item.pnRating || "",
              "Operation Type": item.operationType || "",
              "Extension": item.extension || "",
              "Bypass": item.bypass || "",
              "Product Cost": item.productCost ? Number(item.productCost) : "",
              "Cost Ref Code": item.costRefCode || "",
              "Cost": item.cost ? Number(item.cost) : "",
              "Stock Status": item.stockStatus || "",
              "Discount": item.discount ? `${Number(item.discount)}%` : "",
              "Quotation Rate": item.quotedRate || "",
              "CR Rate": item.contractReviewRate || "",
              "PD Cost Validation": getPdCostValidation(item) || "",
              "Item Name Merge": item.itemNameMerge || "",
              "Total Value": item.totalValue || "",
              "Itemwise Total Value": item.itemWiseTotalValue || "",
              "Delivery Schedule": item.deliverySchedule || "",
              "Validation": item.validation || "",
              "Attachments": enquiry.attachments ? enquiry.attachments.map(a => a.name).join(", ") : "",
              "Attachment Links": enquiry.attachments ? enquiry.attachments.map(a => a.url).join(" ; ") : "",
            });
          });
        }
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Enquiries");
      
      const dateStr = new Date().toISOString().split("T")[0];
      XLSX.writeFile(workbook, `GMD_Quotation_Export_${dateStr}.xlsx`);
      toast.success("Excel file downloaded successfully!", { id: toastId });
    } catch (err: unknown) {
      console.error("Export to Excel failed:", err);
      toast.error("Failed to export Excel file.", { id: toastId });
    }
  };

  const handleAutoFillBlanks = async () => {
    // Collect items that pass all active filters (same logic as filteredEnquiries)
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of enquiry.items) {
        let pass = true
        if (filters.itemName && !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())) pass = false
        if (filters.quantity && !item.quantity.toString().includes(filters.quantity)) pass = false
        if (!matchesMulti(filters.itemType, item.itemType)) pass = false
        if (filters.itemTypeSearch && !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.moc, item.moc)) pass = false
        if (filters.mocSearch && !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.size, item.size, isBlankSize)) pass = false
        if (pass) matchedItems.push(item)
      }
    }

    const blankItems = matchedItems.filter(
      (i: EnquiryItemData) =>
        !i.itemType ||
        !i.moc ||
        !i.size ||
        i.size === "Not detectable" ||
        i.size === "Not mentioned/cant detect size" ||
        !i.operationType ||
        !i.extension ||
        i.extension === "-" ||
        !i.bypass ||
        i.bypass === "-"
    )
    console.log(`[Client] autoFillBlanks: ${blankItems.length} items with blanks out of ${matchedItems.length} matched`);
    if (blankItems.length === 0) {
      toast.info("No blank fields to fill.")
      return
    }
    if (!confirm(`Auto-fill ${blankItems.length} items (itemType, MOC, Size, Operation Type, Extension, Bypass)? This uses AI tokens for complex cases.`)) return

    setAutoFillStatus("running")
    await dispatch(autoFillBlanks(blankItems.map((i: EnquiryItemData) => i.id))).unwrap()
    setAutoFillStatus("idle")
    toast.success(`Auto-fill complete.`)
  }

  const handleFetchItemCodes = async () => {
    // Collect items that pass all active filters (same logic as filteredEnquiries)
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of enquiry.items) {
        let pass = true
        if (filters.itemName && !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())) pass = false
        if (filters.quantity && !item.quantity.toString().includes(filters.quantity)) pass = false
        if (!matchesMulti(filters.itemType, item.itemType)) pass = false
        if (filters.itemTypeSearch && !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.moc, item.moc)) pass = false
        if (filters.mocSearch && !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.size, item.size, isBlankSize)) pass = false
        if (pass) matchedItems.push(item)
      }
    }

    const missingCodeItems = matchedItems.filter((i) => !i.erpItemCode)
    console.log(`[Client] fetchItemCodes: ${missingCodeItems.length} items missing item code out of ${matchedItems.length} matched`)
    if (missingCodeItems.length === 0) {
      toast.info("No items missing ERP item codes.")
      return
    }
    if (!confirm(`Fetch ERP item codes for ${missingCodeItems.length} items?`)) return

    setFetchCodesStatus("running")
    const toastId = toast.loading(`Fetching ERP item codes for ${missingCodeItems.length} items...`)
    try {
      const result = await dispatch(fetchItemCodes(missingCodeItems.map((i) => i.id))).unwrap()
      toast.success(`Item codes fetched for ${result.fetched} item(s).`, { id: toastId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to fetch item codes."
      toast.error(message, { id: toastId })
    } finally {
      setFetchCodesStatus("idle")
    }
  }

  const handleUpdateProductCost = async () => {
    // Collect items that pass all active filters (same logic as filteredEnquiries)
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of enquiry.items) {
        let pass = true
        if (filters.itemName && !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())) pass = false
        if (filters.quantity && !item.quantity.toString().includes(filters.quantity)) pass = false
        if (!matchesMulti(filters.itemType, item.itemType)) pass = false
        if (filters.itemTypeSearch && !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.moc, item.moc)) pass = false
        if (filters.mocSearch && !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.size, item.size, isBlankSize)) pass = false
        if (pass) matchedItems.push(item)
      }
    }

    const costItems = matchedItems.filter((i) => i.erpItemCode && !i.productCost)
    console.log(`[Client] updateProductCost: ${costItems.length} items with blank product cost out of ${matchedItems.length} matched`)
    if (costItems.length === 0) {
      toast.info("No items with blank product cost found.")
      return
    }
    if (!confirm(`Update product cost for ${costItems.length} items from raw material BOM costs?`)) return

    setUpdateCostStatus("running")
    const toastId = toast.loading(`Updating product cost for ${costItems.length} items...`)
    try {
      const result = await dispatch(updateProductCost(costItems.map((i) => i.id))).unwrap()
      toast.success(`Product cost updated for ${result.updated} item(s).`, { id: toastId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to update product cost."
      toast.error(message, { id: toastId })
    } finally {
      setUpdateCostStatus("idle")
    }
  }

  const handleAutoFillVa = async () => {
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of enquiry.items) {
        let pass = true
        if (filters.itemName && !item.itemName.toLowerCase().includes(filters.itemName.toLowerCase())) pass = false
        if (filters.quantity && !item.quantity.toString().includes(filters.quantity)) pass = false
        if (!matchesMulti(filters.itemType, item.itemType)) pass = false
        if (filters.itemTypeSearch && !(item.itemType || "").toLowerCase().includes(filters.itemTypeSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.moc, item.moc)) pass = false
        if (filters.mocSearch && !(item.moc || "").toLowerCase().includes(filters.mocSearch.toLowerCase())) pass = false
        if (!matchesMulti(filters.size, item.size, isBlankSize)) pass = false
        if (pass) matchedItems.push(item)
      }
    }

    const blankVaItems = matchedItems.filter((i: EnquiryItemData) => !i.vaPercent)
    console.log(`[Client] autoFillVa: ${blankVaItems.length} items with blank VA% out of ${matchedItems.length} matched`)
    blankVaItems.forEach((i: EnquiryItemData) => console.log(`  → ${i.itemName} (type: ${i.itemType || "?"}, size: ${i.size || "?"})`))
    if (blankVaItems.length === 0) {
      toast.info("No blank VA% fields to fill.")
      return
    }
    if (!confirm(`Auto-fill VA% for ${blankVaItems.length} items (based on item type + size defaults)?`)) return

    setVaStatus("running")
    try {
      const result = await dispatch(updateVaPercent(blankVaItems.map((i: EnquiryItemData) => i.id))).unwrap()
      console.log(`[Client] VA% auto-fill result:`, result)
      toast.success(`VA% auto-fill complete.`)
    } catch (err) {
      console.error(`[Client] VA% auto-fill failed:`, err)
    } finally {
      setVaStatus("idle")
    }
  }

  const handleFetchContractReviewRates = async () => {
    // Collect items with an erpItemCode from currently paginated enquiries that pass active filters
    const itemsWithCode: EnquiryItemData[] = []
    for (const enquiry of paginatedEnquiries) {
      for (const item of getFilteredItems(enquiry)) {
        if (item.erpItemCode) itemsWithCode.push(item)
      }
    }
    if (itemsWithCode.length === 0) {
      toast.info("No items with ERP item codes found on this page.")
      return
    }
    if (!confirm(`Fetch Contract Review rates for ${itemsWithCode.length} item(s) with ERP item codes?`)) return

    setCrRateStatus("running")
    const toastId = toast.loading(`Fetching Contract Review rates for ${itemsWithCode.length} item(s)...`)
    try {
      const result = await dispatch(fetchContractReviewRates(itemsWithCode.map((i) => i.id))).unwrap()
      toast.success(`Contract Review rates updated for ${result.updated} item(s).`, { id: toastId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to fetch CR rates."
      toast.error(message, { id: toastId })
    } finally {
      setCrRateStatus("idle")
    }
  }

  const SELECT_COL_WIDTH = 44;
  const totalTableWidth = Object.values(columnWidths).reduce((a, b) => a + b, 0) + SELECT_COL_WIDTH;

  const inputClass =
    "mt-1.5 w-full h-7 rounded border border-input bg-background px-2 py-0.5 text-[10px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 normal-case";

  // Active inline cell dropdown styles (Google Sheets-like transparent border, visible chevron, hover background)
  const cellSelectClass =
    "w-full bg-transparent border-none text-xs text-foreground outline-none cursor-pointer focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded p-1 hover:bg-muted/80 transition-colors normal-case font-medium";
  const cellItemSelectClass =
    "w-full bg-transparent border-none text-xs text-muted-foreground outline-none cursor-pointer focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded p-1 hover:bg-muted/80 transition-colors normal-case font-medium";

  return (
    <div className="flex flex-col flex-1 w-full max-w-full min-w-0">
      {/* Table Toolbar */}
      <div className="flex justify-between items-center px-4 py-2.5 bg-muted/50 border-b border-border">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Showing {filteredEnquiries.length} of {enquiries.length} enquiries
        </span>
        
        <div className="flex items-center gap-2 shrink-0">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetAllFilters}
              className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
            >
              <svg className="h-3.5 w-3.5 text-rose-700 dark:text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
              </svg>
              Reset Filters
            </button>
          )}

          <MultiSelectFilter
            label="Validation"
            allLabel="Validation: All"
            options={["Yes", "No"]}
            cascadedOptions={cascadedOptions.validation}
            selected={filters.validation}
            onChange={(v) => dispatch(setFilter({ field: "validation", value: v }))}
            includeBlank
            className="h-8 w-40 rounded-md border border-border bg-background text-foreground"
            panelClassName="w-56"
          />

          <button
            type="button"
            onClick={handleExportToExcel}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-[#0f62fe] hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-[#0f62fe] dark:text-blue-400 stroke-[2]" />
            Export Excel
          </button>

          <div className="relative">
            <input
              type="file"
              id="excel-import-file"
              accept=".xlsx, .xls"
              onChange={handleImportFromExcel}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => document.getElementById("excel-import-file")?.click()}
              className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
            >
              <Upload className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 stroke-[2]" />
              Import Excel
            </button>
          </div>

          <button
            type="button"
            onClick={handleAutoFillBlanks}
            disabled={autoFillStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-400 dark:hover:bg-purple-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-700 dark:text-purple-400 stroke-[2]" />
            {autoFillStatus === "running" ? "Filling..." : "Auto-Fill Blanks"}
          </button>

          <button
            type="button"
            onClick={handleFetchItemCodes}
            disabled={fetchCodesStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-blue-700 dark:text-blue-400 stroke-[2] ${fetchCodesStatus === "running" ? "animate-spin" : ""}`} />
            {fetchCodesStatus === "running" ? "Fetching..." : "Fetch Item Codes"}
          </button>

          <button
            type="button"
            onClick={handleUpdateProductCost}
            disabled={updateCostStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-400 dark:hover:bg-teal-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0 disabled:opacity-50"
          >
            <DollarSign className={`h-3.5 w-3.5 text-teal-700 dark:text-teal-400 stroke-[2] ${updateCostStatus === "running" ? "animate-spin" : ""}`} />
            {updateCostStatus === "running" ? "Updating..." : "Update Product Cost"}
          </button>

          <button
            type="button"
            onClick={handleAutoFillVa}
            disabled={vaStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0 disabled:opacity-50"
          >
            <Percent className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 stroke-[2]" />
            {vaStatus === "running" ? "Filling VA%..." : "Auto-Fill VA%"}
          </button>

          <button
            type="button"
            onClick={handleFetchContractReviewRates}
            disabled={crRateStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400 dark:hover:bg-violet-950/50 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-violet-700 dark:text-violet-400 stroke-[2] ${crRateStatus === "running" ? "animate-spin" : ""}`} />
            {crRateStatus === "running" ? "Fetching..." : "Fetch CR Rates"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[70vh] w-full min-w-0 border-b border-border">
        <table
        className="border-collapse text-left border border-border"
        style={{ tableLayout: "fixed", width: totalTableWidth }}
      >
        <colgroup>
          <col style={{ width: SELECT_COL_WIDTH }} />
          {Object.keys(columnWidths).map((_, idx) => (
            <col key={idx} style={{ width: columnWidths[idx] }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-muted/80 select-none">
            {/* Select checkbox column */}
            <th className="py-2.5 px-2 sticky top-0 z-30 bg-muted/90 border-r border-b border-border text-center">
              {selectedItemIds.size > 0 && selectedEnquiryId ? (
                <button
                  type="button"
                  onClick={clearSelection}
                  title="Clear selection"
                  className="inline-flex items-center justify-center p-1 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">Sel</span>
              )}
            </th>
            {/* 0. Enquiry Date */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Enquiry Date</span>
                {renderSortArrow("enquiryDate")}
              </div>
              <div className="flex gap-1 items-center mt-1.5">
                <input
                  type="date"
                  value={filterEnquiryDateFrom}
                  onChange={(e) => setFilterEnquiryDateFrom(e.target.value)}
                  className="h-6 w-full text-[9px] p-0.5 border rounded bg-background text-foreground outline-none font-normal"
                />
                <span className="text-[9px] text-muted-foreground font-normal">to</span>
                <input
                  type="date"
                  value={filterEnquiryDateTo}
                  onChange={(e) => setFilterEnquiryDateTo(e.target.value)}
                  className="h-6 w-full text-[9px] p-0.5 border rounded bg-background text-foreground outline-none font-normal"
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(0, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 1. Docket No */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Docket No</span>
                {renderSortArrow("docketNumber")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterDocketNumber}
                onChange={(e) => setFilterDocketNumber(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(1, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 2. Party Name */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Party Name</span>
                {renderSortArrow("partyName")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Party Name"
                  allLabel="All Parties"
                  options={dropdownOptions.partyNames}
                  cascadedOptions={cascadedOptions.partyNames}
                  selected={filters.partyNames}
                  onChange={(v) => dispatch(setFilter({ field: "partyNames", value: v }))}
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(2, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 3. Enquiry Type Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Enquiry Type</span>
                {renderSortArrow("enquiryType")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Enquiry Type"
                  allLabel="All Types"
                  options={dropdownOptions.enquiryTypes}
                  cascadedOptions={cascadedOptions.enquiryType}
                  selected={filters.enquiryType}
                  onChange={(v) => dispatch(setFilter({ field: "enquiryType", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(3, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 4. State Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>State</span>
                {renderSortArrow("state")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="State"
                  allLabel="All States"
                  options={dropdownOptions.states}
                  cascadedOptions={cascadedOptions.state}
                  selected={filters.state}
                  onChange={(v) => dispatch(setFilter({ field: "state", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(4, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 5. Payment Terms Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Payment Terms</span>
                {renderSortArrow("paymentTerms")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Payment Terms"
                  allLabel="All Terms"
                  options={dropdownOptions.paymentTerms}
                  cascadedOptions={cascadedOptions.paymentTerms}
                  selected={filters.paymentTerms}
                  onChange={(v) => dispatch(setFilter({ field: "paymentTerms", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(5, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 6. Inspection Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Inspection</span>
                {renderSortArrow("inspection")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Inspection"
                  allLabel="All"
                  options={dropdownOptions.inspections}
                  cascadedOptions={cascadedOptions.inspection}
                  selected={filters.inspection}
                  onChange={(v) => dispatch(setFilter({ field: "inspection", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(6, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 7. PBG Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>PBG</span>
                {renderSortArrow("pbg")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="PBG"
                  allLabel="All"
                  options={dropdownOptions.pbgs}
                  cascadedOptions={cascadedOptions.pbg}
                  selected={filters.pbg}
                  onChange={(v) => dispatch(setFilter({ field: "pbg", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(7, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 8. Utility Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Utility</span>
                {renderSortArrow("utility")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Utility"
                  allLabel="All Utilities"
                  options={dropdownOptions.utilities}
                  cascadedOptions={cascadedOptions.utility}
                  selected={filters.utility}
                  onChange={(v) => dispatch(setFilter({ field: "utility", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(8, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>



            {/* 10. Order Status Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Order Status</span>
                {renderSortArrow("orderStatus")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Order Status"
                  allLabel="All Statuses"
                  options={dropdownOptions.orderStatuses}
                  cascadedOptions={cascadedOptions.orderStatus}
                  selected={filters.orderStatus}
                  onChange={(v) => dispatch(setFilter({ field: "orderStatus", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(9, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* Closure Status */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Closure Status</span>
                {renderSortArrow("closureStatus")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Closure Status"
                  allLabel="All"
                  options={["Sent"]}
                  cascadedOptions={cascadedOptions.closureStatus}
                  selected={filters.closureStatus}
                  onChange={(v) => dispatch(setFilter({ field: "closureStatus", value: v }))}
                  includeBlank
                  searchPlaceholder="Search closure status..."
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(10, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 11. Project Reference */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Project Reference</span>
                {renderSortArrow("projectReference")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterProjectReference}
                onChange={(e) => setFilterProjectReference(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(11, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 12. Item Name As Per Party */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Name</span>
                {renderSortArrow("itemName")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterItemName}
                onChange={(e) => setFilterItemName(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(12, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 12. Quantity */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Quantity</span>
                {renderSortArrow("quantity")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterQuantity}
                onChange={(e) => setFilterQuantity(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(13, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 13. Item Type Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Type</span>
                {renderSortArrow("itemType")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Item Type"
                  allLabel="All Types"
                  options={dropdownOptions.itemTypes}
                  cascadedOptions={cascadedOptions.itemType}
                  selected={filters.itemType}
                  onChange={(v) => dispatch(setFilter({ field: "itemType", value: v }))}
                  includeBlank
                />
              </div>
              <input
                type="text"
                placeholder="Search item type..."
                value={filterItemTypeSearch}
                onChange={(e) => setFilterItemTypeSearch(e.target.value)}
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(14, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 14. MOC Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>MOC</span>
                {renderSortArrow("moc")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="MOC"
                  allLabel="All MOCs"
                  options={dropdownOptions.mocs}
                  cascadedOptions={cascadedOptions.moc}
                  selected={filters.moc}
                  onChange={(v) => dispatch(setFilter({ field: "moc", value: v }))}
                  includeBlank
                />
              </div>
              <input
                type="text"
                placeholder="Search MOC..."
                value={filterMocSearch}
                onChange={(e) => setFilterMocSearch(e.target.value)}
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(15, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 15. Size Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Size</span>
                {renderSortArrow("size")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Size"
                  allLabel="All Sizes"
                  options={dropdownOptions.sizes}
                  cascadedOptions={cascadedOptions.size}
                  selected={filters.size}
                  onChange={(v) => dispatch(setFilter({ field: "size", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(16, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 16. PN Rating Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>PN Rating</span>
                {renderSortArrow("pnRating")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="PN Rating"
                  allLabel="All Ratings"
                  options={dropdownOptions.pnRatings}
                  cascadedOptions={cascadedOptions.pnRating}
                  selected={filters.pnRating}
                  onChange={(v) => dispatch(setFilter({ field: "pnRating", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(17, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 17. Item Code (read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Code</span>
                {renderSortArrow("erpItemCode")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Item Code"
                  allLabel="All Codes"
                  options={cascadedOptions.erpItemCode}
                  cascadedOptions={cascadedOptions.erpItemCode}
                  selected={filters.erpItemCode}
                  onChange={(v) => dispatch(setFilter({ field: "erpItemCode", value: v }))}
                  includeBlank
                  searchPlaceholder="Search item codes..."
                />
              </div>
              <input
                type="text"
                placeholder="Search item code..."
                value={filterErpItemCodeSearch}
                onChange={(e) => setFilterErpItemCodeSearch(e.target.value)}
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(18, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 18. Operation Type Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Operation Type</span>
                {renderSortArrow("operationType")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Operation Type"
                  allLabel="All Operations"
                  options={dropdownOptions.operationTypes}
                  cascadedOptions={cascadedOptions.operationType}
                  selected={filters.operationType}
                  onChange={(v) => dispatch(setFilter({ field: "operationType", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(19, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 19. Extension Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Extension</span>
                {renderSortArrow("extension")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Extension"
                  allLabel="All"
                  options={dropdownOptions.extensions}
                  cascadedOptions={cascadedOptions.extension}
                  selected={filters.extension}
                  onChange={(v) => dispatch(setFilter({ field: "extension", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(20, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 21. Bypass Dropdown */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Bypass</span>
                {renderSortArrow("bypass")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Bypass"
                  allLabel="All"
                  options={dropdownOptions.bypasses}
                  cascadedOptions={cascadedOptions.bypass}
                  selected={filters.bypass}
                  onChange={(v) => dispatch(setFilter({ field: "bypass", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(21, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 21. Product Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Product Cost</span>
                {renderSortArrow("productCost")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Product Cost"
                  allLabel="All Costs"
                  options={cascadedOptions.productCost}
                  cascadedOptions={cascadedOptions.productCost}
                  selected={filters.productCost}
                  onChange={(v) => dispatch(setFilter({ field: "productCost", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(22, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 22. Cost Ref Code */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Cost Ref Code</span>
                {renderSortArrow("costRefCode")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterCostRefCode}
                onChange={(e) => setFilterCostRefCode(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(23, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 23. Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Cost</span>
                {renderSortArrow("cost")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterCost}
                onChange={(e) => setFilterCost(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(24, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 24. Stock Status */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Stock Status</span>
                {renderSortArrow("stockStatus")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterStockStatus}
                onChange={(e) => setFilterStockStatus(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(25, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 25. Discount */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Discount</span>
                {renderSortArrow("discount")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterDiscount}
                onChange={(e) => setFilterDiscount(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(26, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 26. VA% (Moved here next to Quotation Rate) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>VA%</span>
                {renderSortArrow("vaPercent")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="VA%"
                  allLabel="All VA%"
                  options={dropdownOptions.vaPercents}
                  cascadedOptions={cascadedOptions.vaPercent}
                  selected={filters.vaPercent}
                  onChange={(v) => dispatch(setFilter({ field: "vaPercent", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(27, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 27. Quoted Rate */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Quotation Rate</span>
                {renderSortArrow("quotedRate")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterQuotedRate}
                onChange={(e) => setFilterQuotedRate(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(28, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 29. CR Rate (Contract Review Rate — read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Rate(Contract Review)</span>
                {renderSortArrow("contractReviewRate")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="CR Rate"
                  allLabel="All CR Rates"
                  options={cascadedOptions.contractReviewRate || []}
                  cascadedOptions={cascadedOptions.contractReviewRate || []}
                  selected={filters.contractReviewRate || []}
                  onChange={(v) => dispatch(setFilter({ field: "contractReviewRate", value: v }))}
                  includeBlank
                  searchPlaceholder="Search CR rates..."
                />
              </div>
              <input
                type="text"
                placeholder="Search CR rate..."
                value={filterContractReviewRateSearch}
                onChange={(e) => setFilterContractReviewRateSearch(e.target.value)}
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(29, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 30. PD Cost Validation (read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>PD Cost Val</span>
                {renderSortArrow("pdcostValidation")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterPdcostValidationSearch}
                onChange={(e) => setFilterPdcostValidationSearch(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(30, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 31. QR incl. GST */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>QR incl. GST</span>
                {renderSortArrow("quotedRateGst")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterQuotedRateGst}
                onChange={(e) => setFilterQuotedRateGst(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(31, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 32. Item Name (Merge) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Name (Merge)</span>
                {renderSortArrow("itemNameMerge")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterItemNameMerge}
                onChange={(e) => setFilterItemNameMerge(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(32, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 33. Total Value */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Total Value incl. GST</span>
                {renderSortArrow("totalValue")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterTotalValue}
                onChange={(e) => setFilterTotalValue(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(33, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 34. Itemwise Total Value */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Itemwise Total Value</span>
                {renderSortArrow("itemWiseTotalValue")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterItemWiseTotalValue}
                onChange={(e) => setFilterItemWiseTotalValue(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(34, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 35. Validation */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Validation</span>
                {renderSortArrow("validation")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Validation"
                  allLabel="All"
                  options={["Yes", "No"]}
                  cascadedOptions={cascadedOptions.validation}
                  selected={filters.validation}
                  onChange={(v) => dispatch(setFilter({ field: "validation", value: v }))}
                  includeBlank
                />
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 normal-case">
                <button
                  type="button"
                  onClick={() => handleBulkValidation("Yes")}
                  disabled={bulkValidationRunning !== null}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"
                  title="Set all filtered items (all pages) to Yes"
                >
                  {bulkValidationRunning === "Yes" ? "..." : "All Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkValidation("No")}
                  disabled={bulkValidationRunning !== null}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
                  title="Set all filtered items (all pages) to No"
                >
                  {bulkValidationRunning === "No" ? "..." : "All No"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkValidation("")}
                  disabled={bulkValidationRunning !== null}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                  title="Clear validation for all filtered items (all pages)"
                >
                  {bulkValidationRunning === "Clear" ? "..." : "Clear"}
                </button>
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(35, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 36. Attachment */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Attachment</span>
                {renderSortArrow("attachment")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterAttachment}
                onChange={(e) => setFilterAttachment(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(36, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 37. Delivery Schedule */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Delivery Schedule</span>
              </div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(37, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 38. Offer PDF */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted/90 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Offer PDF</span>
              </div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(38, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 35. Actions */}
            <th className="sticky top-0 z-30 bg-muted/90 py-2.5 px-3 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-b border-border text-right">
              <div>Actions</div>
              <div className="h-7 mt-1.5" />
            </th>
          </tr>
        </thead>
        <tbody className="bg-background">
          {filteredEnquiries.length === 0 ? (
            <tr>
              <td colSpan={40} className="py-20 px-4 text-center border-b border-border">
                <div className="flex flex-col items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4 border border-border">
                    <Search className="h-6 w-6 stroke-[1.5]" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">
                    No enquiries found
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                    Get started by adding items or creating a new enquiry.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            paginatedEnquiries.map((enquiry) => {
              const { company, branch } = parseParty(enquiry.partyName);
              const initials = getInitials(enquiry.partyName);
              const displayItems = getFilteredItems(enquiry);
              const hasMultiple = displayItems.length > 1;
              const isExpanded = expandedRows[enquiry.id] !== undefined
                ? expandedRows[enquiry.id]
                : hasActiveFilters;
              const firstItem = displayItems[0];
              const selectedCount = displayItems.filter((i) => selectedItemIds.has(i.id)).length;
              const isAllSelected = displayItems.length > 0 && selectedCount === displayItems.length;
              const isSomeSelected = selectedCount > 0 && selectedCount < displayItems.length;
              const isThisEnquiryActive = selectedEnquiryId === enquiry.id;

              // Setup custom brand avatar styles
              let badgeBg = "bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800";
              if (initials === "RE") {
                badgeBg = "bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800";
              } else if (initials === "AD") {
                badgeBg = "bg-sky-50 text-sky-600 border border-sky-100 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-800";
              } else if (initials === "LT") {
                badgeBg = "bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800";
              } else if (initials === "JS") {
                badgeBg = "bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800";
              }

               return (
                <React.Fragment key={enquiry.id}>
                  {/* Main Docket / First Item Row */}
                  <tr
                    className={`transition-colors ${firstItem && invalidVaItemIds.has(firstItem.id) ? "bg-red-100 dark:bg-red-950/40" : "hover:bg-muted/20"}`}>
                    {/* Select checkbox for first item */}
                    <td className="py-3.5 px-2 text-center border-r border-b border-border">
                      {firstItem ? (
                        <input
                          type="checkbox"
                          checked={isItemSelected(firstItem.id)}
                          onChange={() => toggleItemSelection(enquiry.id, firstItem.id)}
                          className="h-3.5 w-3.5 rounded border-border text-[#0f62fe] focus:ring-blue-500 cursor-pointer"
                          title={isItemSelected(firstItem.id) ? "Deselect item" : "Select item"}
                        />
                      ) : null}
                    </td>
                    {/* Enquiry Date */}
                    <td className="py-3.5 px-4 text-xs text-muted-foreground border-r border-b border-border last:border-r-0 truncate">
                      {new Date(enquiry.enquiryDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>

                    {/* Docket No with expand arrow if applicable */}
                    <td className="py-3.5 px-4 text-xs font-semibold text-[#0f62fe] dark:text-blue-400 border-r border-b border-border last:border-r-0">
                      <div className="flex items-center flex-wrap gap-1">
                        {hasMultiple && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(enquiry.id)}
                            className="mr-1 inline-flex items-center justify-center p-0.5 hover:bg-muted rounded text-muted-foreground cursor-pointer focus:outline-none shrink-0"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <span className="hover:underline cursor-pointer truncate">
                          {enquiry.docketNumber}
                        </span>
                        {hasMultiple && !isExpanded && (
                          <span className="ml-1 px-1.5 py-0.5 text-[9px] font-medium bg-blue-50 text-blue-600 rounded-full border border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800 shrink-0">
                            +{displayItems.length - 1} more items
                          </span>
                        )}
                      </div>
                      {/* Per-enquiry bulk delete bar: filtered scope, persisted across pagination */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {displayItems.length > 1 && (
                          <label className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isAllSelected}
                              ref={(el) => { if (el) el.indeterminate = isSomeSelected; }}
                              onChange={() => toggleSelectAllForEnquiry(enquiry, displayItems)}
                              className="h-3 w-3 rounded border-border cursor-pointer"
                              title={isAllSelected ? "Deselect all filtered items" : "Select all filtered items"}
                            />
                            {isAllSelected ? "All" : "Select all"}
                            <span className="text-[9px] text-muted-foreground/70">({displayItems.length} filtered)</span>
                          </label>
                        )}
                        {isThisEnquiryActive && selectedCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-400">{selectedCount} selected</span>
                            <button
                              type="button"
                              onClick={() => setBulkConfirmOpen(true)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete ({selectedCount})
                            </button>
                            <button
                              type="button"
                              onClick={clearSelection}
                              className="inline-flex items-center p-0.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                              title="Clear selection"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Party Name */}
                    <td className="py-2.5 px-4 border-r border-b border-border last:border-r-0 truncate">
                      {editingPartyEnquiryId === enquiry.id ? (
                        <select
                          value={enquiry.partyName}
                          onChange={(e) => {
                            handleEnquiryFieldChange(enquiry.id, "partyName", e.target.value);
                            setEditingPartyEnquiryId(null);
                          }}
                          onBlur={() => setEditingPartyEnquiryId(null)}
                          autoFocus
                          className="w-full h-8 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground outline-none focus:border-blue-500 normal-case cursor-pointer font-semibold"
                        >
                          {dropdownOptions.partyNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex items-center justify-between w-full group truncate">
                          <div className="flex items-center gap-3 truncate">
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${badgeBg}`}
                            >
                              {initials}
                            </div>
                            <div className="flex flex-col truncate">
                              <span className="text-xs font-bold text-foreground truncate">
                                {company}
                              </span>
                              {branch && (
                                <span className="text-[10px] text-muted-foreground font-medium truncate">
                                  {branch}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingPartyEnquiryId(enquiry.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground cursor-pointer shrink-0 transition-opacity ml-2"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>

                    {/* 3. Enquiry Type Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.enquiryType || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "enquiryType", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.enquiryTypes.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 4. State Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.state || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "state", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.states.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 5. Payment Terms Inline Select */}
                    <td className="py-1 px-1 border-r border-b border-border last:border-r-0 align-top group">
                      <div className="flex gap-0.5 items-start w-full">
                        <textarea
                          key={enquiry.paymentTerms || ""}
                          defaultValue={enquiry.paymentTerms || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (enquiry.paymentTerms || "")) {
                              handleEnquiryFieldChange(enquiry.id, "paymentTerms", e.target.value);
                            }
                          }}
                          placeholder="-"
                          rows={2}
                          className="w-full resize-none bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium cell-scrollable leading-normal max-h-12 overflow-y-auto"
                        />
                        <div className="relative shrink-0 w-4 h-7 flex items-center justify-center cursor-pointer">
                          <select
                            value={enquiry.paymentTerms || ""}
                            onChange={(e) => {
                              handleEnquiryFieldChange(enquiry.id, "paymentTerms", e.target.value);
                              const flexContainer = e.target.closest('.flex');
                              const textarea = flexContainer ? flexContainer.querySelector('textarea') : null;
                              if (textarea) textarea.value = e.target.value;
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                          >
                            <option value="">-</option>
                            {dropdownOptions.paymentTerms.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <ChevronDown className="h-3 w-3 text-muted-foreground pointer-events-none group-hover:text-muted-foreground z-0" />
                        </div>
                      </div>
                    </td>

                    {/* 6. Inspection Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.inspection || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "inspection", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.inspections.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 7. PBG Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.pbg || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "pbg", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.pbgs.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* 8. Utility Inline Dropdown */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.utility || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "utility", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.utilities.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>



                    {/* 10. Order Status Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <select
                        value={enquiry.orderStatus || ""}
                        onChange={(e) => handleEnquiryFieldChange(enquiry.id, "orderStatus", e.target.value)}
                        className={cellSelectClass}
                      >
                        <option value="">-</option>
                        {dropdownOptions.orderStatuses.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>

                    {/* Closure Status */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <input
                        key={enquiry.id + "-closureStatus-" + (enquiry.closureStatus || "")}
                        type="text"
                        defaultValue={enquiry.closureStatus || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (enquiry.closureStatus || "")) {
                            handleEnquiryFieldChange(enquiry.id, "closureStatus", e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="-"
                        className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-center"
                      />
                    </td>

                    {/* Project Reference */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      <input
                        key={enquiry.id + "-projectReference-" + (enquiry.projectReference || "")}
                        type="text"
                        defaultValue={enquiry.projectReference || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (enquiry.projectReference || "")) {
                            handleEnquiryFieldChange(enquiry.id, "projectReference", e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="-"
                        className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-center"
                      />
                    </td>

                    {/* First Item Name */}
                    <td className="py-2 px-2 text-xs text-muted-foreground font-medium border-r border-b border-border last:border-r-0 align-top">
                      {firstItem ? (
                        editingItemNameId === firstItem.id ? (
                          <input
                            type="text"
                            defaultValue={firstItem.itemName}
                            autoFocus
                            onBlur={(e) => {
                              if (e.target.value.trim() !== firstItem.itemName) {
                                handleItemFieldChange(firstItem.id, "itemName", e.target.value.trim());
                              }
                              setEditingItemNameId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                (e.target as HTMLInputElement).blur();
                              } else if (e.key === "Escape") {
                                setEditingItemNameId(null);
                              }
                            }}
                            className="w-full bg-background border border-blue-500 text-xs text-foreground outline-none p-1 rounded font-medium"
                          />
                        ) : (
                          <div className="flex items-center justify-between w-full group truncate">
                            <div className="max-h-12 overflow-y-auto w-full pr-1 cell-scrollable break-words whitespace-normal leading-normal">
                              {firstItem.itemName}
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingItemNameId(firstItem.id)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground cursor-pointer shrink-0 transition-opacity ml-1.5 align-middle"
                              title="Edit item name"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      ) : (
                        "No items"
                      )}
                    </td>

                    {/* First Item Quantity */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-quantity-" + (firstItem.quantity || "")}
                          type="text"
                          defaultValue={firstItem.quantity ? Number(firstItem.quantity).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.quantity ? Number(firstItem.quantity).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "quantity", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-semibold text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* 13. First Item Type Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.itemType || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "itemType", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.itemTypes.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 14. First Item MOC Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.moc || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "moc", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.mocs.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 15. First Item Size Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.size || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "size", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.sizes.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 16. First Item PN Rating Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.pnRating || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "pnRating", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.pnRatings.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 18. First Item Item Code (read-only) */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate" title={firstItem.erpItemCode || ""}>
                          {firstItem.erpItemCode || "-"}
                        </span>
                      ) : "-"}
                    </td>

                    {/* 19. First Item Operation Type Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.operationType || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "operationType", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.operationTypes.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 19. First Item Extension Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.extension || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "extension", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.extensions.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* 20. First Item Bypass Inline Select */}
                    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <select
                          value={firstItem.bypass || ""}
                          onChange={(e) => handleItemFieldChange(firstItem.id, "bypass", e.target.value)}
                          className={cellItemSelectClass}
                        >
                          <option value="">-</option>
                          {dropdownOptions.bypasses.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : "-"}
                    </td>

                    {/* First Item Product Cost */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.productCost ? Number(firstItem.productCost).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.productCost ? Number(firstItem.productCost).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "productCost", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Cost Ref Code */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.costRefCode || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.costRefCode || "")) {
                              handleItemFieldChange(firstItem.id, "costRefCode", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Cost */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.cost ? Number(firstItem.cost).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.cost ? Number(firstItem.cost).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "cost", e.target.value);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "cost", e, 0)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Stock Status */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.stockStatus || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.stockStatus || "")) {
                              handleItemFieldChange(firstItem.id, "stockStatus", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Discount */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          type="text"
                          defaultValue={firstItem.discount ? Number(firstItem.discount).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.discount ? Number(firstItem.discount).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "discount", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item VA% */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0 font-semibold">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-vaPercent-" + (firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : "")}
                          type="text"
                          defaultValue={firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : "")) {
                              handleItemFieldChange(firstItem.id, "vaPercent", val);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "vaPercent", e, 0)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Quoted Rate */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-" + (firstItem.quotedRate || "")}
                          type="text"
                          defaultValue={firstItem.quotedRate || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.quotedRate || "")) {
                              handleItemFieldChange(firstItem.id, "quotedRate", e.target.value);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "quotedRate", e, 0)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item CR Rate (Contract Review Rate — read-only) */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      <span className="block text-xs text-violet-700 dark:text-violet-400 p-1 font-medium text-right">
                        {firstItem?.contractReviewRate || "-"}
                      </span>
                    </td>

                    {/* First Item PD Cost Validation (read-only) */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      <span className="block text-xs text-blue-700 dark:text-blue-400 p-1 font-medium text-right">
                        {firstItem ? getPdCostValidation(firstItem) || "-" : "-"}
                      </span>
                    </td>

                    {/* First Item QR incl. GST */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <span className="block text-xs text-foreground p-1 font-medium text-right">
                          {firstItem.quotedRateGst || "-"}
                        </span>
                      ) : "-"}
                    </td>

                    {/* First Item Item Name Merge */}
                    <td className="py-3 px-3 border-r border-b border-border last:border-r-0 text-xs text-muted-foreground font-medium truncate">
                      {firstItem ? getItemNameMerge(firstItem) || "-" : "-"}
                    </td>

                    {/* First Item Total Value */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-totalValue-" + (firstItem.totalValue || "")}
                          type="text"
                          defaultValue={firstItem.totalValue || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.totalValue || "")) {
                              handleItemFieldChange(firstItem.id, "totalValue", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Itemwise Total Value */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-itemWiseTotalValue-" + (firstItem.itemWiseTotalValue || "")}
                          type="text"
                          defaultValue={firstItem.itemWiseTotalValue || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.itemWiseTotalValue || "")) {
                              handleItemFieldChange(firstItem.id, "itemWiseTotalValue", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* Validation */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleItemFieldChange(firstItem.id, "validation", firstItem.validation === "Yes" ? "" : "Yes")}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                              firstItem.validation === "Yes"
                                ? "bg-emerald-500 text-white "
                                : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/50"
                            }`}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => handleItemFieldChange(firstItem.id, "validation", firstItem.validation === "No" ? "" : "No")}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                              firstItem.validation === "No"
                                ? "bg-rose-500 text-white "
                                : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800 dark:hover:bg-rose-950/50"
                            }`}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>

                    {/* Attachment */}
                    <td className="py-3.5 px-4 text-xs border-r border-b border-border last:border-r-0 truncate align-top">
                      <div className="flex flex-col gap-1 max-w-[150px]">
                        {enquiry.attachments && enquiry.attachments.length > 0 ? (
                          enquiry.attachments.map((att) => (
                            <a
                              key={att.id}
                              href={att.url || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs font-semibold text-[#0f62fe] dark:text-blue-400 hover:underline truncate"
                            >
                              <FileText className="h-3.5 w-3.5 text-[#0f62fe] dark:text-blue-400 stroke-[2] shrink-0" />
                              <span className="truncate">{att.name}</span>
                            </a>
                          ))
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        <button
                          type="button"
                          onClick={() => attachInputRefs.current[enquiry.id]?.click()}
                          className="inline-flex items-center gap-0.5 self-start text-[10px] font-semibold text-[#0f62fe] dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <Plus className="h-3 w-3 stroke-[2.5]" />
                          Add
                        </button>
                        <input
                          ref={(el) => {
                            if (el) attachInputRefs.current[enquiry.id] = el;
                          }}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => handleAddAttachments(e, enquiry.id)}
                        />
                      </div>
                    </td>

                    {/* Delivery Schedule */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <input
                          key={firstItem.id + "-deliverySchedule-" + (firstItem.deliverySchedule || "")}
                          type="text"
                          defaultValue={firstItem.deliverySchedule || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (firstItem.deliverySchedule || "")) {
                              handleItemFieldChange(firstItem.id, "deliverySchedule", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* Offer PDF */}
                    <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                      <OfferPdfCell enquiry={enquiry} />
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right border-b border-border">
                      {firstItem && (
                        <ActionsDropdown
                          item={{
                            ...firstItem,
                            enquiry: {
                              id: enquiry.id,
                              docketNumber: enquiry.docketNumber,
                              partyName: enquiry.partyName,
                              enquiryDate: enquiry.enquiryDate,
                              attachments: enquiry.attachments,
                              enquiryType: enquiry.enquiryType,
                              state: enquiry.state,
                              paymentTerms: enquiry.paymentTerms,
                              inspection: enquiry.inspection,
                              pbg: enquiry.pbg,
                              utility: enquiry.utility,
                              orderStatus: enquiry.orderStatus,
                            },
                          }}
                          dropdownOptions={dropdownOptions}
                        />
                      )}
                    </td>
                  </tr>

                  {/* Additional Items Sub-Rows */}
                  {isExpanded &&
                    hasMultiple &&
                    displayItems.slice(1).map((item: EnquiryItemData, idx: number) => (
                      <tr
                        key={item.id}
                        className={`transition-colors ${invalidVaItemIds.has(item.id) ? "bg-red-100 dark:bg-red-950/40" : "bg-muted/10 hover:bg-muted/20"}`}
                      >
                        {/* Select checkbox for this item + empty cells for docket info alignment */}
                        <td className="py-3 px-2 text-center border-r border-b border-border">
                          <input
                            type="checkbox"
                            checked={isItemSelected(item.id)}
                            onChange={() => toggleItemSelection(enquiry.id, item.id)}
                            className="h-3.5 w-3.5 rounded border-border text-[#0f62fe] focus:ring-blue-500 cursor-pointer"
                            title={isItemSelected(item.id) ? "Deselect item" : "Select item"}
                          />
                        </td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Additional Item Name */}
                        <td className="py-2 px-2 text-xs text-muted-foreground font-medium border-r border-b border-border last:border-r-0 align-top">
                          {editingItemNameId === item.id ? (
                            <input
                              type="text"
                              defaultValue={item.itemName}
                              autoFocus
                              onBlur={(e) => {
                                if (e.target.value.trim() !== item.itemName) {
                                  handleItemFieldChange(item.id, "itemName", e.target.value.trim());
                                }
                                setEditingItemNameId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  (e.target as HTMLInputElement).blur();
                                } else if (e.key === "Escape") {
                                  setEditingItemNameId(null);
                                }
                              }}
                              className="w-full bg-background border border-blue-500 text-xs text-foreground outline-none p-1 rounded font-medium"
                            />
                          ) : (
                            <div className="flex items-center justify-between w-full group truncate">
                              <div className="max-h-12 overflow-y-auto w-full pr-1 cell-scrollable break-words whitespace-normal leading-normal">
                                {item.itemName}
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingItemNameId(item.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground cursor-pointer shrink-0 transition-opacity ml-1.5 align-middle"
                                title="Edit item name"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </td>
                        
                        {/* Additional Item Quantity */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-quantity-" + (item.quantity || "")}
                            type="text"
                            defaultValue={item.quantity ? Number(item.quantity).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.quantity ? Number(item.quantity).toString() : "")) {
                              handleItemFieldChange(item.id, "quantity", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-semibold text-right"
                        />
                        </td>

                        {/* 13. Item Type Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.itemType || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "itemType", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.itemTypes.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 14. MOC Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.moc || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "moc", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.mocs.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 15. Size Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.size || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "size", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.sizes.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 16. PN Rating Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.pnRating || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "pnRating", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.pnRatings.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* Item Code (read-only) */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate" title={item.erpItemCode || ""}>
                            {item.erpItemCode || "-"}
                          </span>
                        </td>

                        {/* 18. Operation Type Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.operationType || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "operationType", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.operationTypes.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 19. Extension Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.extension || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "extension", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.extensions.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* 20. Bypass Inline Select */}
                        <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
                          <select
                            value={item.bypass || ""}
                            onChange={(e) => handleItemFieldChange(item.id, "bypass", e.target.value)}
                            className={cellItemSelectClass}
                          >
                            <option value="">-</option>
                            {dropdownOptions.bypasses.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {/* Product Cost */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.productCost ? Number(item.productCost).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.productCost ? Number(item.productCost).toString() : "")) {
                              handleItemFieldChange(item.id, "productCost", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* Cost Ref Code */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.costRefCode || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.costRefCode || "")) {
                              handleItemFieldChange(item.id, "costRefCode", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      </td>

                      {/* Cost */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.cost ? Number(item.cost).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.cost ? Number(item.cost).toString() : "")) {
                              handleItemFieldChange(item.id, "cost", e.target.value);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "cost", e, idx + 1)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* Stock Status */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.stockStatus || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.stockStatus || "")) {
                              handleItemFieldChange(item.id, "stockStatus", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      </td>

                      {/* Discount */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            type="text"
                            defaultValue={item.discount ? Number(item.discount).toString() : ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.discount ? Number(item.discount).toString() : "")) {
                              handleItemFieldChange(item.id, "discount", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* VA% */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0 font-semibold">
                          <input
                            key={item.id + "-vaPercent-" + (item.vaPercent !== null ? `${item.vaPercent}%` : "")}
                            type="text"
                            defaultValue={item.vaPercent !== null ? `${item.vaPercent}%` : ""}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (item.vaPercent !== null ? `${item.vaPercent}%` : "")) {
                              handleItemFieldChange(item.id, "vaPercent", val);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "vaPercent", e, idx + 1)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* Quoted Rate */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-" + (item.quotedRate || "")}
                            type="text"
                            defaultValue={item.quotedRate || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.quotedRate || "")) {
                              handleItemFieldChange(item.id, "quotedRate", e.target.value);
                            }
                          }}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "quotedRate", e, idx + 1)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      </td>

                      {/* CR Rate (Contract Review Rate — read-only) */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-xs text-violet-700 dark:text-violet-400 p-1 font-medium text-right">
                            {item.contractReviewRate || "-"}
                          </span>
                        </td>

                      {/* PD Cost Validation (read-only) */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-xs text-blue-700 dark:text-blue-400 p-1 font-medium text-right">
                            {getPdCostValidation(item) || "-"}
                          </span>
                        </td>

                      {/* QR incl. GST */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-xs text-foreground p-1 font-medium text-right">
                            {item.quotedRateGst || "-"}
                          </span>
                        </td>

                        {/* Item Name Merge */}
                        <td className="py-3 px-3 border-r border-b border-border last:border-r-0 text-xs text-muted-foreground font-medium truncate">
                          {getItemNameMerge(item) || "-"}
                        </td>

                        {/* Total Value */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-totalValue-" + (item.totalValue || "")}
                            type="text"
                            defaultValue={item.totalValue || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.totalValue || "")) {
                              handleItemFieldChange(item.id, "totalValue", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* Itemwise Total Value */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-itemWiseTotalValue-" + (item.itemWiseTotalValue || "")}
                            type="text"
                            defaultValue={item.itemWiseTotalValue || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.itemWiseTotalValue || "")) {
                              handleItemFieldChange(item.id, "itemWiseTotalValue", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      </td>

                      {/* Validation */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleItemFieldChange(item.id, "validation", item.validation === "Yes" ? "" : "Yes")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                                item.validation === "Yes"
                                  ? "bg-emerald-500 text-white "
                                  : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/50"
                              }`}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => handleItemFieldChange(item.id, "validation", item.validation === "No" ? "" : "No")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                                item.validation === "No"
                                  ? "bg-rose-500 text-white "
                                  : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800 dark:hover:bg-rose-950/50"
                              }`}
                            >
                              No
                            </button>
                          </div>
                        </td>

                      {/* Empty attachment column */}
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Delivery Schedule */}
                        <td className="py-2 px-2 border-r border-b border-border last:border-r-0">
                          <input
                            key={item.id + "-deliverySchedule-" + (item.deliverySchedule || "")}
                            type="text"
                            defaultValue={item.deliverySchedule || ""}
                          onBlur={(e) => {
                            if (e.target.value !== (item.deliverySchedule || "")) {
                              handleItemFieldChange(item.id, "deliverySchedule", e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          placeholder="-"
                          className="w-full bg-transparent border-none text-xs text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      </td>

                      {/* Empty Offer PDF column */}
                        <td className="py-3 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Actions on this item */}
                        <td className="py-3.5 px-4 text-right border-b border-border">
                          <ActionsDropdown
                            item={{
                              ...item,
                              enquiry: {
                                id: enquiry.id,
                                docketNumber: enquiry.docketNumber,
                                partyName: enquiry.partyName,
                                enquiryDate: enquiry.enquiryDate,
                                attachments: enquiry.attachments,
                                enquiryType: enquiry.enquiryType,
                                state: enquiry.state,
                                paymentTerms: enquiry.paymentTerms,
                                inspection: enquiry.inspection,
                                pbg: enquiry.pbg,
                                utility: enquiry.utility,
                                orderStatus: enquiry.orderStatus,
                              },
                            }}
                            dropdownOptions={dropdownOptions}
                          />
                        </td>
                      </tr>
                    ))}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>

    {filteredEnquiries.length > 0 && (
      <Pagination
        currentPage={currentPage}
        totalCount={filteredEnquiries.length}
        pageSize={pageSize}
        onPageChange={(page) => dispatch(setPage(page))}
        onPageSizeChange={(size) => {
          dispatch(setPageSize(size));
          dispatch(setPage(1));
        }}
      />
    )}

    {/* Bulk Delete Confirm Dialog — per enquiry, filtered scope, persisted */}
    <Dialog open={bulkConfirmOpen} onOpenChange={(v) => { if (!v) setBulkConfirmOpen(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Confirm Bulk Delete
          </DialogTitle>
        </DialogHeader>
        {(() => {
          const selEnquiry = enquiries.find((e) => e.id === selectedEnquiryId);
          const selItems = selEnquiry ? selEnquiry.items.filter((it) => selectedItemIds.has(it.id)) : [];
          const allFilteredForEnquiry = selEnquiry ? getFilteredItems(selEnquiry) : [];
          const willDeleteEnquiry = selEnquiry ? selectedItemIds.size >= (selEnquiry.items.length) : false;
          // If filtering hides some items, deleting all filtered != deleting enquiry unless they are all actual items
          const willDeleteEnquiryAccurate = selEnquiry ? selItems.length === selEnquiry.items.length : false;
          return (
            <div className="py-3 space-y-3">
              <p className="text-sm text-muted-foreground">
                {selEnquiry ? (
                  <>Delete <span className="font-bold text-foreground">{selectedItemIds.size}</span> selected item(s) from docket <span className="font-bold text-foreground">"{selEnquiry.docketNumber}"</span>?</>
                ) : (
                  <>No enquiry selected.</>
                )}
              </p>
              {selItems.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded border border-border bg-muted/30 p-2 space-y-1">
                  {selItems.map((it) => (
                    <div key={it.id} className="text-xs text-foreground truncate flex items-start gap-1.5">
                      <span className="text-muted-foreground shrink-0">•</span>
                      <span className="truncate">{it.itemName}</span>
                    </div>
                  ))}
                </div>
              )}
              {willDeleteEnquiryAccurate ? (
                <p className="text-xs text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded p-2">
                  Warning: This will delete all items in this enquiry — the entire enquiry "{selEnquiry?.docketNumber}" will be removed. This cannot be undone.
                </p>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  {allFilteredForEnquiry.length !== selItems.length ? `Note: ${allFilteredForEnquiry.length} filtered items in this enquiry, ${selItems.length} selected.` : null}
                  {" "}This action cannot be undone.
                </p>
              )}
            </div>
          );
        })()}
        <DialogFooter className="pt-2 border-t border-border flex justify-end gap-2">
          <DialogClose render={<Button type="button" variant="outline" size="sm" disabled={bulkDeleting} />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={bulkDeleting || selectedItemIds.size === 0}
            onClick={handleBulkDeleteConfirm}
          >
            {bulkDeleting ? "Deleting..." : `Delete ${selectedItemIds.size} Item(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
  );
}

function triggerDownload(base64: string, fileName: string) {
  const byteChars = atob(base64);
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNums);
  const blob = new Blob([byteArray], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function OfferPdfCell({ enquiry }: { enquiry: EnquiryData }) {
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const storeItems = useAppSelector(selectAllItems);
  const items = storeItems.filter((item: EnquiryItemData) => item.enquiryId === enquiry.id);

  const handleGenerate = async () => {
    setStatus("generating");
    try {
      // Map data into OfferLetterTemplateData shape
      const rowData: OfferLetterTemplateData = {
        docketNo: enquiry.docketNumber,
        state: enquiry.state || "",
        partyName: enquiry.partyName,
        subject: `Offer For Supply under @ ${enquiry.utility || ""}`,
        price: "The Quoted prices are on Firm basis, valid for 60days.",
        paymentTerms: enquiry.paymentTerms || "",
        inspection: enquiry.inspection || "",
        warranty: (() => {
          const pbg = enquiry.pbg;
          let months = 18;
          if (pbg && pbg !== "NA") {
            const match = pbg.match(/For\s+(\d+)\s+Months?/i);
            if (match) {
              months = parseInt(match[1], 10);
            }
          }
          return `The warranty shall be valid as per the standard maintenance clause on our website and to the maximum period of ${months} months from the date of supply.`;
        })(),
        approval: "It shall be in our scope",
        deliveryDestination: enquiry.state || "",
        items: items.map((item: EnquiryItemData) => ({
          itemName: item.itemName,
          partyItemName: item.itemNameMerge || "",
          quantity: item.quantity ? Number(item.quantity) : 0,
          quotationRate: item.quotedRate ? parseFloat(item.quotedRate) : 0,
          quotedRateGst: item.quotedRateGst ? parseFloat(item.quotedRateGst) : 0,
          totalValue: item.totalValue ? parseFloat(item.totalValue) : 0,
          unit: "Nos.",
          deliverySchedule: item.deliverySchedule || "2-3 weeks",
        })),
        totalItemwiseValue: items.reduce((sum: number, item: EnquiryItemData) => {
          const qty = item.quantity ? Number(item.quantity) : 0;
          const rate = item.quotedRate ? parseFloat(item.quotedRate) : 0;
          return sum + qty * rate;
        }, 0),
      };

      const res = await generateOfferPdfAction(rowData);
      if (res.success && res.pdfBase64) {
        triggerDownload(res.pdfBase64, res.fileName);
        setStatus("idle");
      } else {
        setErrorMessage(res.error || "Generation failed");
        setStatus("error");
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "An error occurred");
      setStatus("error");
    }
  };

  if (status === "idle") {
    return (
      <div className="flex justify-center py-1">
        <button
          type="button"
          onClick={handleGenerate}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#0f62fe] border border-blue-200 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 rounded cursor-pointer transition-all  whitespace-nowrap"
        >
          <FileText className="h-3.5 w-3.5 stroke-[2.5]" />
          Generate PDF
        </button>
      </div>
    );
  }

  if (status === "generating") {
    return (
      <div className="flex items-center gap-1.5 justify-center py-1">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="text-[10px] text-muted-foreground font-medium animate-pulse">Generating...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-1">
        <span className="text-[9px] text-red-500 font-medium truncate max-w-[100px]" title={errorMessage}>{errorMessage}</span>
        <button
          type="button"
          onClick={handleGenerate}
          className="text-[9px] text-blue-600 font-bold hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return null;
}
