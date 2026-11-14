"use client";

import { ListFilter } from "lucide-react";
import MultiSelectFilter from "../multi-select-filter";
import { cn } from "../../lib/utils";

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

/** The one header filter control: a 24px icon that stays inside the narrowest column. Lit, with a dot, while a filter is on. */
export const filterIconClass = (active: boolean) =>
  cn(
    "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-primary-foreground/55 transition-[background-color,color,transform] duration-100 outline-none hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary-foreground/60 active:scale-90 data-popup-open:bg-primary-foreground/15 data-popup-open:text-primary-foreground motion-reduce:transition-none",
    active && "bg-primary-foreground/15 text-primary-foreground",
  );

export const FilterIcon = ({ active }: { active: boolean }) => (
  <>
    <ListFilter size={14} />
    {active && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary-foreground" />}
  </>
);

/**
 * Header filter: the shared MultiSelectFilter over the column's distinct
 * values, with typed text turned into a "contains" row filter on Enter.
 * What is filtered shows in the FilterChips row above the table, not in the header.
 */
export function FacetFilter({ label, selected, options, onOpen, onChange, search = "", onSearchChange }: FacetFilterProps) {
  // While loading, show the current selections so they stay visible/uncheckable.
  const opts = options ?? selected;
  const active = selected.length > 0 || Boolean(search);
  return (
    <MultiSelectFilter
      label={label}
      allLabel="All"
      options={opts}
      cascadedOptions={opts}
      selected={selected}
      onChange={onChange}
      onOpen={onOpen}
      onSearchSubmit={onSearchChange}
      loading={options === null}
      ariaLabel={active ? `Filter ${label} (on)` : `Filter ${label}`}
      trigger={<FilterIcon active={active} />}
      className={filterIconClass(active)}
    />
  );
}
