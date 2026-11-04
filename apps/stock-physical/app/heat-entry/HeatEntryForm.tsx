"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Copy, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@gmd/ui/components/combobox";
import { Input } from "@gmd/ui/components/input";
import { Label } from "@gmd/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@gmd/ui/components/select";
import { Skeleton } from "@gmd/ui/components/skeleton";
import type { HeatEntryRow, HeatQueueItem } from "@gmd/physical-stock/types";
import { addHeat, cancelHeat, categories, done, queue } from "./actions";

// Mobile flow, one ERP code at a time:
//   heat no -> Get serial -> print it -> photo of the printed sheet -> Upload
//   (repeat for the next heat of the same code) -> Done -> next code.
// A serial without a sheet is "pending": the form reopens on it until the
// sheet is uploaded or it is cancelled.
// One primary action lives in a sticky translucent bar; Enter / "Go" submits
// the same form so the bar can hide behind the phone keyboard.

const LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const PANEL = "flex flex-col gap-3 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none";

export function HeatEntryForm() {
  const [cats, setCats] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<HeatQueueItem[]>([]);
  // ERP code picked from the dropdown; falls back to the first undone code.
  const [selectedId, setSelectedId] = useState("");
  const [pickCode, setPickCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [heatNo, setHeatNo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    categories().then((r) => (r.success ? setCats(r.data) : toast.error(r.error)));
  }, []);

  const preview = useMemo(() => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const loadQueue = async (cat: string) => {
    setLoading(true);
    const r = await queue(cat);
    setLoading(false);
    if (r.success) setItems(r.data);
    else toast.error(r.error);
  };

  const item = items.find((i) => i.id === selectedId) ?? items[0];
  const codeItems = useMemo(() => items.map((i) => ({ value: i.id, label: i.erp_code ?? "", name: i.description ?? "" })), [items]);
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
    setFile(null);
    toast.success(`${json.data.serial_no} saved`);
  };

  const cancelPending = async () => {
    if (!pending) return;
    setBusy(true);
    const r = await cancelHeat(pending.id);
    setBusy(false);
    if (!r.success) return toast.error(r.error);
    patchEntries((es) => es.filter((e) => e.id !== pending.id));
    setFile(null);
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

  const copySerial = () =>
    navigator.clipboard?.writeText(pending!.serial_no).then(() => {
      navigator.vibrate?.(30);
      toast.success("Copied");
    });

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <Label className={LABEL}>Item category</Label>
        <Select
          value={category}
          onValueChange={(v) => {
            if (!v) return;
            setCategory(v);
            setSelectedId("");
            setPickCode(false);
            setHeatNo("");
            setFile(null);
            void loadQueue(v);
          }}
        >
          <SelectTrigger className="h-12 w-full text-base" disabled={busy}>
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
        <>
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </>
      ) : !category ? null : !item ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Check size={16} /> Every ERP code in this category is done.
        </p>
      ) : (
        <form
          className="flex flex-1 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (pending ? submitSheet() : getSerial());
          }}
        >
          <section className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {items.length} left · {item.location ?? "-"}
              </span>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPickCode((v) => !v)}>
                {pickCode ? "Close" : "Change"}
              </Button>
            </div>
            <div className="text-3xl font-semibold tracking-tight tabular-nums">{item.erp_code}</div>
            <div className="text-sm text-muted-foreground">{item.description || "-"}</div>
            {pickCode && (
              <Combobox
                items={codeItems}
                value={codeItems.find((c) => c.value === item.id) ?? null}
                onValueChange={(v) => v && (setSelectedId(v.value), setHeatNo(""), setPickCode(false))}
                filter={(c, q) => `${c.label} ${c.name}`.toUpperCase().includes(q.trim().toUpperCase())}
                isItemEqualToValue={(a, b) => a.value === b.value}
                autoHighlight
              >
                <ComboboxInput id="erp-code" className="h-12 text-base uppercase" placeholder="Search code" autoFocus disabled={busy} />
                <ComboboxContent>
                  <ComboboxEmpty>No code matches.</ComboboxEmpty>
                  <ComboboxList>
                    {(c: (typeof codeItems)[number]) => (
                      <ComboboxItem key={c.value} value={c}>
                        <span className="font-mono tabular-nums">{c.label}</span>
                        <span className="truncate text-muted-foreground">{c.name}</span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            )}
            {item.entries.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {item.entries.map((e) => (
                  <li
                    key={e.id}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs ${
                      e.sheet_file_id ? "bg-muted text-muted-foreground" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {e.serial_no}
                    {e.sheet_file_id ? <Check size={12} /> : <span className="font-sans">pending</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {pending ? (
            <section key={pending.id} className={PANEL}>
              <Label className={LABEL}>Serial no — print this on the sheet</Label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 select-all font-mono text-3xl font-semibold break-all">{pending.serial_no}</div>
                <Button type="button" variant="ghost" size="icon" aria-label="Copy serial" onClick={copySerial}>
                  <Copy />
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button type="button" variant="outline" className="h-14 text-base" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Camera /> {file ? "Retake" : "Take photo of sheet"}
              </Button>
              {file && (
                <div className="flex items-center gap-3 rounded-xl border p-2">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob URL
                    <img src={preview} alt="" className="size-16 rounded-md object-cover" />
                  ) : (
                    <FileText className="size-16 p-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0 text-sm">
                    <div className="truncate">{file.name}</div>
                    <div className="text-muted-foreground">{Math.round(file.size / 1024)} KB</div>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <section key="heat" className={PANEL}>
              <Label htmlFor="heat" className={LABEL}>
                Heat no
              </Label>
              <Input
                id="heat"
                className="h-14 text-lg uppercase"
                placeholder="3500"
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="go"
                value={heatNo}
                onChange={(e) => setHeatNo(e.target.value.toUpperCase())}
              />
            </section>
          )}

          <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex flex-col gap-2 border-t bg-background/80 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <Button
              type="submit"
              className="h-12 text-base active:scale-[0.98] motion-reduce:active:scale-100"
              disabled={busy || (!pending && !heatNo.trim())}
              aria-busy={busy}
            >
              {busy && <Loader2 className="animate-spin" />}
              {pending ? (busy ? "Uploading…" : "Upload sheet") : busy ? "Getting serial…" : "Get serial no"}
            </Button>
            {pending ? (
              <Button type="button" variant="ghost" className="h-12" disabled={busy} onClick={cancelPending}>
                Cancel this serial
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-12 flex-1" disabled={busy} onClick={skip}>
                  Skip
                </Button>
                <Button type="button" variant="secondary" className="h-12 flex-1" disabled={busy} onClick={finish}>
                  Done with this code
                </Button>
              </div>
            )}
          </div>
        </form>
      )}
    </main>
  );
}
