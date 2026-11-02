"use client";

import { useState } from "react";
import { Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@gmd/ui/components/dialog";
import { checkDocketCodeMismatchesAction, type DocketCodeMismatch } from "@/app/actions/contractMatch";
import { useAppDispatch } from "@/lib/hooks";
import { markEnquiryPageStale, updateItemField } from "@/lib/enquiriesSlice";

/**
 * Item-code check: docket lines whose code differs from the line of their
 * linked contract(s) with the same size and qty. "Use" rewrites the item code
 * through the normal item-code edit (BOM candidates are re-synced).
 */
export default function CodeCheckButton() {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [rows, setRows] = useState<DocketCodeMismatch[]>([]);

  const check = async () => {
    setLoading(true);
    const res = await checkDocketCodeMismatchesAction();
    setLoading(false);
    if (!res.success) return toast.error(res.error);
    setRows(res.data);
    setOpen(true);
  };

  const fix = async (row: DocketCodeMismatch, code: string) => {
    setFixing(row.itemId);
    try {
      await dispatch(updateItemField({ itemId: row.itemId, field: "erpItemCode", value: code })).unwrap();
      setRows((r) => r.filter((x) => x.itemId !== row.itemId));
      dispatch(markEnquiryPageStale());
      toast.success(`${row.docketNumber}: ${row.docketCode ?? "blank"} -> ${code}`);
    } catch (err: unknown) {
      toast.error(typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to update the item code.");
    } finally {
      setFixing(null);
    }
  };

  return (
    <>
      <Button
        onClick={check}
        disabled={loading}
        title="Flag docket items whose item code differs from the contract line of the same size and qty"
        className="flex h-9 items-center gap-1.5 border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
        Code Check
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Item code check</DialogTitle>
            <DialogDescription>
              {rows.length
                ? `${rows.length} docket line(s) whose code is not on the linked contract line of the same size and qty.`
                : "Every docket linked to a contract matches its contract codes."}
            </DialogDescription>
          </DialogHeader>
          {rows.length > 0 && (
            <div className="grid gap-1 text-xs">
              {rows.map((r) => (
                <div key={r.itemId} className="flex items-center justify-between gap-3 rounded border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {r.docketNumber} <span className="font-normal text-muted-foreground">({r.contractNos.join(", ")})</span>
                    </div>
                    <div className="truncate text-muted-foreground">
                      DN{r.size} x {r.qty} · {r.itemName} · docket code{" "}
                      <span className="font-mono text-red-600">{r.docketCode ?? "blank"}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {r.contractCodes.map((code) => (
                      <Button
                        key={code}
                        onClick={() => fix(r, code)}
                        disabled={fixing !== null}
                        title={`Set the item code to the contract code ${code}`}
                        className="h-7 px-2 font-mono text-[11px]"
                      >
                        {fixing === r.itemId ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Use {code}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
