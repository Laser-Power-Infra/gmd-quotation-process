"use client";

import { X } from "lucide-react";
import { Button } from "../button";
import { BLANK } from "./types";

export interface FilterChip {
  key: string;
  label: string;
  value: string;
  /** A date range chip: removing it clears the whole range. */
  date?: boolean;
  /** A "contains" text chip. */
  search?: boolean;
  /** Set on a collapsed chip: every value it stands for; removing it removes them all. */
  values?: string[];
}

/** Above this many values, a column's chips fold into one "N selected" chip. */
const COLLAPSE_AT = 5;

/** One chip per column once it has more than COLLAPSE_AT plain values (e.g. after Select All). */
function collapse(chips: FilterChip[]): FilterChip[] {
  const counts = new Map<string, number>();
  for (const c of chips) if (!c.date && !c.search) counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
  const out: FilterChip[] = [];
  const folded = new Map<string, FilterChip>();
  for (const c of chips) {
    if (c.date || c.search || (counts.get(c.key) ?? 0) <= COLLAPSE_AT) {
      out.push(c);
      continue;
    }
    const group = folded.get(c.key);
    if (group) group.values!.push(c.value);
    else {
      const chip = { key: c.key, label: c.label, value: "", values: [c.value] };
      folded.set(c.key, chip);
      out.push(chip);
    }
  }
  for (const g of folded.values()) g.value = `${g.values!.length} selected`;
  return out;
}

interface FilterChipsProps {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClear: () => void;
}

/** Every active filter as a removable chip; "Clear all" once there are two or more. */
export function FilterChips({ chips: all, onRemove, onClear }: FilterChipsProps) {
  if (all.length === 0) return null;
  const chips = collapse(all);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <span
          key={`${chip.key}:${chip.value}`}
          className="inline-flex h-6 max-w-72 items-center gap-1 rounded-full border border-primary/25 bg-primary/8 pr-1 pl-2.5 text-xs text-foreground"
        >
          <span className="text-muted-foreground">{chip.label}</span>
          <span className="truncate font-medium" title={chip.values?.map((v) => (v === BLANK ? "Blank" : v)).join(", ")}>
            {chip.value === BLANK ? "Blank" : chip.value}
          </span>
          <button
            type="button"
            onClick={() => onRemove(chip)}
            aria-label={`Remove ${chip.label} ${chip.value}`}
            className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-100 hover:bg-primary/15 hover:text-foreground active:scale-90 motion-reduce:transition-none"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      {all.length > 1 && (
        <Button variant="ghost" size="xs" onClick={onClear}>
          Clear all
        </Button>
      )}
    </div>
  );
}
