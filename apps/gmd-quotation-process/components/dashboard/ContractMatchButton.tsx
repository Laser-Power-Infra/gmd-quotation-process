"use client";

import { useMemo, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@gmd/ui/components/button";
import { Input } from "@gmd/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@gmd/ui/components/dialog";
import {
  applyContractDocketMatchAction,
  listLiveContractsAction,
  suggestDocketsForContractsAction,
  type LiveContractRow,
  type MatchedItemResult,
} from "@/app/actions/contractMatch";
import type { DocketSuggestion, SkippedRateLine } from "@/lib/contractDocketMatch";
import { useAppDispatch } from "@/lib/hooks";
import { markEnquiryPageStale } from "@/lib/enquiriesSlice";
import { looseIncludes } from "@/lib/squish";

type Applied = { docketNumber: string; selectedContractNo: string[]; matchedCodes: number; items: MatchedItemResult[]; skipped: SkippedRateLine[] };

/**
 * Contract -> docket match. Pick live contract(s), get the top 3 dockets of the
 * same party by codes with equal total qty, confirm to link the contract(s) and
 * set quoted rate = contract rate on the matched codes. Also lists the live
 * contracts that have no docket yet (they need a back-dated docket).
 */
export default function ContractMatchButton() {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [contracts, setContracts] = useState<LiveContractRow[]>([]);
  const [search, setSearch] = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<DocketSuggestion[] | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);

  const unlinkedCount = contracts.filter((c) => c.dockets.length === 0).length;
  const shown = useMemo(
    () =>
      contracts.filter(
        (c) =>
          (!onlyUnlinked || c.dockets.length === 0) &&
          (!search || looseIncludes(`${c.contractNo} ${c.party} ${c.dockets.join(" ")}`, search)),
      ),
    [contracts, onlyUnlinked, search],
  );

  const reload = async () => {
    setBusy("list");
    const res = await listLiveContractsAction();
    setBusy(null);
    if (!res.success) return toast.error(res.error);
    setContracts(res.data);
  };

  const handleOpen = async () => {
    setOpen(true);
    setPicked([]);
    setSuggestions(null);
    setApplied(null);
    await reload();
  };

  const toggle = (cn: string) => {
    setSuggestions(null);
    setApplied(null);
    setPicked((p) => (p.includes(cn) ? p.filter((x) => x !== cn) : [...p, cn]));
  };

  const suggest = async () => {
    setBusy("suggest");
    const res = await suggestDocketsForContractsAction(picked);
    setBusy(null);
    if (!res.success) return toast.error(res.error);
    setSuggestions(res.data);
    if (res.data.length === 0) toast.info("No docket of this party shares an item code. Create a back-dated docket.");
  };

  const confirm = async (s: DocketSuggestion) => {
    setBusy(s.id);
    const res = await applyContractDocketMatchAction(s.id, picked);
    setBusy(null);
    if (!res.success) return toast.error(res.error);
    setApplied(res.data);
    dispatch(markEnquiryPageStale());
    const negative = res.data.negativeVaCount;
    const failed = res.data.items.length - res.data.updated;
    const skipped = res.data.skippedCount;
    toast.success(
      `${res.data.docketNumber} linked to ${res.data.selectedContractNo.join(", ")}. ${res.data.updated} item(s) updated to contract rate.` +
        (negative ? ` ${negative} with negative VA% - review.` : "") +
        (failed ? ` ${failed} not updated.` : "") +
        (skipped ? ` ${skipped} line(s) got no contract rate - review.` : ""),
    );
    await reload();
  };

  return (
    <>
      <Button
        onClick={handleOpen}
        title="Match a live contract to its docket and write the contract no and contract rates back"
        className="flex h-9 items-center gap-1.5 border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent"
      >
        <Link2 className="h-4 w-4" />
        Contract Match
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Contract to docket match</DialogTitle>
            <DialogDescription>
              {unlinkedCount} live contract(s) have no docket. Pick one or more contracts of a docket, then
              confirm the suggested docket.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 text-xs">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contract, party or docket..."
              className="h-8 text-xs"
            />
            <label className="flex shrink-0 items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} />
              Only without docket
            </label>
          </div>

          <div className="max-h-64 overflow-y-auto rounded border border-border text-xs">
            {busy === "list" && contracts.length === 0 ? (
              <div className="flex items-center gap-2 p-3 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading contracts...
              </div>
            ) : shown.length === 0 ? (
              <div className="p-3 text-muted-foreground">No contracts.</div>
            ) : (
              shown.map((c) => (
                <label
                  key={c.contractNo}
                  className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0 hover:bg-accent"
                >
                  <input type="checkbox" checked={picked.includes(c.contractNo)} onChange={() => toggle(c.contractNo)} />
                  <span className="w-28 shrink-0 font-mono font-semibold">{c.contractNo}</span>
                  <span className="flex-1 truncate">{c.party || "-"}</span>
                  <span className="w-24 shrink-0 text-muted-foreground">{c.dateOfContract || ""}</span>
                  <span className={`w-36 shrink-0 truncate text-right ${c.dockets.length ? "" : "font-semibold text-red-600"}`}>
                    {c.dockets.length ? c.dockets.join(", ") : "No docket"}
                  </span>
                </label>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {picked.length ? `Picked: ${picked.join(", ")}` : "Pick the contract(s) of one docket."}
            </span>
            <Button onClick={suggest} disabled={picked.length === 0 || busy !== null} className="h-8 text-xs">
              {busy === "suggest" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Suggest dockets
            </Button>
          </div>

          {suggestions && suggestions.length > 0 && (
            <div className="grid gap-2 text-xs">
              {suggestions.map((s, i) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded border border-border px-2.5 py-2">
                  <div>
                    <div className="font-semibold">
                      {i + 1}. {s.docketNumber}{" "}
                      <span className="font-normal text-muted-foreground">
                        {new Date(s.enquiryDate).toLocaleDateString("en-GB")}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      {s.matchedCodes.length} of {s.contractCodes} code(s) with equal total qty · {s.commonCodes} code(s) in
                      common · contracts {s.contractNos.join(", ")}
                    </div>
                  </div>
                  <Button onClick={() => confirm(s)} disabled={busy !== null} className="h-8 shrink-0 text-xs">
                    {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Confirm
                  </Button>
                </div>
              ))}
            </div>
          )}

          {applied && (
            <div className="grid gap-1 text-xs">
              <div className="font-semibold">
                {applied.docketNumber}: {applied.matchedCodes} matched code(s), contracts {applied.selectedContractNo.join(", ")}
              </div>
              {applied.items.length === 0 ? (
                <div className="text-muted-foreground">No matched code carries a single contract rate; no rate changed.</div>
              ) : (
                applied.items.map((it) => (
                  <div
                    key={it.itemId}
                    className={`flex justify-between gap-3 rounded px-2 py-1 ${it.negativeVa ? "bg-red-500/10 text-red-600" : "bg-muted/40"}`}
                  >
                    <span className="truncate">
                      <span className="font-mono">{it.code}</span> {it.itemName}
                    </span>
                    <span className="shrink-0">
                      {it.error
                        ? it.error
                        : `QR ${it.oldRate ?? "-"} -> ${it.contractRate} · VA% ${it.vaPercent ?? "-"}${it.negativeVa ? " · NEGATIVE VA%" : ""}`}
                    </span>
                  </div>
                ))
              )}
              {applied.skipped.length > 0 && (
                <>
                  <div className="mt-1 font-semibold text-red-600">
                    {applied.skipped.length} line(s) got no contract rate - fix and re-apply:
                  </div>
                  {applied.skipped.map((s, i) => (
                    <div key={`${s.itemId}-${i}`} className="flex justify-between gap-3 rounded bg-red-500/10 px-2 py-1 text-red-600">
                      <span className="truncate">
                        <span className="font-mono">{s.code ?? "-"}</span> {s.itemName}
                      </span>
                      <span className="shrink-0">{s.reason}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
