"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@gmd/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@gmd/ui/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@gmd/ui/components/dialog";
import { Input } from "@gmd/ui/components/input";
import { Label } from "@gmd/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@gmd/ui/components/select";
import { bomIdsOf, codesOf, isFinishedValve, matchBoms, rmCodesFor, type CodeOptions } from "../codeOptions";
import type { NewItemInput, PhysicalStockActions, PhysicalStockRow } from "../types";

// Cascading selects: each level only offers values found in rows that match
// every level picked above it. Changing a level clears the levels below.
const CASCADE = [
  ["l2_valve_type", "L2 - Valve Type"],
  ["dimension", "Dia"],
  ["l7_dimension", "L7 - PN"],
  ["l4_component", "L4 - Component"],
  ["l5_material", "L5 - Material"],
  ["l6_std", "L6 - STD"],
  ["l8_item_category", "L8 - Item Category"],
] as const;

type CascadeField = (typeof CASCADE)[number][0];

const QTY_TYPES = [
  ["received_qty", "Received"],
  ["dispatch_qty", "Dispatch"],
] as const;

type QtyField = (typeof QTY_TYPES)[number][0];

const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

interface CodeItem {
  value: string;
  label: string;
  name: string;
}

interface NewItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: PhysicalStockRow[];
  /** Synced RM / CREATE BOM codes; without any, the dialog falls back to generating a code. */
  codeOptions?: CodeOptions;
  create: NonNullable<PhysicalStockActions["create"]>;
  onCreated: () => void;
}

function NewItemForm({ rows, codeOptions, create, onCreated }: Omit<NewItemDialogProps, "open" | "onOpenChange">) {
  const [values, setValues] = useState<NewItemInput>({});
  const [qtyType, setQtyType] = useState<QtyField>("received_qty");
  const [saving, setSaving] = useState(false);
  const [bomId, setBomId] = useState("");
  // Explicit fallback: mint a code like before. On by default while no options are synced yet.
  const [generate, setGenerate] = useState(() => !codeOptions?.rm.length && !codeOptions?.bom.length);

  // Finished valve: only the RM codes inside the CREATE BOM(s) matching valve type + Dia + PN.
  // Anything else: the Raw Material codes of the picked L8 item category (all when none picked).
  const finished = isFinishedValve(values.l8_item_category);
  const matched = useMemo(
    () =>
      finished
        ? matchBoms(codeOptions?.bom ?? [], {
            valveType: values.l2_valve_type,
            size: values.dimension,
            pn: values.l7_dimension,
          })
        : [],
    [finished, codeOptions, values.l2_valve_type, values.dimension, values.l7_dimension],
  );
  const bomIds = useMemo(() => bomIdsOf(matched), [matched]);
  const activeBomId = bomIds.includes(bomId) ? bomId : "";
  // BOM codes are RM codes too, so one name lookup serves both paths.
  const names = useMemo(() => new Map((codeOptions?.rm ?? []).map((r) => [r.erpItemCode, r.itemName ?? ""])), [codeOptions]);
  const codeItems = useMemo<CodeItem[]>(
    () =>
      (finished ? codesOf(matched, activeBomId) : rmCodesFor(codeOptions?.rm ?? [], values.l8_item_category)).map((c) => ({
        value: c,
        label: c,
        name: names.get(c) ?? "",
      })),
    [finished, matched, activeBomId, codeOptions, values.l8_item_category, names],
  );
  const picked = codeItems.find((i) => i.value === values.erp_code) ?? null;

  const options = useMemo(() => {
    const out = {} as Record<CascadeField, string[]>;
    CASCADE.forEach(([field], i) => {
      const set = new Set<string>();
      for (const row of rows) {
        const matches = CASCADE.slice(0, i).every(([above]) => !values[above] || norm(row[above]) === values[above]);
        const v = norm(row[field]);
        if (matches && v) set.add(v);
      }
      out[field] = [...set].sort((a, b) => a.localeCompare(b));
    });
    return out;
  }, [rows, values]);

  const setLevel = (field: CascadeField, value: string) => {
    const i = CASCADE.findIndex(([f]) => f === field);
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      for (const [below] of CASCADE.slice(i + 1)) delete next[below];
      delete next.erp_code; // the code list depends on the levels
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // double-click guard: each submit creates a row
    const erp_code = generate ? undefined : picked?.value;
    if (!generate && !erp_code) {
      toast.error("Pick an ERP code from the list, or choose Generate a code.");
      return;
    }
    setSaving(true);
    const res = await create({ ...values, erp_code });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error || "Failed to create item.");
      return;
    }
    toast.success(
      res.data.merged
        ? `Quantity added to existing item — ERP ${res.data.erp_code}`
        : `New item created — ERP ${res.data.erp_code}`,
    );
    onCreated();
  };

  const emptyText = finished
    ? "No CREATE BOM matches this valve type / Dia / PN. Adjust the picks, or generate a code."
    : values.l8_item_category
      ? "No Raw Material code in this item category. Clear the category to see all codes, or generate a code."
      : "No code matches.";

  return (
    <form id="physical-stock-form" onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 sm:w-1/2 sm:pr-1.5">
        <Label htmlFor="ps-location">Location</Label>
        <Input
          id="ps-location"
          className="uppercase"
          placeholder="KGP"
          value={values.location ?? ""}
          onChange={(e) => setValues((prev) => ({ ...prev, location: e.target.value.toUpperCase() }))}
        />
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Classification</legend>
        {CASCADE.map(([field, label]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={`ps-${field}`} className="text-muted-foreground">
              {label}
            </Label>
            <div className="flex items-center gap-1">
              <Select value={values[field] || null} onValueChange={(v) => setLevel(field, (v as string | null) ?? "")}>
                <SelectTrigger id={`ps-${field}`} className="w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="uppercase">
                  {options[field].map((opt) => (
                    <SelectItem key={opt} value={opt} className="uppercase">
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {Boolean(values[field]) && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Clear ${label}`} onClick={() => setLevel(field, "")}>
                  <X />
                </Button>
              )}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ps-erp_code">ERP code</Label>
        {!generate && (
          <>
            <Combobox<CodeItem>
              items={codeItems}
              value={picked}
              onValueChange={(v) => setValues((prev) => ({ ...prev, erp_code: v?.value }))}
              filter={(item, q) => `${item.value} ${item.name}`.toUpperCase().includes(q.trim().toUpperCase())}
              isItemEqualToValue={(a, b) => a.value === b.value}
              autoHighlight
            >
              <ComboboxInput
                id="ps-erp_code"
                className="uppercase"
                placeholder={finished ? "Search the matching BOM" : values.l8_item_category ? `Search ${values.l8_item_category}` : "Search code or name"}
              />
              <ComboboxContent>
                <ComboboxEmpty>{emptyText}</ComboboxEmpty>
                <ComboboxList>
                  {(item: CodeItem) => (
                    <ComboboxItem key={item.value} value={item}>
                      <span className="font-mono tabular-nums">{item.value}</span>
                      <span className="truncate text-muted-foreground">{item.name}</span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {picked?.name && <p className="text-xs text-muted-foreground">{picked.name}</p>}
            {finished && bomIds.length > 1 && (
              // shortcut: no BOM-type column is stored; several CREATE BOMs can match one valve, so pick one
              // BOM or leave blank to list the codes of all of them.
              <Select value={activeBomId || null} onValueChange={(v) => setBomId((v as string | null) ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`BOM (${bomIds.length} match) - all codes shown`} />
                </SelectTrigger>
                <SelectContent>
                  {bomIds.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}
        <Label className="font-normal">
          <input
            type="checkbox"
            className="accent-primary size-4"
            checked={generate}
            onChange={(e) => setGenerate(e.target.checked)}
          />
          Generate a code (new item, not in Raw Materials)
        </Label>
      </div>

      <div className="flex flex-col gap-1.5 sm:w-1/2 sm:pr-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ps-qty">Quantity</Label>
          <div className="flex items-center gap-3">
            {QTY_TYPES.map(([field, label]) => (
              <Label key={field} className="font-normal">
                <input
                  type="radio"
                  name="ps-qty-type"
                  className="accent-primary size-4"
                  checked={qtyType === field}
                  onChange={() => {
                    setQtyType(field);
                    setValues((prev) => ({ ...prev, received_qty: undefined, dispatch_qty: undefined }));
                  }}
                />
                {label}
              </Label>
            ))}
          </div>
        </div>
        <Input
          id="ps-qty"
          inputMode="decimal"
          placeholder="0"
          value={values[qtyType] ?? ""}
          onChange={(e) => setValues((prev) => ({ ...prev, [qtyType]: e.target.value }))}
        />
      </div>
    </form>
  );
}

export default function NewItemDialog({ open, onOpenChange, onCreated, ...rest }: NewItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New stock item</DialogTitle>
          <DialogDescription>Pick the item, then the quantity. Fields are optional and are saved in capitals.</DialogDescription>
        </DialogHeader>
        {open && (
          <NewItemForm
            {...rest}
            onCreated={() => {
              onCreated();
              onOpenChange(false);
            }}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="physical-stock-form">
            <Plus />
            Create item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
