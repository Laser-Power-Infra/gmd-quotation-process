"use client";

import { cn } from "../lib/utils";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Exclusive choice between a few short options; the selected segment is filled with the primary colour. */
export function Segmented<T extends string | number>({ options, value, onChange, label, disabled, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled} className={cn("inline-flex rounded-lg border border-border bg-muted/40 p-0.5", disabled && "pointer-events-none opacity-50", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 min-w-9 rounded-md px-2.5 text-xs font-medium tabular-nums transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95 motion-reduce:transition-none",
            o.value === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
