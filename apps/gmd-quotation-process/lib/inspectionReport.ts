/**
 * Inspection Offer -> draft Inspection Report (pure helpers).
 *
 * The sync (`schedular_function/inspection-offer-sync.ts`) groups the
 * INSPECTION OFFER DUMP rows per offer VRNO and, for an offer it has not seen
 * before, builds a draft with `buildDraftReport`. `checkReport` runs the
 * header / qty / serial / date checks that must pass before 'reviewed'.
 *
 * Assumed JIR-style layout (Amaresh's format is not in the repo yet): header,
 * item lines, QAP / tolerance / MTC placeholders, observations.
 */

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
  ["inspector", "Inspector"],
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

export type ReportData = {
  header: ReportHeader;
  items: ReportItem[];
  // Placeholders until QAP / drawing / MTC sources exist.
  qap: { qapNo: string; mfgStandard: string; bodyPressure: string; seatPressure: string; duration: string };
  tolerance: string;
  mtc: string;
  observations: string;
};

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
      inspector: "",
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

/** Header / qty / serial / date checks. All must pass before a gated status. */
export function checkReport(data: ReportData): ReportCheck[] {
  const checks: ReportCheck[] = [];
  const blank = HEADER_FIELDS.filter(([k]) => !s(data.header[k])).map(([, label]) => label);
  checks.push({
    label: "All header fields filled",
    ok: blank.length === 0,
    detail: blank.length ? `Blank: ${blank.join(", ")}` : undefined,
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
