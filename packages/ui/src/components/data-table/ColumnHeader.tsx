"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { DateFilter } from "./DateFilter";
import { FacetFilter } from "./FacetFilter";
import type { DataColumn, DateRange, TableSort } from "./types";

interface ColumnHeaderProps<Row> {
  column: DataColumn<Row>;
  sort: TableSort | null;
  onSortChange: (sort: TableSort | null) => void;
  selected: string[];
  facetOptions: string[] | null;
  onFacetOpen: () => void;
  onFilterChange: (values: string[]) => void;
  dateRange?: DateRange;
  onDateRangeChange: (range: DateRange | undefined) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
}

/** Label with sort (none → asc → desc → none) and the facet filter trigger. */
export function ColumnHeader<Row>({ column, sort, onSortChange, selected, facetOptions, onFacetOpen, onFilterChange, dateRange, onDateRangeChange, search, onSearchChange }: ColumnHeaderProps<Row>) {
  const dir = sort?.key === column.key ? sort.dir : null;
  const cycle = () => onSortChange(dir === null ? { key: column.key, dir: "asc" } : dir === "asc" ? { key: column.key, dir: "desc" } : null);
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;

  return (
    // overflow-hidden: at the narrowest width the label truncates and nothing spills into the next column.
    <div className="flex h-full items-center gap-0.5 overflow-hidden pr-3 pl-2">
      {column.sortable ? (
        <button
          type="button"
          onClick={cycle}
          aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
          aria-label={`Sort by ${column.label}`}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left outline-none transition-colors duration-100 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary-foreground/60 active:opacity-70 motion-reduce:transition-none",
            dir ? "text-primary-foreground" : "text-primary-foreground/85",
          )}
        >
          <span className="truncate">{column.label}</span>
          <Icon
            size={12}
            className={cn("shrink-0 transition-opacity duration-100", dir ? "opacity-100" : "opacity-0 group-hover/th:opacity-60")}
          />
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate px-1 text-primary-foreground/85">{column.label}</span>
      )}
      {column.filter && column.kind === "date" && <DateFilter label={column.label} value={dateRange} onChange={onDateRangeChange} />}
      {column.filter && column.kind !== "date" && (
        <FacetFilter
          label={column.label}
          selected={selected}
          options={facetOptions}
          onOpen={onFacetOpen}
          onChange={onFilterChange}
          search={search}
          onSearchChange={onSearchChange}
        />
      )}
    </div>
  );
}
