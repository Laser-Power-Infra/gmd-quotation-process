"use client";

import { Fragment, useMemo, useState } from "react";
import DebouncedSearchInput from "@/components/table/DebouncedSearchInput";
import { squish } from "@gmd/dashboard/lib/squish";
import { formatLakh } from "@/lib/debtorsAgeing";
import { formatIndianNumber } from "@/lib/formatCurrency";
import { downloadCsv, toCsv } from "@/lib/debtorJoins";
import { GLOSSARY, ageDays, lightOf, readyValue, type ContractLine } from "@/lib/executionPages";
import { Abbr, Dot, TD, TDN, TH, Tile } from "./ui";

type Line = ContractLine & { amount: number; days: number | null };

export default function ReadyToBillTable({ lines }: { lines: ContractLine[] }) {
  const [search, setSearch] = useState("");
  const [redOnly, setRedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const today = useMemo(() => new Date(), []);

  const ready = useMemo<Line[]>(
    () => lines.filter((l) => l.balBillAgMc > 0).map((l) => ({ ...l, amount: readyValue(l), days: ageDays(l.dateOfContract, today) })),
    [lines, today],
  );

  const filtered = useMemo(() => {
    const needle = squish(search);
    return ready.filter((l) => (!redOnly || lightOf("Bill", l.days) === "red") && (!needle || squish(`${l.party} ${l.contractNo} ${l.itemCode} ${l.itemName}`).includes(needle)));
  }, [ready, search, redOnly]);

  const parties = useMemo(() => {
    type Party = { party: string; amount: number; qty: number; contracts: Set<string>; lines: Line[]; maxDays: number | null };
    const m = new Map<string, Party>();
    for (const l of filtered) {
      const p: Party = m.get(l.party) ?? { party: l.party, amount: 0, qty: 0, contracts: new Set<string>(), lines: [], maxDays: null };
      p.amount += l.amount;
      p.qty += l.balBillAgMc;
      p.contracts.add(l.contractNo);
      p.lines.push(l);
      if (l.days !== null && (p.maxDays === null || l.days > p.maxDays)) p.maxDays = l.days;
      m.set(l.party, p);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [filtered]);

  const total = ready.reduce((s, l) => s + l.amount, 0);
  const redTotal = ready.filter((l) => lightOf("Bill", l.days) === "red").reduce((s, l) => s + l.amount, 0);

  const exportCsv = () =>
    downloadCsv("ready_to_bill.csv", toCsv(
      ["Party", "Contract no", "Contract date", "Item code", "Item", "MC qty", "Billed qty", "Ready to bill qty", "Rate", "Ready to bill amount"],
      filtered.map((l) => [l.party, l.contractNo, l.dateOfContract, l.itemCode, l.itemName, l.mcQty, l.billedQty, l.balBillAgMc, l.rate, l.amount]),
    ));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Ready to bill" value={formatLakh(total)} hint="Material cleared (MC) but not yet invoiced" />
        <Tile label="Stuck over 120 days" value={formatLakh(redTotal)} danger active={redOnly} hint="Click to show only these" onClick={() => setRedOnly(!redOnly)} />
        <Tile label="Parties" value={String(new Set(ready.map((l) => l.party)).size)} />
        <Tile label="Contracts" value={String(new Set(ready.map((l) => l.contractNo)).size)} />
        <Tile label="Item lines" value={String(ready.length)} />
      </div>

      <div className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Party-wise ready to bill</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{parties.length} parties</span>
          <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={exportCsv}>Download Excel (CSV)</button>
          <div className="ml-auto w-72"><DebouncedSearchInput value={search} onCommit={setSearch} placeholder="Search party, contract or item" /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/80">
              <tr>{["", "Party", "Contracts", "Ready qty", "Ready to bill amount", "Pending with"].map((h, i) => <th key={i} className={`${TH} ${i >= 2 && i <= 4 ? "text-right" : ""}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {parties.map((p) => (
                <Fragment key={p.party}>
                  <tr className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(open === p.party ? null : p.party)}>
                    <td className={TD}><Dot light={lightOf("Bill", p.maxDays)} days={p.maxDays} /></td>
                    <td className={`${TD} font-medium`}>{open === p.party ? "▾" : "▸"} {p.party}</td>
                    <td className={TDN}>{p.contracts.size}</td>
                    <td className={TDN}>{formatIndianNumber(p.qty)}</td>
                    <td className={TDN}>{formatLakh(p.amount)}</td>
                    <td className={TD}>Accounts (billing)</td>
                  </tr>
                  {open === p.party && (
                    <tr>
                      <td colSpan={6} className="bg-muted/20 p-3">
                        <table className="w-full border-collapse text-[12px]">
                          <thead>
                            <tr>
                              {["Contract no", "Contract date", "Item"].map((h) => <th key={h} className={TH}>{h}</th>)}
                              <th className={`${TH} text-right`}><Abbr text="MC qty" hint={GLOSSARY.MC} /></th>
                              {["Billed qty", "Ready qty", "Rate", "Amount"].map((h) => <th key={h} className={`${TH} text-right`}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {p.lines.map((l, i) => (
                              <tr key={`${l.contractNo}-${l.itemCode}-${i}`}>
                                <td className={TD}>{l.contractNo}</td>
                                <td className={TD}>{l.dateOfContract ?? "-"}</td>
                                <td className={TD}>{l.itemCode} {l.itemName}</td>
                                <td className={TDN}>{formatIndianNumber(l.mcQty)}</td>
                                <td className={TDN}>{formatIndianNumber(l.billedQty)}</td>
                                <td className={TDN}>{formatIndianNumber(l.balBillAgMc)}</td>
                                <td className={TDN}>{formatIndianNumber(l.rate, 2)}</td>
                                <td className={TDN}>{formatIndianNumber(l.amount, 2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {parties.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">Nothing ready to bill.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
