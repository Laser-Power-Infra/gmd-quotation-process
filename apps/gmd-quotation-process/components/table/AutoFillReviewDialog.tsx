"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@gmd/ui/components/dialog";
import { Button } from "@gmd/ui/components/button";
import type { AutoFillChange } from "@/lib/detailsCheck";

const rowKey = (c: AutoFillChange) => `${c.itemId}:${c.field}`;

/** Auto-Fill review step: every proposed change as old → new with Accept / Reject per row. */
export default function AutoFillReviewDialog({
  changes,
  applying,
  onApply,
  onClose,
}: {
  /** null = closed */
  changes: AutoFillChange[] | null;
  applying: boolean;
  onApply: (accepted: AutoFillChange[]) => void;
  onClose: () => void;
}) {
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  useEffect(() => setRejected(new Set()), [changes]);

  const list = changes ?? [];
  const accepted = list.filter((c) => !rejected.has(rowKey(c)));
  const toggle = (c: AutoFillChange) =>
    setRejected((prev) => {
      const next = new Set(prev);
      if (!next.delete(rowKey(c))) next.add(rowKey(c));
      return next;
    });

  return (
    <Dialog open={changes !== null} onOpenChange={(v) => { if (!v && !applying) onClose(); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Review Auto-Fill ({accepted.length} of {list.length} accepted)
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="p-1.5 text-left">Item</th>
                <th className="p-1.5 text-left">Field</th>
                <th className="p-1.5 text-left">Old → New</th>
                <th className="p-1.5 text-right">
                  <button type="button" className="underline cursor-pointer" onClick={() => setRejected(new Set())}>Accept all</button>
                  {" · "}
                  <button type="button" className="underline cursor-pointer" onClick={() => setRejected(new Set(list.map(rowKey)))}>Reject all</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const off = rejected.has(rowKey(c));
                return (
                  <tr key={rowKey(c)} className={`border-t border-border ${off ? "opacity-50" : ""}`}>
                    <td className="p-1.5 max-w-[360px] truncate" title={c.itemName}>{c.itemName}</td>
                    <td className="p-1.5 font-semibold">{c.field}</td>
                    <td className="p-1.5">
                      <span className="text-muted-foreground">{c.oldValue || "(blank)"}</span>
                      {" → "}
                      <span className="font-semibold">{c.newValue}</span>
                      {c.verify && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">verify</span>
                      )}
                    </td>
                    <td className="p-1.5 text-right">
                      <Button type="button" size="sm" variant={off ? "outline" : "default"} onClick={() => toggle(c)}>
                        {off ? "Rejected" : "Accepted"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Changing size, type, MOC, PN or op type re-resolves the item code (and clears the BOM pick if the code changes).
        </p>
        <DialogFooter className="pt-2 border-t border-border flex justify-end gap-2">
          <DialogClose render={<Button type="button" variant="outline" size="sm" disabled={applying} />}>Cancel</DialogClose>
          <Button type="button" size="sm" disabled={applying || accepted.length === 0} onClick={() => onApply(accepted)}>
            {applying ? "Saving..." : `Apply ${accepted.length} change${accepted.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
