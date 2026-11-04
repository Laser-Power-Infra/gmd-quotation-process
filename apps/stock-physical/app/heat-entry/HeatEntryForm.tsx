"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import { Label } from "@gmd/ui/components/label";
import { Skeleton } from "@gmd/ui/components/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@gmd/ui/components/table";
import { Textarea } from "@gmd/ui/components/textarea";
import { DIMENSION_FIELDS } from "@gmd/physical-stock/dimensions";
import { HEAT_DIM_KEYS, type HeatDims, type HeatEntryRow, type HeatQueueItem } from "@gmd/physical-stock/types";
import { addHeats, cancelHeat, done, findByCode, queue, saveDims } from "./actions";

// Desktop flow, one ERP code at a time (TRADING VALVES, lowest available qty first):
//   paste heat nos -> Generate serial no -> one row per serial
//   -> per row: type flange dims, pick the sheet, Upload (saves dims too)
//   -> Done (every sheet uploaded) -> next code.
// Dims stay editable (Save per row) at any time; the ERP code filter reopens
// any code, done or not, for that.

const LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const DIM_LABEL = Object.fromEntries(DIMENSION_FIELDS) as Record<string, string>;
type Draft = { dims: Partial<HeatDims>; file: File | null };

export function HeatEntryForm() {
  const [items, setItems] = useState<HeatQueueItem[] | null>(null);
  const [filtered, setFiltered] = useState<HeatQueueItem | null>(null);
  const [codeQuery, setCodeQuery] = useState("");
  const [heatText, setHeatText] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null); // "gen" | "done" | "find" | entry id

  useEffect(() => {
    queue().then((r) => (r.success ? setItems(r.data) : toast.error(r.error)));
  }, []);

  const item = filtered ?? items?.[0];
  const pendingCount = item?.entries.filter((e) => !e.sheet_file_id).length ?? 0;

  const patchEntries = (fn: (entries: HeatEntryRow[]) => HeatEntryRow[]) => {
    const patch = (i: HeatQueueItem) => (i.id === item!.id ? { ...i, entries: fn(i.entries) } : i);
    setItems((list) => list && list.map(patch));
    setFiltered((f) => f && patch(f));
  };
  const draft = (id: string): Draft => drafts[id] ?? { dims: {}, file: null };
  const setDraft = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...draft(id), ...patch } }));
  // Typed value wins over the saved one.
  const dimsOf = (e: HeatEntryRow): HeatDims =>
    Object.fromEntries(HEAT_DIM_KEYS.map((k) => [k, draft(e.id).dims[k] ?? e[k] ?? ""])) as HeatDims;

  const find = async () => {
    setBusy("find");
    const r = await findByCode(codeQuery);
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    if (!r.data) return toast.error(`No row with ERP code ${codeQuery.trim()}`);
    setFiltered(r.data);
  };

  const generate = async () => {
    const heats = heatText.split(/[\s,]+/).filter(Boolean);
    if (!item || !heats.length) return;
    setBusy("gen");
    const r = await addHeats(item.id, heats);
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    patchEntries((es) => [...es, ...r.data]);
    setHeatText("");
  };

  const save = async (e: HeatEntryRow) => {
    setBusy(e.id);
    const r = await saveDims(e.id, dimsOf(e));
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    patchEntries((es) => es.map((x) => (x.id === e.id ? r.data : x)));
    setDraft(e.id, { dims: {} });
    toast.success(`${r.data.serial_no} saved`);
  };

  const upload = async (e: HeatEntryRow) => {
    const { file } = draft(e.id);
    if (!file) return toast.error("Choose the sheet file first.");
    setBusy(e.id);
    const body = new FormData();
    body.set("entryId", e.id);
    body.set("file", file);
    for (const [k, v] of Object.entries(dimsOf(e))) body.set(k, v ?? "");
    const res = await fetch("/api/heat-sheet", { method: "POST", body });
    const json = (await res.json()) as { data?: HeatEntryRow; error?: string };
    setBusy(null);
    if (!res.ok || !json.data) return toast.error(json.error || "Upload failed");
    patchEntries((es) => es.map((x) => (x.id === e.id ? json.data! : x)));
    setDraft(e.id, { dims: {}, file: null });
    toast.success(`${json.data.serial_no} saved`);
  };

  const remove = async (e: HeatEntryRow) => {
    setBusy(e.id);
    const r = await cancelHeat(e.id);
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    patchEntries((es) => es.filter((x) => x.id !== e.id));
  };

  const finish = async () => {
    if (!item) return;
    setBusy("done");
    const r = await done(item.id);
    setBusy(null);
    if (!r.success) return toast.error(r.error);
    setItems((list) => list!.filter((i) => i.id !== item.id));
    setHeatText("");
  };

  const skip = () => {
    setItems((list) => [...list!.filter((i) => i.id !== item!.id), item!]);
    setHeatText("");
  };

  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success("Copied"));

  if (!items) return <Skeleton className="m-6 h-64 rounded-xl" />;

  return (
    <main className="flex w-full flex-col gap-6 p-6">
      <form
        className="flex max-w-md items-end gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          void find();
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="code" className={LABEL}>
            Find ERP code
          </Label>
          <Input
            id="code"
            className="font-mono uppercase"
            placeholder="Any code, done or not"
            value={codeQuery}
            onChange={(ev) => setCodeQuery(ev.target.value.toUpperCase())}
            disabled={busy !== null}
          />
        </div>
        <Button type="submit" variant="outline" disabled={busy !== null || !codeQuery.trim()} aria-busy={busy === "find"}>
          {busy === "find" ? <Loader2 className="animate-spin" /> : <Search />}
          Find
        </Button>
        {filtered && (
          <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => (setFiltered(null), setCodeQuery(""))}>
            <X /> Back to queue
          </Button>
        )}
      </form>

      {!item ? (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Check size={16} /> Every TRADING VALVES code is done.
        </p>
      ) : (
        <>
          <section className="flex flex-wrap items-end gap-x-8 gap-y-2 rounded-xl border bg-card p-4">
            <div>
              <div className={LABEL}>{filtered ? "ERP code (filtered)" : `ERP code · ${items.length} left`}</div>
              <div className="text-3xl font-semibold tracking-tight tabular-nums">{item.erp_code}</div>
            </div>
            <div className="min-w-0 flex-1 text-sm text-muted-foreground">{item.description || "-"}</div>
            <div className="text-sm">
              <span className={LABEL}>Location </span>
              {item.location ?? "-"}
            </div>
            <div className="text-sm">
              <span className={LABEL}>Available qty </span>
              {item.available_qty ?? "-"}
            </div>
          </section>

          {!filtered && (
            <section className="flex items-end gap-3">
              <div className="flex max-w-xl flex-1 flex-col gap-1.5">
                <Label htmlFor="heats" className={LABEL}>
                  Heat nos (one per line)
                </Label>
                <Textarea
                  id="heats"
                  rows={4}
                  className="font-mono uppercase"
                  placeholder={"3500\n3501"}
                  autoFocus
                  value={heatText}
                  onChange={(e) => setHeatText(e.target.value.toUpperCase())}
                  disabled={busy !== null}
                />
              </div>
              <Button onClick={generate} disabled={busy !== null || !heatText.trim()} aria-busy={busy === "gen"}>
                {busy === "gen" && <Loader2 className="animate-spin" />}
                Generate serial no
              </Button>
            </section>
          )}

          {item.entries.length === 0 ? (
            filtered && <p className="text-sm text-muted-foreground">No serials on this code yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial no</TableHead>
                  {HEAT_DIM_KEYS.map((k) => (
                    <TableHead key={k}>{DIM_LABEL[k]}</TableHead>
                  ))}
                  <TableHead>Sheet</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.entries.map((e) => {
                  const uploaded = !!e.sheet_file_id;
                  const d = draft(e.id);
                  const dims = dimsOf(e);
                  const rowBusy = busy === e.id;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono tabular-nums">
                        <span className="select-all">{e.serial_no}</span>
                        <Button type="button" variant="ghost" size="icon" className="ml-1 size-7" aria-label="Copy serial" onClick={() => copy(e.serial_no)}>
                          <Copy className="size-3.5" />
                        </Button>
                      </TableCell>
                      {HEAT_DIM_KEYS.map((k) => (
                        <TableCell key={k}>
                          <Input
                            className="h-8 w-24"
                            aria-label={DIM_LABEL[k]}
                            value={dims[k] ?? ""}
                            disabled={rowBusy}
                            onChange={(ev) => setDraft(e.id, { dims: { ...d.dims, [k]: ev.target.value } })}
                          />
                        </TableCell>
                      ))}
                      <TableCell>
                        {uploaded ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Check size={14} /> uploaded
                          </span>
                        ) : (
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="text-sm"
                            disabled={rowBusy}
                            onChange={(ev) => setDraft(e.id, { file: ev.target.files?.[0] ?? null })}
                          />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Button type="button" size="sm" variant="secondary" disabled={busy !== null} aria-busy={rowBusy} onClick={() => save(e)}>
                          {rowBusy && <Loader2 className="animate-spin" />}
                          Save
                        </Button>
                        {!uploaded && (
                          <>
                            <Button type="button" size="sm" className="ml-1" disabled={busy !== null || !d.file} onClick={() => upload(e)}>
                              Upload
                            </Button>
                            <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => remove(e)}>
                              Remove
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {!filtered && (
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy !== null} onClick={skip}>
                Skip
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null || pendingCount > 0}
                aria-busy={busy === "done"}
                title={pendingCount ? `${pendingCount} serial(s) still need a sheet` : undefined}
                onClick={finish}
              >
                {busy === "done" && <Loader2 className="animate-spin" />}
                Done with this code
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
