/**
 * Offer as Excel. Pure: takes the same assembled data the PDF template gets
 * (lib/offerPdf.ts `assembleOfferData`) and returns the .xlsx bytes. No DB, no network.
 * Sheet "Offer" is the letter, sheet "Annexure-A" the price bid. No IMAGE column and no
 * logo: the installed xlsx build cannot embed pictures.
 */
import * as XLSX from "xlsx";
import { MSME_CLAUSE } from "./msmeStatement";
import type { OfferLetterTemplateData } from "@/types/offer-lettter";

export const OFFER_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fixed wording of the offer letter. Copied from lib/offer_letter.hbs; tests/offerXlsx.test.ts fails when the two drift apart. */
export const OFFER_STATIC_TEXT = {
  brand: ["DALUI", "MAKING VALVES SINCE 1979"],
  header: [
    "Head Office : Adventz Infinity@ 5, BN Block, 19 Floor, North Wing, Saltlake, Sector V, Kolkata - 700091",
    "Factory Address :",
    "Unit-1 : Vivekananda Industrial Estate, Balitikuri, Bakultala, Howrah - 711113",
    "Unit-2: Vidyasagar Industrial Park, Plot No. F1, Ruisanda, Rupnarayanpur, Jafala, Gole Bazar, Kharagpur, Paschim Medinipur - 721301",
    "Email id : info@gmdalui.co.in",
    "Phone : (+91) 9147176248",
  ],
  intro: [
    "We are pleased to submit our offer for your kind consideration. This offer has been prepared in accordance with the technical requirements and commercial discussions held, and is subject to the terms and conditions outlined below. The detailed price schedule for the proposed scope of supply is enclosed herewith as Annexure–A for your reference.",
    "We trust that our proposal meets your requirements and assures you of our commitment to quality, reliability, and timely execution. We look forward to the opportunity of working with your esteemed organization and request you to kindly review the enclosed details.",
    "Please feel free to contact us for any clarification or additional information required.",
  ],
  termsTitle: "Terms & Conditions :",
  termLabels: ["1. Price :", "2. Payment Terms :", "3. Inspection :", "4. Warranty :", "5. Approval :", "6. Delivery Destination :", "7. MSME :"],
  msmeTerm:
    "We are a registered Small enterprise, Udyam Registration No. UDYAM-WB-08-0001675. Under Sections 15 and 16 of the MSMED Act, 2006, payment is due within the agreed credit period (not exceeding 45 days); delayed payment carries compound interest with monthly rests at three times the RBI bank rate. Dues paid after 45 days are not deductible for the buyer under Section 43B(h) of the Income-tax Act.",
  signoff: ["Thanks & Regards,", "For G.M. Dalui & Sons Pvt. Ltd.", "Ms. Puja Agarwal", "Contact: 88200 44755 / 96747 55238"],
  enclosed: ["Enclosed :", "Annexure-A (Price Bid)"],
  annexureTitle: "Annexure–A (Price Bid)",
  // The PDF's IMAGE column is left out.
  columns: ["SL NO", "PARTY ITEM NAME", "OUR ITEM NAME", "RATE/UNIT", "QTY", "UNIT", "QR with GST", "Total Val. Incld. GST", "Delivery Schedule"],
} as const;

const T = OFFER_STATIC_TEXT;
const LETTER_WIDTHS = [26, 110];
const ANNEXURE_WIDTHS = [7, 40, 50, 14, 8, 8, 14, 18, 18];
const LINE_PT = 16; // one line of the 12pt default font

type Cell = string | number | null;

/** Lines a text needs in a wrapped column `wch` characters wide (kept line breaks + wrapping). */
function linesIn(text: Cell | undefined, wch: number): number {
  return String(text ?? "")
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / wch)), 0);
}

function toSheet(rows: Cell[][], widths: number[], merges: XLSX.Range[], lines: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!merges"] = merges;
  ws["!rows"] = lines.map((n) => ({ hpt: Math.max(1, n) * LINE_PT }));
  return ws;
}

function letterSheet(d: OfferLetterTemplateData): XLSX.WorkSheet {
  const terms = [d.price, d.paymentTerms, d.inspection, d.warranty, d.approval, d.deliveryDestination, T.msmeTerm];
  // A one-cell row spans both columns.
  const rows: Cell[][] = [
    ...T.brand.map((t) => [t]),
    ...T.header.map((t) => [t]),
    [],
    ["OFFER NO", d.docketNo],
    [],
    ["To,", d.partyName],
    ["SUB:", d.subject],
    [],
    ...T.intro.map((t) => [t]),
    [],
    [T.termsTitle],
    ...T.termLabels.map((label, i) => [label, terms[i] ?? ""]),
    [],
    ...T.signoff.map((t) => [t]),
    [],
    [...T.enclosed],
    [],
    [MSME_CLAUSE],
  ];
  const [a, b] = LETTER_WIDTHS;
  const merges: XLSX.Range[] = [];
  const lines = rows.map((row, r) => {
    if (row.length !== 1) return Math.max(linesIn(row[0], a), linesIn(row[1], b));
    merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
    return linesIn(row[0], a + b);
  });
  return toSheet(rows, LETTER_WIDTHS, merges, lines);
}

function annexureSheet(d: OfferLetterTemplateData): XLSX.WorkSheet {
  const W = ANNEXURE_WIDTHS;
  const last = W.length - 1;
  const items = d.items ?? [];
  const rows: Cell[][] = [[T.annexureTitle], [...T.columns]];
  const merges: XLSX.Range[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: last } }];
  const lines: number[] = [1, 2];

  items.forEach((it, i) => {
    const r = rows.length;
    if (it.isNotOurProduct) {
      rows.push([null, it.itemName, "Not our product"]);
      merges.push({ s: { r, c: 2 }, e: { r, c: last } });
      lines[r] = linesIn(it.itemName, W[1]);
      return;
    }
    // nameRowspan 0 = continuation row of a merged OUR ITEM NAME cell (same rule as the PDF template).
    const span = it.nameRowspan ?? 1;
    rows.push([
      it.slNo ?? i + 1,
      it.itemName,
      span > 0 ? it.partyItemName : null,
      it.quotationRate,
      it.quantity,
      it.unit,
      it.quotedRateGst,
      it.totalValue,
      it.deliverySchedule ?? "",
    ]);
    lines[r] = Math.max(lines[r] ?? 1, linesIn(it.itemName, W[1]), linesIn(it.deliverySchedule, W[8]));
    if (span > 0) {
      if (span > 1) merges.push({ s: { r, c: 2 }, e: { r: r + span - 1, c: 2 } });
      // The merged name's lines are shared out over the rows it covers.
      const each = Math.ceil(linesIn(it.partyItemName, W[2]) / span);
      for (let k = 0; k < span; k++) lines[r + k] = Math.max(lines[r + k] ?? 1, each);
    }
  });

  // Same sums as the PDF footer (lib/generatePdf.ts helpers).
  const r = rows.length;
  rows.push([
    "Total",
    null,
    null,
    Math.round(items.reduce((s, it) => s + (it.quantity || 0) * (it.quotationRate || 0), 0)),
    items.reduce((s, it) => s + (it.quantity || 0), 0),
    null,
    null,
    Math.round(items.reduce((s, it) => s + (it.totalValue || 0), 0)),
  ]);
  merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
  lines.length = rows.length;
  return toSheet(rows, W, merges, Array.from(lines, (n) => n ?? 1));
}

/**
 * The installed xlsx build writes no cell styles, so wrap text is switched on for every
 * cell by editing the one default style inside the written file (it reopens its own zip).
 * shortcut: one style for the whole book (wrap + top aligned), no bold/colours/borders; needs a styling library to go further.
 */
function wrapAllCells(file: Buffer): Buffer {
  const zip = XLSX.CFB.read(file, { type: "buffer" });
  const styles = XLSX.CFB.find(zip, "/xl/styles.xml");
  if (!styles?.content) return file;
  const xml = Buffer.from(styles.content as Uint8Array).toString("utf8");
  const patched = xml.replace(/(<cellXfs[^>]*>)([\s\S]*?)(<\/cellXfs>)/, (_m, open: string, xfs: string, close: string) =>
    open + xfs.replace(/\/>/g, ' applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>') + close,
  );
  if (patched === xml) return file;
  XLSX.CFB.utils.cfb_add(zip, "/xl/styles.xml", Buffer.from(patched, "utf8"));
  return Buffer.from(XLSX.CFB.write(zip, { fileType: "zip", type: "buffer" }) as Uint8Array);
}

export function buildOfferXlsx(data: OfferLetterTemplateData): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, letterSheet(data), "Offer");
  XLSX.utils.book_append_sheet(wb, annexureSheet(data), "Annexure-A");
  return wrapAllCells(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}
