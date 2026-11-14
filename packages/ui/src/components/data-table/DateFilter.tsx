"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { Button } from "../button";
import { Input } from "../input";
import { FilterIcon, filterIconClass } from "./FacetFilter";
import type { DateRange } from "./types";

interface DateFilterProps {
  label: string;
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}

const EMPTY: DateRange = { from: "", to: "" };

/** Header filter for date columns: a start and an end date (either may be blank), applied as typed. */
export function DateFilter({ label, value = EMPTY, onChange }: DateFilterProps) {
  const [open, setOpen] = useState(false);
  const active = Boolean(value.from || value.to);
  const set = (patch: Partial<DateRange>) => {
    const next = { ...value, ...patch };
    onChange(next.from || next.to ? next : undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Filter ${label} by date`}
        title={`Filter ${label} by date`}
        className={filterIconClass(active)}
      >
        <FilterIcon active={active} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-60 gap-2 p-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs font-medium">{label}</span>
          {active && (
            <Button variant="ghost" size="xs" onClick={() => onChange(undefined)}>
              Clear
            </Button>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-8">From</span>
          <Input type="date" autoFocus value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} className="h-7 text-xs" />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-8">To</span>
          <Input type="date" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} className="h-7 text-xs" />
        </label>
      </PopoverContent>
    </Popover>
  );
}
