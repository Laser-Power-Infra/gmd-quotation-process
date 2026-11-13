/**
 * Inspection Offer -> draft Inspection Report (pure helpers).
 *
 * The sync (`schedular_function/inspection-offer-sync.ts`) groups the
 * INSPECTION OFFER DUMP rows per offer VRNO and, for an offer it has not seen
 * before, builds a draft with `buildDraftReport`. `checkReport` runs the
 * header / team / qty / serial / date checks that must pass before 'reviewed'.
 *
 * Assumed JIR-style layout (Amaresh's format is not in the repo yet): header,
 * item lines, QAP / tolerance / MTC placeholders, observations.
 */

import { escapeHtml as esc } from "./docketSnapshot";

/** Every column of the INSPECTION OFFER DUMP tab, in sheet order. */
export const IC_DUMP_COLUMNS = [
  "VRNO",
  "VRDATE",
  "ITEM_CODE",
  "UM",
  "AQTYORDER",
  "ACC_CODE",
  "CONTRACT_VRNO",
  "INSPE_VRNO",
  "INSPE_DATE",
  "DI_VRNO",
  "DI_DATE",
  "INV_VRNO",
  "INV_VRDATE",
  "QTYCANCELLED",
  "IC_QTY",
  "DI_QTY",
  "DI_QTYCANCELLED",
  "INV_QTY",
  "BAL_INSP_OFF",
] as const;

export type IcDumpColumn = (typeof IC_DUMP_COLUMNS)[number];
/** One sheet row (item line) of an offer, every column as trimmed text. */
export type OfferLine = Record<IcDumpColumn, string>;

export type GroupedOffer = {
  vrno: string;
  vrDate: string | null;
  accCode: string | null;
  contractVrno: string | null;
  lines: OfferLine[];
};

/** Sheet rows -> one entry per VRNO, item lines in sheet order. Blank VRNO rows are dropped. */
export function groupOfferRows(rows: OfferLine[]): Map<string, GroupedOffer> {
  const out = new Map<string, GroupedOffer>();
  for (const line of rows) {
    const vrno = line.VRNO.trim();
    if (!vrno) continue;
    const offer = out.get(vrno) ?? {
      vrno,
      vrDate: null,
      accCode: null,
      contractVrno: null,
      lines: [],
    };
    offer.vrDate ??= line.VRDATE || null;
    offer.accCode ??= line.ACC_CODE || null;
    offer.contractVrno ??= line.CONTRACT_VRNO || null;
    offer.lines.push(line);
    out.set(vrno, offer);
  }
  return out;
}

export const REPORT_STATUSES = ["draft", "readings_entered", "reviewed", "final"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
/** Statuses that need every check to pass first. */
export const GATED_STATUSES: readonly ReportStatus[] = ["reviewed", "final"];

export const HEADER_FIELDS = [
  ["client", "Client"],
  ["kindAttn", "Kind Attn"],
  ["reference", "Reference"],
  ["projectName", "Project name"],
  ["contractNo", "Contract no."],
  ["mcNo", "MC no."],
  ["poNo", "PO no."],
  ["contractDate", "Contract / PO date"],
  ["offerNo", "Offer no."],
  ["offerDate", "Offer date"],
  ["inspectionNo", "Inspection no."],
  ["inspectionDate", "Inspection date"],
  ["jirDate", "JIR date"],
  ["utility", "Utility"],
  ["state", "State"],
  ["witness", "Witness"],
] as const;

export type ReportHeader = Record<(typeof HEADER_FIELDS)[number][0], string>;

export type ReportItem = {
  itemCode: string;
  itemName: string;
  size: string;
  pnRating: string;
  material: string;
  um: string;
  contractQty: string;
  alreadyInspected: string;
  qtyOffered: string;
  reportQty: string;
  serialFrom: string;
  serialTo: string;
  remarks: string;
};

export type TeamMember = { agency: string; name: string; designation: string };

export type ReportData = {
  header: ReportHeader;
  items: ReportItem[];
  /** Inspecting team; absent until a member is added in the editor. */
  team?: TeamMember[];
  // Placeholders until QAP / drawing / MTC sources exist.
  qap: { qapNo: string; mfgStandard: string; bodyPressure: string; seatPressure: string; duration: string };
  tolerance: string;
  mtc: string;
  observations: string;
};

// Labels shared by the editor and the printed report.
export const ITEM_COLUMNS: [keyof ReportItem, string][] = [
  ["itemCode", "Item code"],
  ["itemName", "Description"],
  ["size", "Size"],
  ["pnRating", "PN"],
  ["material", "Material"],
  ["um", "UM"],
  ["contractQty", "Contract qty"],
  ["alreadyInspected", "Already inspected"],
  ["qtyOffered", "Qty offered"],
  ["reportQty", "Report qty"],
  ["serialFrom", "Serial from"],
  ["serialTo", "Serial to"],
  ["remarks", "Remarks"],
];

export const QAP_FIELDS: [keyof ReportData["qap"], string][] = [
  ["qapNo", "QAP no."],
  ["mfgStandard", "MFG standard"],
  ["bodyPressure", "Hydro body pressure"],
  ["seatPressure", "Hydro seat pressure"],
  ["duration", "Duration"],
];

export const TEAM_FIELDS: [keyof TeamMember, string][] = [
  ["agency", "Agency"],
  ["name", "Name"],
  ["designation", "Designation"],
];

/** The ContractReview fields the draft reads. */
export type ContractReviewSource = {
  contractNo: string;
  mcNo: string | null;
  itemCode: string;
  itemName: string | null;
  size: string | null;
  pnRating: string | null;
  orderQty: string | null;
  icQty: string | null;
  poNo: string | null;
  dateOfContract: string | null;
  projectReference: string | null;
  utility: string | null;
  state: string | null;
  partyNameDump: string | null;
};

const s = (v: string | null | undefined) => (v ?? "").trim();

export function toNumber(v: string | null | undefined): number | null {
  const t = s(v).replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const fmt = (n: number | null) => (n === null ? "" : String(n));

/** `crFor(mcNo, itemCode)` returns the matching ContractReview row, or undefined. */
export function buildDraftReport(
  offer: GroupedOffer,
  crFor: (mcNo: string, itemCode: string) => ContractReviewSource | undefined,
  clientName: string | undefined,
): ReportData {
  const crs = offer.lines.map((l) => crFor(l.CONTRACT_VRNO, l.ITEM_CODE));
  const cr0 = crs.find(Boolean);
  const first = offer.lines[0];

  return {
    header: {
      client: s(clientName) || s(cr0?.partyNameDump),
      kindAttn: "",
      reference: "",
      projectName: s(cr0?.projectReference),
      contractNo: s(cr0?.contractNo),
      mcNo: s(offer.contractVrno),
      poNo: s(cr0?.poNo),
      contractDate: s(cr0?.dateOfContract),
      offerNo: offer.vrno,
      offerDate: s(offer.vrDate),
      inspectionNo: s(first?.INSPE_VRNO),
      inspectionDate: s(first?.INSPE_DATE),
      jirDate: "",
      utility: s(cr0?.utility),
      state: s(cr0?.state),
      witness: "",
    },
    items: offer.lines.map((l, i) => {
      const cr = crs[i];
      const ordered = toNumber(l.AQTYORDER);
      const offered = ordered === null ? null : ordered - (toNumber(l.QTYCANCELLED) ?? 0);
      return {
        itemCode: l.ITEM_CODE,
        itemName: s(cr?.itemName),
        size: s(cr?.size),
        pnRating: s(cr?.pnRating),
        material: "",
        um: l.UM,
        contractQty: s(cr?.orderQty),
        alreadyInspected: s(cr?.icQty),
        qtyOffered: fmt(offered),
        reportQty: fmt(offered),
        serialFrom: "",
        serialTo: "",
        remarks: "",
      };
    }),
    qap: { qapNo: "", mfgStandard: "", bodyPressure: "", seatPressure: "", duration: "" },
    tolerance: "",
    mtc: "",
    observations: "",
  };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** DD-MM-YYYY, DD/MM/YYYY, DD-Mon-YYYY or YYYY-MM-DD -> UTC midnight ms; null if unparseable. */
export function parseReportDate(v: string): number | null {
  const t = s(v).toUpperCase();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[-/.]([A-Z]{3}|\d{1,2})[-/.](\d{2,4})$/.exec(t);
  if (!m) return null;
  const month = /^\d+$/.test(m[2]) ? +m[2] - 1 : MONTHS.indexOf(m[2]);
  if (month < 0 || month > 11) return null;
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return Date.UTC(year, month, +m[1]);
}

/** "ABC-0101" .. "ABC-0150" -> 50. Null when the two do not share a prefix or end in digits. */
export function serialCount(from: string, to: string): number | null {
  const a = /^(.*?)(\d+)$/.exec(s(from));
  const b = /^(.*?)(\d+)$/.exec(s(to));
  if (!a || !b || a[1] !== b[1]) return null;
  const n = Number(b[2]) - Number(a[2]) + 1;
  return n > 0 ? n : null;
}

export type ReportCheck = { label: string; ok: boolean; detail?: string };

/** Header / team / qty / serial / date checks. All must pass before a gated status. */
export function checkReport(data: ReportData): ReportCheck[] {
  const checks: ReportCheck[] = [];
  const blank = HEADER_FIELDS.filter(([k]) => !s(data.header[k])).map(([, label]) => label);
  checks.push({
    label: "All header fields filled",
    ok: blank.length === 0,
    detail: blank.length ? `Blank: ${blank.join(", ")}` : undefined,
  });

  const team = data.team ?? [];
  const incomplete = team.filter((m) => TEAM_FIELDS.some(([k]) => !s(m[k]))).length;
  checks.push({
    label: "Inspecting team filled (agency, name, designation)",
    ok: team.length > 0 && incomplete === 0,
    detail: !team.length
      ? "No member added"
      : incomplete
        ? `${incomplete} member${incomplete === 1 ? "" : "s"} missing agency, name or designation`
        : undefined,
  });

  if (data.items.length === 0) checks.push({ label: "Offer has item lines", ok: false });
  for (const it of data.items) {
    const tag = it.itemCode || "(no item code)";
    const offered = toNumber(it.qtyOffered);
    const reportQty = toNumber(it.reportQty);
    checks.push({
      label: `${tag}: report qty = offer qty`,
      ok: offered !== null && reportQty === offered,
      detail: `report ${it.reportQty || "-"} vs offer ${it.qtyOffered || "-"}`,
    });

    const contract = toNumber(it.contractQty);
    const balance =
      contract === null || offered === null ? null : contract - (toNumber(it.alreadyInspected) ?? 0) - offered;
    checks.push({
      label: `${tag}: offer qty within contract balance`,
      ok: balance !== null && balance >= 0,
      detail:
        balance === null
          ? "contract qty unknown"
          : `contract ${contract} - inspected ${it.alreadyInspected || 0} - offered ${offered} = ${balance}`,
    });

    const count = serialCount(it.serialFrom, it.serialTo);
    checks.push({
      label: `${tag}: serial range continuous and = report qty`,
      ok: count !== null && count === reportQty,
      detail: count === null ? "serial range not filled or not a continuous range" : `${count} serials`,
    });
  }

  const offerDate = parseReportDate(data.header.offerDate);
  const inspDate = parseReportDate(data.header.inspectionDate);
  const jirDate = parseReportDate(data.header.jirDate);
  checks.push({
    label: "Offer date <= inspection date",
    ok: offerDate !== null && inspDate !== null && offerDate <= inspDate,
    detail: offerDate === null || inspDate === null ? "date missing or unreadable" : undefined,
  });
  checks.push({
    label: "Inspection date = JIR date",
    ok: inspDate !== null && jirDate !== null && inspDate === jirDate,
    detail: inspDate === null || jirDate === null ? "date missing or unreadable" : undefined,
  });
  return checks;
}

const serialRange = (it: ReportItem) => [s(it.serialFrom), s(it.serialTo)].filter(Boolean).join(" – ");

/** List cell: "150 serials: S-0001 – S-0100 …" plus one "item: from – to" per item. Null when no serial is filled. */
export function serialSummary(items: ReportItem[]): { label: string; ranges: string[] } | null {
  const filled = items.filter((it) => serialRange(it));
  if (filled.length === 0) return null;
  const counts = filled.map((it) => serialCount(it.serialFrom, it.serialTo));
  // One uncountable range drops the total rather than under-count it.
  const total = counts.includes(null) ? null : counts.reduce<number>((a, c) => a + (c ?? 0), 0);
  const head = serialRange(filled[0]) + (filled.length > 1 ? " …" : "");
  return {
    label: total === null ? head : `${total} serial${total === 1 ? "" : "s"}: ${head}`,
    ranges: filled.map((it) => `${it.itemCode}: ${serialRange(it)}`),
  };
}

/** Team members as "agency, name, designation"; blank parts and blank members skipped. */
export function teamLines(team: TeamMember[] | undefined): string[] {
  return (team ?? []).map((m) => [m.agency, m.name, m.designation].map(s).filter(Boolean).join(", ")).filter(Boolean);
}

/** Untrusted team input -> members with trimmed string fields; members that are not objects are dropped. */
export function cleanTeam(team: unknown): TeamMember[] {
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
  return (Array.isArray(team) ? team : [])
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m) => ({ agency: str(m.agency), name: str(m.name), designation: str(m.designation) }));
}

/** Reports saved before the team section kept one name in `header.inspector`: show it as the first member (stored on the next save). */
export function seedTeamFromInspector(data: ReportData): ReportData {
  // Dropped from the header, so a member removed and saved is not seeded again.
  const { inspector, ...header } = data.header as ReportHeader & { inspector?: unknown };
  return !data.team?.length && typeof inspector === "string" && inspector.trim()
    ? { ...data, header, team: [{ agency: "", name: inspector.trim(), designation: "" }] }
    : data;
}

/** A physical stock row the stock allocation sets against one contract line (`itemCode`). */
export type OfferedStock = { itemCode: string; erpCode: string; qty: number; pn: string; size: string; material: string };

/** One item against one stock row set against it (or against none). */
export type OfferCheck = {
  itemCode: string;
  /** "PN16 / 100 / DI", from the item. */
  required: string;
  /** "RXV0101 × 5: PN16 / 100 / DUCTILE IRON", plus "(other item code)" when the stock was diverted; "-" when none. */
  offered: string;
  /** "" when they agree, else "Differs: PN, size", "Not compared (blank)" or "No stock allocated". Shown amber, never blocks a status. */
  diff: string;
};

export const OFFER_HEADINGS = ["Item code", "Required (PN / size / material)", "Offered from stock", "Check"];

const norm = (v: string | null | undefined) => s(v).toUpperCase().replace(/\s+/g, " ");
// Material families, so "DI" matches "DUCTILE IRON", "CS" matches "CARBON STEEL/CAST STEEL" and "SS" matches "SS304" / "CF8M".
// First match wins: "FORGED STAINLESS" is SS, "FORGED CARBON STEEL" is CS.
const MATERIALS: [RegExp, string][] = [
  [/DUCTILE|\bDI\b|\bSG\b/, "DI"],
  [/CAST IRON|\bCI\b/, "CI"],
  [/CAST STEEL|CARBON STEEL|\bCS\b|\bWCB\b/, "CS"],
  [/STAINLESS|\bSS(?=\d|\b)|\bCF[38]M?\b/, "SS"],
  [/FORGED|\bA105\b/, "FORGED"],
  [/MILD STEEL|\bMS\b/, "MS"],
];
// PN 16 = PN16 = 16 and DN100 = 100 MM = 100; CLASS 150 stays apart from PN150.
const numKey = (t: string) => {
  const n = /\d+/.exec(t);
  return n ? `${t.includes("CLASS") ? "CLASS " : ""}${Number(n[0])}` : t;
};
const SPECS: [string, (t: string) => string][] = [
  ["PN", numKey],
  ["size", numKey],
  ["material", (t) => MATERIALS.find(([re]) => re.test(t))?.[1] ?? t],
];
const specText = (vals: string[]) => vals.map((v) => s(v) || "-").join(" / ");
// Sheet placeholders count as a blank part.
const specPart = (v: string) => norm(v).replace(/^(-|NA|N\/A|#N\/A)$/, "");

/**
 * Every item against each stock row set against its line. A part blank on either side is not compared;
 * a row with no part compared is "Not compared (blank)", not OK.
 */
export function offerChecks(items: ReportItem[], offered: OfferedStock[]): OfferCheck[] {
  return items.flatMap((it) => {
    const want = [it.pnRating, it.size, it.material];
    const required = specText(want);
    const mine = offered.filter((o) => norm(o.itemCode) === norm(it.itemCode));
    if (!mine.length) return [{ itemCode: it.itemCode, required, offered: "-", diff: "No stock allocated" }];
    return mine.map((o) => {
      const got = [o.pn, o.size, o.material];
      const compared = SPECS.map(([label, key], i) => ({ label, key, a: specPart(want[i]), b: specPart(got[i]) })).filter(
        (p) => p.a && p.b,
      );
      const differs = compared.filter((p) => p.key(p.a) !== p.key(p.b)).map((p) => p.label);
      const diverted = norm(o.erpCode) !== norm(it.itemCode);
      return {
        itemCode: it.itemCode,
        required,
        offered: `${o.erpCode} × ${o.qty}: ${specText(got)}${diverted ? " (other item code)" : ""}`,
        diff: !compared.length ? "Not compared (blank)" : differs.length ? `Differs: ${differs.join(", ")}` : "",
      };
    });
  });
}

/** The printable report. `offers` null = the stock allocation could not be read; `asOf` stamps that comparison. */
export function reportHtml(data: ReportData, offers: OfferCheck[] | null, asOf = new Date()): string {
  const tr = (cells: string[], tag = "td") => `<tr>${cells.map((c) => `<${tag}>${esc(c)}</${tag}>`).join("")}</tr>`;
  const table = (head: string[], rows: string[][]) => `<table>${tr(head, "th")}${rows.map((r) => tr(r)).join("")}</table>`;
  const pairs = (rows: string[][]) => `<table>${rows.map(([l, v]) => `<tr><th>${esc(l)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const notes = [
    ["Dimensions & tolerance", data.tolerance],
    ["MTC & calibration", data.mtc],
    ["Observations", data.observations],
  ].map(([title, v]) => `<h3>${esc(title)}</h3><p class="pre">${esc(v)}</p>`);
  return `<!doctype html><html><head><title>Inspection report ${esc(data.header.offerNo)}</title><style>
body{font-family:sans-serif;font-size:12px;margin:24px}table{border-collapse:collapse;width:100%;margin-bottom:16px}
th,td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eee}.pre{white-space:pre-wrap}
</style></head><body><h2>Inspection Report</h2>
${pairs(HEADER_FIELDS.map(([k, l]) => [l, data.header[k]]))}
<h3>Inspecting team</h3>${table([...TEAM_FIELDS.map(([, l]) => l), "Signature"], (data.team ?? []).map((m) => [...TEAM_FIELDS.map(([k]) => m[k]), ""]))}
<h3>Items</h3>${table(ITEM_COLUMNS.map(([, l]) => l), data.items.map((it) => ITEM_COLUMNS.map(([k]) => it[k])))}
<h3>Required vs offered as of ${esc(asOf.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</h3>${offers ? table(OFFER_HEADINGS, offers.map((o) => [o.itemCode, o.required, o.offered, o.diff || "OK"])) : "<p>Stock allocation unavailable</p>"}
<h3>Standards &amp; tests (QAP)</h3>${pairs(QAP_FIELDS.map(([k, l]) => [l, data.qap[k]]))}
${notes.join("")}</body></html>`;
}

const SERIAL = /^(.*?)(\d+)$/;

/** Parsed serial `m` lies in from..to: same prefix (any case) and its number within the range. */
function serialInRange(m: RegExpExecArray, from: string, to: string): boolean {
  const [a, b] = [from, to].map((v) => SERIAL.exec(s(v).toUpperCase()));
  return !!(a && b && a[1] === m[1] && b[1] === m[1] && Number(a[2]) <= Number(m[2]) && Number(m[2]) <= Number(b[2]));
}

/** List search: the contract no. or a serial range end contains `q`, or `q` is a serial inside a range. Any case. */
export function reportMatches(data: ReportData, q: string): boolean {
  const needle = s(q).toUpperCase();
  const has = (v: string) => s(v).toUpperCase().includes(needle);
  // SERIAL backtracks quadratically on a long digit run, so parse the needle once and only when serial-sized.
  const serial = needle.length <= 40 ? SERIAL.exec(needle) : null;
  return (
    has(data.header.contractNo) ||
    data.items.some(
      (it) =>
        has(it.serialFrom) || has(it.serialTo) || (serial !== null && serialInRange(serial, it.serialFrom, it.serialTo)),
    )
  );
}
