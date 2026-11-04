"use client";

/** One filter bar for the docket-level filters that used to sit in the table header, plus the saved column views. */

import { Columns3 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@gmd/ui/components/popover";
import MultiSelectFilter from "./MultiSelectFilter";
import DebouncedSearchInput from "./DebouncedSearchInput";
import { ColumnVisibility } from "@/components/pbg/column-visibility";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { setFilter } from "@/lib/filtersSlice";
import { ALL_COLUMN_KEYS, COLUMN_VIEWS, ENQUIRY_COLUMNS, matchingView, type ColumnViewId } from "@/lib/enquiryColumns";
import type { DropdownOptions, FiltersState } from "@/lib/types";

const BOX = "h-7 rounded border border-border bg-background text-foreground text-[10px]";

export default function EnquiryFilterBar({
  dropdownOptions,
  cascadedOptions,
  requestFacet,
  contractOptions,
  pendingOnly,
  onTogglePending,
  hasActiveFilters,
  onClearAll,
  visibleColumns,
  onColumnsChange,
  showColumns = true,
}: {
  dropdownOptions: DropdownOptions;
  cascadedOptions: Record<string, string[]>;
  requestFacet: (field: string) => void;
  contractOptions: string[];
  pendingOnly: boolean;
  onTogglePending: () => void;
  hasActiveFilters: boolean;
  onClearAll: () => void;
  visibleColumns: string[];
  onColumnsChange: (keys: string[]) => void;
  showColumns?: boolean;
}) {
  const dispatch = useAppDispatch();
  const filters = useAppSelector((s) => s.filters);
  const activeView = matchingView(visibleColumns);

  const multi = (label: string, field: keyof FiltersState, options: string[], opts?: { noBlank?: boolean; contract?: boolean }) => (
    <div className="w-32 shrink-0" key={field}>
      <MultiSelectFilter
        label={label}
        allLabel={label}
        renderButtonLabel={(sel) => (sel.length === 0 ? label : `${label} (${sel.length})`)}
        options={options}
        cascadedOptions={cascadedOptions[field as string] ?? []}
        onOpen={() => requestFacet(field as string)}
        selected={(filters[field] as string[]) ?? []}
        onChange={(v) => dispatch(setFilter({ field, value: v }))}
        includeBlank={!opts?.noBlank}
        includeAvailable={opts?.contract}
        className={`${BOX} px-1.5 ${(filters[field] as string[] | undefined)?.length ? "border-blue-500 bg-blue-50/80 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300 font-semibold" : ""}`}
      />
    </div>
  );
  const text = (field: keyof FiltersState, placeholder: string, width = "w-28") => (
    <FilterText key={field} field={field} placeholder={placeholder} className={`${BOX} ${width} px-1.5 shrink-0`} />
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border bg-background">
      {text("docketNumber", "Docket no...")}
      {multi("Party", "partyNames", dropdownOptions.partyNames, { noBlank: true })}
      {multi("Contract", "contractNo" as keyof FiltersState, contractOptions, { contract: true })}
      {multi("Type", "enquiryType", dropdownOptions.enquiryTypes)}
      {multi("State", "state", dropdownOptions.states)}
      {multi("Utility", "utility", dropdownOptions.utilities)}
      {multi("Payment", "paymentTerms", dropdownOptions.paymentTerms)}
      {multi("PBG", "pbg", dropdownOptions.pbgs)}
      {multi("Inspection", "inspection", dropdownOptions.inspections)}
      {multi("Status", "orderStatus", dropdownOptions.orderStatuses)}
      {multi("Closure", "closureStatus", dropdownOptions.closureStatuses)}
      {multi("Duplicate", "duplicate", ["Yes", "No"])}
      {text("emailAddress", "Email...")}
      {text("contactNo", "Phone...", "w-24")}
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
        <FilterText field="enquiryDateFrom" type="date" className={`${BOX} w-28 px-1`} />
        to
        <FilterText field="enquiryDateTo" type="date" className={`${BOX} w-28 px-1`} />
      </span>
      <button
        type="button"
        onClick={onTogglePending}
        title="Show only pending dockets (auto-created, with or without items)"
        className={`h-7 shrink-0 rounded border px-2 text-[10px] font-semibold cursor-pointer ${
          pendingOnly
            ? "bg-amber-500 text-white border-amber-500"
            : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25"
        }`}
      >
        {pendingOnly ? "Pending only ✓" : "Pending only"}
      </button>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearAll}
          className="h-7 shrink-0 rounded border border-rose-200 bg-rose-50 px-2 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300 cursor-pointer"
        >
          Clear all
        </button>
      )}

      {showColumns && <div className="ml-auto flex items-center gap-1 shrink-0">
        {(Object.keys(COLUMN_VIEWS) as ColumnViewId[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeView === id}
            onClick={() => onColumnsChange([...COLUMN_VIEWS[id].columns])}
            className={`h-7 rounded border px-2 text-[10px] font-semibold cursor-pointer ${
              activeView === id
                ? "border-[#0f62fe] bg-[#0f62fe] text-white dark:border-blue-500/80 dark:bg-blue-500/80"
                : "border-border bg-background text-foreground hover:bg-accent"
            }`}
          >
            {COLUMN_VIEWS[id].label}
          </button>
        ))}
        <Popover>
          <PopoverTrigger
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[10px] font-semibold hover:bg-accent cursor-pointer"
          >
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto rounded border border-border bg-popover p-0 shadow-lg">
            <ColumnVisibility
              visible={visibleColumns}
              onChange={onColumnsChange}
              defs={ENQUIRY_COLUMNS}
              defaults={ALL_COLUMN_KEYS}
            />
          </PopoverContent>
        </Popover>
      </div>}
    </div>
  );
}

// Owns its Redux read and debounce so a keystroke re-renders only this input.
function FilterText({ field, className, placeholder = "", type }: { field: keyof FiltersState; className?: string; placeholder?: string; type?: string }) {
  const dispatch = useAppDispatch();
  const value = useAppSelector((s) => (s.filters[field] as string) || "");
  return (
    <DebouncedSearchInput
      value={value}
      onCommit={(val: string) => dispatch(setFilter({ field, value: val }))}
      placeholder={placeholder}
      className={className}
      type={type}
    />
  );
}
