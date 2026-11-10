"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@gmd/ui/components/dialog";
import { Button } from "@gmd/ui/components/button";
import { useAppDispatch } from "@/lib/hooks";
import { saveActuatorFields } from "@/lib/enquiriesSlice";
import { actuatorOp, CONTROL_TYPES, SPECIAL_OEM } from "@/lib/actuatorCost";
import { stockLabel, stockText, type ItemStock } from "@/lib/actuatorStock";
import type { EnquiryItemData } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Chip under the Cost cell of an actuated item: shows the build-up / "price pending", click to edit codes and extras. */
export default function ActuatorChip({ item, frozen }: { item: EnquiryItemData; frozen: boolean }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ make: "", control: "", act: "", gb: "", adaptor: "", assembly: "" });
  const actuated = actuatorOp(item.operationType).act || (item.itemType ?? "").toUpperCase() === "ACTUATOR";
  if (!actuated) return null;
  const b = item.actuatorBreakdown as { pending?: string[]; text?: string } | null | undefined;
  const pending = !!b?.pending?.length;
  // Stock read by Sync Available Stock; ignored once the codes were changed since.
  const st = (item.actuatorBreakdown as { stock?: ItemStock } | null)?.stock;
  const stock = st && st.actCode === (item.actCode ?? null) && st.gbCode === (item.gbCode ?? null) ? st : null;
  const special = !!b?.pending?.includes(SPECIAL_OEM);
  const show = () => {
    setF({ make: item.actuatorMake ?? "", control: item.controlType ?? "", act: item.actCode ?? "", gb: item.gbCode ?? "", adaptor: item.adaptorCost?.toString() ?? "", assembly: item.assemblyCost?.toString() ?? "" });
    setOpen(true);
  };
  const save = async () => {
    const amt = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
    // Make changed but codes left alone: omit them so the server re-picks the codes for the new make.
    const repick = f.make !== (item.actuatorMake ?? "") && f.act === (item.actCode ?? "") && f.gb === (item.gbCode ?? "");
    const patch = {
      actuatorMake: f.make || null, controlType: f.control || null,
      ...(repick ? {} : { actCode: f.act.trim() || null, gbCode: f.gb.trim() || null }),
      adaptorCost: amt(f.adaptor), assemblyCost: amt(f.assembly),
    };
    if ([patch.adaptorCost, patch.assemblyCost].some((n) => n !== null && !(n >= 0))) { toast.error("Adaptor and assembly must be numbers, or blank."); return; }
    try { await dispatch(saveActuatorFields({ itemId: item.id, patch })).unwrap(); setOpen(false); }
    catch (e) { toast.error(typeof e === "string" ? e : "Could not save the actuator details."); }
  };
  const input = "h-7 w-full rounded border border-border bg-background px-2 text-xs";
  const row = (label: string, el: React.ReactNode) => <label className="block text-xs"><span className="text-muted-foreground">{label}</span>{el}</label>;
  return (
    <>
      <button
        type="button"
        onClick={show}
        title={b?.text ?? "Click to set the actuator. Use Fetch Actuator to fill codes and price."}
        className={cn("block w-full text-[9px] text-right px-1 font-bold hover:underline cursor-pointer",
          special ? "text-red-700 dark:text-red-300" : pending || !b ? "text-amber-700 dark:text-amber-300" : "text-sky-700 dark:text-sky-300")}
      >
        {special ? SPECIAL_OEM + " · OEM recheck" : pending || !b ? "Actuator · price pending" : "Actuator · priced"}
      </button>
      {stock && (
        <span title={stockText(stock)} className={cn("block w-full text-[9px] text-right px-1 font-bold", stock.short.length ? "text-red-700 dark:text-red-300" : "text-muted-foreground")}>
          {stockLabel(stock)}
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Actuator: {item.itemName}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">{b?.text ?? "Not priced yet. Fetch Actuator fills the codes and price from the master."}</p>
          {stock && <p className={cn("text-xs", stock.short.length ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}>Stock: {stockText(stock)}</p>}
          <div className="grid grid-cols-2 gap-2">
            {row("Make (blank = AUMA)", <select className={input} value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })}><option value="">-</option><option>AUMA</option><option>Rotork</option></select>)}
            {row("Control type", <select className={input} value={f.control} onChange={(e) => setF({ ...f, control: e.target.value })}><option value="">-</option>{CONTROL_TYPES.map((c) => <option key={c}>{c}</option>)}</select>)}
            {row("ACT CODE", <input className={input} value={f.act} onChange={(e) => setF({ ...f, act: e.target.value })} />)}
            {row("GB CODE", <input className={input} value={f.gb} onChange={(e) => setF({ ...f, gb: e.target.value })} />)}
            {row("Adaptor / coupling (Rs, blank = none)", <input className={input} inputMode="decimal" value={f.adaptor} onChange={(e) => setF({ ...f, adaptor: e.target.value })} />)}
            {row("Assembly & testing (Rs, blank = none)", <input className={input} inputMode="decimal" value={f.assembly} onChange={(e) => setF({ ...f, assembly: e.target.value })} />)}
          </div>
          <DialogFooter><Button size="sm" disabled={frozen} onClick={save}>{frozen ? "Frozen" : "Save and re-price"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
