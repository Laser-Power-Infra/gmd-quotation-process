// The actuator line and functionalities printed under an actuated item's description in the offer. Pure (no DB).
import { isActuated } from "./actuatorCost";
import { isSinglePhase } from "./actuatorSelect";
import { matchItemType } from "./itemTypePatterns";

type Unit = { source?: unknown; make?: unknown; model?: unknown; rpm?: unknown; ratio?: unknown } | null | undefined;
interface Selection { status?: unknown; topFlange?: unknown; time?: unknown; act?: Unit; gb?: Unit }

const words = (...xs: unknown[]) => xs.map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
// shortcut: an item without a selection prints the model cut from its code ("ACT-AU-SA14.2" -> "SA14.2", no flange); drop when every actuated item has a selection.
const codeModel = (code: string) => code.replace(/^(?:ACT|GB)-[A-Z]{2}-/, "");

type Item = Parameters<typeof isActuated>[0] & { actuatorMake?: string | null; itemName?: string | null };

/** The standard functionalities of every actuator we offer (Puja, 17 Nov: "as per client data sheet"). Change the wording here only. */
export const ACT_FUNCTIONS = {
  partTurn: "Type: Integral, electric part-turn", // butterfly valve
  multiTurn: "Type: Integral, electric multi-turn", // every other valve type
  power3: "Power supply: 415 V, 3 phase, 50 Hz",
  power1: "Power supply: 230 V, 1 phase, 50 Hz", // the item text says single phase
  limit: "Limit switches: 2 nos (2NO + 2NC)",
  torque: "Torque switches: 2 nos (2NO + 2NC)",
  mode: "Operating mode: Local & Remote",
  pt: "Position transmitter: 4–20 mA", // only when the item text says "with PT" / "position transmitter"
};

/**
 * Everything printed under an actuated item's name in the offer (PDF and Excel), one entry per line: the actuator line, then
 * the functionalities. Make, model and gearbox are in the actuator line; no price. Null when the item is not actuated.
 */
export function offerActuatorLine(it: Item): string | null {
  if (!isActuated(it)) return null;
  const text = it.itemName ?? "";
  // An ACTUATOR line has no valve type of its own: read from the item name, as deriveMapKey does.
  const type = (it.itemType ?? "").trim().toUpperCase() === "ACTUATOR" ? matchItemType(text) : it.itemType;
  const F = ACT_FUNCTIONS;
  return [
    actuatorLine(it),
    (type ?? "").trim().toUpperCase() === "BUTTERFLY VALVE" ? F.partTurn : F.multiTurn,
    isSinglePhase(text) ? F.power1 : F.power3, F.limit, F.torque, F.mode,
    /\bwith\s+PT\b|\bposition\s+transmitter/i.test(text) && F.pt,
  ].filter(Boolean).join("\n");
}

/** "Actuator: Rotork K150 @24 rpm | Gearbox: Viral VWESGA-80 (220:1) | Top flange: F25 | Operating time: 1.72 min", missing parts dropped; null when the item is not actuated. */
export function actuatorLine(it: Item): string | null {
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
