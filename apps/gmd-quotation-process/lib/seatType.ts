// Seat type of a valve line (Puja, 18 Nov 2026). Only the item's own category sets the minimum VA% (lib/vaRules.ts, 20 Nov);
// BOQ text and docket spec only raise a warning when they disagree with it. No DB here.

export type Seat = "Metal seated" | "Resilient";
export type SeatSource = "BOQ" | "ITEM" | "SPEC";
export interface SeatType { seat: Seat | null; source: SeatSource | null; flag: "seat type unknown" | null }

// Whole word only: "MS" never inside "SYSTEMS", "RS" never inside "VERSION". Valid in JS and Postgres.
const word = (w: string) => `(?<![a-z0-9])${w}(?![a-z0-9])`;
const METAL = [
  "metal[\\s-]*seat", // also "gun metal seat"
  "bronze[\\s-]*seat",
  word("ms"),
  // The app's own sluice item types and isolation op types: SLUICE VALVE-METAL-*, WITH ISOLATION METAL SLUICE.
  "sluice valve-metal",
  "metal[\\s-]*sluice",
];
const RESILIENT = [
  "resilient",
  "rubber[\\s-]*seat",
  "soft[\\s-]*seat",
  "epdm",
  word("bs\\W*5163"),
  word("rs") + "(?!\\.|\\s*\\d)", // "Rs. 500" / "Rs 500" is rupees, not resilient seated
];
/** Group 1 = a metal-seated keyword, group 2 = a resilient one. */
export const SEAT_PATTERN = `(${METAL.join("|")})|(${RESILIENT.join("|")})`;
// Docket spec (attachment OCR) has no bare MS / RS: there they are mild steel ("MS Pipe"), "Ms. Puja", rupees.
const bare = (p: string) => p.startsWith("(?<![a-z0-9])ms") || p.startsWith("(?<![a-z0-9])rs");
/** Same, without bare MS / RS. lib/seatType-server.ts runs it in SQL on the spec text. */
export const SPEC_SEAT_PATTERN = `(${METAL.filter((p) => !bare(p)).join("|")})|(${RESILIENT.filter((p) => !bare(p)).join("|")})`;
const SEAT_RE = new RegExp(SEAT_PATTERN, "i");
const SPEC_SEAT_RE = new RegExp(SPEC_SEAT_PATTERN, "i");

function seatIn(text: string | null | undefined, re = SEAT_RE): Seat | null {
  const m = text ? re.exec(text) : null;
  return m ? (m[1] ? "Metal seated" : "Resilient") : null;
}

/** The first source naming a seat wins; inside one source, its first keyword (both kinds = no flag). */
export function detectSeatType(src: { boq?: string | null; itemText?: string | null; spec?: string | null }): SeatType {
  for (const [source, text] of [["BOQ", src.boq], ["ITEM", src.itemText], ["SPEC", src.spec]] as const) {
    const seat = seatIn(text, source === "SPEC" ? SPEC_SEAT_RE : SEAT_RE);
    if (seat) return { seat, source, flag: null };
  }
  return { seat: null, source: null, flag: "seat type unknown" };
}

/** A docket line: BOQ = the party's item name, item text = item type + merged details, spec = the docket's spec keyword. */
export interface SeatItem { itemName?: string | null; itemType?: string | null; itemNameMerge?: string | null; seatSpec?: string | null }

/** The item's own category (item type + merged details); it alone sets the minimum VA% (lib/vaRules.ts). */
export const categorySeat = (it: SeatItem) =>
  detectSeatType({ itemText: [it.itemType, it.itemNameMerge].filter(Boolean).join(" ") }).seat;

/** Warning text when the BOQ (else the docket spec) names a seat the category does not; sluice and check valves only. */
export function seatMismatch(it: SeatItem): string | null {
  const type = (it.itemType ?? "").toUpperCase().trim();
  if (!type.startsWith("SLUICE VALVE-") && type !== "CHECK VALVE") return null;
  const other = detectSeatType({ boq: it.itemName, spec: it.seatSpec });
  if (!other.seat || other.seat === categorySeat(it)) return null;
  return `${other.source === "BOQ" ? "BOQ" : "Spec"} says ${other.seat.toLowerCase()}`;
}
