"use client";

import { useMemo, useState } from "react";
import type { MismatchReport } from "@/lib/actuatorStock";

const TH = "sticky top-0 z-20 border-b border-r border-border bg-muted px-3 py-2.5 text-[13px] font-semibold text-foreground whitespace-normal align-bottom";
const TD = "border-r border-border px-3 py-2";
const NUM = `${TD} text-right tabular-nums`;
const SEL = "rounded border border-border bg-background px-2 py-1 text-sm";

export interface MappingRow {
  mapKey: string; valveType: string; dn: number; pn: string; valveTorque: number | null; requiredTorque: number | null;
  gearbox: string | null; actInputTorque: number | null; aumaModel: string | null; rotorkModel: string | null;
  directPartTurn: string | null; stockRotorkNm: number | null; valveFlange: string | null; flangeCheck: string | null;
  gmdGbCode: string | null; gmdGbRating: number | null; note: string | null;
}
export interface StockLine { kind: string; erpCode: string; make: string | null; ratingCode: string | null; series: string | null; torque: number | null; qty: number | null }
type Live<T> = T & { live: number | null };
export interface ReportData {
  totals: MismatchReport["totals"]; erpMismatch: Live<MismatchReport["erpMismatch"][number]>[]; gearboxCoded: Live<MismatchReport["gearboxCoded"][number]>[];
  gearboxNeedsCode: MismatchReport["gearboxNeedsCode"]; aumaToFill: Live<MismatchReport["aumaToFill"][number]>[];
}
export interface SuitRow { mapKey: string; kind: string; code: string; make: string; label: string; ratingNm: number | null; mark: string }

type Make = "ALL" | "AUMA" | "Rotork" | "GMD";
const nm = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 }));
const uniq = <T,>(a: T[]) => [...new Set(a)];

export default function ActuatorMappingView(props: {
  mappings: MappingRow[]; suitability: SuitRow[]; qtyByCode: Record<string, number>;
  rotorkQtyByNm: Record<string, number>; stockError: string | null; stockLines: StockLine[]; report: ReportData;
}) {
  const { mappings, suitability, qtyByCode, rotorkQtyByNm, stockError, stockLines, report } = props;
  const [view, setView] = useState<"mapping" | "suitability" | "stock" | "report">("mapping");
  const [type, setType] = useState("");
  const [dn, setDn] = useState("");
  const [pn, setPn] = useState("");
  const [make, setMake] = useState<Make>("ALL");

  const types = useMemo(() => uniq(mappings.map((m) => m.valveType)).sort(), [mappings]);
  const dns = useMemo(() => uniq(mappings.map((m) => m.dn)).sort((a, b) => a - b), [mappings]);
  const pns = useMemo(() => uniq(mappings.map((m) => m.pn)).sort(), [mappings]);
  const rows = useMemo(
    () => mappings.filter((m) => (!type || m.valveType === type) && (!dn || m.dn === Number(dn)) && (!pn || m.pn === pn)),
    [mappings, type, dn, pn],
  );
  const shown = (m: Make[]) => make === "ALL" || m.includes(make);
  const qty = (n: number | undefined) => (stockError || n === undefined ? "-" : n.toLocaleString("en-IN"));

  // SUITABILITY: columns are every actuator / gearbox code (ordered by make, then rating); rows follow the same filters.
  const cols = useMemo(() => {
    const seen = new Map<string, SuitRow>();
    for (const s of suitability) if (!seen.has(s.code)) seen.set(s.code, s);
    return [...seen.values()]
      .filter((c) => make === "ALL" || c.make === make)
      .sort((a, b) => a.make.localeCompare(b.make) || (a.ratingNm ?? 0) - (b.ratingNm ?? 0));
  }, [suitability, make]);
  const marks = useMemo(() => new Map(suitability.map((s) => [`${s.mapKey}\n${s.code}`, s.mark])), [suitability]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {stockError && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{stockError}</div>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Actuator &amp; Gearbox Mapping</h2>
          <div className="flex overflow-hidden rounded border border-border text-sm">
            {(["mapping", "suitability", "stock", "report"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={`px-3 py-1 ${view === v ? "bg-primary text-primary-foreground" : ""}`}>
                {v === "mapping" ? "Mapping" : v === "suitability" ? "Suitability" : v === "stock" ? "Stock" : "Mismatch report"}
              </button>
            ))}
          </div>
          <select aria-label="Valve type" className={SEL} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All valve types</option>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select aria-label="Size (DN)" className={SEL} value={dn} onChange={(e) => setDn(e.target.value)}>
            <option value="">All sizes</option>
            {dns.map((d) => <option key={d} value={d}>DN {d}</option>)}
          </select>
          <select aria-label="Pressure (PN)" className={SEL} value={pn} onChange={(e) => setPn(e.target.value)}>
            <option value="">All pressures</option>
            {pns.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select aria-label="Make" className={SEL} value={make} onChange={(e) => setMake(e.target.value as Make)}>
            <option value="ALL">All makes</option>
            <option value="AUMA">AUMA</option>
            <option value="Rotork">Rotork</option>
            <option value="GMD">GMD gearbox</option>
          </select>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{view === "stock" ? stockLines.length : view === "report" ? report.erpMismatch.length + report.gearboxNeedsCode.length + report.aumaToFill.length : rows.length} rows</span>
          {view === "suitability" && (
            <span className="text-xs text-muted-foreground">
              <span className="font-bold text-green-700 dark:text-green-400">✔</span> suitable ·{" "}
              <span className="font-bold text-amber-600 dark:text-amber-400">○</span> oversized · blank = too small · n/a = not applicable
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {view === "report" ? (
            <div className="space-y-6 p-4 text-sm">
              <p className="text-muted-foreground">
                ERP vs physical figures are the imported workbook snapshot (STOCK_ACT / GMD_GB_STOCK). "Available now" is live Physical Stock. Read-only.
              </p>
              <p>
                {report.totals.lines} actuator lines ({report.totals.rotork} Rotork K-series, {report.totals.auma} AUMA SA), {report.totals.units.toLocaleString("en-IN")} units available,
                stock value Rs {report.totals.value.toLocaleString("en-IN")}. {report.erpMismatch.length} lines where ERP stock differs from physical.
              </p>
              <ReportTable title={`Actuator lines: ERP stock differs from physical (${report.erpMismatch.length})`}
                head={["ERP code", "Make", "Rating", "ERP stock", "Physical", "Available now"]}
                rows={report.erpMismatch.map((a) => [a.erpCode, a.make, a.ratingCode, nm(a.stockPerErp), nm(a.physicalSum), a.live === null ? "-" : a.live.toLocaleString("en-IN")])} />
              <ReportTable title={`Gearboxes with an ERP code (${report.gearboxCoded.length})`}
                head={["ERP code", "Type", "Rated torque (Nm)", "Available (workbook)", "Available now"]}
                rows={report.gearboxCoded.map((g) => [g.erpCode, g.gbType, nm(g.ratedTorque), nm(g.available), g.live === null ? "-" : g.live.toLocaleString("en-IN")])} />
              <ReportTable title={`Gearbox lines with no ERP code: needs ERP code (${report.gearboxNeedsCode.length})`}
                head={["Line", "Type", "Qty", "Remarks"]}
                rows={report.gearboxNeedsCode.map((g) => [g.erpCode, g.gbType, nm(g.available), g.remarks])} />
              <ReportTable title={`AUMA SA lines with blank nameplate torque: to fill (${report.aumaToFill.length})`}
                head={["ERP code", "Rating", "Available now"]}
                rows={report.aumaToFill.map((a) => [a.erpCode, a.ratingCode, a.live === null ? "-" : a.live.toLocaleString("en-IN")])} />
            </div>
          ) : view === "stock" ? (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>{["Item", "ERP code", "Make", "Rating / type", "Torque (Nm)", "Available now"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stockLines.filter((l) => make === "ALL" || l.make === make).map((l, i) => (
                  <tr key={l.erpCode} className={i % 2 ? "bg-muted" : "bg-card"}>
                    <td className={TD}>{l.kind}</td>
                    <td className={`${TD} whitespace-nowrap font-medium`}>{l.erpCode}</td>
                    <td className={TD}>{l.make ?? "-"}</td>
                    <td className={TD}>{l.ratingCode ?? "-"}</td>
                    <td className={NUM}>{l.torque === null ? <span className="text-muted-foreground">to fill</span> : nm(l.torque)}</td>
                    <td className={`${NUM} font-semibold`}>{l.qty === null ? "-" : l.qty.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : view === "mapping" ? (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  {["Valve type", "DN", "PN", "Required torque (Nm)", "AUMA gearbox", "Actuator input torque (Nm)"].map((h) => <th key={h} className={TH}>{h}</th>)}
                  {shown(["AUMA"]) && <th className={TH}>AUMA SA model</th>}
                  {shown(["Rotork"]) && <th className={TH}>Rotork model</th>}
                  {shown(["Rotork"]) && <th className={TH}>In-stock Rotork K-series (Nm)</th>}
                  {shown(["Rotork"]) && <th className={TH}>K-series available</th>}
                  <th className={TH}>Valve top flange</th>
                  <th className={TH}>Flange check</th>
                  {shown(["GMD"]) && <th className={TH}>GMD stock gearbox</th>}
                  {shown(["GMD"]) && <th className={TH}>GMD gearbox rating (Nm)</th>}
                  {shown(["GMD"]) && <th className={TH}>GMD gearbox available</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((m, i) => (
                  <tr key={m.mapKey} className={i % 2 ? "bg-muted" : "bg-card"}>
                    <td className={`${TD} whitespace-nowrap`}>{m.valveType}</td>
                    <td className={NUM}>{m.dn}</td>
                    <td className={TD}>{m.pn}</td>
                    <td className={`${NUM} font-semibold`}>{nm(m.requiredTorque)}</td>
                    <td className={TD}>{m.gearbox ?? "-"}</td>
                    <td className={NUM}>{nm(m.actInputTorque)}</td>
                    {shown(["AUMA"]) && <td className={TD}>{m.aumaModel ?? "-"}</td>}
                    {shown(["Rotork"]) && <td className={TD}>{m.rotorkModel ?? "-"}</td>}
                    {shown(["Rotork"]) && <td className={NUM}>{m.stockRotorkNm === null ? "none" : nm(m.stockRotorkNm)}</td>}
                    {shown(["Rotork"]) && <td className={NUM}>{m.stockRotorkNm === null ? "-" : qty(rotorkQtyByNm[m.stockRotorkNm] ?? 0)}</td>}
                    <td className={TD}>{m.valveFlange ?? "-"}</td>
                    <td className={TD}>{m.flangeCheck ?? "-"}</td>
                    {shown(["GMD"]) && <td className={TD}>{m.gmdGbCode ?? "-"}</td>}
                    {shown(["GMD"]) && <td className={NUM}>{nm(m.gmdGbRating)}</td>}
                    {shown(["GMD"]) && <td className={NUM}>{m.gmdGbCode ? qty(qtyByCode[m.gmdGbCode]) : "-"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="border-collapse text-center text-sm">
              <thead>
                <tr>
                  {["Valve type", "DN", "PN", "Required torque (Nm)"].map((h) => <th key={h} className={`${TH} text-left`}>{h}</th>)}
                  {cols.map((c) => (
                    <th key={c.code} className={TH}>
                      <div className="whitespace-nowrap">{c.label}</div>
                      <div className="font-normal text-muted-foreground">{nm(c.ratingNm)} Nm</div>
                      <div className="font-normal text-muted-foreground">stock {qty(qtyByCode[c.code])}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((m, i) => (
                  <tr key={m.mapKey} className={i % 2 ? "bg-muted" : "bg-card"}>
                    <td className={`${TD} text-left whitespace-nowrap`}>{m.valveType}</td>
                    <td className={NUM}>{m.dn}</td>
                    <td className={`${TD} text-left`}>{m.pn}</td>
                    <td className={`${NUM} font-semibold`}>{nm(m.requiredTorque)}</td>
                    {cols.map((c) => {
                      const mark = marks.get(`${m.mapKey}\n${c.code}`) ?? "";
                      const cls = mark === "✔" ? "font-bold text-green-700 dark:text-green-400" : mark === "○" ? "font-bold text-amber-600 dark:text-amber-400" : "text-muted-foreground";
                      return <td key={c.code} className={`${TD} ${cls}`}>{mark}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportTable({ title, head, rows }: { title: string; head: string[]; rows: (string | null)[][] }) {
  return (
    <section>
      <h3 className="mb-2 font-semibold text-foreground">{title}</h3>
      <table className="w-full border-collapse text-left text-sm">
        <thead><tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r, i) => <tr key={i} className={i % 2 ? "bg-muted" : "bg-card"}>{r.map((c, j) => <td key={j} className={TD}>{c ?? "-"}</td>)}</tr>)}
        </tbody>
      </table>
    </section>
  );
}
