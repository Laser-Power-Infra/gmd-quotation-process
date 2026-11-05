"use client";

import { useState } from "react";
import { ListFilter, TextSearch, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { Button } from "../button";
import { cn } from "../../lib/utils";
import { OptionList } from "./OptionList";

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
 * Header filter button; its popover lists the column's distinct values (picks
 * apply at once) and turns typed text into a "contains" row filter on Enter.
 */
export function FacetFilter({ label, selected, options, onOpen, onChange, search = "", onSearchChange }: FacetFilterProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const count = selected.length + (search ? 1 : 0);
  const active = count > 0;
  const set = new Set(selected);
  const submitSearch = (text: string) => {
    onSearchChange?.(text);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen();
      }}
    >
      <PopoverTrigger
        aria-label={`Filter ${label}`}
        className={cn(
          "relative flex size-6 shrink-0 items-center justify-center rounded-md text-primary-foreground/70 transition-[background-color,color,transform] duration-100 outline-none hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary-foreground/60 active:scale-90 motion-reduce:transition-none",
          (active || open) && "bg-primary-foreground/15 text-primary-foreground",
          !active && "opacity-0 group-hover/th:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
        )}
      >
        <ListFilter size={13} />
        {active && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary-foreground px-0.5 text-[9px] font-semibold leading-none text-primary">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 gap-2 p-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs font-medium">{label}</span>
          {active && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onChange([]);
                onSearchChange?.("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
        {search && (
          <span className="inline-flex h-6 w-fit max-w-full items-center gap-1 rounded-full border border-primary/25 bg-primary/8 pr-1 pl-2 text-xs">
            <TextSearch size={11} className="shrink-0 text-muted-foreground" />
            <span className="truncate">contains “{search}”</span>
            <button
              type="button"
              aria-label="Clear text filter"
              onClick={() => onSearchChange?.("")}
              className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/15 hover:text-foreground"
            >
              <X size={10} strokeWidth={2.5} />
            </button>
          </span>
        )}
        <OptionList
          options={options}
          selected={set}
          onToggle={(v) => onChange(set.has(v) ? selected.filter((s) => s !== v) : [...selected, v])}
          onQueryChange={setQ}
          onSubmit={onSearchChange && submitSearch}
        />
        {onSearchChange && q.trim() && (
          <Button variant="outline" size="xs" className="justify-start" onClick={() => submitSearch(q.trim())}>
            <TextSearch />
            <span className="truncate">Rows containing “{q.trim()}”</span>
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
