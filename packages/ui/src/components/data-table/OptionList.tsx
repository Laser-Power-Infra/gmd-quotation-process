"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { Skeleton } from "../skeleton";
import { cn } from "../../lib/utils";
import { BLANK } from "./types";

interface OptionListProps {
  /** null while loading. */
  options: readonly string[] | null;
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
  /** Single choice: no checkboxes, highlighted row instead. */
  single?: boolean;
  /** Values outside `options` the caller still wants listed (e.g. the current cell value). */
  extra?: readonly string[];
  emptyText?: string;
  /** Enter in the narrow box with text in it (and no single exact option) submits that text. */
  onSubmit?: (query: string) => void;
  /** Mirrors the narrow box so the caller can offer the text as a row filter. */
  onQueryChange?: (query: string) => void;
}

/** Searchable option list shared by facet filters (multi) and select editors (single). Arrow keys move, Enter picks. */
export function OptionList({ options, selected, onToggle, single, extra = [], emptyText = "No matches", onSubmit, onQueryChange }: OptionListProps) {
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const base = options ?? [];
    const all = extra.filter((v) => v && !base.includes(v)).concat(base);
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((v) => v.toLowerCase().includes(needle)) : all;
  }, [options, extra, q]);

  const move = (e: KeyboardEvent, from: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-option]");
    if (!items?.length) return;
    const next = e.key === "ArrowDown" ? Math.min(from + 1, items.length - 1) : from - 1;
    if (next < 0) (listRef.current?.previousElementSibling as HTMLInputElement | null)?.focus();
    else items[next].focus();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onQueryChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") move(e, -1);
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (shown.length === 1 && shown[0].toLowerCase() === q.trim().toLowerCase()) onToggle(shown[0]);
          else if (q.trim() && onSubmit) onSubmit(q.trim());
          else if (shown.length === 1) onToggle(shown[0]);
        }}
        placeholder="Type to narrow"
        aria-label="Narrow options"
        className="h-7 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30"
      />
      <div ref={listRef} role="listbox" aria-multiselectable={!single} className="max-h-64 overflow-y-auto overscroll-contain -mx-1">
        {options === null ? (
          <div className="flex flex-col gap-1.5 px-1 py-1">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          shown.map((v, i) => {
            const on = selected.has(v);
            return (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={on}
                data-option
                onClick={() => onToggle(v)}
                onKeyDown={(e) => move(e, i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-100 outline-none hover:bg-muted focus-visible:bg-muted active:bg-muted/70 motion-reduce:transition-none",
                  single && on && "bg-primary/10 text-primary",
                )}
              >
                {!single && (
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-100",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
                    )}
                  >
                    {on && <Check size={10} strokeWidth={3} />}
                  </span>
                )}
                <span className={cn("truncate", v === BLANK && "italic text-muted-foreground")}>{v === BLANK ? "Blank" : v}</span>
                {single && on && <Check size={12} className="ml-auto shrink-0" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
