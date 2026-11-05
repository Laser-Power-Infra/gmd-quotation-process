"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { cn } from "../../lib/utils";
import { OptionList } from "./OptionList";

interface OptionPickerProps extends Omit<ComponentProps<typeof PopoverTrigger>, "value" | "onChange" | "children"> {
  value: string;
  /** null while loading. */
  options: readonly string[] | null;
  onChange: (value: string) => void;
  /** Controlled open state (the cell editor drives it); uncontrolled otherwise. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  /** Picking the current value again, or the × on the trigger, clears it. */
  clearable?: boolean;
  /** Custom trigger content; the default is a select-style field. */
  children?: ReactNode;
  emptyText?: string;
}

/** The one dropdown: a trigger and the shared searchable OptionList (single choice). */
export function OptionPicker({
  value,
  options,
  onChange,
  open,
  onOpenChange,
  placeholder = "Select",
  clearable,
  children,
  emptyText,
  className,
  ...trigger
}: OptionPickerProps) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const pick = (v: string) => {
    onChange(clearable && v === value ? "" : v);
    setOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
        {...trigger}
        className={cn(
          children
            ? ""
            : "flex h-8 w-full items-center gap-1.5 rounded-lg border border-input bg-transparent py-1 pr-2 pl-2.5 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/60 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        {children ?? (
          <>
            <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
            {clearable && value ? (
              <span
                role="button"
                aria-label="Clear"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={12} />
              </span>
            ) : (
              <ChevronDown size={14} className="pointer-events-none shrink-0 text-muted-foreground" />
            )}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-(--anchor-width) min-w-64 gap-2 p-2">
        <OptionList single options={options} selected={new Set(value ? [value] : [])} extra={value ? [value] : []} onToggle={pick} emptyText={emptyText} />
      </PopoverContent>
    </Popover>
  );
}
