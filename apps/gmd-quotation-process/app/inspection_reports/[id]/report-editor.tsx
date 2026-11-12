"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { saveInspectionReportAction } from "../actions";
import {
  HEADER_FIELDS,
  REPORT_STATUSES,
  checkReport,
  type ReportData,
  type ReportItem,
  type TeamMember,
} from "@/lib/inspectionReport";

const ITEM_COLUMNS: [keyof ReportItem, string][] = [
  ["itemCode", "Item code"],
  ["itemName", "Description"],
  ["size", "Size"],
  ["pnRating", "PN"],
  ["material", "Material"],
  ["um", "UM"],
  ["contractQty", "Contract qty"],
  ["alreadyInspected", "Already inspected"],
  ["qtyOffered", "Qty offered"],
  ["reportQty", "Report qty"],
  ["serialFrom", "Serial from"],
  ["serialTo", "Serial to"],
  ["remarks", "Remarks"],
];

const QAP_FIELDS: [keyof ReportData["qap"], string][] = [
  ["qapNo", "QAP no."],
  ["mfgStandard", "MFG standard"],
  ["bodyPressure", "Hydro body pressure"],
  ["seatPressure", "Hydro seat pressure"],
  ["duration", "Duration"],
];

const TEAM_FIELDS: [keyof TeamMember, string][] = [
  ["agency", "Agency"],
  ["name", "Name"],
  ["designation", "Designation"],
];

const inputCls = "h-8 w-full rounded-md border border-slate-300 px-2 text-sm";

export function ReportEditor({
  id,
  offerNo,
  initialStatus,
  initialData,
}: {
  id: string;
  offerNo: string;
  initialStatus: string;
  initialData: ReportData;
}) {
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();
  const checks = useMemo(() => checkReport(data), [data]);

  const setHeader = (k: keyof ReportData["header"], v: string) =>
    setData((d) => ({ ...d, header: { ...d.header, [k]: v } }));
  const setItem = (i: number, k: keyof ReportItem, v: string) =>
    setData((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const setTeam = (f: (t: TeamMember[]) => TeamMember[]) => setData((d) => ({ ...d, team: f(d.team ?? []) }));
  const setMember = (i: number, k: keyof TeamMember, v: string) =>
    setTeam((t) => t.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  const save = () =>
    startTransition(async () => {
      const res = await saveInspectionReportAction(id, status, data);
      if (res.success) toast.success("Saved");
      else toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/inspection_reports" className="text-sm text-blue-700 underline">
          ← All offers
        </Link>
        <h1 className="text-lg font-semibold">Inspection Report — {offerNo}</h1>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="ml-auto h-8 rounded-md border border-slate-300 px-2 text-sm"
          aria-label="Status"
        >
          {REPORT_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>

      <section>
        <h2 className="mb-2 font-medium">Header</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {HEADER_FIELDS.map(([k, label]) => (
            <label key={k} className="text-xs text-slate-600">
              {label}
              <input className={inputCls} value={data.header[k]} onChange={(e) => setHeader(k, e.target.value)} />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Inspecting team</h2>
        <div className="grid gap-2">
          {(data.team ?? []).map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_32px] items-end gap-2">
              {TEAM_FIELDS.map(([k, label]) => (
                <label key={k} className="text-xs text-slate-600">
                  {label}
                  <input className={inputCls} value={m[k]} onChange={(e) => setMember(i, k, e.target.value)} />
                </label>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                aria-label="Remove member"
                onClick={() => setTeam((t) => t.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => setTeam((t) => [...t, { agency: "", name: "", designation: "" }])}
          >
            + Add member
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                {ITEM_COLUMNS.map(([k, label]) => (
                  <th key={k} className="px-1 py-1 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={i}>
                  {ITEM_COLUMNS.map(([k, label]) => (
                    <td key={k} className="px-1 py-0.5">
                      <input
                        className={`${inputCls} min-w-24`}
                        aria-label={label}
                        value={it[k]}
                        onChange={(e) => setItem(i, k, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Standards &amp; tests (QAP)</h2>
        <p className="mb-2 text-xs text-slate-500">Placeholder until approved QAP data is in the system.</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {QAP_FIELDS.map(([k, label]) => (
            <label key={k} className="text-xs text-slate-600">
              {label}
              <input
                className={inputCls}
                value={data.qap[k]}
                onChange={(e) => setData((d) => ({ ...d, qap: { ...d.qap, [k]: e.target.value } }))}
              />
            </label>
          ))}
        </div>
      </section>

      {(
        [
          ["tolerance", "Dimensions & tolerance", "Placeholder until drawing / tolerance data is in the system."],
          ["mtc", "MTC & calibration", "Placeholder until the MTC library is in the system."],
          ["observations", "Observations", ""],
        ] as const
      ).map(([k, title, note]) => (
        <section key={k}>
          <h2 className="mb-1 font-medium">{title}</h2>
          {note && <p className="mb-1 text-xs text-slate-500">{note}</p>}
          <textarea
            className="min-h-20 w-full rounded-md border border-slate-300 p-2 text-sm"
            aria-label={title}
            value={data[k]}
            onChange={(e) => setData((d) => ({ ...d, [k]: e.target.value }))}
          />
        </section>
      ))}

      <section>
        <h2 className="mb-2 font-medium">Checks (must all pass for reviewed / final)</h2>
        <ul className="space-y-1 text-sm">
          {checks.map((c, i) => (
            <li key={i} className={c.ok ? "text-green-700" : "text-red-700"}>
              {c.ok ? "✓" : "✗"} {c.label}
              {c.detail && <span className="text-slate-500"> — {c.detail}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
