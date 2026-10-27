"use client";

import { useMemo } from "react";
import { Button } from "@gmd/ui/components/button";
import { Label } from "@gmd/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gmd/ui/components/select";
import {
  EMPTY_DATE_PRESET,
  MONTH_OPTIONS,
  daysInMonth,
  fyOptions,
  yearOptions,
  type DatePreset,
} from "@/lib/supplyDatePreset";

interface SupplyFilterSidebarProps {
  value: DatePreset;
  onChange: (next: DatePreset) => void;
}

const labelClass = "text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";
const selectClass = "h-6 w-full text-xs";
// Base UI's Select can report null when cleared; treat that as "no value".
const orEmpty = (v: string | null) => v ?? "";

export default function SupplyFilterSidebar({ value, onChange }: SupplyFilterSidebarProps) {
  const fys = useMemo(() => fyOptions(), []);
  const years = useMemo(() => yearOptions(), []);

  const dayCount = value.year && value.month
    ? daysInMonth(Number(value.year), Number(value.month))
    : 31;
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => String(i + 1).padStart(2, "0")),
    [dayCount],
  );

  // Changing a higher level clears the lower ones so the range never mixes.
  return (
    <aside className="w-52 shrink-0 flex flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1.5">
        <Label className={labelClass}>Financial Year</Label>
        <Select value={value.fy} onValueChange={(fy) => onChange({ fy: orEmpty(fy), year: "", month: "", day: "" })}>
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Select FY" />
          </SelectTrigger>
          <SelectContent>
            {fys.map((fy) => (
              <SelectItem key={fy} value={fy}>{fy}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className={labelClass}>Year</Label>
        <Select
          value={value.year}
          onValueChange={(year) => onChange({ fy: "", year: orEmpty(year), month: "", day: "" })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Select year" />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className={labelClass}>Month</Label>
        <Select
          value={value.month}
          disabled={!value.year}
          onValueChange={(month) => onChange({ fy: "", year: value.year, month: orEmpty(month), day: "" })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Select month" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className={labelClass}>Day</Label>
        <Select
          value={value.day}
          disabled={!value.month}
          onValueChange={(day) => onChange({ fy: "", year: value.year, month: value.month, day: orEmpty(day) })}
        >
          <SelectTrigger className={selectClass}>
            <SelectValue placeholder="Select day" />
          </SelectTrigger>
          <SelectContent>
            {days.map((d) => (
              <SelectItem key={d} value={d}>{Number(d)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-6 text-xs"
        disabled={!value.fy && !value.year}
        onClick={() => onChange(EMPTY_DATE_PRESET)}
      >
        Clear date
      </Button>
    </aside>
  );
}
