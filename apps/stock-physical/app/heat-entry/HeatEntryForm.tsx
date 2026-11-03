"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import { Label } from "@gmd/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@gmd/ui/components/select";
import type { HeatEntryRow, HeatQueueItem } from "@gmd/physical-stock/types";
import { addHeat, cancelHeat, categories, done, queue } from "./actions";

// Mobile flow, one ERP code at a time:
//   heat no -> Get serial -> print it -> upload the printed sheet -> Submit
//   (repeat for the next heat of the same code) -> Done -> next code.
// A serial without a sheet is "pending": the form reopens on it until the
// sheet is uploaded or it is cancelled.

export function HeatEntryForm() {
  const [cats, setCats] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<HeatQueueItem[]>([]);
  // ERP code picked from the dropdown; falls back to the first undone code.
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [heatNo, setHeatNo] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    categories().then((r) => (r.success ? setCats(r.data) : toast.error(r.error)));
  }, []);

  const loadQueue = async (cat: string) => {
    setLoading(true);
    const r = await queue(cat);
    setLoading(false);
    if (r.success) setItems(r.data);
    else toast.error(r.error);
  };

  const item = items.find((i) => i.id === selectedId) ?? items[0];
  const pending = item?.entries.find((e) => !e.sheet_file_id) ?? null;

  const patchEntries = (fn: (entries: HeatEntryRow[]) => HeatEntryRow[]) =>
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, entries: fn(i.entries) } : i)));

  const getSerial = async () => {
    if (!item) return;
    setBusy(true);
    const r = await addHeat(item.id, heatNo);
    setBusy(false);
    if (!r.success) return toast.error(r.error);
    patchEntries((es) => [...es, r.data]);
    setHeatNo("");
  };

  const submitSheet = async () => {
    const file = fileRef.current?.files?.[0];
    if (!pending || !file) return toast.error("Choose the printed sheet first.");
    setBusy(true);
    const body = new FormData();
    body.set("entryId", pending.id);
    body.set("file", file);
    const res = await fetch("/api/heat-sheet", { method: "POST", body });
    const json = (await res.json()) as { data?: HeatEntryRow; error?: string };
    setBusy(false);
    if (!res.ok || !json.data) return toast.error(json.error || "Upload failed");
    patchEntries((es) => es.map((e) => (e.id === pending.id ? json.data! : e)));
    if (fileRef.current) fileRef.current.value = "";
    toast.success(`${json.data.serial_no} saved`);
  };

  const cancelPending = async () => {
    if (!pending) return;
    setBusy(true);
    const r = await cancelHeat(pending.id);
    setBusy(false);
    if (!r.success) return toast.error(r.error);
    patchEntries((es) => es.filter((e) => e.id !== pending.id));
  };

  const finish = async () => {
    if (!item) return;
    setBusy(true);
    const r = await done(item.id);
    setBusy(false);
    if (!r.success) return toast.error(r.error);
    setItems((list) => list.filter((i) => i.id !== item.id));
    setSelectedId("");
  };

  const skip = () => {
    setItems((list) => [...list.filter((i) => i.id !== item.id), item]);
    setSelectedId("");
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <Label>Item category</Label>
        <Select
          value={category}
          onValueChange={(v) => {
            if (!v) return;
            setCategory(v);
            setSelectedId("");
            setSearch("");
            setHeatNo("");
            void loadQueue(v);
          }}
        >
          <SelectTrigger className="h-12 w-full text-base">
            <SelectValue placeholder="Choose a category" />
          </SelectTrigger>
          <SelectContent>
            {cats.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : !category ? null : !item ? (
        <p className="text-sm text-muted-foreground">Every ERP code in this category is done.</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="erp-search">ERP code</Label>
            <Input
              id="erp-search"
              className="h-12 text-base uppercase"
              placeholder="Search code"
              inputMode="search"
              value={search}
              onChange={(e) => setSearch(e.target.value.toUpperCase())}
            />
            <Select value={item.id} onValueChange={(v) => v && (setSelectedId(v), setHeatNo(""))}>
              <SelectTrigger className="h-12 w-full text-base">
                {/* Base UI shows the raw value (row id) unless given children. */}
                <SelectValue>{item.erp_code}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {items
                  .filter((i) => !search || (i.erp_code ?? "").toUpperCase().includes(search))
                  .map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.erp_code}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">
              {items.length} left · {item.location ?? "-"}
            </div>
            <div className="text-2xl font-bold tracking-wide">{item.erp_code}</div>
            <div className="text-sm text-muted-foreground">{item.description || "-"}</div>
            {item.entries.length > 0 && (
              <ul className="mt-2 text-sm">
                {item.entries.map((e) => (
                  <li key={e.id} className={e.sheet_file_id ? "" : "text-amber-600"}>
                    {e.serial_no}
                    {e.sheet_file_id ? "" : " (sheet pending)"}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pending ? (
            <div className="flex flex-col gap-3 rounded-lg border border-primary p-3">
              <div className="text-xs text-muted-foreground">Serial no — print this on the sheet</div>
              <div className="select-all break-all font-mono text-xl font-bold">{pending.serial_no}</div>
              <Label htmlFor="sheet">Printed sheet (photo or PDF)</Label>
              <Input id="sheet" ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="h-12" />
              <Button className="h-12 text-base" disabled={busy} onClick={submitSheet}>
                Submit
              </Button>
              <Button variant="ghost" disabled={busy} onClick={cancelPending}>
                Cancel this serial
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void getSerial();
              }}
            >
              <Label htmlFor="heat">Heat no</Label>
              <Input
                id="heat"
                className="h-12 text-base uppercase"
                placeholder="3500"
                autoFocus
                value={heatNo}
                onChange={(e) => setHeatNo(e.target.value.toUpperCase())}
              />
              <Button type="submit" className="h-12 text-base" disabled={busy || !heatNo.trim()}>
                Get serial no
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-12 flex-1" disabled={busy} onClick={skip}>
                  Skip
                </Button>
                <Button type="button" variant="secondary" className="h-12 flex-1" disabled={busy} onClick={finish}>
                  Done with this code
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </main>
  );
}
