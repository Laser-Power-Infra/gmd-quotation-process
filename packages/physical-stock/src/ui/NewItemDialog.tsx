"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
import { Segmented } from "@gmd/ui/components/segmented";
import { OptionPicker } from "@gmd/ui/components/data-table/OptionPicker";
import { BLANK } from "@gmd/ui/components/data-table/types";
import { isGeneratedErpCode } from "../columns";
import { bomIdsOf, codesOf, isFinishedValve, matchBoms, rmCodesFor, type CodeOptions } from "../codeOptions";
import type { NewItemInput, PhysicalStockActions } from "../types";

// Cascading selects: each level only offers values found in stock rows that
// match every level picked above it (one facet query per level). Changing a
// level clears the levels below.
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
  ["dispatch_qty", "Dispatched"],
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
  loadFacet: PhysicalStockActions["loadFacet"];
  /** Synced RM / CREATE BOM codes, fetched when the form opens; without any, the dialog falls back to generating a code. */
  loadCodeOptions?: PhysicalStockActions["loadCodeOptions"];
  create: NonNullable<PhysicalStockActions["create"]>;
  /** With it, the submit toast offers Undo for that entry. */
  revertEntry?: PhysicalStockActions["revertEntry"];
  onCreated: () => void;
}


function NewItemForm({ loadFacet, loadCodeOptions, create, revertEntry, onCreated }: Omit<NewItemDialogProps, "open" | "onOpenChange">) {
  const [values, setValues] = useState<NewItemInput>({});
  const [qtyType, setQtyType] = useState<QtyField>("received_qty");
  const [saving, setSaving] = useState(false);
  const [bomId, setBomId] = useState("");
  const [codeOptions, setCodeOptions] = useState<CodeOptions>();
  // Explicit fallback: mint a code like before. On while no options are synced yet.
  const [generate, setGenerate] = useState(true);
  // Facet lists fetched when a level's picker opens, keyed by the level and the picks above it.
  const [options, setOptions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!loadCodeOptions) return;
    loadCodeOptions().then((res) => {
      if (!res.success) return;
      setCodeOptions(res.data);
      if (res.data.rm.length || res.data.bom.length) setGenerate(false);
    });
  }, [loadCodeOptions]);

  // A level lists only values seen under the levels picked above it; fetched once per combination, on open.
  const levelKey = (i: number) => [CASCADE[i][0], ...CASCADE.slice(0, i).map(([above]) => values[above] ?? "")].join("|");
  const openLevel = (i: number) => {
    const key = levelKey(i);
    if (options[key]) return;
    const filters: Record<string, string[]> = {};
    for (const [above] of CASCADE.slice(0, i)) if (values[above]) filters[above] = [values[above]!];
    loadFacet(CASCADE[i][0], { page: 1, pageSize: 1, sort: null, search: "", filters }).then((res) => {
      setOptions((prev) => ({ ...prev, [key]: res.success ? res.data.filter((v) => v !== BLANK).map(norm) : [] }));
    });
  };

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
  const [matches, setMatches] = useState<string[]>([]);
  const match = matches.length === 1 ? matches[0] : null;
  // BOM codes are RM codes too, so one name lookup serves both paths.
  const names = useMemo(() => new Map((codeOptions?.rm ?? []).map((r) => [r.erpItemCode, r.itemName ?? ""])), [codeOptions]);
  // Several stock rows share this location + classification: only their codes are offered.
  const codeItems = useMemo<CodeItem[]>(
    () =>
      (matches.length > 1
        ? matches
        : finished
          ? codesOf(matched, activeBomId)
          : rmCodesFor(codeOptions?.rm ?? [], values.l8_item_category)
      ).map((c) => ({ value: c, label: c, name: names.get(c) ?? "" })),
    [matches, finished, matched, activeBomId, codeOptions, values.l8_item_category, names],
  );
  const picked = codeItems.find((i) => i.value === values.erp_code) ?? null;

  // Location + every level filled and exactly one stock row has that combination:
  // that is the item, so its code is fixed and the quantity is added to it.
  const complete = Boolean(values.location?.trim()) && CASCADE.every(([f]) => values[f]);
  const identity = complete ? [values.location!.trim(), ...CASCADE.map(([f]) => values[f]!)].join("|") : "";
  useEffect(() => {
    if (!identity) return setMatches([]);
    let live = true;
    const [location, ...levels] = identity.split("|");
    const filters: Record<string, string[]> = { location: [location] };
    CASCADE.forEach(([f], i) => (filters[f] = [levels[i]]));
    loadFacet("erp_code", { page: 1, pageSize: 1, sort: null, search: "", filters }).then((res) => {
      if (!live) return;
      const codes = res.success ? res.data.filter((v) => v !== BLANK) : [];
      setMatches(codes);
    });
    return () => {
      live = false;
    };
  }, [identity, loadFacet]);

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
    // A matched generated code is re-minted server-side by the same location + L match; a real code is sent as picked.
    const minting = generate && matches.length === 0;
    const erp_code = match ? (isGeneratedErpCode(match) ? undefined : match) : minting ? undefined : picked?.value;
    if (!match && !minting && !erp_code) {
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
    const { erp_code: code, existing, entry_no } = res.data;
    toast.success(existing ? `Quantity added to ERP ${code} — entry ${entry_no}` : `New item created — ERP ${code}, entry ${entry_no}`, {
      duration: 10000,
      action: revertEntry && {
        label: "Undo",
        onClick: async () => {
          const undo = await revertEntry(entry_no);
          if (undo.success) toast.success(`Entry ${entry_no} reverted`);
          else toast.error(undo.error || `Could not revert ${entry_no}`);
          onCreated();
        },
      },
    });
    onCreated();
  };

  const emptyText = finished
    ? "No CREATE BOM matches this valve type / Dia / PN. Adjust the picks, or generate a code."
    : values.l8_item_category
      ? "No Raw Material code in this item category. Clear the category to see all codes, or generate a code."
      : "No code matches.";

  return (
    <form id="physical-stock-form" onSubmit={submit} className="flex flex-col divide-y divide-border">
      <Section title="Location" hint="Store or yard the item is counted at.">
        <Field label="Location" htmlFor="ps-location" className="sm:w-1/2">
          <Input
            id="ps-location"
            className="uppercase"
            placeholder="KGP"
            value={values.location ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, location: e.target.value.toUpperCase() }))}
          />
        </Field>
      </Section>

      <Section title="Classification" hint="Each level lists only what exists under the levels above it.">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {CASCADE.map(([field, label], i) => (
            <Field key={field} label={label} htmlFor={`ps-${field}`}>
              <OptionPicker
                id={`ps-${field}`}
                value={values[field] ?? ""}
                options={options[levelKey(i)] ?? null}
                onOpenChange={(open) => open && openLevel(i)}
                onChange={(v) => setLevel(field, v)}
                clearable
                className="uppercase"
                emptyText="No stock row has this combination yet"
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section
        title="ERP code"
        hint={
          match
            ? "This location and classification already exist in stock: the quantity is added to that item."
            : matches.length > 1
              ? `${matches.length} items already exist with this location and classification: pick which one receives the quantity.`
              : generate
              ? "A new code is minted for an item that is not in Raw Materials."
              : "Pick a synced Raw Material or BOM code."
        }
        aside={
          <Segmented
            label="ERP code source"
            disabled={matches.length > 0}
            options={[
              { value: "pick", label: "Pick from list" },
              { value: "generate", label: "Generate new" },
            ]}
            value={generate && matches.length === 0 ? "generate" : "pick"}
            onChange={(v) => setGenerate(v === "generate")}
          />
        }
      >
        {match ? (
          <Field label="Code" htmlFor="ps-erp_code" hint="Existing item">
            <Input id="ps-erp_code" value={match} readOnly disabled className="font-mono tabular-nums" />
          </Field>
        ) : (!generate || matches.length > 1) && (
          <div className="flex flex-col gap-3">
            <Field label="Code" htmlFor="ps-erp_code">
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
            </Field>
            {finished && bomIds.length > 1 && (
              // shortcut: no BOM-type column is stored; several CREATE BOMs can match one valve, so pick one
              // BOM or leave blank to list the codes of all of them.
              <Field label={`BOM (${bomIds.length} match)`} hint="Leave blank to list the codes of every match.">
                <OptionPicker value={activeBomId} options={bomIds} onChange={setBomId} clearable placeholder="All matching BOMs" />
              </Field>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Quantity"
        hint="Received adds to stock, dispatched takes from it."
        aside={
          <Segmented
            label="Quantity type"
            options={QTY_TYPES.map(([value, label]) => ({ value, label }))}
            value={qtyType}
            onChange={(field) => {
              setQtyType(field);
              setValues((prev) => ({ ...prev, received_qty: undefined, dispatch_qty: undefined }));
            }}
          />
        }
      >
        <Field label={qtyType === "received_qty" ? "Received quantity" : "Dispatched quantity"} htmlFor="ps-qty" className="sm:w-1/2">
          <Input
            id="ps-qty"
            inputMode="decimal"
            placeholder="0"
            value={values[qtyType] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [qtyType]: e.target.value }))}
          />
        </Field>
      </Section>
    </form>
  );
}

/** Titled block of the form: heading, one-line hint, optional control on the right, then its fields. */
function Section({ title, hint, aside, children }: { title: string; hint: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Field label above its control; the label is the only quiet text in a section. */
function Field({ label, hint, htmlFor, className, children }: { label: string; hint?: string; htmlFor?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function NewItemDialog({ open, onOpenChange, onCreated, ...rest }: NewItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto gap-6">
        <DialogHeader>
          <DialogTitle>New stock item</DialogTitle>
          <DialogDescription>Every field is optional; text is saved in capitals.</DialogDescription>
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
