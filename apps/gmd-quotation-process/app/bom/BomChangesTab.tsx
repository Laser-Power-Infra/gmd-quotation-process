"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@gmd/ui/components/button";
import { SortTh } from "@gmd/ui/components/plain-table";
import type { TableSort } from "@gmd/ui/components/data-table/types";
import { sortRows } from "@gmd/dashboard/lib/tableSort";
import {
  approveBomChangeAction,
  deleteBomChangeAction,
  listBomChangesAction,
  proposeMissingBomsAction,
  rejectBomChangeAction,
  submitBomChangeAction,
  type BomChangeView,
} from "@/app/actions/bomChange";
import { BOM_CHANGE_STATUSES, type BomChangeStatus } from "@/lib/bomColumns";
import BomChangeDialog, { type BomChangeDraft } from "./BomChangeDialog";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-foreground",
  SUBMITTED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  APPROVED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

const TH = "px-2 py-1.5 font-bold uppercase tracking-wider border-b border-border whitespace-nowrap";
// Sort key per column (null = not sortable); ISO dates sort correctly as text, Status in workflow order.
const COLS = [
  ["createdAt", "When"], ["kind", "Kind"], ["status", "Status"], ["itemCode", "Item code"], ["bomId", "BOM ID"],
  [null, "Lines (code × qty)"], ["source", "Source"], ["note", "Note"], ["createdBy", "Raised by"], ["approvedBy", "Decided by"], [null, ""],
] as const;

/**
 * BOM change requests: Draft -> Submitted -> Approved / Rejected. The rows are
 * the history (who raised, who approved, when). "BOMs to create" is the CREATE
 * kind, carrying the docket / contract number that asked for it.
 */
export default function BomChangesTab() {
  const [rows, setRows] = useState<BomChangeView[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("SUBMITTED");
  const [kind, setKind] = useState<string>("");
  const [sort, setSort] = useState<TableSort | null>(null);
  const [editing, setEditing] = useState<BomChangeDraft | null>(null);
  const [proposing, setProposing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listBomChangesAction();
    if (res.success) {
      setRows(res.data);
      setCanApprove(res.canApprove);
    } else toast.error(res.error);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      sortRows(
        rows.filter((r) => (!status || r.status === status) && (!kind || r.kind === kind)),
        sort,
        (r, k) => (k === "status" ? BOM_CHANGE_STATUSES.indexOf(r.status as BomChangeStatus) : r[k as keyof BomChangeView]),
      ),
    [rows, status, kind, sort],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const run = async (label: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    const id = toast.loading(label);
    const res = await fn();
    if (!res.success) toast.error(res.error ?? "Failed", { id });
    else {
      toast.success("Done", { id });
      await load();
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col p-6 gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Status:</span>
        {["", ...BOM_CHANGE_STATUSES].map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded border px-2 py-1 ${status === s ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground"}`}
          >
            {s || "All"} {s ? `(${counts[s] ?? 0})` : `(${rows.length})`}
          </button>
        ))}
        <span className="ml-3 font-semibold">Kind:</span>
        {["", "CREATE", "EDIT", "REOPEN", "CLOSE"].map((k) => (
          <button
            key={k || "all"}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded border px-2 py-1 ${kind === k ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border text-muted-foreground"}`}
          >
            {k === "CREATE" ? "BOMs to create" : k || "All"}
          </button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={proposing}
          onClick={async () => {
            setProposing(true);
            const res = await proposeMissingBomsAction();
            setProposing(false);
            toast[res.failed ? "error" : "success"](`${res.proposed} BOM(s) proposed from sent dockets + live contracts`);
            void load();
          }}
          title="Propose BOMs for item codes in sent dockets and live contracts that have no open BOM"
        >
          {proposing ? <Loader2 size={12} className="animate-spin" /> : null} Propose missing BOMs
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr className="text-left">
              {COLS.map(([k, h]) =>
                k ? <SortTh key={k} k={k} label={h} sort={sort} onSort={setSort} className={TH} /> : <th key={h} className={TH}>{h}</th>,
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-6 text-center text-muted-foreground">
                  No changes
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.id} className="border-b border-border align-top hover:bg-muted/50">
                  <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.createdAt)}</td>
                  <td className="px-2 py-1.5 font-semibold">{r.kind}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${STATUS_TONE[r.status] ?? ""}`}>{r.status}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono">{r.itemCode}</td>
                  <td className="px-2 py-1.5 font-mono">{r.bomId ?? ""}</td>
                  <td className="px-2 py-1.5">
                    {r.lines.map((l) => (
                      <div key={l.code} className="font-mono">
                        {l.code} × {l.qty}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.source ?? ""}</td>
                  <td className="px-2 py-1.5 max-w-60">{r.note ?? ""}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.createdBy ?? ""}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.approvedBy ?? ""}
                    {r.approvedAt ? <div className="text-muted-foreground">{fmt(r.approvedAt)}</div> : null}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex gap-1">
                      {(r.status === "DRAFT" || r.status === "REJECTED") && (
                        <>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setEditing({ ...r, kind: r.kind as BomChangeDraft["kind"] })}>
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => run("Submitting…", () => submitBomChangeAction(r.id))}>
                            Submit
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => run("Deleting…", () => deleteBomChangeAction(r.id))}>
                            Delete
                          </Button>
                        </>
                      )}
                      {r.status === "SUBMITTED" && canApprove && (
                        <>
                          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => run("Approving and applying…", () => approveBomChangeAction(r.id))}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => run("Rejecting…", () => rejectBomChangeAction(r.id))}>
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <BomChangeDialog draft={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}
