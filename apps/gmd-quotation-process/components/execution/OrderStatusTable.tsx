"use client";

import { Fragment, useMemo, useState } from "react";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import { formatLakh } from "@/lib/debtorsAgeing";
import { formatIndianNumber } from "@/lib/formatCurrency";
import { downloadCsv, toCsv } from "@/lib/debtorJoins";
import { GLOSSARY, PENDING_WITH, STAGES, ageDays, lightOf, stageOf, type ContractLine, type Stage } from "@/lib/executionPages";
import { fetchContractInvoicesAction } from "@/app/actions/executionPages";
import type { InvoiceLine } from "@/lib/executionPages-server";
import { Abbr, Dot, TD, TDN, TH, Tile } from "./ui";

type Contract = { contractNo: string; party: string; date: string | null; days: number | null; stage: Stage; value: number; lines: (ContractLine & { stage: Stage })[] };

const list = (a: string[]) => (a.length ? a.join(", ") : "-");

export default function OrderStatusTable({ lines }: { lines: ContractLine[] }) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<Stage | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Record<string, InvoiceLine[] | string>>({});
  const today = useMemo(() => new Date(), []);

  const contracts = useMemo(() => {
    const map = new Map<string, Contract>();
    for (const l of lines) {
      const s = stageOf(l);
      const c: Contract = map.get(l.contractNo) ?? { contractNo: l.contractNo, party: l.party, date: l.dateOfContract, days: ageDays(l.dateOfContract, today), stage: "Done", value: 0, lines: [] };
      c.lines.push({ ...l, stage: s });
      c.value += l.orderQty * l.rate;
      // A contract sits at its least-advanced open line.
      if (STAGES.indexOf(s) < STAGES.indexOf(c.stage)) c.stage = s;
      map.set(l.contractNo, c);
    }
    return [...map.values()].sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  }, [lines, today]);

  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, contracts.filter((c) => c.stage === s).length])) as Record<Stage, number>, [contracts]);

  const shown = useMemo(() => {
    const needle = squish(search);
    return contracts.filter((c) => {
      if (stage ? c.stage !== stage : !showDone && c.stage === "Done") return false;
      return !needle || squish(`${c.contractNo} ${c.party} ${c.lines.map((l) => `${l.itemCode} ${l.itemName}`).join(" ")}`).includes(needle);
    });
  }, [contracts, search, stage, showDone]);

  const toggle = async (no: string) => {
    setOpen(open === no ? null : no);
    if (open === no || invoices[no]) return;
    const res = await fetchContractInvoicesAction(no);
    setInvoices((m) => ({ ...m, [no]: res.success ? res.invoices : res.error }));
  };

  const exportCsv = () =>
    downloadCsv("order_status.csv", toCsv(
      ["Contract no", "Party", "Contract date", "Item code", "Item", "Order qty", "MC qty", "Prod order qty", "DI qty", "Billed qty", "Stage", "Pending with", "Prod order no", "Inspection offers", "Inspections", "DI dates"],
      shown.flatMap((c) => c.lines.map((l) => [c.contractNo, c.party, c.date, l.itemCode, l.itemName, l.orderQty, l.mcQty, l.prodOrdQty, l.diQty, l.billedQty, l.stage, PENDING_WITH[l.stage], l.productionOrderNumber, list(l.offerNumber), list(l.inspectionNumber), list(l.diDate)])),
    ));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {STAGES.map((s) => (
          <Tile key={s} label={s === "Done" ? "Fully billed" : `At ${s}`} value={String(counts[s])} hint={`${PENDING_WITH[s]}. Click to filter.`} active={stage === s} onClick={() => setStage(stage === s ? null : s)} />
        ))}
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Contracts</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{shown.length}</span>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show fully billed
          </label>
          {stage && <button type="button" className="text-xs text-primary underline" onClick={() => setStage(null)}>Clear: {stage}</button>}
          <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={exportCsv}>Download Excel (CSV)</button>
          <div className="ml-auto w-72"><DebouncedSearchInput value={search} onCommit={setSearch} placeholder="Search contract, party or item" /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/80">
              <tr>
                {["", "Contract no", "Party", "Contract date", "Items", "Order value", "Where it is", "Pending with"].map((h, i) => <th key={i} className={`${TH} ${i === 5 ? "text-right" : ""}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((c) => {
                const inv = invoices[c.contractNo];
                return (
                  <Fragment key={c.contractNo}>
                    <tr className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(c.contractNo)}>
                      <td className={TD}><Dot light={lightOf(c.stage, c.days)} days={c.days} /></td>
                      <td className={`${TD} font-medium`}>{open === c.contractNo ? "▾" : "▸"} {c.contractNo}</td>
                      <td className={TD}>{c.party}</td>
                      <td className={TD}>{c.date ?? "-"}</td>
                      <td className={TDN}>{c.lines.length}</td>
                      <td className={TDN}>{formatLakh(c.value)}</td>
                      <td className={TD}>{c.stage === "Done" ? "Fully billed" : c.stage}</td>
                      <td className={TD}>{PENDING_WITH[c.stage]}</td>
                    </tr>
                    {open === c.contractNo && (
                      <tr>
                        <td colSpan={8} className="bg-muted/20 p-3">
                          <div className="mb-1 text-xs font-semibold">Paper trail: order, production, inspection offer, inspection, dispatch, invoice</div>
                          <table className="w-full border-collapse text-[12px]">
                            <thead>
                              <tr>
                                <th className={TH}>Item</th>
                                {(["Order qty", "MC", "Prod order", "DI", "Bill"] as const).map((h) => <th key={h} className={`${TH} text-right`}><Abbr text={h === "Order qty" ? h : `${h} qty`} hint={GLOSSARY[h]} /></th>)}
                                <th className={TH}><Abbr text="Prod order no" hint={GLOSSARY["Prod order"]} /></th>
                                <th className={TH}><Abbr text="Inspection offer" hint={GLOSSARY.Offer} /></th>
                                <th className={TH}><Abbr text="Inspection no" hint={GLOSSARY.Inspection} /></th>
                                <th className={TH}><Abbr text="DI date" hint={GLOSSARY.DI} /></th>
                                <th className={TH}>Stage</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {c.lines.map((l, i) => (
                                <tr key={`${l.itemCode}-${i}`}>
                                  <td className={TD}>{l.itemCode} {l.itemName}</td>
                                  {[l.orderQty, l.mcQty, l.prodOrdQty, l.diQty, l.billedQty].map((q, j) => <td key={j} className={TDN}>{formatIndianNumber(q)}</td>)}
                                  <td className={TD}>{l.productionOrderNumber ?? "-"}</td>
                                  <td className={TD}>{list(l.offerNumber)}</td>
                                  <td className={TD}>{list(l.inspectionNumber)}</td>
                                  <td className={TD}>{list(l.diDate)}</td>
                                  <td className={TD}>{l.stage === "Done" ? "Fully billed" : l.stage}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="mb-1 mt-3 text-xs font-semibold">Invoices against this contract</div>
                          {inv === undefined ? (
                            <div className="text-xs text-muted-foreground">Loading...</div>
                          ) : typeof inv === "string" ? (
                            <div className="text-xs text-red-600">{inv}</div>
                          ) : inv.length === 0 ? (
                            <div className="text-xs text-muted-foreground">No invoice yet.</div>
                          ) : (
                            <table className="w-full border-collapse text-[12px]">
                              <thead><tr>{["Invoice no", "Date", "Item", "Qty", "Value", "LR no / date", "Documents"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                              <tbody className="divide-y divide-border/60">
                                {inv.map((v, i) => (
                                  <tr key={`${v.invoiceNo}-${i}`}>
                                    <td className={TD}>{v.invoiceNo}</td>
                                    <td className={TD}>{v.date ?? "-"}</td>
                                    <td className={TD}>{v.itemCode} {v.itemName}</td>
                                    <td className={TDN}>{v.qty ?? "-"}</td>
                                    <td className={TDN}>{formatIndianNumber(v.value, 2) || "-"}</td>
                                    <td className={TD}>{v.lrNoDt ?? "-"}</td>
                                    <td className={TD}>
                                      {([["Order copy", v.orderCopy], ["Invoice", v.invoice], ["Inspection report", v.inspectionReport]] as const)
                                        .filter(([, u]) => u && /^https?:\/\//i.test(u))
                                        .map(([label, u]) => <a key={label} href={u!} target="_blank" rel="noreferrer" className="mr-2 text-primary underline">{label}</a>)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">No contracts match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
