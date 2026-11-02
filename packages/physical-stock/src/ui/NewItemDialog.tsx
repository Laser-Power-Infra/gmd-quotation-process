"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@gmd/ui/components/button";
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
  const bomIds = useMemo(
    () =>
      finished
        ? bomIdsOf(
            matchBoms(codeOptions?.bom ?? [], {
              valveType: values.l2_valve_type,
              size: values.dimension,
              pn: values.l7_dimension,
            }),
          )
        : [],
    [finished, codeOptions, values.l2_valve_type, values.dimension, values.l7_dimension],
  );
  const activeBomId = bomIds.includes(bomId) ? bomId : "";
  const codes = useMemo(
    () =>
      finished
        ? codesOf(
            matchBoms(codeOptions?.bom ?? [], {
              valveType: values.l2_valve_type,
              size: values.dimension,
              pn: values.l7_dimension,
            }),
            activeBomId,
          )
        : rmCodesFor(codeOptions?.rm ?? [], values.l8_item_category),
    [finished, codeOptions, values.l2_valve_type, values.dimension, values.l7_dimension, values.l8_item_category, activeBomId],
  );

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
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // double-click guard: each submit creates a row
    let erp_code: string | undefined;
    if (!generate) {
      const typed = (values.erp_code ?? "").trim().toUpperCase();
      erp_code = codes.find((c) => c.toUpperCase() === typed);
      if (!erp_code) {
        toast.error(typed ? "Pick an ERP code from the list." : "Pick an ERP code, or choose Generate a code.");
        return;
      }
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

  return (
    <form id="physical-stock-form" onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ps-location">Location</Label>
        <Input
          id="ps-location"
          className="uppercase"
          placeholder="KGP"
          value={values.location ?? ""}
          onChange={(e) => setValues((prev) => ({ ...prev, location: e.target.value.toUpperCase() }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Quantity</Label>
        <div className="flex items-center gap-4">
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
        <Input
          id="ps-qty"
          inputMode="decimal"
          placeholder="0"
          value={values[qtyType] ?? ""}
          onChange={(e) => setValues((prev) => ({ ...prev, [qtyType]: e.target.value }))}
        />
      </div>
      {CASCADE.map(([field, label]) => (
        <div key={field} className="flex flex-col gap-1.5">
          <Label htmlFor={`ps-${field}`}>{label}</Label>
          <div className="flex w-full items-center gap-2">
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
              <Button type="button" variant="outline" size="xs" onClick={() => setLevel(field, "")}>
                Clear
              </Button>
            )}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ps-erp_code">ERP Code</Label>
        {finished && bomIds.length > 1 && !generate && (
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
        {!generate && (
          <>
            {/* shortcut: native datalist as the searchable dropdown; swap for a combobox if the list gets unwieldy. */}
            <Input
              id="ps-erp_code"
              list="ps-erp-codes"
              className="uppercase"
              placeholder={finished ? "Code from the matching BOM" : values.l8_item_category ? `Code in ${values.l8_item_category}` : "Search Raw Material code"}
              value={values.erp_code ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, erp_code: e.target.value }))}
            />
            <datalist id="ps-erp-codes">
              {codes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {finished && codes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No CREATE BOM matches this valve type / Dia / PN. Adjust the picks, or generate a code.
              </p>
            )}
            {!finished && Boolean(values.l8_item_category) && codes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No Raw Material code in this item category. Clear the category to see all codes, or generate a code.
              </p>
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
    </form>
  );
}

export default function NewItemDialog({ open, onOpenChange, onCreated, ...rest }: NewItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Physical Stock Item</DialogTitle>
          <DialogDescription>
            ERP code comes from Raw Materials (finished valves: from the matching CREATE BOM), or can be generated. Fields are optional and are saved in capitals.
          </DialogDescription>
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
