"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import GMDUpdateHeader from "@gmd/dashboard/components/GMDUpdateHeader";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@gmd/ui/components/dialog";
import { listValveSerialsAction, saveValveSerialAction, valveSerialOptionsAction, valveStandardAction } from "@/app/actions/valveSerial";
import type { ValveSerialRecord } from "@/app/actions/valveSerial";
import {
  DIM_FIELDS,
  ID_FIELDS,
  VALVE_SERIAL_FIELDS,
  outOfTolerance,
  stdLabel,
  toleranceFlags,
} from "@/lib/valveSerial";
import type { ValveSerialField, ValveStandard } from "@/lib/valveSerial";
import { downloadCsv, toCsv } from "@/lib/debtorJoins";
import type { HeatSerial } from "@gmd/physical-stock/types";

const LABEL = Object.fromEntries(VALVE_SERIAL_FIELDS) as Record<ValveSerialField, string>;
const EMPTY = Object.fromEntries(VALVE_SERIAL_FIELDS.map(([f]) => [f, ""])) as Record<ValveSerialField, string>;
const flagText = (r: ValveSerialRecord) => toleranceFlags(r, r.standard).map((f) => LABEL[f]).join(", ");
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Opens the inspection certificate for one serial no in a new window and prints it. */
function printCertificate(r: ValveSerialRecord) {
  const w = window.open("", "_blank");
  if (!w) return toast.error("Allow pop-ups to print the certificate");
  const ids = ID_FIELDS.map(([f, l]) => `<tr><th>${esc(l)}</th><td colspan="3">${esc(r[f])}</td></tr>`).join("");
  const dims = DIM_FIELDS.map(([f, l]) => {
    const bad = outOfTolerance(r[f], r.standard?.[f]);
    return `<tr><th>${esc(l)}</th><td>${esc(r[f])}</td><td>${esc(stdLabel(r.standard?.[f]))}</td><td${bad ? ' class="bad"' : ""}>${r.standard?.[f] ? (bad ? "OUT OF TOLERANCE" : "OK") : ""}</td></tr>`;
  }).join("");
  w.document.write(`<!doctype html><html><head><title>Inspection certificate ${esc(r.serialNo)}</title><style>
body{font-family:sans-serif;font-size:12px;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:16px}
th,td{border:1px solid #444;padding:4px 6px;text-align:left}th{width:30%;background:#eee}.bad{color:#b00;font-weight:bold}
</style></head><body><h2>Valve Inspection / Test Certificate</h2><table>${ids}</table>
<table><tr><th>Dimension</th><th>Measured</th><th>Standard</th><th>Result</th></tr>${dims}</table>
<p>Assigned by: ${esc(r.assignedBy)} &nbsp; Last updated: ${esc(new Date(r.updatedAt).toLocaleString())}</p>
<p style="margin-top:48px">Inspector signature: ____________________</p></body></html>`);
  w.document.close();
  w.print();
}

export default function ValveSerialPage() {
  const [records, setRecords] = useState<ValveSerialRecord[] | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ id: string | null; values: Record<ValveSerialField, string> } | null>(null);
  const [standard, setStandard] = useState<ValveStandard>({});
  const [options, setOptions] = useState<{ serials: HeatSerial[]; sizes: string[]; pnRatings: string[] }>({ serials: [], sizes: [], pnRatings: [] });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecords(await listValveSerialsAction());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load serial nos");
      setRecords([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (records ?? []).filter((r) => !q || VALVE_SERIAL_FIELDS.some(([f]) => r[f]?.toLowerCase().includes(q)));
  }, [records, search]);

  const open = (r?: ValveSerialRecord) => {
    setStandard(r?.standard ?? {});
    setForm({ id: r?.id ?? null, values: r ? { ...EMPTY, ...Object.fromEntries(VALVE_SERIAL_FIELDS.map(([f]) => [f, r[f] ?? ""])) } : { ...EMPTY } });
    void valveSerialOptionsAction().then(setOptions);
  };

  const heatSerial = (serial: string) => options.serials.find((h) => h.serial_no === serial.trim());

  // Picking a heat-entry serial brings its stock row's valve type and size into blank fields.
  const setValue = (f: ValveSerialField, value: string) => {
    if (!form) return;
    const values = { ...form.values, [f]: value };
    const h = f === "serialNo" ? heatSerial(value) : undefined;
    if (h) {
      values.valveType ||= h.valve_type ?? "";
      values.sizeDn ||= h.size ?? "";
    }
    setForm({ ...form, values });
  };

  // Fills only blank fields, so measured values already typed are never overwritten.
  const prefill = async () => {
    if (!form) return;
    const std = await valveStandardAction(form.values);
    setStandard(std);
    const filled = Object.keys(std).length;
    if (!filled) return toast.error("No standard data for this type / size / PN");
    setForm({
      ...form,
      values: Object.fromEntries(
        VALVE_SERIAL_FIELDS.map(([f]) => [f, form.values[f] || std[f]?.value || ""]),
      ) as Record<ValveSerialField, string>,
    });
    toast.success(`Pre-filled ${filled} standard values`);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await saveValveSerialAction(form.id, form.values);
      if (!res.success) return toast.error(res.error || "Failed to save");
      toast.success("Serial no saved");
      setForm(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () =>
    downloadCsv(
      "valve_serial_nos.csv",
      toCsv(
        [...VALVE_SERIAL_FIELDS.map(([, l]) => l), "Out of tolerance", "Assigned by", "Updated"],
        shown.map((r) => [...VALVE_SERIAL_FIELDS.map(([f]) => r[f]), flagText(r), r.assignedBy, new Date(r.updatedAt).toLocaleString()]),
      ),
    );

  return (
    <main className="flex flex-col bg-background h-[calc(100vh-64px)] overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 p-6 overflow-hidden">
        <GMDUpdateHeader title="VALVE SERIAL NO" totalRows={records?.length ?? 0} />
        <div className="mt-4 flex flex-wrap items-center gap-2 shrink-0">
          <Button size="sm" onClick={() => open()}>Assign serial no</Button>
          <Button size="sm" variant="outline" onClick={exportCsv}>Download CSV</Button>
          <Input className="w-full sm:ml-auto sm:w-72" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="p-2" />
                {VALVE_SERIAL_FIELDS.map(([f, l]) => (
                  <th key={f} className="p-2 whitespace-nowrap">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2 whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => open(r)}>Edit</Button>{" "}
                    <Button size="sm" variant="outline" onClick={() => printCertificate(r)}>Print</Button>
                  </td>
                  {VALVE_SERIAL_FIELDS.map(([f]) => {
                    const bad = outOfTolerance(r[f], r.standard?.[f]);
                    return (
                      <td key={f} className={`p-2 whitespace-nowrap ${bad ? "font-semibold text-red-600 dark:text-red-400" : ""}`} title={r.standard?.[f] ? `Standard: ${stdLabel(r.standard[f])}` : undefined}>
                        {r[f]}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {records && shown.length === 0 && (
                <tr><td colSpan={VALVE_SERIAL_FIELDS.length + 1} className="p-4 text-muted-foreground">No serial nos assigned yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
            <DialogHeader><DialogTitle>{form?.id ? "Edit serial no" : "Assign serial no"}</DialogTitle></DialogHeader>
            {form && (
              <div className="grid gap-3 sm:grid-cols-3">
                {VALVE_SERIAL_FIELDS.map(([f, l]) => {
                  const bad = outOfTolerance(form.values[f], standard[f]);
                  const list = f === "serialNo" ? "vs-serials" : f === "sizeDn" ? "vs-sizes" : f === "pnRating" ? "vs-pn" : undefined;
                  return (
                    <label key={f} className="grid gap-1 text-sm">
                      {l}
                      <Input
                        list={list}
                        value={form.values[f]}
                        aria-invalid={bad || undefined}
                        className={bad ? "border-red-600" : undefined}
                        onChange={(e) => setValue(f, e.target.value)}
                      />
                      {f === "serialNo" && form.values.serialNo.trim() && !heatSerial(form.values.serialNo) && (
                        <span className="text-xs text-amber-600">Not a serial from the heat-entry form</span>
                      )}
                      {standard[f] && (
                        <span className={`text-xs ${bad ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                          {bad ? "Out of tolerance. " : ""}Std: {stdLabel(standard[f])}
                        </span>
                      )}
                    </label>
                  );
                })}
                <datalist id="vs-serials">{options.serials.map((h) => <option key={h.id} value={h.serial_no} />)}</datalist>
                <datalist id="vs-sizes">{options.sizes.map((v) => <option key={v} value={v} />)}</datalist>
                <datalist id="vs-pn">{options.pnRatings.map((v) => <option key={v} value={v} />)}</datalist>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={prefill} title="Fills blank fields from Technicals (Flange tab first, then Gate Valve)">Pre-fill standard</Button>
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

