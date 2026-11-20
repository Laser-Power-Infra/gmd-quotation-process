// The actuator line printed under an actuated item's description in the offer. Pure (no DB).
import { isActuated } from "./actuatorCost";

type Unit = { source?: unknown; make?: unknown; model?: unknown; rpm?: unknown; ratio?: unknown } | null | undefined;
interface Selection { status?: unknown; topFlange?: unknown; time?: unknown; act?: Unit; gb?: Unit }

const words = (...xs: unknown[]) => xs.map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
// shortcut: an item without a selection prints the model cut from its code ("ACT-AU-SA14.2" -> "SA14.2", no flange); drop when every actuated item has a selection.
const codeModel = (code: string) => code.replace(/^(?:ACT|GB)-[A-Z]{2}-/, "");

/** "Actuator: Rotork K150 @24 rpm | Gearbox: Viral VWESGA-80 (220:1) | Top flange: F25 | Operating time: 1.72 min", missing parts dropped; null when the item is not actuated. */
export function offerActuatorLine(it: Parameters<typeof isActuated>[0] & { actuatorMake?: string | null }): string | null {
  if (!isActuated(it)) return null;
  const sel = (it.actuatorBreakdown as { selection?: Selection } | null | undefined)?.selection;
  let act: string | null | undefined, gb: string | null | undefined;
  if (sel) {
    act = sel.status === "OEM RFQ" ? "to be confirmed by OEM" : words(sel.act?.make, sel.act?.model, sel.act?.rpm != null ? `@${sel.act.rpm} rpm` : ""); // rpm / ratio / time: blank on selections stored before 20 Nov
    // The selection has no gearbox make: source "viral" is the Viral block of the master.
    gb = sel.gb && words(sel.gb.source === "viral" ? "Viral" : null, sel.gb.model, sel.gb.ratio && `(${sel.gb.ratio})`);
  } else {
    act = it.actCode && words(it.actuatorMake, codeModel(it.actCode)); // a make without a code is only the default
    gb = it.gbCode && codeModel(it.gbCode);
  }
  const flange = words(sel?.topFlange);
  const time = typeof sel?.time === "number" ? `${sel.time.toFixed(2)} min` : "";
  return [act && `Actuator: ${act}`, gb && `Gearbox: ${gb}`, flange && `Top flange: ${flange}`, time && `Operating time: ${time}`].filter(Boolean).join(" | ") || null;
}
