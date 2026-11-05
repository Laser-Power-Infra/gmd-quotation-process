"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { cn } from "../../lib/utils";
import { OptionPicker } from "./OptionPicker";
import type { EditMode } from "./types";

interface EditableCellProps {
  value: string;
  display: string;
  mode: EditMode;
  options?: readonly string[];
  /** Per-row options, fetched when the editor opens (overrides `options`). */
  loadOptions?: () => Promise<readonly string[]>;
  /** Resolve false to reject: the cell snaps back. */
  onSave: (value: string) => Promise<boolean>;
  align?: "left" | "right";
  /** Fill-once cell that is still blank: shown with a dashed outline on hover. */
  fillable?: boolean;
}

/**
 * Inline editor. Double-click, Enter or F2 opens it; Enter saves, Esc cancels,
 * blur saves a changed draft. The new value shows at once and reverts if the
 * save fails.
 */
export function EditableCell({ value, display, mode, options, loadOptions, onSave, align, fillable }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState<string | null>(null);
  const [dynamic, setDynamic] = useState<readonly string[] | null>(null);
  const cellRef = useRef<HTMLButtonElement>(null);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const open = () => {
    setDraft(value);
    setEditing(true);
    if (loadOptions) {
      setDynamic(null);
      loadOptions().then(setDynamic, () => setDynamic(options ?? []));
    }
  };

  // The editor unmounts on close; focus the plain cell once it is back in the DOM.
  const refocus = () => requestAnimationFrame(() => cellRef.current?.focus());

  const close = () => {
    setEditing(false);
    refocus();
  };

  const commit = async (next: string) => {
    setEditing(false);
    if (next === value) return close();
    setPending(next);
    const ok = await onSave(next);
    setPending(null);
    if (!ok) setDraft(value);
    refocus();
  };

  const onCellKey = (e: KeyboardEvent) => {
    if (editing) return;
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      open();
    }
  };

  const shown = pending ?? display;
  const cellClass = cn(
    "flex h-full min-h-9 w-full items-center px-3 text-left outline-none transition-[box-shadow,background-color] duration-100 motion-reduce:transition-none",
    align === "right" && "justify-end tabular-nums",
    "cursor-text hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
    fillable && "hover:outline hover:outline-1 hover:-outline-offset-2 hover:outline-dashed hover:outline-primary/50",
    pending !== null && "text-muted-foreground",
  );

  // Closed select cells are plain divs: a popover per cell is what made 50-row pages slow.
  if (mode === "select" && editing) {
    return (
      <OptionPicker
        ref={cellRef}
        value={draft}
        options={loadOptions ? dynamic : (options ?? [])}
        onChange={(v) => void commit(v)}
        clearable
        open
        onOpenChange={(next) => !next && close()}
        aria-label={`Edit ${display || "blank"}`}
        className={cn(cellClass, "cursor-pointer")}
      >
        <span className="truncate">{shown}</span>
      </OptionPicker>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            skipBlur.current = true;
            void commit(draft);
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipBlur.current = true;
            setDraft(value);
            close();
          } else if (e.key === "Tab") {
            // Save, then let focus move to the next cell.
            skipBlur.current = true;
            void commit(draft);
          }
        }}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          void commit(draft);
        }}
        aria-label="Edit value"
        className={cn(
          "h-9 w-full bg-background px-3 text-sm outline-none ring-2 ring-inset ring-primary",
          align === "right" && "text-right tabular-nums",
        )}
      />
    );
  }

  return (
    <div
      ref={cellRef as unknown as RefObject<HTMLDivElement>}
      role="button"
      tabIndex={0}
      onDoubleClick={open}
      onKeyDown={onCellKey}
      aria-label={`Edit ${display || "blank"}`}
      className={cn(cellClass, mode === "select" && "cursor-pointer")}
    >
      <span className="truncate">{shown}</span>
    </div>
  );
}
