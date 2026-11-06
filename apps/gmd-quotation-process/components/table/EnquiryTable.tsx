"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, ChevronDown, ChevronRight, Search, Download, Upload, Edit2, Sparkles, Percent, Plus, RefreshCw, DollarSign, Trash2, X, PackageCheck, ExternalLink, ImageIcon, Check, Mail, Loader2, History, AlertTriangle } from "lucide-react";
import Image from "next/image";
import { shallowEqual } from "react-redux";
import { toast } from "sonner";
import ActionsDropdown from "./ActionsDropdown";
import Pagination from "./Pagination";
import MultiSelectFilter, { BLANK } from "@gmd/ui/components/multi-select-filter";
import CellSelect, { optionsWithCurrent } from "./CellSelect";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import DebouncedSearchInput from "./DebouncedSearchInput";
import { selectAllEnquiries, selectAllItems, updateEnquiryField, updateItemField, addAttachments, fetchItemCodes, updateProductCost, update2to1Cost, updateAllBomCosts, fetchContractReviewRates, populatePdCostValidation, deleteEnquiry, bulkUpdateValidation, bulkUpdateApm, clearQuotedRates, selectBomId, syncAvailableStock, sendDocketEmail, loadFilteredEnquiryIds, loadEnquiryFacet, loadEnquiryItems, selectEnquiryQuery, setEnquirySort, setEnquiryProjectReference, setEnquiryPendingOnly, setEnquiryClosedBomOnly, setEnquiryIncompleteOnly, setEnquiryCostWarningOnly, setEnquiryStage } from "@/lib/enquiriesSlice";
import { enquiryFilterKey, type EnquiryStage } from "@/lib/enquiryQuery";
import { fetchDocketNumbers, fetchFilteredEnquiryExport, fetchGeneratedImageMap } from "@/app/actions/enquiryQuery";
import { setFilter, resetFilters } from "@/lib/filtersSlice";
import { itemDeletedStatus, DELETED_STATUS_OPTIONS } from "@/lib/filterUtils";
import { setPage, setPageSize } from "@/lib/paginationSlice";
import { toggleRow, setRowExpanded, setColumnWidth, setVisibleColumns, setExpandedRows, DEFAULT_COLUMN_WIDTHS, setGeneratedImages, toggleEnquirySelection, setSelectedEnquiries, clearEnquirySelection } from "@/lib/uiSlice";
import type { DropdownOptions, EnquiryData, EnquiryItemData, FiltersState } from "@/lib/types";
import type { CfResult } from "@/lib/cfSet";
import { generateOfferPdfAction } from "@/lib/generate-offer-pdf";
import type { OfferLetterTemplateData } from "@/types/offer-lettter";
import { useSession } from "next-auth/react";
import { oneClickAccess, FROZEN_ITEM_FIELD_SET, isEnquiryFrozen } from "@/lib/oneClickAccess";
import { importExcelData, autoFillBlanks, updateVaPercent } from "@/lib/enquiriesSlice";
import { isVaRuleViolation } from "@/lib/vaRules";
import { applyVaRulesAction } from "@/app/actions/misc";
import { markEnquiryPageStale } from "@/lib/enquiriesSlice";
import { parseAndValidateContractNumbers } from "@/lib/contractValidation";
import { makeImageKey } from "@/lib/imageKey";
import { RM_TYPE_OPTIONS } from "@/lib/gmd_lib/sheet-columns";
import { C_BATCH_VALUE } from "@/lib/gmd_lib/verify-bom-columns";
import { N_BATCH_VALUE } from "@/lib/gmd_lib/contract-review-columns";
import { correctItemType } from "@/lib/itemTypePatterns";
import { missingDetails, sizeFromName, type AutoFillChange } from "@/lib/detailsCheck";
import { previewAutoFillAction, getItemChangeLogAction } from "@/app/actions/item";
import AutoFillReviewDialog from "./AutoFillReviewDialog";
import DocketRow, { type DocketRowActions } from "./DocketRow";
import EnquiryFilterBar from "./EnquiryFilterBar";
import DocketEditDrawer from "./DocketEditDrawer";
import EditableText from "./EditableText";
import { ALL_COLUMN_KEYS, effectiveColumns } from "@/lib/enquiryColumns";
import { ENQUIRY_COLUMNS_KEY, loadColumnSet, saveColumnSet } from "@/lib/tablePrefs";
import AssigneePendingStrip from "./AssigneePendingStrip";
import { AGE_BUCKETS, istDaysSince } from "@/lib/stageAgeing";
import { ConfirmDialog } from "@/components/chat/ConfirmDialog";
import { isInternalEmail } from "@/lib/enquiryEmailParty";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@gmd/ui/components/dialog";
import { Button } from "@gmd/ui/components/button";
import { cn } from "@/lib/utils";
import { formatIndianNumber, cleanNumberInput, hasNumberChanged } from "@/lib/formatCurrency";
import { looseIncludes } from "@/lib/squish";
import { missingValidationTerms, validationBlockedMessage } from "@/lib/commercialTerms";
import { computeCostLoading, describeCostLoading, formatLoadingPct } from "@/lib/costLoading";

interface EnquiryTableProps {
  dropdownOptions: DropdownOptions;
  /** Every docket number, from the server render. Refetched only after a duplicate delete. */
  autoSentDockets?: string[];
  autoPendingDockets?: string[];
  /** Analytics shrink factor (0.6-1) for the block above the table. */
  scale?: number;
  onScaleChange?: (v: number) => void;
}

// Red warning icon beside Product Cost; the reasons come from lib/costSanity.ts.
/** Shared empty list, so a docket with no items keeps a stable prop identity. */
const EMPTY_ITEMS: EnquiryItemData[] = [];

function CostWarningIcon({ warnings }: { warnings?: string[] | null }) {
  if (!warnings?.length) return null;
  const text = `Cost warning: ${warnings.join("; ")}`;
  return (
    <span title={text} aria-label={text} role="img" className="shrink-0 text-red-600 dark:text-red-400">
      <AlertTriangle className="h-3.5 w-3.5" />
    </span>
  );
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

const STAGE_TILES: [Exclude<EnquiryStage, "">, string][] = [
  ["details", "Details pending"],
  ["cost", "Cost pending"],
  ["validation", "Validation pending"],
  ["ready", "Ready to send"],
  ["sent", "Sent, awaiting reply"],
];

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
  if (Array.isArray(actual)) {
    if (values.includes(BLANK) && (actual.length === 0 || actual.every((v) => blankCheck(v)))) return true;
    return actual.some((v) => values.includes(String(v)));
  }
  if (values.includes(BLANK) && blankCheck(actual)) return true;
  return values.includes(actual as string);
}

function isBlankOthers(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return isBlankValue(value);
}

const ALL_DROPDOWN_FIELDS = [
  "enquiryType", "state", "paymentTerms", "inspection", "pbg", "utility", "orderStatus", "closureStatus", "duplicate", "apm",
  "itemType", "moc", "size", "pnRating", "operationType", "extension", "bypass", "others",
  "validation", "vaPercent", "erpItemCode", "bomId", "productCost", "costRefCode", "cost", "contractReviewRate", "pdcostValidation", "availableStock", "rmType", "deliverySchedule",
  "contractNo", "itemNameMerge",
] as const;

// One header filter box. Owning its own Redux read and its own debounce keeps every
// keystroke inside this leaf instead of re-rendering the whole table body.
function FilterTextInput({
  field,
  className,
  placeholder = "Search...",
  type,
}: {
  field: keyof FiltersState;
  className?: string;
  placeholder?: string;
  type?: string;
}) {
  const dispatch = useAppDispatch();
  const value = useAppSelector((s) => (s.filters[field] as string) || "");
  const onCommit = useCallback(
    (val: string) => dispatch(setFilter({ field, value: val })),
    [dispatch, field]
  );
  return (
    <DebouncedSearchInput
      value={value}
      onCommit={onCommit}
      placeholder={placeholder}
      className={className}
      type={type}
    />
  );
}

function OthersInlineMultiSelect({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const safeValue = Array.isArray(value) ? value : [];
  const safeOptions = options && options.length > 0 ? options : ["flange", "gasket", "nut and bolt"];
  const toggle = (opt: string) => {
    const next = safeValue.includes(opt) ? safeValue.filter((v) => v !== opt) : [...safeValue, opt];
    onChange(next);
  };
  const display = safeValue.length === 0 ? "-" : safeValue.join(", ");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[26px] rounded border border-border bg-background px-1.5 py-1 text-[10px] text-left truncate hover:bg-accent flex items-center justify-between gap-1"
        title={display}
      >
        <span className="truncate flex-1">{display}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-7 left-0 z-50 w-48 rounded border border-border bg-popover shadow-lg p-2 flex flex-col gap-1 max-h-48 overflow-auto">
            {safeOptions.map((opt) => {
              const checked = safeValue.includes(opt);
              return (
                <label key={opt} className="flex items-center gap-2 text-[11px] cursor-pointer hover:bg-accent px-1 py-1 rounded">
                  <input type="checkbox" checked={checked} onChange={() => toggle(opt)} className="h-3 w-3 rounded border-border" />
                  <span className="truncate">{opt}</span>
                </label>
              );
            })}
            <div className="flex justify-between pt-1 border-t border-border mt-1">
              <button type="button" onClick={() => { onChange([]); setOpen(false); }} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
              <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-blue-600 dark:text-blue-300 font-bold hover:underline">Done</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The item detail chips, shared by the collapsed "first item" row and every expanded item row. */
function ItemDetailFields({
  item,
  dropdownOptions,
  onChange,
  isFrozen,
}: {
  item: EnquiryItemData;
  dropdownOptions: DropdownOptions;
  onChange: (itemId: string, field: string, value: string) => void;
  isFrozen: boolean;
}) {
  const others = Array.isArray(item.others) ? item.others : [];
  const nameSize = sizeFromName(item.itemName);
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-0.5">
      <CellSelect variant="chip" chipLabel="type" placeholder="-" value={item.itemType || ""} options={dropdownOptions.itemTypes} onChange={(v) => onChange(item.id, "itemType", v)} />
      <CellSelect variant="chip" chipLabel="moc" placeholder="-" value={item.moc || ""} options={dropdownOptions.mocs} onChange={(v) => onChange(item.id, "moc", v)} />
      <CellSelect variant="chip" chipLabel="size" placeholder="-" value={item.size || ""} options={dropdownOptions.sizes} onChange={(v) => onChange(item.id, "size", v)} />
      {nameSize && item.size && nameSize !== item.size.trim() && (
        <span
          title={`Item name says size ${nameSize}, Details has ${item.size}`}
          className="inline-flex items-center rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
        >
          name: {nameSize}
        </span>
      )}
      <CellSelect variant="chip" chipLabel="pn_rating" placeholder="-" value={item.pnRating || ""} options={dropdownOptions.pnRatings} onChange={(v) => onChange(item.id, "pnRating", v)} />
      <CellSelect variant="chip" chipLabel="operation_type" placeholder="-" value={item.operationType || ""} options={dropdownOptions.operationTypes} onChange={(v) => onChange(item.id, "operationType", v)} />
      <CellSelect variant="chip" chipLabel="extension" placeholder="-" value={item.extension || ""} options={dropdownOptions.extensions} onChange={(v) => onChange(item.id, "extension", v)} />
      <CellSelect variant="chip" chipLabel="bypass" placeholder="-" value={item.bypass || ""} options={dropdownOptions.bypasses} onChange={(v) => onChange(item.id, "bypass", v)} />
      <div className="flex items-center gap-1 h-5 text-[10px] text-muted-foreground bg-background border border-border rounded px-1 py-0">
        other:
        <div className="min-w-28">
          <OthersInlineMultiSelect
            value={others}
            options={dropdownOptions.others}
            onChange={(next) => {
              if (JSON.stringify([...others].sort()) !== JSON.stringify([...next].sort())) {
                onChange(item.id, "others", JSON.stringify(next));
              }
            }}
          />
        </div>
      </div>
      <CellSelect variant="chip" chipLabel="rm_type" placeholder="-" value={item.rmType || ""} options={RM_TYPE_OPTIONS} allowCustomValue disabled={isFrozen} onChange={(v) => onChange(item.id, "rmType", v)} />
    </div>
  );
}

function ItemImageCells({
  item,
  image,
}: {
  item: EnquiryItemData | null;
  image: { url: string | null; driveFileId: string | null } | null;
}) {
  return (
    <>
      {/* View Image */}
      <td className="py-2 px-2 border-r border-b border-border last:border-r-0 align-top">
        {item ? (
          image ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-10 h-10 rounded border border-border bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {image.driveFileId ? (
                  <Image
                    src={`https://drive.google.com/thumbnail?id=${image.driveFileId}&sz=w400`}
                    width={40}
                    height={40}
                    alt={item.itemName || "item"}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <ImageIcon size={14} className="text-muted-foreground" />
                )}
              </div>
              {image.url ? (
                <a
                  href={image.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 underline shrink-0"
                >
                  View <ExternalLink size={10} />
                </a>
              ) : null}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground italic">
              <ImageIcon size={12} /> No image
            </span>
          )
        ) : (
          "-"
        )}
      </td>
    </>
  );
}

/* Item Code (read-only). An item whose ERP item master status is C is closed, so the
   cell says so instead of showing the code; the real code stays in the title. Shared by
   the enquiry row (first item) and the expanded sub-rows so both mark closed items. */
function ItemCodeCell({ item }: { item?: EnquiryItemData }) {
  if (!item) {
    return (
      <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
        <span className="block text-[10px] text-muted-foreground p-1 font-mono">-</span>
      </td>
    );
  }
  return (
    <td className="py-2 px-1 border-r border-b border-border last:border-r-0">
      {item.nBatch === N_BATCH_VALUE ? (
        <span
          title={`${item.erpItemCode || ""} - NOT in CURRENT REQT on the GMD Item Creation Form`}
          className="block text-[10px] font-semibold italic text-amber-700 dark:text-amber-300 p-1 truncate"
        >
          Deleted as Current Reqt = No
        </span>
      ) : item.cBatch === C_BATCH_VALUE ? (
        <span
          title={`${item.erpItemCode || ""} - closed in ITEM MASTER ERP (ITEM_STATUS = C)`}
          className="block text-[10px] font-semibold italic text-rose-700 dark:text-rose-300 p-1 truncate"
        >
          Deleted as Closed
        </span>
      ) : (
        <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate" title={item.erpItemCode || ""}>
          {item.erpItemCode || "-"}
        </span>
      )}
    </td>
  );
}

export const MIN_SCALE = 0.6;
const clampScale = (v: number) => Math.min(1, Math.max(MIN_SCALE, Math.round(v * 1000) / 1000));

// Drag up to shrink what sits above the table, down to grow it back; double-click resets.
function ScaleBar({ scale, onChange }: { scale: number; onChange: (v: number) => void }) {
  const start = useRef<{ y: number; s: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize analytics"
      aria-valuemin={MIN_SCALE * 100}
      aria-valuemax={100}
      aria-valuenow={Math.round(scale * 100)}
      tabIndex={0}
      title="Drag to resize analytics, double-click to reset"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = { y: e.clientY, s: scale }; }}
      onPointerMove={(e) => { if (start.current) onChange(clampScale(start.current.s + (e.clientY - start.current.y) / 500)); }}
      onPointerUp={() => { start.current = null; }}
      onPointerCancel={() => { start.current = null; }}
      onDoubleClick={() => onChange(1)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); onChange(clampScale(scale - 0.05)); }
        else if (e.key === "ArrowDown") { e.preventDefault(); onChange(clampScale(scale + 0.05)); }
      }}
      className="flex h-2 shrink-0 cursor-row-resize touch-none select-none items-center justify-center border-b border-border bg-muted/50 hover:bg-accent focus-visible:bg-accent"
    >
      <span className="h-0.5 w-10 rounded-full bg-muted-foreground/40" />
    </div>
  );
}

export default function EnquiryTable({ dropdownOptions, autoSentDockets, autoPendingDockets, scale = 1, onScaleChange = () => {} }: EnquiryTableProps) {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role as string | undefined;
  const canEditApm = role === "admin" || role === "developer";
  const dispatch = useAppDispatch();
  const enquiries = useAppSelector(selectAllEnquiries);
  // Not the loaded page: the original docket can be on any page, under any filter.
  // Fetched on mount; refetched only after a duplicate delete, not on
  // other users' creates.
  const [docketNumbers, setDocketNumbers] = useState<string[]>([]);
  const [docketListVersion, setDocketListVersion] = useState(0);
  useEffect(() => {
    fetchDocketNumbers().then(setDocketNumbers).catch(() => {});
  }, [docketListVersion]);
  const autoSentSet = useMemo(() => new Set(autoSentDockets ?? []), [autoSentDockets]);
  const autoPendingSet = useMemo(() => new Set(autoPendingDockets ?? []), [autoPendingDockets]);
  const allItems = useAppSelector(selectAllItems);
  const filters = useAppSelector((s) => s.filters);
  const { currentPage, pageSize } = useAppSelector((s) => s.pagination);
  const pageState = useAppSelector((s) => s.enquiries.page);
  const pageTotal = pageState.total;
  const isPageLoading = pageState.status === "loading";
  const totalPages = Math.max(1, Math.ceil(pageTotal / pageSize));
  const pageStart = pageTotal === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, pageTotal);
  const itemCount = useAppSelector(
    (s) => s.enquiries.page.summary?.analyticsItems ?? 0,
  );
  const sortField = pageState.sort?.field ?? null;
  const sortDirection = pageState.sort?.direction ?? "desc";
  const expandedRows = useAppSelector((s) => s.ui.expandedRows);
  const columnWidths = useAppSelector((s) => s.ui.columnWidths);
  const analyticsOn = useAppSelector((s) => s.ui.analyticsOn);
  const storedColumns = useAppSelector((s) => s.ui.visibleColumns);
  const visibleColumns = effectiveColumns(analyticsOn, storedColumns);
  const [editingDocketId, setEditingDocketId] = useState<string | null>(null);
  // The saved column choice is read after mount so the server render matches the first client render.
  useEffect(() => {
    const saved = loadColumnSet(ENQUIRY_COLUMNS_KEY, ALL_COLUMN_KEYS);
    if (saved) dispatch(setVisibleColumns(saved));
  }, [dispatch]);
  const changeColumns = (keys: string[]) => {
    dispatch(setVisibleColumns(keys));
    saveColumnSet(ENQUIRY_COLUMNS_KEY, keys);
  };
  const selectedEnquiryIds = useAppSelector((s) => s.ui.selectedEnquiryIds);
  const closedBomIds = useAppSelector((s) => s.ui.closedBomIds);

  const tableRef = useRef<HTMLTableElement>(null);

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
  const [projectReferenceInput, setProjectReferenceInput] = useState("");
  const filterProjectReference = pageState.projectReference;
  useEffect(() => {
    const timer = setTimeout(
      () => dispatch(setEnquiryProjectReference(projectReferenceInput)),
      300,
    );
    return () => clearTimeout(timer);
  }, [projectReferenceInput, dispatch]);
  const [editingItemNameId, setEditingItemNameId] = useState<string | null>(null);
  const [autoFillStatus, setAutoFillStatus] = useState<"idle" | "running">("idle");
  const [autoFillChanges, setAutoFillChanges] = useState<AutoFillChange[] | null>(null);
  const [autoFillApplying, setAutoFillApplying] = useState(false);
  // In-app replacement for window.confirm(): `if (!(await ask("..."))) return;`
  const [confirmState, setConfirmState] = useState<{ msg: string; resolve: (ok: boolean) => void } | null>(null);
  const ask = (msg: string) => new Promise<boolean>((resolve) => setConfirmState({ msg, resolve }));
  const confirmValidation = async (item: EnquiryItemData, next: "Yes" | "No" | "") => {
    if (next === "Yes") {
      const parent = enquiries.find((e) => e.id === item.enquiryId);
      const missing = parent ? missingValidationTerms(parent) : [];
      if (parent && missing.length > 0) {
        toast.error(validationBlockedMessage(parent.docketNumber, missing), { duration: 6000 });
        return;
      }
    }
    if (!(await ask(`Set validation to "${next || "Blank"}" for ${item.itemName || "this item"}?`))) return;
    await handleItemFieldChange(item.id, "validation", next);
  };
  // Validation=Yes locks Rate & VA%; say so in the cell and offer the way out.
  const unlockButton = (item: EnquiryItemData) =>
    item.validation === "Yes" ? (
      <button
        type="button"
        onClick={() => confirmValidation(item, "")}
        title="Validated: Rate & VA% are locked. Click to clear validation and edit."
        className="shrink-0 px-1 py-0.5 text-[9px] font-bold rounded border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10 cursor-pointer"
      >
        Unlock
      </button>
    ) : null;
  // Cost loading % the engine applies over product cost, shown under Cost. Amber when terms are blank.
  const costLoadingBadge = (enquiry: EnquiryData, item: EnquiryItemData) => {
    const tables = dropdownOptions.costLoading;
    const pc = item.productCost !== null && item.productCost !== undefined ? Number(item.productCost) : null;
    if (!tables || pc === null || !(pc > 0)) return null;
    const loading = computeCostLoading(enquiry, pc, tables);
    const missing = missingValidationTerms(enquiry);
    const title = describeCostLoading(loading) + (missing.length ? ` Blank on this docket: ${missing.join(", ")} (counted as 0%).` : "");
    return (
      <div
        title={title}
        className={cn(
          "text-[9px] leading-tight text-right px-1 whitespace-nowrap",
          missing.length ? "text-amber-700 dark:text-amber-300 font-semibold" : "text-muted-foreground",
        )}
      >
        Loading {formatLoadingPct(loading.loadingPct)}{missing.length ? " · terms blank" : ""}
      </div>
    );
  };
  // "CF" chip on a CF set line: tooltip = priced parts + gaps, link = the Flange master row it was priced from.
  const cfChip = (item: EnquiryItemData) => {
    const b = item.cfSetBreakdown as CfResult | null | undefined;
    if (!item.parentItemId || !b) return null;
    const title = [
      ...b.lines.map((l) => `${l.qty} x ${l.part} (${l.unitKg} kg @ ${l.rateKey}) = ${l.cost}`),
      ...b.missing.map((m) => `MISSING: ${m}`),
      b.standardAssumed ? "Flange standard not in master: matched without it" : "",
    ].filter(Boolean).join("\n");
    const href = b.flangeRowIndex != null ? `/technical?tab=flange&row=${b.flangeRowIndex}` : "/technical?tab=flange";
    return (
      <a href={href} title={title} className="block text-[9px] text-right px-1 font-bold text-sky-700 dark:text-sky-300 hover:underline">
        CF set{b.missing.length ? " · incomplete" : ""} · flange master
      </a>
    );
  };
  type ChangeRow = { id: string; field: string; oldValue: string | null; newValue: string | null; changedBy: string; createdAt: string };
  const [history, setHistory] = useState<{ itemName: string; rows: ChangeRow[] } | null>(null);
  const historyButton = (item: EnquiryItemData) => (
    <button
      type="button"
      onClick={async () => {
        const r = await getItemChangeLogAction(item.id);
        if (!r.success) { toast.error(r.error || "Failed to load history."); return; }
        setHistory({ itemName: item.itemName || "Item", rows: r.data ?? [] });
      }}
      title="Who changed VA%, rate or validation, and when"
      aria-label="Change history"
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
    >
      <History className="h-3 w-3" />
    </button>
  );
  const [vaStatus, setVaStatus] = useState<"idle" | "running">("idle");
  const [fetchCodesStatus, setFetchCodesStatus] = useState<"idle" | "running">("idle");
  const [updateCostStatus, setUpdateCostStatus] = useState<"idle" | "running">("idle");
  const [crRateStatus, setCrRateStatus] = useState<"idle" | "running">("idle");
  const [pdCostValStatus, setPdCostValStatus] = useState<"idle" | "running">("idle");
  const [syncStockStatus, setSyncStockStatus] = useState<"idle" | "running">("idle");
  // Docket No header filter: show only auto-created dockets (pending), whether
  // the item parser has added rows or not.
  const pendingOnly = pageState.pendingOnly;
  const setPendingOnly = (value: boolean | ((prev: boolean) => boolean)) => {
    dispatch(
      setEnquiryPendingOnly(
        typeof value === "function" ? value(pendingOnly) : value,
      ),
    );
  };
  // BOM ID header filter: show only items whose selected BOM is closed (VerifyBom.cBatch = "C").
  const closedBomOnly = pageState.closedBomOnly;
  const setClosedBomOnly = (value: boolean) => dispatch(setEnquiryClosedBomOnly(value));
  // Details header filter: only items missing Type, MOC, Size, PN or Op Type.
  const incompleteOnly = pageState.incompleteOnly;
  const setIncompleteOnly = (value: boolean) => dispatch(setEnquiryIncompleteOnly(value));
  // Product Cost header filter: only items with a cost sanity warning (lib/costSanity.ts).
  const costWarningOnly = pageState.costWarningOnly;
  const setCostWarningOnly = (value: boolean) => dispatch(setEnquiryCostWarningOnly(value));

  // Image lookup: GeneratedImage rows keyed by imageKey (itemType__operationType__rmType).
  // Fetched on mount and stored in Redux so cards can react.
  const imageMap = useAppSelector((s) => s.ui.generatedImages);
  useEffect(() => {
    let cancelled = false;
    fetchGeneratedImageMap()
      .then((map) => {
        if (!cancelled) dispatch(setGeneratedImages(map));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const getItemImage = useCallback(
    (item: EnquiryItemData) => {
      if (!item.itemType || !item.operationType || !item.rmType) return null;
      const img = imageMap[makeImageKey(item.itemType, item.operationType, item.rmType)];
      if (!img || (!img.url && !img.driveFileId)) return null;
      return img;
    },
    [imageMap]
  );

  // Filter changes reset paging inside DashboardContainer (before it builds the query),
  // so no extra request is fired from here.

  // Docket-level selection (persisted in Redux so the metrics card and the
  // analytics sidebar can scope themselves to the same dockets). Ids that no
  // longer exist are ignored by every consumer via set membership.
  const selectedEnquiryIdSet = useMemo(() => new Set(selectedEnquiryIds), [selectedEnquiryIds]);
  const closedBomIdSet = useMemo(() => new Set(closedBomIds), [closedBomIds]);

  const validSelectedEnquiryIds = useMemo(
    () => enquiries.filter((e) => selectedEnquiryIdSet.has(e.id)).map((e) => e.id),
    [enquiries, selectedEnquiryIdSet]
  );

  const isEnquirySelected = (enquiryId: string) => selectedEnquiryIdSet.has(enquiryId);

  const toggleEnquiry = (enquiryId: string) => {
    dispatch(toggleEnquirySelection(enquiryId));
  };

  const clearSelection = () => {
    dispatch(clearEnquirySelection());
  };

  // Select every docket the server matches across all pages; a second click clears.
  const selectAllFiltered = async () => {
    try {
      const result = await dispatch(
        loadFilteredEnquiryIds({ query: query }),
      ).unwrap();
      const ids = result.enquiryIds;
      if (ids.length === 0) return;
      const allSelected =
        ids.length === selectedEnquiryIds.length &&
        ids.every((id) => selectedEnquiryIdSet.has(id));
      dispatch(setSelectedEnquiries(allSelected ? [] : ids));
    } catch {
      toast.error("Failed to load filtered dockets.");
    }
  };

  const [clearQrRunning, setClearQrRunning] = useState(false);
  const [clearQrConfirmOpen, setClearQrConfirmOpen] = useState(false);
  const [clearQrPending, setClearQrPending] = useState<{ total: number; ids: string[] } | null>(null);
  const handleClearQr = async () => {
    try {
      const { itemIds } = await dispatch(
        loadFilteredEnquiryIds({ query: query }),
      ).unwrap();
      if (itemIds.length === 0) {
        toast.info("No items match current filters.");
        return;
      }
      setClearQrPending({ total: itemIds.length, ids: itemIds });
      setClearQrConfirmOpen(true);
    } catch {
      toast.error("Failed to load filtered items.");
    }
  };
  const handleClearQrConfirm = async () => {
    if (!clearQrPending) return;
    setClearQrRunning(true);
    const toastId = toast.loading("Clearing quoted rates...");
    try {
      const result: any = await dispatch(clearQuotedRates(clearQrPending.ids)).unwrap();
      const skipped = Number(result.skippedFrozen ?? 0);
      toast.success(
        `Cleared ${result.cleared} Quoted Rate(s).${skipped > 0 ? ` Skipped ${skipped} frozen item(s).` : ""} VA% preserved.`,
        { id: toastId },
      );
      setClearQrConfirmOpen(false);
      setClearQrPending(null);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to clear quoted rates.";
      toast.error(msg, { id: toastId });
    } finally {
      setClearQrRunning(false);
    }
  };

  const [bulkValidationRunning, setBulkValidationRunning] = useState<"Yes" | "No" | "Clear" | null>(null);
  const handleBulkValidation = async (val: "Yes" | "No" | "") => {
    let itemIds: string[];
    let docketCount: number;
    try {
      const ids = await dispatch(loadFilteredEnquiryIds({ query: query })).unwrap();
      itemIds = ids.itemIds;
      docketCount = ids.enquiryIds.length;
    } catch {
      toast.error("Failed to load filtered items.");
      return;
    }
    if (itemIds.length === 0) {
      toast.info("No items match current filters.");
      return;
    }
    const label = val === "" ? "Blank" : val;
    if (!(await ask(`Set validation to "${label}": this will change ${itemIds.length} item(s) in ${docketCount} docket(s) across all pages. Continue?`))) return;
    const runKey = val === "" ? "Clear" : val;
    setBulkValidationRunning(runKey as any);
    const toastId = toast.loading(`Setting validation to "${label}"...`);
    try {
      const result: any = await dispatch(bulkUpdateValidation({ itemIds, validation: val === "" ? null : val })).unwrap();
      toast.success(`Validation set to "${label}" for ${result.updated} item(s).`, { id: toastId });
      const skipped: { docketNumber: string; missing: string[]; items: number }[] = result.skipped ?? [];
      if (skipped.length > 0) {
        const list = skipped.slice(0, 5).map((s) => `${s.docketNumber} (${s.missing.join(", ")})`).join("; ");
        const more = skipped.length > 5 ? ` and ${skipped.length - 5} more` : "";
        toast.warning(`Skipped ${skipped.length} docket(s) with blank payment terms / inspection / PBG: ${list}${more}.`, { duration: 10000 });
      }
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to update validation.";
      toast.error(msg, { id: toastId });
    } finally {
      setBulkValidationRunning(null);
    }
  };

  const [bulkApmRunning, setBulkApmRunning] = useState<"Yes" | "No" | "Clear" | null>(null);
  const handleBulkApm = async (val: "Yes" | "No" | "") => {
    if (!canEditApm) { toast.error("Admin or developer only can set APM — please login"); return; }
    let enquiryIds: string[];
    try {
      enquiryIds = (
        await dispatch(loadFilteredEnquiryIds({ query: query })).unwrap()
      ).enquiryIds;
    } catch {
      toast.error("Failed to load filtered enquiries.");
      return;
    }
    if (enquiryIds.length === 0) {
      toast.info("No enquiries match current filters.");
      return;
    }
    const label = val === "" ? "Blank" : val;
    if (!(await ask(`Set APM to "${label}": this will change ${enquiryIds.length} docket(s) across all pages. Continue?`))) return;
    const runKey = val === "" ? "Clear" : val;
    setBulkApmRunning(runKey as any);
    const toastId = toast.loading(`Setting APM to "${label}"...`);
    try {
      const result: any = await dispatch(bulkUpdateApm({ enquiryIds, apm: val === "" ? null : val })).unwrap();
      toast.success(`APM set to "${label}" for ${result.updated} enquir${result.updated === 1 ? "y" : "ies"}.`, { id: toastId });
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to update APM.";
      toast.error(msg, { id: toastId });
    } finally {
      setBulkApmRunning(null);
    }
  };

  // Cascading dropdown options come from the server: one DISTINCT query per
  // column, requested when its dropdown opens. Options from the previous filter
  // combination stay visible until the new ones arrive.
  const facets = pageState.facets;
  const query = useAppSelector(selectEnquiryQuery, shallowEqual);
  const filterKey = enquiryFilterKey(query);

  const requestFacet = (field: string) => {
    const entry = facets[field];
    if (entry && entry.filterKey === filterKey && entry.status !== "error") return;
    dispatch(loadEnquiryFacet({ query, field, filterKey }));
  };

  const cascadedOptions: Record<string, string[]> = {};
  for (const field of ALL_DROPDOWN_FIELDS) {
    cascadedOptions[field] = facets[field]?.options ?? [];
  }
  // Party names are an enquiry-level dropdown but sit outside the shared list.
  cascadedOptions.partyNames = facets.partyNames?.options ?? [];

  // Master unique list of all contract numbers selected across all enquiries
  const allSelectedContractOptions = useMemo(() => {
    const set = new Set<string>();
    for (const eq of enquiries) {
      for (const cn of (eq as any).selectedContractNo ?? []) {
        const trimmed = String(cn ?? "").trim();
        if (trimmed) set.add(trimmed);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [enquiries]);

  // VA% rules: item IDs below the minimum VA% or above the CR rate
  const invalidVaItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of allItems) {
      const violates = isVaRuleViolation(item);
      if (violates) ids.add(item.id);
    }
    return ids;
  }, [allItems]);



  // Open the docket the user searched for, but only once the search names exactly one.
  // Expanding every partial match meant typing "123" opened all 50 dockets on the "1"
  // it passes through, which is the whole page's items rendered twice over before the
  // search even finished. Respects a manual collapse.
  useEffect(() => {
    if (!filters.docketNumber) return;
    let only: EnquiryData | undefined;
    for (const enquiry of enquiries) {
      if (!looseIncludes(enquiry.docketNumber, filters.docketNumber)) continue;
      if (only) return; // more than one match: leave them all collapsed
      only = enquiry;
    }
    if (!only || expandedRows[only.id] !== undefined) return;
    dispatch(setExpandedRows({ [only.id]: true }));
  }, [filters.docketNumber, enquiries, expandedRows, dispatch]);

  // Drives the "clear filters" button. globalSearch is excluded on purpose: it filters
  // server-side and never counted as an active filter here.
  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filters).some(([key, val]) => {
        if (key === "globalSearch") return false;
        if (Array.isArray(val)) return val.length > 0;
        return val !== "" && val !== "All";
      }),
    [filters]
  );

  const handleResetAllFilters = () => {
    dispatch(resetFilters());
    setPendingOnly(false);
    setClosedBomOnly(false);
    setIncompleteOnly(false);
    setCostWarningOnly(false);
    dispatch(setEnquiryStage(""));
    setProjectReferenceInput("");
    dispatch(setEnquiryProjectReference(""));
    toast.success("All filters reset successfully.");
  };

  const activeDetailsFilterCount = useMemo(() => {
    let count = 0;
    if (filters.itemType && filters.itemType.length > 0) count++;
    if (filters.moc && filters.moc.length > 0) count++;
    if (filters.size && filters.size.length > 0) count++;
    if (filters.pnRating && filters.pnRating.length > 0) count++;
    if (filters.operationType && filters.operationType.length > 0) count++;
    if (filters.extension && filters.extension.length > 0) count++;
    if (filters.bypass && filters.bypass.length > 0) count++;
    if (filters.others && filters.others.length > 0) count++;
    if (filters.rmType && filters.rmType.length > 0) count++;
    return count;
  }, [filters]);

  const handleClearDetailsFilters = useCallback(() => {
    dispatch(setFilter({ field: "itemType", value: [] }));
    dispatch(setFilter({ field: "moc", value: [] }));
    dispatch(setFilter({ field: "size", value: [] }));
    dispatch(setFilter({ field: "pnRating", value: [] }));
    dispatch(setFilter({ field: "operationType", value: [] }));
    dispatch(setFilter({ field: "extension", value: [] }));
    dispatch(setFilter({ field: "bypass", value: [] }));
    dispatch(setFilter({ field: "others", value: [] }));
    dispatch(setFilter({ field: "rmType", value: [] }));
  }, [dispatch]);

  const getFilteredItems = useCallback((enquiry: EnquiryData) => {
    if (!enquiry.items) return [];
    return enquiry.items.filter((item: EnquiryItemData) => {
      if (
        filters.itemName &&
        !looseIncludes(item.itemName, filters.itemName)
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
        !looseIncludes((item.itemType || ""), filters.itemTypeSearch)
      ) {
        return false;
      }
      if (!matchesMulti(filters.moc, item.moc)) {
        return false;
      }
      if (
        filters.mocSearch &&
        !looseIncludes((item.moc || ""), filters.mocSearch)
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
      if (!matchesMulti((filters as any).others, (item as any).others, isBlankOthers)) {
        return false;
      }
      if (
        (filters as any).othersSearch &&
        !looseIncludes(((item as any).others || ""), (filters as any).othersSearch)
      ) {
        return false;
      }
      if (!matchesMulti(filters.erpItemCode, item.erpItemCode)) {
        return false;
      }
      if (
        filters.erpItemCodeSearch &&
        !looseIncludes((item.erpItemCode || ""), filters.erpItemCodeSearch)
      ) {
        return false;
      }
      if (!matchesMulti(filters.bomId as any, (item as any).bomId)) {
        return false;
      }
      if (
        filters.bomIdSearch &&
        !looseIncludes(((item as any).bomId || ""), filters.bomIdSearch)
      ) {
        return false;
      }
      if (!matchesMulti(filters.contractReviewRate, item.contractReviewRate)) {
        return false;
      }
      if (!matchesMulti(filters.pdcostValidation, getPdCostValidation(item))) {
        return false;
      }
      if (
        filters.contractReviewRateSearch &&
        !looseIncludes((item.contractReviewRate || ""), filters.contractReviewRateSearch)
      ) {
        return false;
      }
      if (
        filters.pdcostValidationSearch &&
        !looseIncludes((getPdCostValidation(item) || ""), filters.pdcostValidationSearch)
      ) {
        return false;
      }
      if (
        filters.productCost.length > 0 &&
        !matchesMulti(filters.productCost, item.productCost != null ? String(item.productCost) : null)
      ) {
        return false;
      }
      if (!matchesMulti(filters.costRefCode, item.costRefCode)) {
        return false;
      }
      if (
        filters.costRefCodeSearch &&
        !looseIncludes((item.costRefCode || ""), filters.costRefCodeSearch)
      ) {
        return false;
      }
      if (
        filters.cost.length > 0 &&
        !matchesMulti(filters.cost, item.cost != null ? String(item.cost) : null)
      ) {
        return false;
      }
      if (
        filters.stockStatus &&
        !looseIncludes((item.stockStatus || ""), filters.stockStatus)
      ) {
        return false;
      }
      if (
        filters.stockQuantity &&
        !looseIncludes((item.stockQuantity || ""), filters.stockQuantity)
      ) {
        return false;
      }
      if (
        filters.availableStock.length > 0 &&
        !matchesMulti(filters.availableStock, item.availableStock ?? null)
      ) {
        return false;
      }
      if (
        filters.rmType.length > 0 &&
        !matchesMulti(filters.rmType, item.rmType ?? null)
      ) {
        return false;
      }
      if (
        filters.deliverySchedule.length > 0 &&
        !matchesMulti(filters.deliverySchedule, item.deliverySchedule ?? null)
      ) {
        return false;
      }
      if (
        filters.stockAgainstContract &&
        !looseIncludes((item.stockAgainstContract || ""), filters.stockAgainstContract)
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
      if (!matchesMulti(filters.itemNameMerge, item.itemNameMerge)) {
        return false;
      }
      if (
        filters.itemNameMergeSearch &&
        !looseIncludes((item.itemNameMerge || ""), filters.itemNameMergeSearch)
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
      if ((filters as any).image && (filters as any).image.length > 0) {
        const hasImg = !!getItemImage(item);
        const wantPresent = (filters as any).image.includes("Present");
        const wantBlank = (filters as any).image.includes(BLANK);
        if (wantPresent && !wantBlank && !hasImg) return false;
        if (wantBlank && !wantPresent && hasImg) return false;
      }
      if (!itemDeletedStatus(item, filters.deletedStatus)) return false;
      if (incompleteOnly && missingDetails(item).length === 0) return false;
      if (costWarningOnly && !item.costWarnings?.length) return false;
      if (closedBomOnly) {
        const bomId = (item as unknown as Record<string, unknown>).bomId as string | null | undefined;
        if (!bomId || !closedBomIdSet.has(bomId)) return false;
      }
      return true;
    });
  }, [filters, getItemImage, closedBomOnly, closedBomIdSet, incompleteOnly, costWarningOnly]);

  const toggleExpand = (id: string, currentExpanded: boolean) => {
    dispatch(setRowExpanded({ id, expanded: !currentExpanded }));
  };

  const handleSort = (field: string) => {
    const direction =
      sortField === field ? (sortDirection === "asc" ? "desc" : "asc") : "desc";
    dispatch(setEnquirySort({ field, direction }));
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
            <span className="text-[8px] text-[#0f62fe] dark:text-blue-300 font-bold leading-none">▲</span>
          ) : (
            <span className="text-[8px] text-[#0f62fe] dark:text-blue-300 font-bold leading-none">▼</span>
          )
        ) : (
          <span className="text-[8px] text-muted-foreground leading-none">▼</span>
        )}
      </button>
    );
  };

  // Docket (0) never shrinks below its default: number, chips and sort labels overlap the next column otherwise.
  const minColWidth = (idx: number) => (idx === 0 ? DEFAULT_COLUMN_WIDTHS[0] : 60);

  // Mouse drag handler for column resizing.
  // The drag paints straight to the DOM and dispatches once on mouseup — dispatching per
  // mousemove re-rendered the whole table at pointer-event rate. `columnWidths` only ever
  // drives these two style properties, so writing them directly stays behaviour-neutral.
  const handleMouseDown = (columnIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getColWidth(columnIndex);
    let latestWidth = startWidth;

    const table = tableRef.current;
    // <col> 0 is the select column, so data column N is <col> N + 1
    const col = table?.querySelectorAll("colgroup > col")[columnIndex + 1] as HTMLElement | undefined;
    const startTotalWidth = table ? parseFloat(table.style.width) || 0 : 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      latestWidth = Math.max(minColWidth(columnIndex), startWidth + deltaX);
      if (col) col.style.width = `${latestWidth}px`;
      if (table) table.style.width = `${startTotalWidth + (latestWidth - startWidth)}px`;
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (latestWidth !== startWidth) {
        dispatch(setColumnWidth({ index: columnIndex, width: latestWidth }));
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };



  // Inline table cell dropdown update handlers
  const handleEnquiryFieldChange = async (enquiryId: string, field: string, val: string) => {
    const dbVal = val === "" ? null : val;
    console.log(`[Client] updateEnquiryField enquiry=${enquiryId} field=${field} val="${dbVal}"`);
    const toastId = toast.loading(`Saving ${field}...`);
    try {
      await dispatch(updateEnquiryField({ enquiryId, field, value: dbVal })).unwrap();
      toast.success(`Saved successfully.`, { id: toastId });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : err ? String(err) : `Failed to save.`, { id: toastId });
    }
  };

  const [deletingEnquiryId, setDeletingEnquiryId] = useState<string | null>(null);
  const handleDeleteDuplicate = async (enquiry: EnquiryData) => {
    if (!enquiry.duplicateOfDocket) return;
    const itemCount = enquiry.itemsLoaded ? enquiry.items.length : (enquiry.itemCount ?? 0);
    if (
      !await ask(
        `Delete docket ${enquiry.docketNumber} as a duplicate of ${enquiry.duplicateOfDocket}?` +
          (itemCount > 0 ? `\n\nIts ${itemCount} item(s) will also be deleted.` : "") +
          `\nIts source mail will be re-linked to ${enquiry.duplicateOfDocket}.`,
      )
    )
      return;
    setDeletingEnquiryId(enquiry.id);
    const toastId = toast.loading(`Deleting ${enquiry.docketNumber}...`);
    try {
      await dispatch(deleteEnquiry(enquiry.id)).unwrap();
      toast.success(`Deleted ${enquiry.docketNumber}.`, { id: toastId });
      setDocketListVersion((v) => v + 1);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to delete docket",
        { id: toastId },
      );
    } finally {
      setDeletingEnquiryId(null);
    }
  };

  // No batch action exists, so the drawer saves one changed field at a time.
  const handleDrawerSave = async (id: string, changes: Record<string, string>, contracts: string[] | null) => {
    const toastId = toast.loading("Saving docket...");
    try {
      for (const [field, value] of Object.entries(changes)) {
        await dispatch(updateEnquiryField({ enquiryId: id, field, value: value === "" ? null : value })).unwrap();
      }
      if (contracts) await dispatch(updateEnquiryField({ enquiryId: id, field: "selectedContractNo", value: contracts })).unwrap();
      toast.success("Saved.", { id: toastId });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : err ? String(err) : "Failed to save.", { id: toastId });
      throw err;
    }
  };

  const handleSelectedContractNoChange = async (enquiryId: string, values: string[]) => {
    console.log(`[Client] updateEnquiryField enquiry=${enquiryId} field=selectedContractNo val="${values.join(",")}"`);
    const toastId = toast.loading(`Saving selected contracts...`);
    try {
      await dispatch(updateEnquiryField({ enquiryId, field: "selectedContractNo", value: values })).unwrap();
      toast.success(`Selected contracts saved.`, { id: toastId });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : err ? String(err) : `Failed to save.`, { id: toastId });
    }
  };

  const getItemNameMerge = (item: EnquiryItemData) => {
    const baseFields = [
      item.itemType,
      item.moc,
      item.size,
      item.pnRating,
      item.operationType,
    ];
    const base = baseFields
      .map(val => (val || "").trim())
      .filter(Boolean)
      .join("-");

    const parts: string[] = [];
    if (base) parts.push(base);

    const extension = String(item.extension ?? "").trim();
    if (extension) parts.push(`WITH-EXTENSION-${extension}`);

    const bypass = String(item.bypass ?? "").trim();
    if (bypass) parts.push(`WITH-BYPASS-${bypass}`);

    const others = Array.isArray(item.others) ? item.others : [];
    const othersStr = others
      .map(v => String(v).trim())
      .filter(Boolean)
      .join("-");
    if (othersStr) parts.push(`WITH-${othersStr}`);

    return parts.join("-");
  };

  const handleItemFieldChange = async (itemId: string, field: string, val: string) => {
    const dbVal = val === "" ? null : val;
    console.log(`[Client] updateItemField item=${itemId} field=${field} val="${dbVal}"`);
    // Validation=Yes freezes the rate block: VA% and quotedRate are system-controlled
    if (field === "quotedRate" || field === "vaPercent") {
      const parentItem = allItems.find((i) => i.id === itemId) || null;
      if (parentItem?.validation === "Yes") {
        toast.error("Rate & VA% are locked for validated items (Validation = Yes).");
        return;
      }
    }
    // Client-side frozen guard: pricing columns (incl. quantity) are frozen after one-time PDF
    if (FROZEN_ITEM_FIELD_SET.has(field)) {
      const parentItem = allItems.find((i) => i.id === itemId) || null;
      const parentEnquiry = parentItem ? enquiries.find((e) => e.id === parentItem.enquiryId) : null;
      if (parentEnquiry && isEnquiryFrozen((parentEnquiry as any).apm, (parentEnquiry as any).offerPdfGeneratedAt)) {
        toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit.");
        return;
      }
    }
    const toastId = toast.loading(`Saving ${field}...`);
    const prevItem = allItems.find((i) => i.id === itemId) || null;
    const prevQr = prevItem?.quotedRate ? parseFloat(String(prevItem.quotedRate)) : null;

    try {
      const result = await dispatch(updateItemField({ itemId, field, value: dbVal })).unwrap();
      toast.success(`Saved successfully.`, { id: toastId });

      // Toast when QR is rounded up after manual entry
      const newQr = result?.quotedRate ? parseFloat(String(result.quotedRate)) : null;
      if (newQr !== null && !isNaN(newQr)) {
        if (field === "quotedRate" && dbVal !== null) {
          const inNum = parseFloat(String(dbVal).replace(/,/g, ""));
          if (!isNaN(inNum) && inNum !== newQr) {
            toast.info(`Quoted Rate rounded up: ${inNum.toFixed(2)} → ${newQr.toFixed(2)}`, { duration: 4000 });
          }
        } else if (["vaPercent", "cost", "productCost", "extension", "bypass", "quantity"].includes(field)) {
          // For vaPercent/cost etc., QR is derived — toast when the QR value changes
          if (prevQr !== null && prevQr !== newQr) {
            toast.info(`Quoted Rate rounded up: ${newQr.toFixed(2)}`, { duration: 4000 });
          } else if (prevQr === null && newQr !== null) {
            toast.info(`Quoted Rate rounded up: ${newQr.toFixed(2)}`, { duration: 3000 });
          }
        }
      }

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
    // Frozen guard: bulk paste mutates frozen pricing columns
    if (isEnquiryFrozen((enquiry as any).apm, (enquiry as any).offerPdfGeneratedAt)) {
      toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit.");
      e.preventDefault();
      return;
    }
    const clipboardData = e.clipboardData.getData("text");
    if (!clipboardData) return;

    const lines = clipboardData.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return; // Single value → allow the normal paste
    }

    e.preventDefault();

    const [full] = (await ensureItems([enquiry])) ?? [];
    if (!full) return;
    const targets = getFilteredItems(full).slice(startIndex);
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
      const allResults = await Promise.all(
        updates.map(async ({ item, cost, vaPercent, quotedRate }) => {
          const resItems: any[] = [];
          if (cost !== undefined) {
            const r = await dispatch(updateItemField({ itemId: item.id, field: "cost", value: cost.toString() })).unwrap();
            resItems.push(r);
          }
          if (vaPercent !== undefined) {
            const r = await dispatch(updateItemField({ itemId: item.id, field: "vaPercent", value: vaPercent.toString() })).unwrap();
            resItems.push(r);
          }
          if (quotedRate !== undefined) {
            const r = await dispatch(updateItemField({ itemId: item.id, field: "quotedRate", value: quotedRate.toString() })).unwrap();
            resItems.push(r);
          }
          return resItems;
        })
      );
      const flatResults = (allResults.flat() as any[]) as EnquiryItemData[];
      // Deduplicate to last result per item id (for cost+va case, last holds final QR)
      const lastById = new Map<string, EnquiryItemData>();
      for (const r of flatResults) lastById.set(r.id, r);
      toast.success(`Updated ${updates.length} item(s).`, { id: toastId });
      // One aggregated toast for rounding
      if (field === "quotedRate") {
        let roundedCount = 0;
        updates.forEach(({ item, quotedRate }) => {
          if (quotedRate !== undefined) {
            const res = lastById.get(item.id);
            const outQr = res?.quotedRate ? parseFloat(String(res.quotedRate)) : null;
            if (outQr !== null && !isNaN(outQr) && outQr !== quotedRate) roundedCount++;
          }
        });
        if (roundedCount > 0) {
          toast.info(`${roundedCount} rate(s) rounded up`, { duration: 4000 });
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update items.", { id: toastId });
    }
  };

  // Rows arrive already filtered, sorted and paginated by the server.
  // Selection scope: the header checkbox asks the server for every matching
  // docket id (all pages) instead of relying on the loaded rows.
  const selectedFilteredCount = selectedEnquiryIds.length;
  const allFilteredSelected = pageTotal > 0 && selectedFilteredCount >= pageTotal;
  const someFilteredSelected = selectedFilteredCount > 0 && !allFilteredSelected;

  const paginatedEnquiries = enquiries;

  // Page rows carry only their first item. Expanded dockets load the rest (toggle,
  // expand-all and auto-expand all just set expandedRows).
  const loadingIds = useRef(new Set<string>());
  useEffect(() => {
    const ids = paginatedEnquiries
      .filter((e) => expandedRows[e.id] && !e.itemsLoaded && (e.itemCount ?? 0) > 1 && !loadingIds.current.has(e.id))
      .map((e) => e.id);
    if (ids.length === 0) return;
    ids.forEach((id) => loadingIds.current.add(id));
    dispatch(loadEnquiryItems({ enquiryIds: ids })).finally(() => ids.forEach((id) => loadingIds.current.delete(id)));
  }, [paginatedEnquiries, expandedRows, dispatch]);

  // Every handler that loops a docket's items must go through this first, or it would
  // silently process only the first item of each collapsed docket. Returns the page
  // with full item lists, or null (after a toast) when loading failed.
  const ensureItems = async (list: EnquiryData[]): Promise<EnquiryData[] | null> => {
    const missing = list.filter((e) => !e.itemsLoaded).map((e) => e.id);
    if (missing.length === 0) return list;
    const toastId = toast.loading("Loading items...");
    try {
      const loaded = await dispatch(loadEnquiryItems({ enquiryIds: missing })).unwrap();
      toast.dismiss(toastId);
      return list.map((e) =>
        e.itemsLoaded ? e : { ...e, itemsLoaded: true, items: loaded.filter((i) => i.enquiryId === e.id) },
      );
    } catch (err) {
      toast.error("Could not load items - nothing was changed.", { id: toastId });
      return null;
    }
  };
  const ensurePageItems = () => ensureItems(paginatedEnquiries);

  // getFilteredItems runs ~130 predicates per item. Called straight from the render
  // map it re-ran for every row on every one of this component's state changes, so
  // the result is cached per page and only recomputed when the filters really change.
  const filteredItemsByEnquiry = useMemo(() => {
    const byId = new Map<string, EnquiryItemData[]>();
    for (const enquiry of paginatedEnquiries) {
      byId.set(enquiry.id, getFilteredItems(enquiry));
    }
    return byId;
  }, [paginatedEnquiries, getFilteredItems]);

  // Unfiltered items per docket, grouped once. OfferPdfCell used to select every item
  // in the store and filter them in its own body, once per row.
  const itemsByEnquiry = useMemo(() => {
    const byId = new Map<string, EnquiryItemData[]>();
    for (const item of allItems) {
      const list = byId.get(item.enquiryId);
      if (list) list.push(item);
      else byId.set(item.enquiryId, [item]);
    }
    return byId;
  }, [allItems]);

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

        const XLSX = await import("xlsx");
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

  const handleExportToExcel = async () => {
    const toastId = toast.loading("Preparing Excel file...");
    try {
      const rows: Record<string, string | number>[] = [];
      // Export covers every matching docket, not just the loaded page.
      const allEnquiries = await fetchFilteredEnquiryExport(query);

      allEnquiries.forEach((enquiry) => {
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
            "Technical Evaluation": enquiry.technicalEvaluation || "",
            "Reverse Auction": enquiry.reverseAuctionStatus || "",
            "Item Name": "",
            "Quantity": "",
            "Item Type": "",
            "MOC": "",
            "Size": "",
            "PN Rating": "",
            "Item Code": "",
            "BOM ID": "",
            "Operation Type": "",
            "Extension": "",
            "Bypass": "",
            "Other": "",
            "Product Cost": "",
            "Cost Ref Code": "",
"Cost": "",
              "Stock Status": "",
            "Stock Quantity": "",
            "Available Stock": "",
            "RM Type": "",
            "Stock Against Contract": "",
            "Discount": "",
            "Quotation Rate": "",
            "CR Rate": "",
            "PD Cost Validation": "",
            "Item Name Merge": "",
            "Total Value": "",
            "Itemwise Total Value": "",
              "Delivery Schedule": "",
              "Validation": "",
              "APM": (enquiry as any).apm || "",
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
              "Technical Evaluation": enquiry.technicalEvaluation || "",
              "Reverse Auction": enquiry.reverseAuctionStatus || "",
              "Item Name": item.itemName,
              "Quantity": item.quantity ? Number(item.quantity) : "",
              "Item Type": item.itemType || "",
              "MOC": item.moc || "",
              "Size": item.size || "",
              "PN Rating": item.pnRating || "",
              "Item Code": (item as any).erpItemCode || item.erpItemCode || "",
              "BOM ID": (item as any).bomId || "",
              "Operation Type": item.operationType || "",
              "Extension": item.extension || "",
              "Bypass": item.bypass || "",
              "Other": Array.isArray((item as any).others) ? (item as any).others.join(", ") : (item as any).others || "",
              "Product Cost": item.productCost ? Number(item.productCost) : "",
              "Cost Ref Code": item.costRefCode || "",
              "Cost": item.cost ? Number(item.cost) : "",
              "Stock Status": item.stockStatus || "",
              "Stock Quantity": item.stockQuantity || "",
              "Available Stock": item.availableStock || "",
              "RM Type": item.rmType || "",
              "Stock Against Contract": item.stockAgainstContract || "",
              "Discount": item.discount ? `${Number(item.discount)}%` : "",
              "Quotation Rate": item.quotedRate || "",
              "CR Rate": item.contractReviewRate || "",
              "PD Cost Validation": getPdCostValidation(item) || "",
              "Item Name Merge": item.itemNameMerge || "",
              "Total Value": item.totalValue || "",
              "Itemwise Total Value": item.itemWiseTotalValue || "",
              "Delivery Schedule": item.deliverySchedule || "",
              "Validation": item.validation || "",
              "APM": (enquiry as any).apm || "",
              "Attachments": enquiry.attachments ? enquiry.attachments.map(a => a.name).join(", ") : "",
              "Attachment Links": enquiry.attachments ? enquiry.attachments.map(a => a.url).join(" ; ") : "",
            });
          });
        }
      });

      const XLSX = await import("xlsx");
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
    const pageFull = await ensurePageItems();
    if (!pageFull) return;
    // Collect items that pass all active filters
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of pageFull) {
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
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
    // Items whose stored item type is wrong for the name (e.g. "Dual Plate Check
    // Valve" kept as CHECK VALVE) are corrected too, even with no blanks.
    const correctableItems = matchedItems.filter(
      (i: EnquiryItemData) => correctItemType(i.itemName, i.itemType) !== null
    )
    const itemsToProcess = [
      ...blankItems,
      ...correctableItems.filter((c) => !blankItems.some((b) => b.id === c.id)),
    ]
    if (itemsToProcess.length === 0) {
      toast.info("No blank fields or item types to fix.")
      return
    }

    // Preview only: nothing is saved until the user accepts rows in the review dialog.
    setAutoFillStatus("running")
    try {
      const result = await previewAutoFillAction(itemsToProcess.map((i: EnquiryItemData) => i.id))
      if (!result.success) {
        toast.error(result.error || "Auto-fill preview failed.")
      } else if (result.data!.changes.length === 0) {
        toast.info("Auto-fill found nothing to change.")
      } else {
        setAutoFillChanges(result.data!.changes)
      }
    } finally {
      setAutoFillStatus("idle")
    }
  }

  const handleApplyAutoFill = async (accepted: AutoFillChange[]) => {
    setAutoFillApplying(true)
    try {
      await dispatch(autoFillBlanks(accepted)).unwrap()
      toast.success(`Auto-fill applied: ${accepted.length} change(s).`)
      setAutoFillChanges(null)
    } catch {
      toast.error("Failed to apply auto-fill.")
    } finally {
      setAutoFillApplying(false)
    }
  }

  const handleFetchItemCodes = async () => {
    const pageFull = await ensurePageItems();
    if (!pageFull) return;
    // Collect every item that passes all active filters. Already-coded items are
    // included too: the button re-syncs the master sheet, so codes whose mapping
    // changed upstream are updated, not just blanks.
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of pageFull) {
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
      }
    }

    const missingCodeItems = matchedItems.filter((i) => !i.erpItemCode)
    const alreadyCoded = matchedItems.length - missingCodeItems.length
    console.log(`[Client] fetchItemCodes: ${matchedItems.length} item(s) in scope, ${missingCodeItems.length} currently missing a code`)
    if (matchedItems.length === 0) {
      toast.info("No items in the current view to refresh.")
      return
    }
    if (
      !await ask(
        `Re-check ERP item codes for ${matchedItems.length} item(s) against the live master sheet? ` +
          `${alreadyCoded} already coded (updated if the sheet mapping changed), ${missingCodeItems.length} missing.`
      )
    ) return

    setFetchCodesStatus("running")
    const toastId = toast.loading(`Refreshing ERP item codes for ${matchedItems.length} item(s)...`)
    try {
      const result = await dispatch(fetchItemCodes(matchedItems.map((i) => i.id))).unwrap()
      const changed: { itemName: string; from: string | null; to: string }[] = result?.changes ?? []
      const syncFailed = result?.syncFailed === true
      const changeLines = changed
        .slice(0, 8)
        .map((c) => `• ${(c.itemName || "").slice(0, 35)}: ${c.from ?? "(blank)"} → ${c.to}`)
        .join("\n")
      const extraChanges = changed.length > 8 ? `\n...and ${changed.length - 8} more` : ""
      const changeBlock = changeLines ? (
        <div className="mt-1 whitespace-pre-line">
          {changeLines}
          {extraChanges}
        </div>
      ) : null

      if (result?.failures && result.failures.length > 0) {
        toast.warning(
          <div className="text-xs">
            <div className="font-semibold">
              {syncFailed ? "Master sheet sync failed - used last snapshot. " : ""}
              {changed.length > 0
                ? `Updated ${changed.length} code(s), ${result.fetched} item(s) now have a code, ${result.failures.length} not derivable:`
                : `${result.fetched} item(s) verified, ${result.failures.length} not derivable:`}
            </div>
            {changeBlock}
            <div className="mt-1 space-y-1 text-[11px] leading-relaxed opacity-90 max-h-48 overflow-y-auto whitespace-pre-line">
              {result.failures.map((f: any, idx: number) => (
                <div key={idx}>
                  <span className="font-medium text-amber-700 dark:text-amber-300">• {f.itemName.slice(0, 35)}:</span>{" "}
                  <span>{f.reason}</span>
                </div>
              ))}
            </div>
          </div>,
          { id: toastId, duration: 12000 }
        )
      } else if (changed.length > 0) {
        toast.success(
          <div className="text-xs">
            <div className="font-semibold">
              {syncFailed ? "Master sheet sync failed - used last snapshot. " : ""}
              Updated {changed.length} item code(s), {result.fetched} verified.
            </div>
            {changeBlock}
          </div>,
          { id: toastId, duration: 9000 }
        )
      } else if (syncFailed) {
        toast.warning(`Master sheet sync failed - verified ${result?.fetched ?? 0} item(s) against the last snapshot.`, {
          id: toastId,
          duration: 8000,
        })
      } else {
        toast.success(`Item codes up to date - ${result?.fetched ?? 0} item(s) verified, no changes in the master sheet.`, {
          id: toastId,
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to fetch item codes."
      toast.error(
        <div className="text-xs">
          <div className="font-semibold">Item codes not found</div>
          <div className="mt-1 text-[11px] leading-relaxed opacity-90 whitespace-pre-line">
            {message}
          </div>
        </div>,
        { id: toastId, duration: 14000 }
      )
    } finally {
      setFetchCodesStatus("idle")
    }
  }

  const handleUpdateAllBomCosts = async () => {
    const pageFull = await ensurePageItems();
    if (!pageFull) return;
    const frozenEnquiryIds = new Set(
      paginatedEnquiries
        .filter((e) => isEnquiryFrozen((e as any).apm, (e as any).offerPdfGeneratedAt))
        .map((e) => e.id)
    );
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of pageFull) {
      if (frozenEnquiryIds.has(enquiry.id)) continue;
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
      }
    }
    if (frozenEnquiryIds.size > 0) {
      toast(`Skipping frozen enquiries (${frozenEnquiryIds.size}) — rate & cost are frozen after one-time PDF.`, { duration: 3000 });
    }

    // Items that need a cost: either they have an item code (sheet/DIRECT M2M
    // path) or they have no BOM at all (Indent Listing cost-ref path, which is
    // keyed on item name/size/PN and does not need an item code).
    const targetItems = matchedItems.filter(
      (i) =>
        (i.erpItemCode || !i.bomId) &&
        (!i.productCost || !i.cost || Number(i.cost) === 0)
    )
    console.log(`[Client] updateAllBomCosts: ${targetItems.length} target items out of ${matchedItems.length} matched`)
    if (targetItems.length === 0) {
      const bomNoCodeCount = matchedItems.filter((i) => i.bomId && !i.erpItemCode).length
      if (bomNoCodeCount > 0) {
        toast.info(`Found ${bomNoCodeCount} item(s) with a BOM but no ERP item code. Please click 'Fetch Item Codes' first.`)
      } else {
        toast.info("No items requiring cost updates found.")
      }
      return
    }
    if (!await ask(`Update costs (BOM DIRECT M2M & 2:1, plus Indent Listing fallback) for ${targetItems.length} item(s)?`)) return

    setUpdateCostStatus("running")
    const toastId = toast.loading(`Updating BOM costs for ${targetItems.length} item(s)...`)
    try {
      const result = await dispatch(updateAllBomCosts(targetItems.map((i) => i.id))).unwrap()
      const indentPart = result.indentRefFilled
        ? `, ${result.indentRefFilled} cost ref(s) filled from Indent Listing`
        : ""
      toast.success(`Costs updated for ${result.updated} item(s)${indentPart}.`, { id: toastId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to update BOM costs."
      toast.error(message, { id: toastId })
    } finally {
      setUpdateCostStatus("idle")
    }
  }

  const handleAutoFillVa = async () => {
    const pageFull = await ensurePageItems();
    if (!pageFull) return;
    const frozenEnquiryIds2 = new Set(
      paginatedEnquiries
        .filter((e) => isEnquiryFrozen((e as any).apm, (e as any).offerPdfGeneratedAt))
        .map((e) => e.id)
    );
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of pageFull) {
      if (frozenEnquiryIds2.has(enquiry.id)) continue;
      for (const item of getFilteredItems(enquiry)) {
        matchedItems.push(item)
      }
    }
    if (frozenEnquiryIds2.size > 0) {
      toast(`Skipping frozen enquiries (${frozenEnquiryIds2.size}) — VA% is frozen after one-time PDF.`, { duration: 3000 });
    }

    const blankVaItems = matchedItems.filter((i: EnquiryItemData) => !i.vaPercent)
    console.log(`[Client] autoFillVa: ${blankVaItems.length} items with blank VA% out of ${matchedItems.length} matched`)
    blankVaItems.forEach((i: EnquiryItemData) => console.log(`  → ${i.itemName} (type: ${i.itemType || "?"}, size: ${i.size || "?"})`))
    if (blankVaItems.length === 0) {
      toast.info("No blank VA% fields to fill.")
      return
    }
    if (!await ask(`Auto-fill VA% for ${blankVaItems.length} items (based on item type + size defaults)?`)) return

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
    const pageFull = await ensurePageItems();
    if (!pageFull) return;
    // Collect items with an erpItemCode from currently paginated enquiries that pass active filters
    const itemsWithCode: EnquiryItemData[] = []
    for (const enquiry of pageFull) {
      for (const item of getFilteredItems(enquiry)) {
        if (item.erpItemCode) itemsWithCode.push(item)
      }
    }
    if (itemsWithCode.length === 0) {
      toast.info("No items with ERP item codes found on this page.")
      return
    }
    if (
      !await ask(
        `Fetch Contract Review rates for ${itemsWithCode.length} item(s) with ERP item codes?\n\n` +
          `Any BLANK Cost Ref Code will also be filled from the Contract Review cost code ref. ` +
          `Items that already have a Cost Ref Code are left untouched, and a cost code ref ` +
          `that matches more than one RM code is skipped.`,
      )
    )
      return

    setCrRateStatus("running")
    const toastId = toast.loading(`Fetching Contract Review rates for ${itemsWithCode.length} item(s)...`)
    try {
      const result = await dispatch(fetchContractReviewRates(itemsWithCode.map((i) => i.id))).unwrap()
      const costRefParts: string[] = []
      if (result.costRefFilled) costRefParts.push(`${result.costRefFilled} cost code ref filled`)
      if (result.costRefMulti) costRefParts.push(`${result.costRefMulti} multi-code skipped`)
      if (result.costRefNoMatch) costRefParts.push(`${result.costRefNoMatch} no contract row`)
      const costRefDetail = costRefParts.length > 0 ? ` | ${costRefParts.join(", ")}` : ""
      toast.success(
        `Contract Review rates updated for ${result.updated} item(s)${costRefDetail}`,
        { id: toastId },
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to fetch CR rates."
      toast.error(message, { id: toastId })
    } finally {
      setCrRateStatus("idle")
    }
  }

  const handleApplyVaRules = async (enquiryId: string, docket: string) => {
    if (!(await ask(`Apply VA% rules to ${docket}? Fetches CR rates, then sets rates (min VA%, CR rate, previous-party cap). Validated items are skipped.`))) return
    const res = await applyVaRulesAction(enquiryId)
    if (!res.success) return void toast.error(res.error)
    dispatch(markEnquiryPageStale())
    toast.success(`${docket}: ${res.changed} item(s) updated${res.locked ? `, ${res.locked} validated item(s) skipped` : ""}`)
  }

  const handlePopulatePdCostVal = async () => {
    const pageFull = await ensurePageItems();
    if (!pageFull) return;
    // Collect items from currently paginated enquiries that pass active filters and have both CR Rate and Product Cost
    const matchedItems: EnquiryItemData[] = []
    for (const enquiry of pageFull) {
      for (const item of getFilteredItems(enquiry)) {
        if (item.contractReviewRate && item.productCost != null) {
          matchedItems.push(item)
        }
      }
    }
    if (matchedItems.length === 0) {
      toast.info("No items with both Contract Review Rate and Product Cost found on this page.")
      return
    }
    if (!await ask(`Populate PD Cost Validation % for ${matchedItems.length} item(s)?`)) return

    setPdCostValStatus("running")
    const toastId = toast.loading(`Populating PD Cost Validation % for ${matchedItems.length} item(s)...`)
    try {
      const result = await dispatch(populatePdCostValidation(matchedItems.map((i) => i.id))).unwrap()
      toast.success(`PD Cost Validation % updated for ${result.updated} item(s).`, { id: toastId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to populate PD Cost Validation."
      toast.error(message, { id: toastId })
    } finally {
      setPdCostValStatus("idle")
    }
  }

  const handleSyncAvailableStock = async () => {
    if (!await ask("Sync available stock and RM Type for ALL items with a raw material code from Raw Materials dashboard (GMDUpdateItem)? This will backfill availableStock and rmType wherever rmItemCode matches.")) return

    setSyncStockStatus("running")
    const toastId = toast.loading("Syncing available stock and RM Type for all items with an RM code...")
    try {
      const result: any = await dispatch(syncAvailableStock(undefined)).unwrap()
      const count = result.count ?? 0
      if (count === 0) {
        toast.info("No available stock or RM Type changes found.", { id: toastId })
      } else {
        toast.success(`Available stock and RM Type synced for ${count} item(s).`, { id: toastId })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Failed to sync available stock."
      toast.error(message, { id: toastId })
    } finally {
      setSyncStockStatus("idle")
    }
  }

  const TOTAL_COLUMNS = ALL_COLUMN_KEYS.length;
  const SELECT_COL_WIDTH = 44;
  const getColWidth = (idx: number) => Math.max(minColWidth(idx), columnWidths[idx] ?? DEFAULT_COLUMN_WIDTHS[idx] ?? 120);
  const visibleSet = new Set(visibleColumns);
  const hiddenIdx = ALL_COLUMN_KEYS.flatMap((k, i) => (visibleSet.has(k) ? [] : [i]));
  const totalTableWidth =
    ALL_COLUMN_KEYS.reduce((sum, k, idx) => sum + (visibleSet.has(k) ? getColWidth(idx) : 0), 0) +
    SELECT_COL_WIDTH;
  // Docket, Item Name and Details (holds Size) pin to the left; columns between them scroll underneath.
  const frozenLeft: Record<number, number> = {
    0: 0,
    8: getColWidth(0),
    9: getColWidth(0) + (visibleSet.has("itemName") ? getColWidth(8) : 0),
  };
  // Hidden columns: the cell at the same position in every row (the select checkbox is the first) is hidden.
  const hiddenColumnsCss =
    hiddenIdx
      .map((i) => `.enq-table > colgroup > col:nth-child(${i + 2}), .enq-table tr > :nth-child(${i + 2})`)
      .join(",") + "{display:none}";
  const rowCallbacks = useRef<DocketRowActions>(null as unknown as DocketRowActions);
  rowCallbacks.current = {
    toggleExpand,
    applyVaRules: handleApplyVaRules,
    fieldChange: handleEnquiryFieldChange,
    addAttachments: handleAddAttachments,
    showIncomplete: () => setIncompleteOnly(true),
    edit: setEditingDocketId,
  };
  // Stable, so a memoised DocketRow is not re-rendered by unrelated table updates.
  const rowActions = useMemo<DocketRowActions>(
    () => ({
      toggleExpand: (...a) => rowCallbacks.current.toggleExpand(...a),
      applyVaRules: (...a) => rowCallbacks.current.applyVaRules(...a),
      fieldChange: (...a) => rowCallbacks.current.fieldChange(...a),
      addAttachments: (...a) => rowCallbacks.current.addAttachments(...a),
      showIncomplete: () => rowCallbacks.current.showIncomplete(),
      edit: (id) => rowCallbacks.current.edit(id),
    }),
    [],
  );
  // Collapsed table borders don't travel with sticky cells, so draw the divider as a shadow.
  const FROZEN_TD = "sticky z-20 bg-background [tr:hover>&]:bg-muted shadow-[inset_-1px_0_0_var(--border),inset_0_-1px_0_var(--border)]";
  // Yes/No toggle: only the saved side is coloured (with a tick), so the stored value reads at a glance.
  const renderYesNo = (
    enquiryId: string,
    field: "technicalEvaluation" | "reverseAuctionStatus",
    label: string,
    raw: string | null | undefined,
  ) => {
    const saved = (raw ?? "").trim().toLowerCase();
    return (
      <div className="flex items-center justify-center gap-1">
        {(["Yes", "No"] as const).map((opt) => {
          const on = saved === opt.toLowerCase();
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              title={on ? `${label}: ${opt} (saved). Click to clear.` : `Set ${label} ${opt}`}
              onClick={() => handleEnquiryFieldChange(enquiryId, field, on ? "" : opt)}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded border cursor-pointer transition-all ${
                on
                  ? opt === "Yes"
                    ? "bg-emerald-500 border-emerald-500 text-white dark:bg-emerald-500/80"
                    : "bg-rose-500 border-rose-500 text-white dark:bg-rose-500/80"
                  : "bg-background border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {on && <Check className="h-2.5 w-2.5" />}
              {opt}
            </button>
          );
        })}
      </div>
    );
  };
  const allExpanded =
    paginatedEnquiries.length > 0 &&
    paginatedEnquiries.every((e) => expandedRows[e.id] ?? false);
  const toggleExpandAll = () =>
    dispatch(setExpandedRows(Object.fromEntries(paginatedEnquiries.map((e) => [e.id, !allExpanded]))));

  const inputClass =
    "mt-1.5 w-full h-7 rounded border border-input bg-background px-2 py-0.5 text-[10px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 normal-case";

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full max-w-full min-w-0">
      {/* Everything above the drag bar scales together (CSS zoom); the table itself never does. */}
      <div className="shrink-0" style={analyticsOn && scale < 1 ? { zoom: scale } : undefined}>
      {/* Status tiles: one stage per docket, counted server-side; click to filter */}
      {analyticsOn && <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-border">
        {STAGE_TILES.map(([stage, label]) => {
          const active = pageState.stage === stage;
          return (
            <button
              key={stage}
              type="button"
              onClick={() => dispatch(setEnquiryStage(active ? "" : stage))}
              aria-pressed={active}
              className={`flex flex-1 flex-col items-start rounded-md border px-3 py-1.5 min-w-32 cursor-pointer transition-colors ${
                active
                  ? "border-[#0f62fe] bg-[#0f62fe] text-white dark:border-blue-500/80 dark:bg-blue-500/80"
                  : "border-border bg-background text-foreground hover:bg-accent"
              }`}
            >
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${active ? "text-white/80" : "text-muted-foreground"}`}>{label}</span>
              <span className="text-lg font-bold leading-tight">{pageState.summary?.stageCounts?.[stage] ?? 0}</span>
              {/* Ageing: days since enquiry */}
              <span className={`text-[9px] tabular-nums ${active ? "text-white/80" : "text-muted-foreground"}`}>
                {AGE_BUCKETS.map((b) => `${b}d ${pageState.summary?.stageAgeing?.[stage]?.[b] ?? 0}`).join(" · ")}
              </span>
            </button>
          );
        })}
      </div>}
      {analyticsOn && <AssigneePendingStrip rows={pageState.summary?.assigneePending ?? []} />}
      {/* Table Toolbar */}
      <div className="flex flex-wrap justify-between items-center gap-x-4 gap-y-2 px-4 py-2.5 bg-muted/50 border-b border-border">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">
          {isPageLoading ? (
            <span className="inline-flex items-center gap-1.5 text-[#0f62fe] dark:text-blue-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading page {currentPage}…
            </span>
          ) : (
            <>
              Showing {pageStart}–{pageEnd} of {pageTotal.toLocaleString()} enquiries
              {itemCount > 0 && (
                <span className="ml-1.5 font-normal text-muted-foreground/80">
                  · {itemCount.toLocaleString()} items
                </span>
              )}
              <span className="ml-1.5 font-normal text-muted-foreground/80">
                · page {currentPage} of {totalPages}
              </span>
              {pageState.refreshing && (
                <span className="ml-1.5 inline-flex items-center gap-1 font-normal text-muted-foreground/80">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> refreshing…
                </span>
              )}
            </>
          )}
          {validSelectedEnquiryIds.length > 0 && (
            <span className="ml-1.5 text-[#0f62fe] dark:text-blue-300">
              · {validSelectedEnquiryIds.length} selected
            </span>
          )}
        </span>

        {/* Row colour legend (red = invalidVaItemIds, blue = isSelected) */}
        {analyticsOn && <span className="hidden items-center gap-3 whitespace-nowrap text-[10px] font-normal text-muted-foreground/80 sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-[2px] border border-red-300 bg-red-100 dark:border-red-500/40 dark:bg-red-500/15" />
            Red row = VA% below minimum, or rate above CR rate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-[2px] border border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10" />
            Selected
          </span>
        </span>}
        </div>

        {analyticsOn && <div className="flex flex-wrap items-center justify-end gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetAllFilters}
              className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
            >
              <svg className="h-3.5 w-3.5 text-rose-700 dark:text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            onOpen={() => requestFacet('validation')}
            selected={filters.validation}
            onChange={(v) => dispatch(setFilter({ field: "validation", value: v }))}
            includeBlank
            className="h-8 w-40 rounded-md border border-border bg-background text-foreground"
            panelClassName="w-56"
          />

          <button
            type="button"
            onClick={handleExportToExcel}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-[#0f62fe] hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-[#0f62fe] dark:text-blue-300 stroke-2" />
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
              className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all  shrink-0"
            >
              <Upload className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300 stroke-2" />
              Import Excel
            </button>
          </div>

          <button
            type="button"
            onClick={handleAutoFillBlanks}
            disabled={autoFillStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-500/25 dark:bg-purple-500/10 dark:text-purple-300 dark:hover:bg-purple-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-700 dark:text-purple-300 stroke-2" />
            {autoFillStatus === "running" ? "Filling..." : "Auto-Fill Blanks"}
          </button>

          <button
            type="button"
            onClick={handleFetchItemCodes}
            disabled={fetchCodesStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-blue-700 dark:text-blue-300 stroke-2 ${fetchCodesStatus === "running" ? "animate-spin" : ""}`} />
            {fetchCodesStatus === "running" ? "Refreshing..." : "Fetch Item Codes"}
          </button>

          <button
            type="button"
            onClick={handleUpdateAllBomCosts}
            disabled={updateCostStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <DollarSign className={`h-3.5 w-3.5 text-teal-700 dark:text-teal-300 stroke-2 ${updateCostStatus === "running" ? "animate-spin" : ""}`} />
            {updateCostStatus === "running" ? "Updating..." : "Update BOM Costs"}
          </button>

          <button
            type="button"
            onClick={handleFetchContractReviewRates}
            disabled={crRateStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-violet-700 dark:text-violet-300 stroke-2 ${crRateStatus === "running" ? "animate-spin" : ""}`} />
            {crRateStatus === "running" ? "Fetching..." : "Fetch CR Rates"}
          </button>

          <button
            type="button"
            onClick={handleSyncAvailableStock}
            disabled={syncStockStatus === "running" || updateCostStatus === "running"}
            className="group/button inline-flex shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20 h-8 gap-1.5 px-3 text-xs font-semibold cursor-pointer transition-all shrink-0 disabled:opacity-50"
            title="Backfill availableStock and RM Type for all items with an RM code from Raw Materials (GMDUpdateItem)"
          >
            <PackageCheck className={`h-3.5 w-3.5 text-amber-700 dark:text-amber-300 stroke-2 ${syncStockStatus === "running" ? "animate-spin" : ""}`} />
            {syncStockStatus === "running" ? "Syncing Stock..." : "Sync Available Stock"}
          </button>
        </div>}
      </div>

      <EnquiryFilterBar
        dropdownOptions={dropdownOptions}
        cascadedOptions={cascadedOptions}
        requestFacet={requestFacet}
        contractOptions={allSelectedContractOptions}
        pendingOnly={pendingOnly}
        onTogglePending={() => setPendingOnly((v) => !v)}
        hasActiveFilters={hasActiveFilters}
        onClearAll={handleResetAllFilters}
        visibleColumns={visibleColumns}
        onColumnsChange={changeColumns}
        showColumns={analyticsOn}
      />
      </div>
      {analyticsOn && <ScaleBar scale={scale} onChange={onScaleChange} />}

      {/* Narrowing to a stage returns few rows and comes back fast, so the opacity dip
          alone was easy to miss. This bar always registers. */}
      <div className="h-0.5 w-full shrink-0 overflow-hidden" aria-hidden="true">
        {isPageLoading && (
          <div className="h-full w-full animate-pulse bg-[#0f62fe] dark:bg-blue-400" />
        )}
      </div>

      <div
        aria-busy={isPageLoading}
        className={`flex-1 min-h-0 overflow-x-auto overflow-y-auto w-full min-w-0 border-b border-border transition-opacity duration-200 ${
          isPageLoading ? "opacity-60" : ""
        }`}
      >
        {hiddenIdx.length > 0 && <style>{hiddenColumnsCss}</style>}
        <table
        ref={tableRef}
        className="enq-table border-collapse text-left border border-border"
        style={{ tableLayout: "fixed", width: totalTableWidth }}
      >
        <colgroup>
          <col style={{ width: SELECT_COL_WIDTH }} />
          {Array.from({ length: TOTAL_COLUMNS }, (_, idx) => (
            <col key={idx} style={{ width: getColWidth(idx) }} />
          ))}
        </colgroup>
        {/* Opaque sticky layer: collapsed borders leave gaps between sticky <th>s that rows showed through. */}
        <thead className="sticky top-0 z-30 bg-muted">
          <tr className="bg-muted select-none">
            {/* Select checkbox column — scope: cascading-filtered dockets */}
            <th className="py-2.5 px-2 sticky top-0 z-30 bg-muted border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] text-center align-top">
              <div className="flex flex-col items-center justify-center gap-1">
                <span className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">Sel</span>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => { if (el) el.indeterminate = someFilteredSelected; }}
                  onChange={selectAllFiltered}
                  disabled={pageTotal === 0}
                  className="h-3.5 w-3.5 rounded border-border cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  title={allFilteredSelected ? "Clear selection" : `Select all ${pageTotal} filtered docket(s)`}
                />
                {selectedFilteredCount > 0 && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    title="Clear selection"
                    className="inline-flex items-center justify-center p-0.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </th>
            <th style={{ left: 0 }} className="relative py-1.5 px-3 sticky top-0 z-40 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)]">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 truncate"><button
                    type="button"
                    onClick={toggleExpandAll}
                    disabled={paginatedEnquiries.length === 0}
                    title={allExpanded ? "Collapse all dockets" : "Expand all dockets"}
                    aria-label={allExpanded ? "Collapse all dockets" : "Expand all dockets"}
                    className="inline-flex items-center justify-center p-0.5 hover:bg-background rounded cursor-pointer disabled:opacity-40"
                  >
                    {allExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>Docket</span>
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">{renderSortArrow("docketNumber")}<span className="text-[8px] font-semibold">Date</span>{renderSortArrow("enquiryDate")}<span className="text-[8px] font-semibold">Party</span>{renderSortArrow("partyName")}</span>
              </div>
              <FilterTextInput field="docketNumber" placeholder="Docket no..." className={inputClass} />
              <div
                onMouseDown={(e) => handleMouseDown(0, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>
            <th className="relative py-1.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)]">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 truncate">Location</span>
                <span className="flex items-center gap-1"></span>
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(1, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>
            <th className="relative py-1.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)]">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 truncate">Terms &amp; Contract</span>
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">{renderSortArrow("contractNo")}</span>
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
            <th className="relative py-1.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)]">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 truncate">Contact</span>
                <span className="flex items-center gap-1"></span>
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
            <th className="relative py-1.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)]">
              <div className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 truncate">Status</span>
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap"><span className="text-[8px] font-semibold">Order</span>{renderSortArrow("orderStatus")}<span className="text-[8px] font-semibold">Closure</span>{renderSortArrow("closureStatus")}</span>
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

            {/* 11. Project Reference */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Project Reference</span>
                {renderSortArrow("projectReference")}
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={filterProjectReference}
                onChange={(e) => setProjectReferenceInput(e.target.value)}
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(5, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 12. Technical Evaluation */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Technical Evaluation</span>
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

            {/* 13. Reverse Auction */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Reverse Auction</span>
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

            {/* 14. Item Name As Per Party */}
            <th style={{ left: frozenLeft[8] }} className="relative py-2.5 px-3 sticky top-0 z-40 bg-muted shadow-[inset_-1px_0_0_var(--border),inset_0_-1px_0_var(--border)] text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Name</span>
                {renderSortArrow("itemName")}
              </div>
              <FilterTextInput
                field="itemName"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(8, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* Details */}
            <th style={{ left: frozenLeft[9] }} className="relative py-2.5 px-2.5 sticky top-0 z-40 bg-muted shadow-[inset_-1px_0_0_var(--border),inset_0_-1px_0_var(--border)] text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border last:border-r-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span>Details</span>
                  {activeDetailsFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                      {activeDetailsFilterCount}
                    </span>
                  )}
                </div>
                {activeDetailsFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={handleClearDetailsFilters}
                    className="inline-flex items-center gap-0.5 text-[9px] font-medium text-muted-foreground hover:text-red-500 dark:hover:text-red-200 cursor-pointer transition-colors normal-case"
                    title="Clear all details filters"
                  >
                    <X className="h-2.5 w-2.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              <label
                className="mt-1 flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground cursor-pointer select-none normal-case"
                title="Show only items missing Type, MOC, Size, PN or Op Type (or where Type is UNKNOWN)"
              >
                <input
                  type="checkbox"
                  checked={incompleteOnly}
                  onChange={(e) => setIncompleteOnly(e.target.checked)}
                  className="h-3 w-3 rounded border-border cursor-pointer"
                />
                Details incomplete
              </label>

              {/* Side-by-side compact dropdown filters (4 per row grid structure) */}
              <div className="grid grid-cols-4 gap-1 mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Item Type"
                  allLabel="Type"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Type" : `Type (${sel.length})`)}
                  options={dropdownOptions.itemTypes}
                  cascadedOptions={cascadedOptions.itemType}
                  onOpen={() => requestFacet('itemType')}
                  selected={filters.itemType}
                  onChange={(v) => dispatch(setFilter({ field: "itemType", value: v }))}
                  includeBlank
                  searchPlaceholder="Search type..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.itemType.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="MOC"
                  allLabel="MOC"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "MOC" : `MOC (${sel.length})`)}
                  options={dropdownOptions.mocs}
                  cascadedOptions={cascadedOptions.moc}
                  onOpen={() => requestFacet('moc')}
                  selected={filters.moc}
                  onChange={(v) => dispatch(setFilter({ field: "moc", value: v }))}
                  includeBlank
                  searchPlaceholder="Search MOC..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.moc.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="Size"
                  allLabel="Size"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Size" : `Size (${sel.length})`)}
                  options={dropdownOptions.sizes}
                  cascadedOptions={cascadedOptions.size}
                  onOpen={() => requestFacet('size')}
                  selected={filters.size}
                  onChange={(v) => dispatch(setFilter({ field: "size", value: v }))}
                  includeBlank
                  searchPlaceholder="Search size..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.size.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="center"
                />

                <MultiSelectFilter
                  label="PN Rating"
                  allLabel="PN"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "PN" : `PN (${sel.length})`)}
                  options={dropdownOptions.pnRatings}
                  cascadedOptions={cascadedOptions.pnRating}
                  onOpen={() => requestFacet('pnRating')}
                  selected={filters.pnRating}
                  onChange={(v) => dispatch(setFilter({ field: "pnRating", value: v }))}
                  includeBlank
                  searchPlaceholder="Search PN rating..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.pnRating.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="end"
                />

                <MultiSelectFilter
                  label="Operation Type"
                  allLabel="Op Type"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Op Type" : `Op (${sel.length})`)}
                  options={dropdownOptions.operationTypes}
                  cascadedOptions={cascadedOptions.operationType}
                  onOpen={() => requestFacet('operationType')}
                  selected={filters.operationType}
                  onChange={(v) => dispatch(setFilter({ field: "operationType", value: v }))}
                  includeBlank
                  searchPlaceholder="Search operation..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.operationType.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="Extension"
                  allLabel="Ext"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Ext" : `Ext (${sel.length})`)}
                  options={dropdownOptions.extensions}
                  cascadedOptions={cascadedOptions.extension}
                  onOpen={() => requestFacet('extension')}
                  selected={filters.extension}
                  onChange={(v) => dispatch(setFilter({ field: "extension", value: v }))}
                  includeBlank
                  searchPlaceholder="Search extension..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.extension.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
                />

                <MultiSelectFilter
                  label="Bypass"
                  allLabel="Bypass"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Bypass" : `Byp (${sel.length})`)}
                  options={dropdownOptions.bypasses}
                  cascadedOptions={cascadedOptions.bypass}
                  onOpen={() => requestFacet('bypass')}
                  selected={filters.bypass}
                  onChange={(v) => dispatch(setFilter({ field: "bypass", value: v }))}
                  includeBlank
                  searchPlaceholder="Search bypass..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.bypass.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="center"
                />

                <MultiSelectFilter
                  label="Other"
                  allLabel="Other"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "Other" : `Other (${sel.length})`)}
                  options={dropdownOptions.others || ["flange", "gasket", "nut and bolt"]}
                  cascadedOptions={cascadedOptions.others || []}
                  onOpen={() => requestFacet('others')}
                  selected={filters.others || []}
                  onChange={(v) => dispatch(setFilter({ field: "others", value: v }))}
                  includeBlank
                  searchPlaceholder="Search other..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    (filters.others || []).length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="end"
                />

                <MultiSelectFilter
                  label="RM Type"
                  allLabel="RM Type"
                  renderButtonLabel={(sel) => (sel.length === 0 ? "RM Type" : `RM (${sel.length})`)}
                  options={Array.from(new Set([...RM_TYPE_OPTIONS, ...(cascadedOptions.rmType ?? [])]))}
                  cascadedOptions={cascadedOptions.rmType ?? []}
                  onOpen={() => requestFacet('rmType')}
                  selected={filters.rmType}
                  onChange={(v) => dispatch(setFilter({ field: "rmType", value: v }))}
                  includeBlank
                  searchPlaceholder="Search RM type..."
                  className={cn(
                    "h-6 px-1.5 py-0 text-[9px] font-normal leading-none",
                    filters.rmType.length > 0 &&
                      "border-blue-500 dark:border-blue-400/50 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold"
                  )}
                  align="start"
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

            {/* 12. Quantity */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Quantity</span>
                {renderSortArrow("quantity")}
              </div>
              <FilterTextInput
                field="quantity"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(10, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 17. Item Code (read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
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
                  onOpen={() => requestFacet('erpItemCode')}
                  selected={filters.erpItemCode}
                  onChange={(v) => dispatch(setFilter({ field: "erpItemCode", value: v }))}
                  includeBlank
                  searchPlaceholder="Search item codes..."
                />
              </div>
              <FilterTextInput
                field="erpItemCodeSearch"
                placeholder="Search item code..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div className="relative mt-1 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Deleted"
                  allLabel="All Items"
                  options={DELETED_STATUS_OPTIONS}
                  cascadedOptions={DELETED_STATUS_OPTIONS}
                  selected={filters.deletedStatus}
                  onChange={(v) => dispatch(setFilter({ field: "deletedStatus", value: v }))}
                  searchPlaceholder="Search status..."
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(11, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 18a. BOM ID (beside Item Code) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>BOM ID</span>
                {renderSortArrow("bomId")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="BOM ID"
                  allLabel="All BOM IDs"
                  options={cascadedOptions.bomId || []}
                  cascadedOptions={cascadedOptions.bomId || []}
                  onOpen={() => requestFacet('bomId')}
                  selected={filters.bomId as any || []}
                  onChange={(v) => dispatch(setFilter({ field: "bomId" as any, value: v }))}
                  includeBlank
                  searchPlaceholder="Search BOM IDs..."
                />
              </div>
              <FilterTextInput
                field="bomIdSearch"
                placeholder="Search BOM ID..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <label
                className="mt-1 flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground cursor-pointer select-none normal-case"
                title="Show only items whose selected BOM is closed (C batch)"
              >
                <input
                  type="checkbox"
                  checked={closedBomOnly}
                  onChange={(e) => setClosedBomOnly(e.target.checked)}
                  className="h-3 w-3 rounded border-border cursor-pointer"
                />
                Closed BOM only
              </label>
              <div
                onMouseDown={(e) => handleMouseDown(12, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 22. Product Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
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
                  onOpen={() => requestFacet('productCost')}
                  selected={filters.productCost}
                  onChange={(v) => dispatch(setFilter({ field: "productCost", value: v }))}
                  includeBlank
                />
              </div>
              <label
                className="mt-1 flex items-center gap-1.5 text-[9px] font-semibold text-muted-foreground cursor-pointer select-none normal-case"
                title="Show only items with a cost warning: smaller size costs more than a larger size, motorised item without actuator cost, or VA% below 0"
              >
                <input
                  type="checkbox"
                  checked={costWarningOnly}
                  onChange={(e) => setCostWarningOnly(e.target.checked)}
                  className="h-3 w-3 rounded border-border cursor-pointer"
                />
                Cost warnings
              </label>
              <div
                onMouseDown={(e) => handleMouseDown(13, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 23. Cost Ref Code */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Cost Ref Code</span>
                {renderSortArrow("costRefCode")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Cost Ref Code"
                  allLabel="All Codes"
                  options={cascadedOptions.costRefCode || []}
                  cascadedOptions={cascadedOptions.costRefCode || []}
                  onOpen={() => requestFacet('costRefCode')}
                  selected={filters.costRefCode}
                  onChange={(v) => dispatch(setFilter({ field: "costRefCode", value: v }))}
                  includeBlank
                  searchPlaceholder="Search cost ref codes..."
                />
              </div>
              <FilterTextInput
                field="costRefCodeSearch"
                placeholder="Search..."
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

            {/* 23. Cost */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Cost</span>
                {renderSortArrow("cost")}
              </div>
              <MultiSelectFilter
                label="Cost"
                allLabel="Cost: All"
                options={cascadedOptions.cost}
                cascadedOptions={cascadedOptions.cost}
                onOpen={() => requestFacet('cost')}
                selected={filters.cost}
                onChange={(v) => dispatch(setFilter({ field: "cost", value: v }))}
                includeBlank
                className="mt-1 h-6 w-full rounded border border-input bg-background px-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-ring"
                panelClassName="w-56 z-80"
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

            {/* 27. Stock Status */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Stock Status</span>
                {renderSortArrow("stockStatus")}
              </div>
              <FilterTextInput
                field="stockStatus"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(16, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 28. Stock Quantity */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Stock Quantity</span>
                {renderSortArrow("stockQuantity")}
              </div>
              <FilterTextInput
                field="stockQuantity"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(17, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 29. Available Stock */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Available Stock</span>
                {renderSortArrow("availableStock")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Available Stock"
                  allLabel="All Stock"
                  options={cascadedOptions.availableStock ?? []}
                  cascadedOptions={cascadedOptions.availableStock ?? []}
                  onOpen={() => requestFacet('availableStock')}
                  selected={filters.availableStock}
                  onChange={(v) => dispatch(setFilter({ field: "availableStock", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(18, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* View Image */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>View Image</span>
                {renderSortArrow("image")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Image"
                  allLabel="All"
                  options={["Present"]}
                  cascadedOptions={["Present"]}
                  selected={(filters as any).image ?? []}
                  onChange={(v) => dispatch(setFilter({ field: "image" as any, value: v }))}
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

            {/* 30. Stock Against Contract */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Stock Against Contract</span>
                {renderSortArrow("stockAgainstContract")}
              </div>
              <FilterTextInput
                field="stockAgainstContract"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(20, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 31. Discount */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Discount</span>
                {renderSortArrow("discount")}
              </div>
              <FilterTextInput
                field="discount"
                placeholder="Search..."
                className={inputClass}
              />
              <div
                onMouseDown={(e) => handleMouseDown(21, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 32. VA% (Moved here next to Quotation Rate) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>VA%</span>
                {renderSortArrow("vaPercent")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="VA%"
                  allLabel="All VA%"
                  options={cascadedOptions.vaPercent}
                  cascadedOptions={cascadedOptions.vaPercent}
                  onOpen={() => requestFacet('vaPercent')}
                  selected={filters.vaPercent}
                  onChange={(v) => dispatch(setFilter({ field: "vaPercent", value: v }))}
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

            {/* 33. Quoted Rate */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Quotation Rate</span>
                {renderSortArrow("quotedRate")}
              </div>
              <FilterTextInput
                field="quotedRate"
                placeholder="Search..."
                className={inputClass}
              />
              <div className="mt-1.5 normal-case">
                <button
                  type="button"
                  onClick={handleClearQr}
                  disabled={clearQrRunning}
                  className="w-full px-1.5 py-1 text-[9px] font-bold rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                  title="Clear Quoted Rate (and GST/Total) for all filtered items (all pages) — VA% kept"
                >
                  {clearQrRunning ? "..." : "Clear"}
                </button>
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(23, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 34. CR Rate (Contract Review Rate — read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
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
                  onOpen={() => requestFacet('contractReviewRate')}
                  selected={filters.contractReviewRate || []}
                  onChange={(v) => dispatch(setFilter({ field: "contractReviewRate", value: v }))}
                  includeBlank
                  searchPlaceholder="Search CR rates..."
                />
              </div>
              <FilterTextInput
                field="contractReviewRateSearch"
                placeholder="Search CR rate..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
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

            {/* 35. PD Cost Validation (read-only) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>PD Cost Val</span>
                {renderSortArrow("pdcostValidation")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="PD Cost Val"
                  allLabel="All PD Cost Val"
                  options={cascadedOptions.pdcostValidation || []}
                  cascadedOptions={cascadedOptions.pdcostValidation || []}
                  onOpen={() => requestFacet('pdcostValidation')}
                  selected={filters.pdcostValidation || []}
                  onChange={(v) => dispatch(setFilter({ field: "pdcostValidation", value: v }))}
                  includeBlank
                  searchPlaceholder="Search PD cost val..."
                />
              </div>
              <FilterTextInput
                field="pdcostValidationSearch"
                placeholder="Search PD cost val..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
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

            {/* 36. QR incl. GST */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>QR incl. GST</span>
                {renderSortArrow("quotedRateGst")}
              </div>
              <FilterTextInput
                field="quotedRateGst"
                placeholder="Search..."
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

            {/* 37. Item Name (Merge) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Item Name (Merge)</span>
                {renderSortArrow("itemNameMerge")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Item Name (Merge)"
                  allLabel="All Names"
                  options={cascadedOptions.itemNameMerge ?? []}
                  cascadedOptions={cascadedOptions.itemNameMerge ?? []}
                  onOpen={() => requestFacet('itemNameMerge')}
                  selected={filters.itemNameMerge}
                  onChange={(v) => dispatch(setFilter({ field: "itemNameMerge", value: v }))}
                  includeBlank
                  searchPlaceholder="Search merged item names..."
                />
              </div>
              <FilterTextInput
                field="itemNameMergeSearch"
                placeholder="Search item name..."
                className="mt-1 w-full h-6 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-normal text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500 normal-case"
              />
              <div
                onMouseDown={(e) => handleMouseDown(27, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 38. Total Value */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Total Value incl. GST</span>
                {renderSortArrow("totalValue")}
              </div>
              <FilterTextInput
                field="totalValue"
                placeholder="Search..."
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

            {/* 39. Itemwise Total Value */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Itemwise Total Value</span>
                {renderSortArrow("itemWiseTotalValue")}
              </div>
              <FilterTextInput
                field="itemWiseTotalValue"
                placeholder="Search..."
                className={inputClass}
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

            {/* 40. Validation */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
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
                  onOpen={() => requestFacet('validation')}
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
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                  title="Set all filtered items (all pages) to Yes"
                >
                  {bulkValidationRunning === "Yes" ? "..." : "All Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkValidation("No")}
                  disabled={bulkValidationRunning !== null}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
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
                onMouseDown={(e) => handleMouseDown(30, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 43. Delivery Schedule */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Delivery Schedule</span>
                {renderSortArrow("deliverySchedule")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="Delivery Schedule"
                  allLabel="All"
                  options={cascadedOptions.deliverySchedule ?? []}
                  cascadedOptions={cascadedOptions.deliverySchedule ?? []}
                  onOpen={() => requestFacet('deliverySchedule')}
                  selected={filters.deliverySchedule}
                  onChange={(v) => dispatch(setFilter({ field: "deliverySchedule", value: v }))}
                  includeBlank
                />
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(31, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 44. APM - beside Offer PDF (enquiry-based) */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>APM</span>
                {renderSortArrow("apm")}
              </div>
              <div className="relative mt-1.5 normal-case font-normal text-left text-foreground">
                <MultiSelectFilter
                  label="APM"
                  allLabel="All"
                  options={["Yes", "No"]}
                  cascadedOptions={cascadedOptions.apm}
                  onOpen={() => requestFacet('apm')}
                  selected={filters.apm}
                  onChange={(v) => dispatch(setFilter({ field: "apm", value: v }))}
                  includeBlank
                />
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 normal-case">
                <button
                  type="button"
                  onClick={() => handleBulkApm("Yes")}
                  disabled={bulkApmRunning !== null || !canEditApm}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  title={canEditApm ? "Set all filtered enquiries (all pages) to Yes" : "Admin only"}
                >
                  {bulkApmRunning === "Yes" ? "..." : "All Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkApm("No")}
                  disabled={bulkApmRunning !== null || !canEditApm}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  title={canEditApm ? "Set all filtered enquiries (all pages) to No" : "Admin only"}
                >
                  {bulkApmRunning === "No" ? "..." : "All No"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkApm("")}
                  disabled={bulkApmRunning !== null || !canEditApm}
                  className="px-1.5 py-1 text-[9px] font-bold rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  title={canEditApm ? "Clear APM for all filtered enquiries (all pages)" : "Admin only"}
                >
                  {bulkApmRunning === "Clear" ? "..." : "Clear"}
                </button>
              </div>
              <div
                onMouseDown={(e) => handleMouseDown(32, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 45. Offer PDF */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Offer PDF</span>
              </div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(33, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 46. Send Email */}
            <th className="relative py-2.5 px-3 sticky top-0 z-30 bg-muted text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-r border-b border-border shadow-[inset_0_-1px_0_var(--border)] last:border-r-0">
              <div className="flex items-center justify-between">
                <span>Send Email</span>
              </div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(34, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>

            {/* 47. Actions */}
            <th style={{ right: 0 }} className="relative sticky top-0 z-40 bg-muted py-2.5 px-3 text-[10px] font-bold tracking-wider text-muted-foreground uppercase border-b border-border shadow-[inset_1px_0_0_var(--border),inset_0_-1px_0_var(--border)] text-right">
              <div>Actions</div>
              <div className="h-7 mt-1.5" />
              <div
                onMouseDown={(e) => handleMouseDown(35, e)}
                className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-20 group"
                style={{ marginRight: "-3px" }}
              >
                <div className="absolute top-0 left-[-4px] w-[14px] h-full" />
                <div className="absolute right-[2px] top-0 w-[2px] h-full bg-transparent group-hover:bg-[#0f62fe] group-active:bg-[#0f62fe] dark:group-hover:bg-blue-500 dark:group-active:bg-blue-500 transition-colors" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="bg-background">
          {pageTotal === 0 ? (
            <tr>
              <td colSpan={TOTAL_COLUMNS + 1} className="py-20 px-4 text-center border-b border-border">
                <div className="flex flex-col items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4 border border-border">
                    <Search className="h-5 w-6 stroke-[1.5]" />
                  </div>
                  <h3 className="text-xs font-semibold text-foreground">
                    No enquiries found
                  </h3>
                  <p className="mt-1 text-[11px] text-muted-foreground max-w-xs">
                    Get started by adding items or creating a new enquiry.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            paginatedEnquiries.map((enquiry) => {
              let displayItems = filteredItemsByEnquiry.get(enquiry.id) ?? getFilteredItems(enquiry);
              if (displayItems.length > 1 && sortField === "image") {
                displayItems = [...displayItems].sort((a, b) => {
                  const aVal = getItemImage(a) ? 1 : 0;
                  const bVal = getItemImage(b) ? 1 : 0;
                  return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
                });
              }
              const hasMultiple = displayItems.length > 1;
              // Collapsed by default even under a filter: auto-expanding every docket
              // multiplied the rendered rows by items-per-docket on the slowest action.
              const isExpanded = expandedRows[enquiry.id] ?? false;
              const firstItem = displayItems[0];
              const isSelected = isEnquirySelected(enquiry.id);
              const isFrozen = isEnquiryFrozen((enquiry as any).apm, (enquiry as any).offerPdfGeneratedAt);

               return (
                <React.Fragment key={enquiry.id}>
                  {/* Main Docket / First Item Row */}
                  <tr
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) setEditingDocketId(enquiry.id);
                    }}
                    title={firstItem && invalidVaItemIds.has(firstItem.id) ? "Red row = VA% below minimum, or rate above CR rate" : undefined} className={`h-[44px] transition-colors focus-visible:outline-1 focus-visible:outline-blue-500 ${firstItem && invalidVaItemIds.has(firstItem.id) ? "bg-red-100 dark:bg-red-500/15" : isSelected ? "bg-blue-50/70 hover:bg-blue-50 dark:bg-blue-500/10 dark:hover:bg-blue-500/20" : "hover:bg-muted/20"}`}>
                    {/* Select checkbox for this docket */}
                    <td className="py-1.5 px-2 text-center border-r border-b border-border">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleEnquiry(enquiry.id)}
                        className="h-3 w-3 rounded border-border text-[#0f62fe] dark:text-blue-300 focus:ring-blue-500 cursor-pointer"
                        title={isSelected ? "Deselect docket" : "Select docket"}
                      />
                    </td>
                    <DocketRow
                      enquiry={enquiry}
                      itemCount={enquiry.itemsLoaded ? displayItems.length : (enquiry.itemCount ?? displayItems.length)}
                      isExpanded={isExpanded}
                      incomplete={enquiry.itemsLoaded ? (enquiry.items ?? []).filter((i: EnquiryItemData) => missingDetails(i).length > 0).length : (enquiry.incompleteItemCount ?? 0)}
                      closureAuto={
                        enquiry.closureStatus === "Sent" && autoSentSet.has(enquiry.docketNumber) ? "sent"
                          : enquiry.closureStatus === "Pending" && autoPendingSet.has(enquiry.docketNumber) ? "pending" : null
                      }
                      actions={rowActions}
                    />

                    {/* Project Reference */}
                    <td className="py-1 px-1 border-r border-b border-border last:border-r-0">
                      <EditableText
                        value={enquiry.projectReference || ""}
                        onCommit={(v) => {
                          if (v !== (enquiry.projectReference || "")) {
                            handleEnquiryFieldChange(enquiry.id, "projectReference", v);
                          }
                        }}
                        className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-center"
                      />
                    </td>

                    {/* Technical Evaluation / Reverse Auction */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {renderYesNo(enquiry.id, "technicalEvaluation", "Technical Evaluation", enquiry.technicalEvaluation)}
                    </td>
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {renderYesNo(enquiry.id, "reverseAuctionStatus", "Reverse Auction", enquiry.reverseAuctionStatus)}
                    </td>

                    {/* First Item Name */}
                    <td style={{ left: frozenLeft[8] }} className={`${FROZEN_TD} py-1 px-2 text-[11px] text-muted-foreground font-medium border-r border-b border-border last:border-r-0 align-top`}>
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
                            className="w-full bg-background border border-blue-500 text-[11px] text-foreground outline-none p-1 rounded font-medium"
                          />
                        ) : (
                          <div className="flex items-center justify-between w-full group truncate">
                            <div title={firstItem.itemName} className="w-full pr-1 wrap-break-word whitespace-normal leading-normal line-clamp-2">
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

                    {/* Details */}
                    <td style={{ left: frozenLeft[9] }} className={`${FROZEN_TD} py-1 px-2 border-r border-b border-border last:border-r-0 align-top`}>
                      {firstItem ? (
                        <ItemDetailFields
                          item={firstItem}
                          dropdownOptions={dropdownOptions}
                          onChange={handleItemFieldChange}
                          isFrozen={isFrozen}
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Quantity */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <EditableText
                          value={firstItem.quantity ? Number(firstItem.quantity).toString() : ""}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onCommit={(v) => {
                            if (v !== (firstItem.quantity ? Number(firstItem.quantity).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "quantity", v);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-semibold text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* 18. First Item Item Code (read-only) */}
                    <ItemCodeCell item={firstItem} />

                    {/* 18a. First Item BOM ID (dropdown when multiple, else read-only) */}
                    <td className="py-1 px-1 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        (() => {
                          const avail = (firstItem as any).availableBomIds as string[] | undefined;
                          const hasMulti = Array.isArray(avail) && avail.length > 1;
                          if (hasMulti) {
                            const bomLabels: Record<string, string> = {};
                            for (const b of avail!) bomLabels[b] = closedBomIdSet.has(b) ? `${b} (C - Closed BOM)` : b;
                            return (
                              <CellSelect
                                placeholder="-- select --"
                                searchPlaceholder="Search BOM..."
                                value={(firstItem as any).bomId || ""}
                                options={avail!}
                                optionLabels={bomLabels}
                                disabled={isFrozen}
                                title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : (avail || []).join(", ")}
                                onChange={(v) => {
                                  if (isFrozen) { toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit."); return; }
                                  toast.promise(dispatch(selectBomId({ itemId: firstItem.id, bomId: v || null })).unwrap(), {
                                    loading: "Saving BOM...",
                                    success: "BOM saved.",
                                    error: (err) => (typeof err === "string" ? err : err?.message || "Failed to save BOM."),
                                  });
                                }}
                              />
                            );
                          }
                          const bomId = (firstItem as any).bomId as string | undefined;
                          return (
                            <span className="flex items-center gap-1 min-w-0" title={bomId || ""}>
                              <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate">{bomId || "-"}</span>
                              {bomId && closedBomIdSet.has(bomId) && (
                                <span className="shrink-0 px-1 py-0.5 text-[9px] font-bold rounded border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300" title="Closed BOM (BOM MAST ERP TO_DATE - C batch)">C</span>
                              )}
                            </span>
                          );
                        })()
                      ) : "-"}
                    </td>

                    {/* First Item Product Cost */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <div className="flex items-center gap-1">
                        <CostWarningIcon warnings={firstItem.costWarnings} />
                        <EditableText
                          value={formatIndianNumber(firstItem.productCost)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, firstItem.productCost)) {
                              handleItemFieldChange(firstItem.id, "productCost", next);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        </div>
                      ) : "-"}
                    </td>

                    {/* First Item Cost Ref Code */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <EditableText
                          value={firstItem.costRefCode || ""}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onCommit={(v) => {
                            if (v !== (firstItem.costRefCode || "")) {
                              handleItemFieldChange(firstItem.id, "costRefCode", v);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Cost */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (<>
                        <EditableText
                          value={formatIndianNumber(firstItem.cost)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "cost", e, 0)}
                          onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, firstItem.cost)) {
                              handleItemFieldChange(firstItem.id, "cost", next);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        {costLoadingBadge(enquiry, firstItem)}{cfChip(firstItem)}</>
                      ) : "-"}
                    </td>

                    {/* First Item Stock Status */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <EditableText
                          value={firstItem.stockStatus || ""}
                          onCommit={(v) => {
                            if (v !== (firstItem.stockStatus || "")) {
                              handleItemFieldChange(firstItem.id, "stockStatus", v);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Stock Quantity */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <EditableText
                          value={firstItem.stockQuantity || ""}
                          onCommit={(v) => {
                            if (v !== (firstItem.stockQuantity || "")) {
                              handleItemFieldChange(firstItem.id, "stockQuantity", v);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Available Stock */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <EditableText
                          value={firstItem.availableStock || ""}
                          onCommit={(v) => {
                            if (v !== (firstItem.availableStock || "")) {
                              handleItemFieldChange(firstItem.id, "availableStock", v);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item View Image */}
                    <ItemImageCells item={firstItem ?? null} image={firstItem ? getItemImage(firstItem) : null} />

                    {/* First Item Stock Against Contract */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <EditableText
                          value={firstItem.stockAgainstContract || ""}
                          onCommit={(v) => {
                            if (v !== (firstItem.stockAgainstContract || "")) {
                              handleItemFieldChange(firstItem.id, "stockAgainstContract", v);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Discount */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <EditableText
                          value={firstItem.discount !== null && firstItem.discount !== undefined ? Number(firstItem.discount).toString() : ""}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onCommit={(v) => {
                            if (v !== (firstItem.discount !== null && firstItem.discount !== undefined ? Number(firstItem.discount).toString() : "")) {
                              handleItemFieldChange(firstItem.id, "discount", v);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item VA% */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 font-semibold ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <div className="flex items-center gap-1">
                        <EditableText
                          value={firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : ""}
                          disabled={isFrozen}
                          readOnly={firstItem.validation === "Yes"}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "vaPercent", e, 0)}
                          onCommit={(v) => {
                            const val = v.trim();
                            if (val !== (firstItem.vaPercent !== null ? `${firstItem.vaPercent}%` : "")) {
                              handleItemFieldChange(firstItem.id, "vaPercent", val);
                            }
                          }}
                          className={`w-full bg-transparent border-none text-[11px] ${(firstItem.vaPercent ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-foreground"} outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed`}
                        />
                        {unlockButton(firstItem)}
                        </div>
                      ) : "-"}
                    </td>

                    {/* First Item Quoted Rate */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <EditableText
                          value={formatIndianNumber(firstItem.quotedRate)}
                          disabled={isFrozen}
                          readOnly={firstItem.validation === "Yes"}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onPaste={(e) => handleBulkFieldPaste(enquiry, "quotedRate", e, 0)}
                          onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, firstItem.quotedRate)) {
                              handleItemFieldChange(firstItem.id, "quotedRate", next);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item CR Rate (Contract Review Rate — read-only) */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      <span className="block text-[11px] text-violet-700 dark:text-violet-300 p-1 font-medium text-right">
                        {formatIndianNumber(firstItem?.contractReviewRate) || "-"}
                      </span>
                    </td>

                    {/* First Item PD Cost Validation (read-only) */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      <span className="block text-[11px] text-blue-700 dark:text-blue-300 p-1 font-medium text-right">
                        {firstItem ? getPdCostValidation(firstItem) || "-" : "-"}
                      </span>
                    </td>

                    {/* First Item QR incl. GST */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <span className="block text-[11px] text-foreground p-1 font-medium text-right">
                          {formatIndianNumber(firstItem.quotedRateGst) || "-"}
                        </span>
                      ) : "-"}
                    </td>

                    {/* First Item Item Name Merge */}
                    <td className="py-1.5 px-3 border-r border-b border-border last:border-r-0 text-[11px] text-muted-foreground font-medium truncate">
                      {firstItem ? getItemNameMerge(firstItem) || "-" : "-"}
                    </td>

                    {/* First Item Total Value */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <EditableText
                          value={formatIndianNumber(firstItem.totalValue)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, firstItem.totalValue)) {
                              handleItemFieldChange(firstItem.id, "totalValue", next);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* First Item Itemwise Total Value */}
                    <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                      {firstItem ? (
                        <EditableText
                          value={formatIndianNumber(firstItem.itemWiseTotalValue)}
                          disabled={isFrozen}
                          title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                          onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, firstItem.itemWiseTotalValue)) {
                              handleItemFieldChange(firstItem.id, "itemWiseTotalValue", next);
                            }
                          }}
                          className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      ) : "-"}
                    </td>

                    {/* Validation */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => confirmValidation(firstItem, firstItem.validation === "Yes" ? "" : "Yes")}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                              firstItem.validation === "Yes"
                                ? "bg-emerald-500 dark:bg-emerald-500/80 text-white "
                                : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20"
                            }`}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => confirmValidation(firstItem, firstItem.validation === "No" ? "" : "No")}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                              firstItem.validation === "No"
                                ? "bg-rose-500 dark:bg-rose-500/80 text-white "
                                : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:bg-rose-500/20"
                            }`}
                          >
                            No
                          </button>
                          {historyButton(firstItem)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>

                    {/* Delivery Schedule */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      {firstItem ? (
                        <CellSelect
                          placeholder="-"
                          value={firstItem.deliverySchedule || ""}
                          options={dropdownOptions.deliverySchedules.filter((opt) => opt !== "-")}
                          searchPlaceholder="Search delivery schedule..."
                          onChange={(v) => handleItemFieldChange(firstItem.id, "deliverySchedule", v)}
                        />
                      ) : "-"}
                    </td>

                    {/* APM - beside Offer PDF (enquiry-based) — admin/developer only */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          disabled={!canEditApm}
                          title={canEditApm ? "Set APM Yes" : "Admin only — please login"}
                          onClick={() => canEditApm && handleEnquiryFieldChange(enquiry.id, "apm", (enquiry as any).apm === "Yes" ? "" : "Yes")}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${!canEditApm ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${
                            (enquiry as any).apm === "Yes"
                              ? "bg-emerald-500 dark:bg-emerald-500/80 text-white "
                              : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20"
                          }`}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          disabled={!canEditApm}
                          title={canEditApm ? "Set APM No" : "Admin only — please login"}
                          onClick={() => canEditApm && handleEnquiryFieldChange(enquiry.id, "apm", (enquiry as any).apm === "No" ? "" : "No")}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${!canEditApm ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${
                            (enquiry as any).apm === "No"
                              ? "bg-rose-500 dark:bg-rose-500/80 text-white "
                              : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:bg-rose-500/20"
                          }`}
                        >
                          No
                        </button>
                      </div>
                      {!canEditApm && <div className="text-[9px] text-center text-muted-foreground mt-1">ðŸ”’ admin only</div>}
                    </td>

                    {/* Offer PDF */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      <OfferPdfCell enquiry={enquiry} items={itemsByEnquiry.get(enquiry.id) ?? EMPTY_ITEMS} />
                    </td>

                    {/* Send Email */}
                    <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                      <SendEmailCell enquiry={enquiry} />
                    </td>

                    {/* Actions */}
                    <td style={{ right: 0 }} className="sticky z-20 bg-background [tr:hover>&]:bg-muted shadow-[inset_1px_0_0_var(--border),inset_0_-1px_0_var(--border)] py-1.5 px-4 text-right border-b border-border">
                      {firstItem && (
                        <ActionsDropdown
                          item={firstItem}
                          enquiry={enquiry}
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
                        title={invalidVaItemIds.has(item.id) ? "Red row = VA% below minimum, or rate above CR rate" : undefined} className={`transition-colors ${invalidVaItemIds.has(item.id) ? "bg-red-100 dark:bg-red-500/15" : "bg-muted/10 hover:bg-muted/20"}`}
                      >
                        {/* Empty selection cell — selection is per docket */}
                        <td className="py-1.5 px-2 text-center border-r border-b border-border"></td>
                        <td style={{ left: frozenLeft[0] }} className={`${FROZEN_TD} py-1.5 px-4 border-r border-b border-border last:border-r-0`}></td>
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Additional Item Name */}
                        <td style={{ left: frozenLeft[8] }} className={`${FROZEN_TD} py-1 px-2 text-[11px] text-muted-foreground font-medium border-r border-b border-border last:border-r-0 align-top`}>
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
                              className="w-full bg-background border border-blue-500 text-[11px] text-foreground outline-none p-1 rounded font-medium"
                            />
                          ) : (
                            <div className="flex items-center justify-between w-full group truncate">
                              <div title={item.itemName} className="w-full pr-1 wrap-break-word whitespace-normal leading-normal line-clamp-2">
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
                        
                        {/* Details */}
                        <td style={{ left: frozenLeft[9] }} className={`${FROZEN_TD} py-1 px-2 border-r border-b border-border last:border-r-0 align-top`}>
                          <ItemDetailFields
                            item={item}
                            dropdownOptions={dropdownOptions}
                            onChange={handleItemFieldChange}
                            isFrozen={isFrozen}
                          />
                        </td>

                        {/* Additional Item Quantity */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <EditableText
                            value={item.quantity ? Number(item.quantity).toString() : ""}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onCommit={(v) => {
                            if (v !== (item.quantity ? Number(item.quantity).toString() : "")) {
                              handleItemFieldChange(item.id, "quantity", v);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-semibold text-right disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>

                        {/* Item Code (read-only) */}
                        <ItemCodeCell item={item} />

                        {/* BOM ID (dropdown when multiple, else read-only) */}
                        <td className="py-1 px-1 border-r border-b border-border last:border-r-0">
                          {(() => {
                            const avail = (item as any).availableBomIds as string[] | undefined;
                            const hasMulti = Array.isArray(avail) && avail.length > 1;
                            if (hasMulti) {
                              const bomLabels: Record<string, string> = {};
                              for (const b of avail!) bomLabels[b] = closedBomIdSet.has(b) ? `${b} (C - Closed BOM)` : b;
                              return (
                                <CellSelect
                                  placeholder="-- select --"
                                  searchPlaceholder="Search BOM..."
                                  value={(item as any).bomId || ""}
                                  options={avail!}
                                  optionLabels={bomLabels}
                                  disabled={isFrozen}
                                  title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : (avail || []).join(", ")}
                                  onChange={(v) => {
                                    if (isFrozen) { toast.error("Rate & cost columns are frozen after one-time PDF generation — revert APM to edit."); return; }
                                    toast.promise(dispatch(selectBomId({ itemId: item.id, bomId: v || null })).unwrap(), {
                                      loading: "Saving BOM...",
                                      success: "BOM saved.",
                                      error: (err) => (typeof err === "string" ? err : err?.message || "Failed to save BOM."),
                                    });
                                  }}
                                />
                              );
                            }
                            const bomId = (item as any).bomId as string | undefined;
                            return (
                              <span className="flex items-center gap-1 min-w-0" title={bomId || ""}>
                                <span className="block text-[10px] text-muted-foreground p-1 font-mono truncate">{bomId || "-"}</span>
                                {bomId && closedBomIdSet.has(bomId) && (
                                  <span className="shrink-0 px-1 py-0.5 text-[9px] font-bold rounded border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300" title="Closed BOM (BOM MAST ERP TO_DATE - C batch)">C</span>
                                )}
                              </span>
                            );
                          })()}
                        </td>

                        {/* Product Cost */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <div className="flex items-center gap-1">
                          <CostWarningIcon warnings={item.costWarnings} />
                          <EditableText
                            value={formatIndianNumber(item.productCost)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, item.productCost)) {
                              handleItemFieldChange(item.id, "productCost", next);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          </div>
                      </td>

                      {/* Cost Ref Code */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <EditableText
                            value={item.costRefCode || ""}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onCommit={(v) => {
                            if (v !== (item.costRefCode || "")) {
                              handleItemFieldChange(item.id, "costRefCode", v);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                      </td>

                      {/* Cost */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <EditableText
                            value={formatIndianNumber(item.cost)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onPaste={(e) => handleBulkFieldPaste(enquiry, "cost", e, idx + 1)}
                            onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, item.cost)) {
                              handleItemFieldChange(item.id, "cost", next);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        {costLoadingBadge(enquiry, item)}
                        {cfChip(item)}
                      </td>

                      {/* Stock Status */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <EditableText
                            value={item.stockStatus || ""}
                            onCommit={(v) => {
                            if (v !== (item.stockStatus || "")) {
                              handleItemFieldChange(item.id, "stockStatus", v);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium"
                          />
                      </td>

                      {/* Stock Quantity */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <EditableText
                            value={item.stockQuantity || ""}
                            onCommit={(v) => {
                            if (v !== (item.stockQuantity || "")) {
                              handleItemFieldChange(item.id, "stockQuantity", v);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                          />
                      </td>

                      {/* Available Stock */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <EditableText
                            value={item.availableStock || ""}
                            onCommit={(v) => {
                            if (v !== (item.availableStock || "")) {
                              handleItemFieldChange(item.id, "availableStock", v);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                          />
                      </td>

                      {/* View Image */}
                      <ItemImageCells item={item} image={getItemImage(item)} />

                      {/* Stock Against Contract */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <EditableText
                            value={item.stockAgainstContract || ""}
                            onCommit={(v) => {
                            if (v !== (item.stockAgainstContract || "")) {
                              handleItemFieldChange(item.id, "stockAgainstContract", v);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right"
                          />
                      </td>

                      {/* Discount */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <EditableText
                            value={item.discount !== null && item.discount !== undefined ? Number(item.discount).toString() : ""}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onCommit={(v) => {
                            if (v !== (item.discount !== null && item.discount !== undefined ? Number(item.discount).toString() : "")) {
                              handleItemFieldChange(item.id, "discount", v);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                      </td>

                      {/* VA% */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 font-semibold ${isFrozen ? "bg-muted" : ""}`}>
                          <div className="flex items-center gap-1">
                          <EditableText
                            value={item.vaPercent !== null ? `${item.vaPercent}%` : ""}
                            disabled={isFrozen}
                            readOnly={item.validation === "Yes"}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onPaste={(e) => handleBulkFieldPaste(enquiry, "vaPercent", e, idx + 1)}
                            onCommit={(v) => {
                            const val = v.trim();
                            if (val !== (item.vaPercent !== null ? `${item.vaPercent}%` : "")) {
                              handleItemFieldChange(item.id, "vaPercent", val);
                            }
                            }}
                            className={`w-full bg-transparent border-none text-[11px] ${(item.vaPercent ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-foreground"} outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                          {unlockButton(item)}
                          </div>
                      </td>

                      {/* Quoted Rate */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <EditableText
                            value={formatIndianNumber(item.quotedRate)}
                            disabled={isFrozen}
                            readOnly={item.validation === "Yes"}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onPaste={(e) => handleBulkFieldPaste(enquiry, "quotedRate", e, idx + 1)}
                            onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, item.quotedRate)) {
                              handleItemFieldChange(item.id, "quotedRate", next);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                      </td>

                      {/* CR Rate (Contract Review Rate — read-only) */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-[11px] text-violet-700 dark:text-violet-300 p-1 font-medium text-right">
                            {formatIndianNumber(item.contractReviewRate) || "-"}
                          </span>
                        </td>

                      {/* PD Cost Validation (read-only) */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-[11px] text-blue-700 dark:text-blue-300 p-1 font-medium text-right">
                            {getPdCostValidation(item) || "-"}
                          </span>
                        </td>

                      {/* QR incl. GST */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <span className="block text-[11px] text-foreground p-1 font-medium text-right">
                            {formatIndianNumber(item.quotedRateGst) || "-"}
                          </span>
                        </td>

                        {/* Item Name Merge */}
                        <td className="py-1.5 px-3 border-r border-b border-border last:border-r-0 text-[11px] text-muted-foreground font-medium truncate">
                          {getItemNameMerge(item) || "-"}
                        </td>

                        {/* Total Value */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <EditableText
                            value={formatIndianNumber(item.totalValue)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, item.totalValue)) {
                              handleItemFieldChange(item.id, "totalValue", next);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                      </td>

                      {/* Itemwise Total Value */}
                        <td className={`py-1 px-2 border-r border-b border-border last:border-r-0 ${isFrozen ? "bg-muted" : ""}`}>
                          <EditableText
                            value={formatIndianNumber(item.itemWiseTotalValue)}
                            disabled={isFrozen}
                            title={isFrozen ? "Frozen after one-time PDF — revert APM to edit" : undefined}
                            onCommit={(v) => {
                            const next = cleanNumberInput(v);
                            if (hasNumberChanged(next, item.itemWiseTotalValue)) {
                              handleItemFieldChange(item.id, "itemWiseTotalValue", next);
                            }
                            }}
                            className="w-full bg-transparent border-none text-[11px] text-foreground outline-none p-1 focus:bg-accent focus:ring-1 focus:ring-blue-500 rounded hover:bg-muted/80 transition-colors font-medium text-right disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                      </td>

                      {/* Validation */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => confirmValidation(item, item.validation === "Yes" ? "" : "Yes")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                                item.validation === "Yes"
                                  ? "bg-emerald-500 dark:bg-emerald-500/80 text-white "
                                  : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20"
                              }`}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => confirmValidation(item, item.validation === "No" ? "" : "No")}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                                item.validation === "No"
                                  ? "bg-rose-500 dark:bg-rose-500/80 text-white "
                                  : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:bg-rose-500/20"
                              }`}
                            >
                              No
                            </button>
                            {historyButton(item)}
                          </div>
                        </td>

                        {/* Delivery Schedule */}
                        <td className="py-1 px-2 border-r border-b border-border last:border-r-0">
                          <CellSelect
                            placeholder="-"
                            value={item.deliverySchedule || ""}
                            options={dropdownOptions.deliverySchedules.filter((opt) => opt !== "-")}
                            searchPlaceholder="Search delivery schedule..."
                            onChange={(v) => handleItemFieldChange(item.id, "deliverySchedule", v)}
                          />
                        </td>

                      {/* Empty APM column - enquiry-based, only parent row has controls */}
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>

                      {/* Empty Offer PDF column */}
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>

                      {/* Empty Send Email column */}
                        <td className="py-1.5 px-4 border-r border-b border-border last:border-r-0"></td>

                        {/* Actions on this item */}
                        <td style={{ right: 0 }} className="sticky z-20 bg-background [tr:hover>&]:bg-muted shadow-[inset_1px_0_0_var(--border),inset_0_-1px_0_var(--border)] py-1.5 px-4 text-right border-b border-border">
                          <ActionsDropdown
                            item={item}
                            enquiry={enquiry}
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

    {pageTotal > 0 && (
      <div className="shrink-0 border-t border-border bg-card">
        <Pagination
          currentPage={currentPage}
          totalCount={pageTotal}
          pageSize={pageSize}
          onPageChange={(page) => dispatch(setPage(page))}
          onPageSizeChange={(size) => {
            dispatch(setPageSize(size));
            dispatch(setPage(1));
          }}
        />
      </div>
    )}

    <AutoFillReviewDialog
      changes={autoFillChanges}
      applying={autoFillApplying}
      onApply={handleApplyAutoFill}
      onClose={() => setAutoFillChanges(null)}
    />

    <Dialog open={history !== null} onOpenChange={(open) => { if (!open) setHistory(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">History: {history?.itemName}</DialogTitle>
        </DialogHeader>
        {history?.rows.length ? (
          <ul className="max-h-80 overflow-y-auto divide-y divide-border text-xs">
            {history.rows.map((r) => (
              <li key={r.id} className="py-1.5">
                <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()} · {r.changedBy}</span>
                <div>
                  <b>{r.field}</b>: {r.oldValue ?? "blank"} → {r.newValue ?? "blank"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No recorded changes yet.</p>
        )}
      </DialogContent>
    </Dialog>

    {/* Promise settles once, so Confirm's trailing onOpenChange(false) is a no-op. */}
    <ConfirmDialog
      open={confirmState !== null}
      onOpenChange={(open) => { if (!open) { confirmState?.resolve(false); setConfirmState(null); } }}
      title="Please confirm"
      description={confirmState?.msg ?? ""}
      confirmLabel="Continue"
      confirmVariant="default"
      onConfirm={() => confirmState?.resolve(true)}
    />

    {/* Clear Quoted Rate Confirm Dialog — filtered scope, VA% preserved */}
    <Dialog open={clearQrConfirmOpen} onOpenChange={(v) => { if (!v && !clearQrRunning) { setClearQrConfirmOpen(false); setClearQrPending(null); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Confirm Clear Quoted Rates
          </DialogTitle>
        </DialogHeader>
        <div className="py-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Clear quoted rates from <span className="font-bold text-foreground">{clearQrPending?.total ?? 0}</span> filtered item(s) across all pages?
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded p-2">
            This will delete <span className="font-semibold">Quotation Rate, QR incl. GST, Total Value</span> and <span className="font-semibold">Itemwise Total</span> from the database for filtered items only. <span className="font-semibold">VA% will be kept</span>. Items frozen after one-time PDF generation are skipped. This cannot be undone without re-entering rates.
          </p>
        </div>
        <DialogFooter className="pt-2 border-t border-border flex justify-end gap-2">
          <DialogClose render={<Button type="button" variant="outline" size="sm" disabled={clearQrRunning} />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={clearQrRunning || !clearQrPending}
            onClick={handleClearQrConfirm}
          >
            {clearQrRunning ? "Clearing..." : "Clear quoted rates"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <DocketEditDrawer
      enquiry={paginatedEnquiries.find((e) => e.id === editingDocketId) ?? null}
      dropdownOptions={dropdownOptions}
      docketNumbers={docketNumbers}
      deleting={deletingEnquiryId !== null}
      onSave={handleDrawerSave}
      onClose={() => setEditingDocketId(null)}
      onDeleteDuplicate={async (e) => {
        await handleDeleteDuplicate(e);
        setEditingDocketId(null);
      }}
    />  </div>
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

function OfferPdfCell({ enquiry, items }: { enquiry: EnquiryData; items: EnquiryItemData[] }) {
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const apm = (enquiry as any).apm as string | null | undefined;
  const generatedAt = (enquiry as any).offerPdfGeneratedAt as string | Date | null | undefined;
  const access = oneClickAccess(apm ?? null, generatedAt ?? null);
  const dispatch = useAppDispatch();

  const handleGenerate = async () => {
    setStatus("generating");
    try {
      // The row may hold only its first item; the offer needs all of them.
      const all = enquiry.itemsLoaded ? items : await dispatch(loadEnquiryItems({ enquiryIds: [enquiry.id] })).unwrap();
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
        items: all.map((item: EnquiryItemData) => ({
          itemName: item.itemName,
          partyItemName: item.itemNameMerge || "",
          quantity: item.quantity ? Number(item.quantity) : 0,
          quotationRate: item.quotedRate ? parseFloat(item.quotedRate) : 0,
          quotedRateGst: item.quotedRateGst ? parseFloat(item.quotedRateGst) : 0,
          totalValue: item.totalValue ? parseFloat(item.totalValue) : 0,
          unit: "Nos.",
          deliverySchedule: item.deliverySchedule || "2-3 weeks",
        })),
        totalItemwiseValue: all.reduce((sum: number, item: EnquiryItemData) => {
          const qty = item.quantity ? Number(item.quantity) : 0;
          const rate = item.quotedRate ? parseFloat(item.quotedRate) : 0;
          return sum + qty * rate;
        }, 0),
      };

      const res = await generateOfferPdfAction(rowData, enquiry.id);
      if (res.success && res.pdfBase64) {
        triggerDownload(res.pdfBase64, res.fileName);
        // After Yes one-time, reload to reflect frozen state (server updated offerPdfGeneratedAt)
        if (apm === "Yes") {
          // optimistic: page reload enquiries after short delay to show frozen badge
          setTimeout(() => window.location.reload(), 800);
        }
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

  // Frozen/disabled states before idle render
  if (!access.allowed) {
    const isFrozen = apm === "Yes" && !!generatedAt;
    const isNo = apm === "No";
    return (
      <div className="flex flex-col items-center gap-1 py-1" title={access.reason || ""}>
        <span className={`text-[9px] font-bold px-2 py-1 rounded border ${isFrozen ? "bg-muted text-muted-foreground border-border" : "bg-rose-50 text-rose-700 border-rose-200 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"}`}>
          {isFrozen ? "Frozen" : isNo ? "Disabled (APM No)" : access.reason}
        </span>
        {isFrozen && generatedAt && <span className="text-[8px] text-muted-foreground">{new Date(generatedAt as any).toLocaleString()}</span>}
        {isNo && <span className="text-[8px] text-muted-foreground">APM=No blocks offer</span>}
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <button
          type="button"
          onClick={async () => { await handleGenerate(); // refresh enquiry so frozen state shows without reload
            try { const { updateEnquiryField } = await import("@/lib/enquiriesSlice"); // trigger refetch via page refresh not ideal; optimistic: reload enquiries
            } catch {} }}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#0f62fe] border border-blue-200 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:border-blue-500/25 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 rounded cursor-pointer transition-all whitespace-nowrap"
        >
          <FileText className="h-3.5 w-3.5 stroke-[2.5]" />
          Generate PDF
        </button>
        {apm === "Yes" && !generatedAt && <span className="text-[8px] text-amber-600 dark:text-amber-300 font-medium">One-time only</span>}
        {(!apm || apm === "") && <span className="text-[8px] text-muted-foreground">Unlimited (APM empty)</span>}
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
        <span className="text-[9px] text-red-500 dark:text-red-300 font-medium truncate max-w-[100px]" title={errorMessage}>{errorMessage}</span>
        <button
          type="button"
          onClick={handleGenerate}
          className="text-[9px] text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return null;
}

/**
 * Per-docket email send control.
 *
 * Tick (✓) approves the docket; the Send button stays frozen until then. Cross
 * (✗) clears the approval and the sent marker, allowing a resend. Sending is
 * done server-side through the n8n Gmail webhook (see sendDocketEmail).
 */
function SendEmailCell({ enquiry }: { enquiry: EnquiryData }) {
  const dispatch = useAppDispatch();
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noThreadOpen, setNoThreadOpen] = useState(false);
  // A rate changed after the last send: default the next mail to "Revised".
  const [revised, setRevised] = useState(!!enquiry.offerRevised);
  useEffect(() => { if (enquiry.offerRevised) setRevised(true); }, [enquiry.offerRevised]);

  const approved = !!enquiry.emailApproved;
  const sentBy = enquiry.emailSentBy ?? null;
  const sent = !!sentBy;
  const to = (enquiry.senderEmail || "").trim();
  const cc = (enquiry.emailAddress || "").trim();
  const canSend = approved && !sent && to !== "" && !sending;

  const handleApprove = async () => {
    setBusy(true);
    try {
      await dispatch(updateEnquiryField({ enquiryId: enquiry.id, field: "emailApproved", value: true })).unwrap();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to approve");
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      await dispatch(updateEnquiryField({ enquiryId: enquiry.id, field: "emailApproved", value: false })).unwrap();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to reset");
    } finally {
      setBusy(false);
    }
  };

  const doSend = async (allowNoThread: boolean) => {
    setSending(true);
    const toastId = toast.loading("Sending email...");
    try {
      await dispatch(sendDocketEmail({ enquiryId: enquiry.id, allowNoThread, revised })).unwrap();
      toast.success("Email sent.", { id: toastId });
      setNoThreadOpen(false);
      setRevised(false);
    } catch (e) {
      // No linked thread: let the user decide to send it as a new mail instead.
      if (e && typeof e === "object" && (e as { code?: string }).code === "NO_THREAD") {
        toast.dismiss(toastId);
        setNoThreadOpen(true);
        return;
      }
      const msg =
        e && typeof e === "object" && "error" in e
          ? String((e as { error?: unknown }).error)
          : e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Failed to send email";
      toast.error(msg, { id: toastId });
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    void doSend(false);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-1" title={`Sent${sentBy ? ` by ${sentBy}` : ""}`}>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Check className="h-3 w-3 stroke-[3]" /> Sent
        </span>
        {enquiry.offerRevised && (
          <span
            className="px-2 py-0.5 text-[9px] font-bold rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            title="A quoted rate changed after this offer was sent. Reset, then send it again as Revised."
          >
            Revised: re-send
          </span>
        )}
        <button
          type="button"
          onClick={handleReset}
          disabled={busy}
          className="text-[9px] text-muted-foreground hover:text-foreground hover:underline cursor-pointer disabled:opacity-50"
          title="Reset to allow resending"
        >
          Reset
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-1 py-1">
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={handleApprove}
          disabled={approved || busy}
          title={approved ? "Approved — Send unlocked" : "Approve this docket (unlocks Send)"}
          aria-pressed={approved}
          className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
            approved
              ? "border-emerald-500 bg-emerald-500 text-white cursor-default dark:bg-emerald-500/80"
              : "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 cursor-pointer"
          } ${busy ? "opacity-60" : ""}`}
        >
          <Check className="h-3 w-3 stroke-[3]" />
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={!approved || busy}
          title={approved ? "Reject approval (re-freezes Send)" : "Not approved"}
          aria-pressed={false}
          className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
            approved
              ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20 cursor-pointer"
              : "border-border bg-muted text-muted-foreground/60 cursor-not-allowed"
          } ${busy ? "opacity-60" : ""}`}
        >
          <X className="h-3 w-3 stroke-[3]" />
        </button>
      </div>
      <label className="flex items-center gap-1 text-[9px] text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={revised}
          onChange={(e) => setRevised(e.target.checked)}
          disabled={sending}
          className="h-3 w-3"
        />
        Revised
      </label>
      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        title={
          !approved
            ? "Frozen — approve (tick) first"
            : !to
              ? "No recipient (sender email) on this docket"
              : `Send to ${to}${cc ? ` · cc ${cc}` : ""}`
        }
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded border transition-colors whitespace-nowrap ${
          canSend
            ? "text-[#0f62fe] border-blue-200 bg-blue-50 hover:bg-blue-100 dark:text-blue-300 dark:border-blue-500/25 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 cursor-pointer"
            : "text-muted-foreground border-border bg-muted cursor-not-allowed"
        }`}
      >
        {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
        {sending ? "Sending" : "Send"}
      </button>

      <Dialog
        open={noThreadOpen}
        onOpenChange={(v) => {
          if (!v && !sending) setNoThreadOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              No linked email thread
            </DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            This docket isn&apos;t linked to a Gmail thread, so the quotation
            can&apos;t be sent as a reply. Send it as a new email instead?
          </p>
          <DialogFooter className="pt-2 border-t border-border flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="outline" size="sm" disabled={sending} />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              size="sm"
              disabled={sending}
              onClick={() => void doSend(true)}
            >
              {sending ? "Sending..." : "Send as new mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
