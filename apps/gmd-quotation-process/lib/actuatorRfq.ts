// RFQ to the OEM for an actuated item whose MAPPING row says "Special – refer OEM" (no auto cost).
// The app cannot write into her mailbox: it opens a Gmail compose window that she reviews and saves or sends herself.
// Built only from the valve / actuator spec fields below, never from the enquiry, so no customer, project or contact detail can reach the OEM.
import { deriveMapKey, SPECIAL_OEM } from "./actuatorCost";

// Fixed by the requester: Rotork by default, AUMA only when the spec asks for AUMA.
const ROTORK = { name: "Mrinal Ghosh", email: "Mrinal.Ghosh@rotork.com" };
const AUMA = { name: "Subrata Karmakar", email: "Subrata.Karmakar@auma.co.in" };
const CC = "info@gmdalui.co.in";
const TBC = "to confirm";

/** The parts of actuatorBreakdown read here. `selection` is written by the actuator pick; older breakdowns only have `pending`. */
interface Breakdown {
  pending?: string[];
  selection?: {
    status?: string; valveType?: string | null; dn?: string | number | null; pn?: string | number | null; qty?: number | null;
    requiredTorque?: string | number | null; topFlange?: string | null; aumaRequired?: boolean;
  };
}

export interface RfqItem {
  itemType?: string | null; itemName?: string | null; size?: string | null; pnRating?: string | null;
  quantity?: number | null; controlType?: string | null; actuatorBreakdown?: unknown;
}
export interface Rfq { to: string; cc: string; subject: string; body: string }

/** Needs an OEM quote: the pick says OEM RFQ, or (older breakdowns) the price is pending on Special – refer OEM. */
export function isOemRfq(it: { actuatorBreakdown?: unknown }): boolean {
  const b = it.actuatorBreakdown as Breakdown | null | undefined;
  return b?.selection?.status === "OEM RFQ" || !!b?.pending?.includes(SPECIAL_OEM);
}

// 1300 -> "DN1300"; a value that already carries its prefix ("PN16") is kept as is.
const tag = (prefix: string, v: string | number | null | undefined) =>
  v == null || v === "" ? null : /^\d+$/.test(String(v)) ? `${prefix}${v}` : String(v);

export function buildRfq(it: RfqItem): Rfq {
  const s = (it.actuatorBreakdown as Breakdown | null | undefined)?.selection;
  // No selection yet: TYPE|DN|PN read from the item fields the same way the MAPPING lookup reads them.
  const [type, dn, pn] = deriveMapKey(it)?.split("|") ?? [];
  const valve = s?.valveType || type || it.itemType || "valve";
  const size = tag("DN", s?.dn ?? dn ?? it.size);
  const rating = tag("PN", s?.pn ?? pn ?? it.pnRating);
  const qty = it.quantity ?? s?.qty ?? TBC; // the item's quantity is live; selection.qty is a copy from the last pick
  const torque = parseFloat(String(s?.requiredTorque ?? "").replace(/,/g, ""));
  const oem = s?.aumaRequired === true ? AUMA : ROTORK;
  const body = [
    `Dear ${oem.name},`,
    "",
    "Kindly quote your price and delivery for the following electric actuator requirement, and share the datasheet.",
    "",
    `Valve type: ${valve}`,
    `Size: ${size ?? TBC}`,
    `Pressure rating: ${rating ?? TBC}`,
    `Quantity: ${qty}`,
    `Required torque: ${torque > 0 ? `${torque.toLocaleString("en-IN")} Nm` : TBC}`,
    `Valve top / base flange: ${s?.topFlange || TBC}`,
    `Control type: ${it.controlType || TBC}`,
    "",
    "Regards,",
  ].join("\n");
  return { to: oem.email, cc: CC, subject: `RFQ – Electric actuator for ${[valve, size, rating].filter(Boolean).join(" ")} (qty ${qty})`, body };
}

const enc = encodeURIComponent;
/** Full-screen Gmail compose in her own account; nothing is sent until she sends it. */
export const gmailComposeUrl = (r: Rfq) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(r.to)}&cc=${enc(r.cc)}&su=${enc(r.subject)}&body=${enc(r.body)}`;
