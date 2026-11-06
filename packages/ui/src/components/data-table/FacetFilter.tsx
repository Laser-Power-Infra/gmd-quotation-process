"use client";

import { TextSearch, X } from "lucide-react";
import MultiSelectFilter from "../multi-select-filter";

interface FacetFilterProps {
  label: string;
  selected: string[];
  /** null until loaded. */
  options: string[] | null;
  /** Fired when the popover opens; the caller fetches the facet. */
  onOpen: () => void;
  onChange: (values: string[]) => void;
  /** Active "contains" text for this column. */
  search?: string;
  onSearchChange?: (value: string) => void;
}

/**
 * Header filter: the shared MultiSelectFilter over the column's distinct
 * values, with typed text turned into a "contains" row filter on Enter.
 */
export function FacetFilter({ label, selected, options, onOpen, onChange, search = "", onSearchChange }: FacetFilterProps) {
  // While loading, show the current selections so they stay visible/uncheckable.
  const opts = options ?? selected;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <MultiSelectFilter
        label={label}
        allLabel="All"
        options={opts}
        cascadedOptions={opts}
        selected={selected}
        onChange={onChange}
        onOpen={onOpen}
        onSearchSubmit={onSearchChange}
        renderButtonLabel={(s, all) => (s.length ? `${s.length} Selected` : search ? "Contains…" : all)}
        className="h-6 w-auto min-w-12 max-w-24 border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 [&_svg]:text-primary-foreground/70"
      />
      {search && (
        <span className="inline-flex h-5 min-w-0 max-w-28 items-center gap-1 rounded-full bg-primary-foreground/15 pr-0.5 pl-1.5 text-[10px] font-normal normal-case text-primary-foreground">
          <TextSearch size={10} className="shrink-0" />
          <span className="truncate">“{search}”</span>
          <button
            type="button"
            aria-label="Clear text filter"
            onClick={() => onSearchChange?.("")}
            className="flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-primary-foreground/20"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </span>
      )}
    </div>
  );
}
