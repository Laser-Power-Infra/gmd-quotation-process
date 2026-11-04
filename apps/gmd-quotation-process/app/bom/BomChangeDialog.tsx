"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@gmd/ui/components/dialog";
import { saveBomChangeDraftAction } from "@/app/actions/bomChange";
import type { BomChangeKind, BomChangeLine } from "@/lib/bomColumns";

export interface BomChangeDraft {
  id?: string;
  kind: BomChangeKind;
  bomId: string | null;
  itemCode: string;
  itemName?: string | null;
  lines: BomChangeLine[];
  note?: string | null;
}

const TITLE: Record<BomChangeKind, string> = {
  EDIT: "Edit BOM",
  REOPEN: "Reopen + correct BOM",
  CREATE: "Create BOM",
  CLOSE: "Close BOM",
};

/** One dialog for every kind of BomChange: lines (child code + qty) + note, saved as Draft or Submitted. */
export default function BomChangeDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: BomChangeDraft | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<BomChangeLine[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setLines(draft.lines.length ? draft.lines.map((l) => ({ ...l })) : [{ code: "", qty: 1 }]);
    setNote(draft.note ?? "");
  }, [draft]);

  if (!draft) return null;

  const save = async (submit: boolean) => {
    setBusy(true);
    try {
      const res = await saveBomChangeDraftAction({
        id: draft.id,
        kind: draft.kind,
        bomId: draft.bomId,
        itemCode: draft.itemCode,
        lines,
        note,
        submit,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(submit ? "Submitted for approval" : "Draft saved");
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const setLine = (i: number, patch: Partial<BomChangeLine>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-130">
        <DialogHeader>
          <DialogTitle>
            {TITLE[draft.kind]} · {draft.itemCode}
            {draft.bomId ? ` · ${draft.bomId}` : ""}
          </DialogTitle>
          <DialogDescription>
            {draft.itemName || ""}
            {draft.kind === "CLOSE"
              ? " All lines of this BOM will be marked NO USE once approved."
              : " The lines below replace the BOM's open lines once approved."}
          </DialogDescription>
        </DialogHeader>

        {draft.kind !== "CLOSE" && (
          <div className="grid gap-2 text-xs">
            <div className="grid grid-cols-[1fr_80px_32px] gap-2 font-semibold text-muted-foreground">
              <span>Child code (RM or FG)</span>
              <span>Qty</span>
              <span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_32px] gap-2">
                <Input
                  value={l.code}
                  onChange={(e) => setLine(i, { code: e.target.value.toUpperCase() })}
                  placeholder="e.g. RSD080005 or FBS040002"
                  className="h-8 text-xs uppercase"
                />
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove line"
                >
                  ×
                </Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => setLines((p) => [...p, { code: "", qty: 1 }])}>
              + Add line
            </Button>
          </div>
        )}

        <label className="grid gap-1 text-xs">
          <span className="font-semibold text-muted-foreground">Note (why)</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" placeholder="e.g. size corrected per review list row 12" />
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => save(false)} disabled={busy}>
            Save draft
          </Button>
          <Button type="button" onClick={() => save(true)} disabled={busy}>
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
