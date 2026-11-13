"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Download, Pencil, Plus, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@gmd/ui/components/dialog";
import { DataTable } from "@gmd/ui/components/data-table/DataTable";
import { FilterChips, type FilterChip } from "@gmd/ui/components/data-table/FilterChips";
import { Pagination } from "@gmd/ui/components/data-table/Pagination";
import { SearchField } from "@gmd/ui/components/data-table/SearchField";
import { useServerTable } from "@gmd/ui/components/data-table/useServerTable";
import type { DataColumn } from "@gmd/ui/components/data-table/types";
import { downloadCsv, toCsv } from "@gmd/ui/lib/csv";
import { cn } from "@gmd/ui/lib/utils";
import {
  DIM_FIELDS,
  DISPATCH_FIELDS,
  ID_FIELDS,
  TEST_FIELDS,
  VALVE_SERIAL_FIELDS,
  outOfTolerance,
  stdLabel,
  toleranceFlags,
  type ValveSerialField,
  type ValveStandard,
} from "../fields";
import { VALVE_SERIAL_COLUMNS, type HeatSerialOption, type ValveSerialActions, type ValveSerialPageData, type ValveSerialRow } from "../columns";
import {
  clearFilters,
  queryOf,
  select,
  selectValveSerialTable,
  setColumnSearch,
  setDateRange,
  setFilter,
  setPage,
  setPageSize,
  setSearch,
  setSort,
} from "../state/tableSlice";

const LABEL = Object.fromEntries(VALVE_SERIAL_FIELDS) as Record<ValveSerialField, string>;
const EMPTY = Object.fromEntries(VALVE_SERIAL_FIELDS.map(([f]) => [f, ""])) as Record<ValveSerialField, string>;
const SECTIONS = [
  ["Identity", ID_FIELDS],
  ["Dimensions", DIM_FIELDS],
  ["Test results", TEST_FIELDS],
  ["Dispatch", DISPATCH_FIELDS],
] as const;
const DATE_INPUTS = new Set<string>(["testDate", "invoiceDate"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LISTS: Partial<Record<ValveSerialField, string>> = { serialNo: "vs-serials", sizeDn: "vs-sizes", pnRating: "vs-pn", testResult: "vs-result" };
const DIM_KEYS = new Set<string>(DIM_FIELDS.map(([f]) => f));
const count = new Intl.NumberFormat("en-IN");
const labelOf = (key: string) => VALVE_SERIAL_COLUMNS.find((c) => c.key === key)?.label ?? key;
const flagText =(r: ValveSerialRow) => toleranceFlags(r, r.standard).map((f) => LABEL[f]).join(", ");
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Opens the inspection / test certificate for one serial no in a new window and prints it. */
function printCertificate(r: ValveSerialRow) {
  const w = window.open("", "_blank");
  if (!w) return void toast.error("Allow pop-ups to print the certificate");
  const idRows = [...ID_FIELDS, ...DISPATCH_FIELDS.filter(([f]) => f !== "tcLink" && r[f])];
  const ids = idRows.map(([f, l]) => `<tr><th>${esc(l)}</th><td colspan="3">${esc(r[f])}</td></tr>`).join("");
  const tests = TEST_FIELDS.map(([f, l]) => `<tr><th>${esc(l)}</th><td>${esc(r[f])}</td><td colspan="2">${esc(stdLabel(r.standard?.[f]))}</td></tr>`).join("");
  const dims = DIM_FIELDS.map(([f, l]) => {
    const bad = outOfTolerance(r[f], r.standard?.[f]);
    return `<tr><th>${esc(l)}</th><td>${esc(r[f])}</td><td>${esc(stdLabel(r.standard?.[f]))}</td><td${bad ? ' class="bad"' : ""}>${r.standard?.[f] ? (bad ? "OUT OF TOLERANCE" : "OK") : ""}</td></tr>`;
  }).join("");
  w.document.write(`<!doctype html><html><head><title>Inspection certificate ${esc(r.serialNo)}</title><style>
body{font-family:sans-serif;font-size:12px;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:16px}
th,td{border:1px solid #444;padding:4px 6px;text-align:left}th{width:30%;background:#eee}.bad{color:#b00;font-weight:bold}
</style></head><body><h2>Valve Inspection / Test Certificate</h2><table>${ids}</table>
<table><tr><th>Test</th><th>Result</th><th colspan="2">Standard</th></tr>${tests}</table>
<table><tr><th>Dimension</th><th>Measured</th><th>Standard</th><th>Result</th></tr>${dims}</table>
<p>Assigned by: ${esc(r.assignedBy)} &nbsp; Last updated: ${esc(new Date(r.updatedAt).toLocaleString())}</p>
<p style="margin-top:48px">Inspector signature: ____________________</p></body></html>`);
  w.document.close();
  w.print();
}

/** A measured dimension: red when outside the standard's band, the standard in the tooltip. */
function dimCell(r: ValveSerialRow, f: ValveSerialField) {
  const std = r.standard?.[f];
  const bad = outOfTolerance(r[f], std);
  return (
    <span className={cn(bad && "font-semibold text-red-700 dark:text-red-400")} title={std ? `${bad ? "Out of tolerance. " : ""}Standard: ${stdLabel(std)}` : undefined}>
      {r[f]}
      {bad && <span className="sr-only"> (out of tolerance)</span>}
    </span>
  );
}

export function ValveSerialPage({ actions }: { actions: ValveSerialActions }) {
  const dispatch = useDispatch();
  const state = useSelector(selectValveSerialTable);
  const { loadPage, loadFacet, saveSerial, loadStandard, loadOptions } = actions;

  const query = useMemo(() => queryOf(state), [state]);
  const queryKey = JSON.stringify(query);
  const filterKey = JSON.stringify({ filters: query.filters, dateRanges: query.dateRanges, columnSearch: query.columnSearch, search: query.search });
  // A column's facet ignores that column's own filters (the server skips them too), so picking a value keeps its list.
  const facetKey = useCallback(
    (key: string) => {
      const omit = <T,>(o: Record<string, T> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== key));
      return JSON.stringify({ filters: omit(query.filters), dateRanges: omit(query.dateRanges), columnSearch: omit(query.columnSearch), search: query.search });
    },
    [query],
  );

  const table = useServerTable<ValveSerialPageData>({
    queryKey,
    filterKey,
    facetKey,
    fetchPage: async () => {
      const res = await loadPage(query);
      if (!res.success) throw new Error(res.error || "Failed to load serial nos.");
      return res.data;
    },
    fetchFacet: async (key) => {
      const res = await loadFacet(key, query);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const { data, refresh } = table;
  const total = data?.total ?? 0;

  useEffect(() => {
    if (table.error) toast.error(table.error);
  }, [table.error]);

  const [form, setForm] = useState<{ id: string | null; values: Record<ValveSerialField, string> } | null>(null);
  const [standard, setStandard] = useState<ValveStandard>({});
  const [options, setOptions] = useState<{ serials: HeatSerialOption[]; sizes: string[]; pnRatings: string[] }>({ serials: [], sizes: [], pnRatings: [] });
  const [saving, setSaving] = useState(false);

  const open = useCallback(
    (r?: ValveSerialRow) => {
      setStandard(r?.standard ?? {});
      setForm({ id: r?.id ?? null, values: r ? { ...EMPTY, ...Object.fromEntries(VALVE_SERIAL_FIELDS.map(([f]) => [f, r[f] ?? ""])) } : { ...EMPTY } });
      void loadOptions().then(setOptions, () => toast.error("Could not load the serial and size lists"));
    },
    [loadOptions],
  );

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

  // Fills only blank fields, so values already typed are never overwritten.
  const prefill = async () => {
    if (!form) return;
    const std = await loadStandard(form.values).catch(() => null);
    if (!std) return void toast.error("Could not load the standard values");
    setStandard(std);
    const filled = Object.keys(std).length;
    if (!filled) return void toast.error("No standard data for this type / size / PN");
    setForm({
      ...form,
      values: Object.fromEntries(VALVE_SERIAL_FIELDS.map(([f]) => [f, form.values[f] || std[f]?.value || ""])) as Record<ValveSerialField, string>,
    });
    toast.success(`Pre-filled ${filled} standard values`);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const res = await saveSerial(form.id, form.values);
      if (!res.success) return void toast.error(res.error || "Failed to save");
      toast.success("Serial no saved");
      setForm(null);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo<DataColumn<ValveSerialRow>[]>(
    () => [
      {
        key: "actions",
        label: "Actions",
        kind: "text",
        sticky: true,
        width: 72,
        render: (r) => (
          <span className="flex gap-1">
            <Button size="icon-xs" variant="ghost" title="Edit" aria-label={`Edit ${r.serialNo}`} onClick={(e) => (e.stopPropagation(), open(r))}>
              <Pencil />
            </Button>
            <Button size="icon-xs" variant="ghost" title="Print certificate" aria-label={`Print certificate ${r.serialNo}`} onClick={(e) => (e.stopPropagation(), printCertificate(r))}>
              <Printer />
            </Button>
          </span>
        ),
      },
      ...VALVE_SERIAL_COLUMNS.map((c): DataColumn<ValveSerialRow> => {
        if (DIM_KEYS.has(c.key)) return { ...c, render: (r) => dimCell(r, c.key as ValveSerialField) };
        if (c.key === "tcLink")
          return {
            ...c,
            render: (r) =>
              /^https?:\/\//i.test(r.tcLink ?? "") ? (
                <a href={r.tcLink!} target="_blank" rel="noreferrer" aria-label={`Open TC for ${r.serialNo}`} onClick={(e) => e.stopPropagation()} className="text-primary underline-offset-2 hover:underline">
                  Open TC
                </a>
              ) : (
                r.tcLink
              ),
          };
        return c;
      }),
    ],
    [open],
  );

  const chips = useMemo<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    for (const [key, values] of Object.entries(state.filters)) for (const value of values) out.push({ key, label: labelOf(key), value });
    for (const [key, value] of Object.entries(state.columnSearch)) out.push({ key, label: labelOf(key), value: `contains “${value}”`, search: true });
    for (const [key, range] of Object.entries(state.dateRanges)) out.push({ key, label: labelOf(key), value: `${range.from || "start"} to ${range.to || "today"}`, date: true });
    return out;
  }, [state.filters, state.dateRanges, state.columnSearch]);
  const hasFilters = chips.length > 0 || Boolean(state.search);

  // Every page under the current filters and sort.
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: ValveSerialRow[] = [];
      for (let page = 1; ; page++) {
        const res = await loadPage({ ...query, page, pageSize: 200 });
        if (!res.success) throw new Error(res.error);
        all.push(...res.data.rows);
        if (all.length >= res.data.total || res.data.rows.length === 0) break;
      }
      const csv = toCsv(
        [...VALVE_SERIAL_COLUMNS.map((c) => c.label), "Out of tolerance", "Updated"],
        all.map((r) => [...VALVE_SERIAL_COLUMNS.map((c) => (r as unknown as Record<string, string | null>)[c.key]), flagText(r), new Date(r.updatedAt).toLocaleString()]),
      );
      downloadCsv(`Valve_Serial_Nos_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="flex h-[calc(100vh-64px)] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-6">
        <header className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Valve Serial No</h1>
          <span className="text-sm tabular-nums text-muted-foreground">{data ? `${count.format(total)} serial nos` : ""}</span>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField value={state.search} onCommit={(v) => dispatch(setSearch(v))} busy={table.refreshing} placeholder="Search serial, contract, invoice, party" />
          <FilterChips
            chips={chips}
            onRemove={(chip) =>
              chip.date
                ? dispatch(setDateRange({ key: chip.key, range: undefined }))
                : chip.search
                  ? dispatch(setColumnSearch({ key: chip.key, value: "" }))
                  : dispatch(setFilter({ key: chip.key, values: (state.filters[chip.key] ?? []).filter((v) => v !== chip.value) }))
            }
            onClear={() => dispatch(clearFilters())}
          />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting || !total}>
              <Download />
              {exporting ? "Exporting…" : "CSV"}
            </Button>
            <Button size="sm" onClick={() => open()}>
              <Plus />
              Assign serial no
            </Button>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowId={(r) => r.id}
          sort={state.sort}
          onSortChange={(s) => dispatch(setSort(s))}
          filters={state.filters}
          onFilterChange={(key, values) => dispatch(setFilter({ key, values }))}
          dateRanges={state.dateRanges}
          onDateRangeChange={(key, range) => dispatch(setDateRange({ key, range }))}
          columnSearch={state.columnSearch}
          onColumnSearchChange={(key, value) => dispatch(setColumnSearch({ key, value }))}
          facetOptions={table.getFacetOptions}
          onFacetOpen={(key) => void table.requestFacet(key)}
          selectedId={state.selectedId}
          onSelect={(id) => dispatch(select(id))}
          loading={table.loading}
          refreshing={table.refreshing}
          error={table.error}
          onRetry={() => void refresh()}
          hasFilters={hasFilters}
          onClearFilters={() => dispatch(clearFilters())}
          onPageStep={(d) => {
            const next = state.page + d;
            if (next >= 1 && next <= Math.ceil(total / state.pageSize)) dispatch(setPage(next));
          }}
        />
        <Pagination page={state.page} pageSize={state.pageSize} total={total} onPageChange={(p) => dispatch(setPage(p))} onPageSizeChange={(s) => dispatch(setPageSize(s))} />
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit serial no" : "Assign serial no"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-5">
              {SECTIONS.map(([title, fields]) => (
                <section key={title} className="grid gap-3">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {fields.map(([f, l]) => {
                      const bad = outOfTolerance(form.values[f], standard[f]);
                      return (
                        <label key={f} className="grid gap-1 text-sm">
                          {l}
                          <Input
                            // An imported date the picker cannot hold ("27-Feb-25") stays visible as text.
                            type={DATE_INPUTS.has(f) && (!form.values[f] || ISO_DAY.test(form.values[f])) ? "date" : "text"}
                            list={LISTS[f]}
                            value={form.values[f]}
                            aria-invalid={bad || undefined}
                            className={bad ? "border-red-600" : undefined}
                            onChange={(e) => setValue(f, e.target.value)}
                          />
                          {f === "serialNo" && form.values.serialNo.trim() && !heatSerial(form.values.serialNo) && (
                            <span className="text-xs text-amber-700 dark:text-amber-400">Not a serial from the heat-entry form</span>
                          )}
                          {standard[f] && (
                            <span className={`text-xs ${bad ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                              {bad ? "Out of tolerance. " : ""}Std: {stdLabel(standard[f])}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
              <datalist id="vs-serials">{options.serials.map((h) => <option key={h.id} value={h.serial_no} />)}</datalist>
              <datalist id="vs-sizes">{options.sizes.map((v) => <option key={v} value={v} />)}</datalist>
              <datalist id="vs-pn">{options.pnRatings.map((v) => <option key={v} value={v} />)}</datalist>
              <datalist id="vs-result">
                <option value="Pass" />
                <option value="Fail" />
              </datalist>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={prefill} title="Fills blank fields from Technicals (Flange tab first, then Gate Valve)">
              Pre-fill standard
            </Button>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
