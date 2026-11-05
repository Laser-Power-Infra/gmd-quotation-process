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
}

interface FilterChipsProps {
  chips: FilterChip[];
  onRemove: (chip: FilterChip) => void;
  onClear: () => void;
}

/** Every active filter as a removable chip; "Clear all" once there are two or more. */
export function FilterChips({ chips, onRemove, onClear }: FilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <span
          key={`${chip.key}:${chip.value}`}
          className="inline-flex h-6 max-w-72 items-center gap-1 rounded-full border border-primary/25 bg-primary/8 pr-1 pl-2.5 text-xs text-foreground"
        >
          <span className="text-muted-foreground">{chip.label}</span>
          <span className="truncate font-medium">{chip.value === BLANK ? "Blank" : chip.value}</span>
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
      {chips.length > 1 && (
        <Button variant="ghost" size="xs" onClick={onClear}>
          Clear all
        </Button>
      )}
    </div>
  );
}
