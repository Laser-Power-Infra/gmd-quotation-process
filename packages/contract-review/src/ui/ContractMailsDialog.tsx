"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@gmd/ui/components/dialog";
import MailThreadCard from "@gmd/dashboard/components/MailThreadCard";
import type { ActionResult, ContractMail } from "../types";

/** "Docket mails" of one contract, in the docket follow-up dashboard's thread cards. Open while `contractNo` is set. */
export function ContractMailsDialog({
  contractNo,
  load,
  onClose,
}: {
  contractNo: string | null;
  load: (contractNo: string) => Promise<ActionResult<ContractMail[]>>;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{ contractNo: string; res: ActionResult<ContractMail[]> } | null>(null);

  useEffect(() => {
    if (!contractNo) return;
    let live = true;
    load(contractNo)
      .catch((err: unknown): ActionResult<ContractMail[]> => ({
        success: false,
        error: err instanceof Error ? err.message : "Failed to load the docket mails.",
      }))
      .then((res) => {
        if (live) setResult({ contractNo, res });
      });
    return () => {
      live = false;
    };
  }, [contractNo, load]);

  // While the dialog fades out (contractNo already null) it keeps showing the last result.
  const shownNo = contractNo ?? result?.contractNo ?? null;
  const res = result && result.contractNo === shownNo ? result.res : null;
  const mails = res?.data ?? [];

  return (
    <Dialog open={!!contractNo} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Docket mails — {shownNo}
            {/* The server returns at most 200 (MAX_MAILS in the app's lib/contractMails.ts): a full list may have more. */}
            {res?.success ? (mails.length === 200 ? " (newest 200)" : ` (${mails.length})`) : ""}
          </DialogTitle>
          <DialogDescription>
            Mails from the docket follow-up dashboard for this contract&apos;s dockets, and mails that
            mention the contract no, its PO number or a docket. Newest first.
          </DialogDescription>
        </DialogHeader>
        {!res ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Loading mails…
          </div>
        ) : !res.success ? (
          <p className="py-6 text-center text-destructive">{res.error || "Failed to load the docket mails."}</p>
        ) : mails.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No docket mails found for this contract.
          </div>
        ) : (
          <div className="space-y-3">
            {mails.map((m, i) => (
              <MailThreadCard key={m.threadId} thread={m} index={i} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
