/**
 * Pure item-line parser for docket mail content.
 *
 * Turns free-form email bodies, OCR text and attachment text into a list of
 * `{ itemName, quantity }` candidates for the `docket-creation` scheduled job.
 *
 * Deliberately free of Prisma / network / AI imports so it can be unit-tested
 * without a database. The optional AI fallback lives in
 * `docket-item-extraction.ts`.
 *
 * Design rules (see README `docket-creation`):
 *   - Only lines that carry an explicit quantity are emitted. A line with no
 *     quantity is skipped, per the product requirement.
 *   - The item name is the line with its enumerator, quantity token and trailing
 *     price column removed. The rest of the wording is preserved verbatim.
 *   - Header rows, totals, signatures and contact lines are dropped.
 *   - Identical `itemName` + `quantity` pairs are de-duplicated, which collapses
 *     the repeated blocks produced by quoted reply history.
 */

export interface ParsedDocketItem {
  itemName: string;
  quantity: number;
}

export interface DocketParserInput {
  /** Full message bodies (a thread body may contain several messages). */
  bodies?: (string | null | undefined)[];
  /** OCR text of attached PDFs/images. */
  ocrText?: string | null;
  /** Plain text extracted from attachments (spreadsheets are tab-delimited). */
  attachmentTexts?: (string | null | undefined)[];
  /** Safety cap on returned items. Default 500. */
  maxItems?: number;
}

const MAX_ITEMS_DEFAULT = 500;
const MAX_QUANTITY = 1_000_000;

/** Units that denote a countable quantity (not a size, pressure or mass). */
const QUANTITY_UNITS = [
  "nos", "no", "pcs", "pc", "pieces", "piece",
  "sets", "set", "each", "ea", "units", "unit",
  "numbers", "number", "pairs", "pair",
  "boxes", "box", "rolls", "roll", "coils", "coil", "bags", "bag",
  "mtrs", "mtr", "meters", "meter", "metres", "metre",
  "lengths", "length",
];

const UNIT_ALT = QUANTITY_UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

const QTY_LABEL_RE = new RegExp(
  `\\b(?:req(?:d|uired)?\\s*qty|order\\s*qty|total\\s*qty|qty|quantity|qnty)\\s*[:=\\-.]?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${UNIT_ALT})?\\b\\.?`,
  "i",
);
// A tight range ("2-3 Nos") — spaces around the dash are deliberately NOT
// accepted, so a size followed by a quantity ("DN100 - 4 Nos") is not mistaken
// for a range.
const RANGE_UNIT_RE = new RegExp(`(\\d[\\d,]*)[-\\u2013](\\d[\\d,]*)\\s*(?:${UNIT_ALT})\\b\\.?`, "i");
const TRAILING_UNIT_RE = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${UNIT_ALT})\\b\\.?`, "gi");
// "Rs 500 each" / "INR 1,200 per pc" is a price, not a quantity.
const PRICE_TOKEN_RE = /(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?(?:\/-)?(?:\s*(?:each|ea|per\s*\w+))?/gi;
const LEADING_QTY_RE = new RegExp(`^\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:x\\b|${UNIT_ALT})\\b\\.?`, "i");

const ENUMERATOR_RE = /^\s*(?:\d+[.)]|[-*•–])\s+/;
const TRAILING_PRICE_RE = /\s+(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s*$/i;
const TRAILING_SEP_RE = /[\s\-–:;,|]+$/;
const LEADING_OF_RE = /^of\s+/i;

/** Header / noise lines that must never become an item name. */
const SKIP_ITEM_RE = [
  /^(?:sl\.?\s*no|sr\.?\s*no|s\.?\s*no|ser(?:ial)?\.?\s*no|no\.?)$/i,
  /^(?:item|item\s*name|item\s*desc(?:ription)?|description|particulars|material|name|specification|spec)$/i,
  /^(?:qty|quantity|qnty|unit|uom|rate|price|amount|value|total|sub\s*-?\s*total|subtotal|grand\s*total|gst|igst|cgst|sgst|hsn|sac|make|brand|delivery|terms?|remarks?|note|page)\b/i,
  /^(?:regards?|thanks?|thank\s*you|best\s*regards|sincerely|dear|hi|hello|from|sent|to|cc|bcc|subject|tel|mobile|phone|email|e-mail|website|address|quotation|enquiry|inquiry|rfq|ref|reference|date|kind\s*attn)\b/i,
  // Prose / conversational lines are never item names.
  /^(?:as\s+discussed|we\s+(?:require|need|want)|kindly|please|refer|dear|hi\b|hello|thanks|thank\s+you|regards|message)\b/i,
];

/**
 * Whole lines that must be discarded before any quantity parsing. Email headers,
 * quoted-reply separators, serial-number fragments and pressure/spec lines all
 * otherwise masquerade as line items.
 */
const LINE_SKIP_RE = [
  /^\s*(?:subject|from|sent|date|to|cc|bcc|reply-to|return-path|importance)\s*:/i,
  /^on\s.+wrote:?\s*$/i,
  /^\s*[-_=]{3,}/,
  /^\s*(?:begin\s+forwarded|forwarded\s+message|original\s+message)/i,
  /\b(?:sr|sl)\.?\s*no\b/i,
  /\b(?:gst|hsn|sac|igst|cgst|sgst)\b/i,
  /\bpsig\b|\bkg\s*\/\s*cm2\b|\bkg\s*\/\s*cm\b/i,
];

/** Strips leading `>` / `|` quote markers so quoted history collapses on dedupe. */
function stripQuoteMarkers(line: string): string {
  return line.replace(/^\s*(?:[>|]+\s*)+/, "");
}

function shouldSkipLine(line: string): boolean {
  return LINE_SKIP_RE.some((re) => re.test(line));
}

/** A line that is clearly a header/noise line, not an item. */
function isNoiseItemName(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return true;
  if (/^(?:https?:\/\/|www\.)/i.test(n)) return true;
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(n)) return true;
  if (SKIP_ITEM_RE.some((re) => re.test(n))) return true;
  // A line that is only a quantity unit or label ("Nos", "Qty", "Nos.") is noise.
  if (new RegExp(`^(?:${UNIT_ALT}|qty|quantity|qnty)\\.?$`, "i").test(n)) return true;
  // A line that is only digits/punctuation is never an item.
  if (!/[a-z]/i.test(n)) return true;
  return false;
}

/** Decodes the handful of HTML entities that show up in mail bodies. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Strips tags and entity-decodes, preserving line breaks and tabs. */
export function htmlToText(text: string): string {
  return decodeEntities(
    text
      .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<\/(?:td|th)>/gi, "\t")
      .replace(/<[^>]+>/g, " "),
  );
}

function parsePositiveNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const value = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(value) || value <= 0 || value > MAX_QUANTITY) return null;
  return value;
}

/**
 * Extracts a quantity from a line and returns the line with the quantity token
 * removed. Returns `null` when the line carries no explicit quantity.
 */
function extractQuantity(rawLine: string): { quantity: number; cleaned: string } | null {
  const line = rawLine.replace(PRICE_TOKEN_RE, " ");
  let m = QTY_LABEL_RE.exec(line);
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  m = RANGE_UNIT_RE.exec(line);
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  m = LEADING_QTY_RE.exec(line);
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  // Last match wins: "Valve 2 Nos DN100 4 Nos" -> 4.
  m = [...line.matchAll(TRAILING_UNIT_RE)].pop() ?? null;
  if (m) {
    const quantity = parsePositiveNumber(m[1]);
    if (quantity !== null) return { quantity, cleaned: line.replace(m[0], " ") };
  }

  return null;
}

/** Cleans a candidate line into an item name, or `null` if it is noise. */
function toItemName(line: string): string | null {
  const name = line
    .replace(ENUMERATOR_RE, "")
    .replace(TRAILING_PRICE_RE, "")
    .replace(/^[\s*:;.\-–—>|]+/, "")
    .replace(TRAILING_SEP_RE, "")
    .replace(/[\s*:;.\-–—|]+$/, "")
    .replace(LEADING_OF_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || isNoiseItemName(name)) return null;
  return name;
}

function dedupeKey(item: ParsedDocketItem): string {
  return `${item.itemName.toLowerCase().replace(/\s+/g, " ").trim()}|${item.quantity}`;
}

// -----------------------------------------------------------------------------
// File patterns
//
// Every known way an enquiry lists its items has ONE reader below, and every
// item records which reader produced it:
//
//   mail-lines       item lines typed in the mail body ("1. Gate Valve - 2 Nos")
//   column-table     a table with a description and a quantity column; optional
//                    size / PN columns are folded into the name
//   sectioned-sheet  a sheet whose items sit under heading rows (general note,
//                    lettered section, "PN-1.0" sub-heading) that belong in the name
//
// A description merged over several rows is not a reader: `fillMergedDown` in
// docket-attachments.ts un-merges it before the text reaches this file, after
// which it is an ordinary column-table.
//
// To support a new file type: write a `TableLayout`, put it in `TABLE_LAYOUTS`
// above the layouts it is more specific than (first match wins), and add a test
// with a sample of the file. Existing readers stay untouched.
// -----------------------------------------------------------------------------

export type DocketItemPattern = "mail-lines" | "column-table" | "sectioned-sheet";

type Candidate = ParsedDocketItem & { pattern: DocketItemPattern };

interface TableHeader {
  desc: number;
  qty: number;
  size: number;
  /** A "(MM)" size header means bare numbers are millimetres, not inches. */
  sizeMm: boolean;
  rating: number;
  fields: number;
}

/** One table: its header and the rows under it that have the header's width. */
interface TableBlock {
  header: TableHeader;
  rows: string[][];
}

interface TableLayout {
  name: DocketItemPattern;
  matches(table: TableBlock): boolean;
  read(table: TableBlock): ParsedDocketItem[];
}

/**
 * Shared by every table layout: splits tab- or pipe-delimited text (email tables
 * and spreadsheets flattened to text) into tables. A table starts at a header row
 * with a description column and a quantity column and ends at the next header or
 * the first non-table line.
 */
function splitTables(lines: string[]): TableBlock[] {
  const tables: TableBlock[] = [];
  let current: TableBlock | null = null;

  for (const raw of lines) {
    // Edge tabs are empty cells: trimming them would shift "\tPN-1.0" out of its column.
    const line = stripQuoteMarkers(raw).replace(/^[ \r]+|[ \r]+$/g, "");
    const delimiter = line.includes("\t") ? "\t" : line.includes("|") ? "|" : null;
    if (!delimiter) {
      current = null;
      continue;
    }
    const cells = line.split(delimiter).map((c) => c.trim());

    const totalQtyIdx = cells.findIndex((c) => /^total\s*qty$/i.test(c));
    const qtyIdx = totalQtyIdx !== -1
      ? totalQtyIdx
      : cells.findIndex((c) => /^(?:qty|quantity|qnty|nos|no\.?|req(?:d|uired)?\s*qty)$/i.test(c));
    const descIdx = cells.findIndex((c) =>
      /^(?:item|item\s*name|item\s*desc(?:ription)?|description|particulars|material|name|specification)$/i.test(c),
    );

    if (qtyIdx !== -1 && descIdx !== -1) {
      const sizeIdx = cells.findIndex((c) =>
        /^(?:nominal\s*)?(?:size|size\s*\/\s*dn|dn|nb|dia|diameter)(?:\s*\((?:mm|inch|in)\))?$/i.test(c),
      );
      const ratingIdx = cells.findIndex((c) =>
        /^(?:pn|pressure\s*rating|rating|class|pn\s*\/\s*(?:ansi\s*)?(?:rating|class))$/i.test(c),
      );
      current = {
        header: {
          desc: descIdx,
          qty: qtyIdx,
          size: sizeIdx,
          sizeMm: sizeIdx >= 0 && /\(mm\)/i.test(cells[sizeIdx]),
          rating: ratingIdx,
          fields: cells.length,
        },
        rows: [],
      };
      tables.push(current);
      continue;
    }

    if (current && cells.length === current.header.fields) current.rows.push(cells);
  }

  return tables;
}

function rowQuantity(h: TableHeader, cells: string[]): number | null {
  return parsePositiveNumber((cells[h.qty] ?? "").match(/\d[\d,]*(?:\.\d+)?/)?.[0]);
}

/**
 * Folds the size and rating columns into the name when the description lacks
 * them, so rows that differ only by size / PN stay separate items.
 */
function foldSizeAndRating(h: TableHeader, cells: string[], name: string): string {
  let itemName = name;
  for (const [idx, isSize] of [[h.size, true], [h.rating, false]] as const) {
    if (idx < 0) continue;
    let cell = (cells[idx] ?? "").trim();
    if (!cell || cell === "-") continue;
    if (isSize && h.sizeMm && /^\d+$/.test(cell)) cell = `${cell}MM`;
    if (!itemName.toLowerCase().includes(cell.toLowerCase())) {
      itemName = `${itemName} ${cell}`.replace(/\s+/g, " ").trim();
    }
  }
  return itemName;
}

/**
 * A heading row has no quantity and text only in the description column, plus at
 * most a short enumerator ("A"). Anything else filled in (a unit, a rate) makes
 * it a quantity-less item, not a heading. Returns the heading text and whether it
 * is enumerated, or `null` for a non-heading row.
 */
function readHeading(h: TableHeader, cells: string[]): { text: string; enumerated: boolean } | null {
  if (rowQuantity(h, cells) !== null) return null;
  const text = toItemName(cells[h.desc] ?? "");
  if (!text) return null;
  const others = cells.filter((c, i) => i !== h.desc && c);
  if (others.length > 1 || (others[0]?.length ?? 0) > 6) return null;
  return { text, enumerated: others.length === 1 };
}

/** Pattern: sectioned-sheet. Item name = general note + section + sub-heading + row text. */
const sectionedSheet: TableLayout = {
  name: "sectioned-sheet",
  matches: ({ header, rows }) => rows.some((cells) => readHeading(header, cells) !== null),
  read({ header, rows }) {
    const out: ParsedDocketItem[] = [];
    let note = "";
    let section = "";
    let sub = "";
    for (const cells of rows) {
      const heading = readHeading(header, cells);
      if (heading) {
        if (heading.enumerated) {
          section = heading.text;
          sub = "";
        } else if (section) sub = heading.text;
        // Before any section: notes stack up until the first item, then replace.
        else note = out.length ? heading.text : `${note} ${heading.text}`.trim();
        continue;
      }
      const quantity = rowQuantity(header, cells);
      const name = toItemName(cells[header.desc] ?? "");
      if (quantity === null || !name) continue;
      const itemName = [note, section, sub, name].filter(Boolean).join(" ");
      out.push({ itemName: foldSizeAndRating(header, cells, itemName), quantity });
    }
    return out;
  },
};

/** Pattern: column-table. One item per row that has a description and a quantity. */
const columnTable: TableLayout = {
  name: "column-table",
  matches: () => true,
  read({ header, rows }) {
    const out: ParsedDocketItem[] = [];
    for (const cells of rows) {
      const quantity = rowQuantity(header, cells);
      const name = toItemName(cells[header.desc] ?? "");
      if (quantity === null || !name) continue;
      out.push({ itemName: foldSizeAndRating(header, cells, name), quantity });
    }
    return out;
  },
};

/** First match wins: most specific layout first, `column-table` is the catch-all. */
const TABLE_LAYOUTS: TableLayout[] = [sectionedSheet, columnTable];

function readTables(lines: string[], out: Candidate[]): void {
  for (const table of splitTables(lines)) {
    const layout = TABLE_LAYOUTS.find((l) => l.matches(table))!;
    for (const item of layout.read(table)) out.push({ ...item, pattern: layout.name });
  }
}

/** Pattern: mail-lines. One item per body line that carries an explicit quantity. */
function readMailLines(lines: string[], out: Candidate[]): void {
  for (const rawLine of lines) {
    const line = stripQuoteMarkers(rawLine).trim();
    if (!line || line.length > 400) continue;
    if (shouldSkipLine(line)) continue;
    const qty = extractQuantity(line);
    if (!qty) continue;
    const itemName = toItemName(qty.cleaned);
    if (!itemName) continue;
    out.push({ itemName, quantity: qty.quantity, pattern: "mail-lines" });
  }
}

/**
 * Parses every provided source into de-duplicated `{ itemName, quantity }`
 * candidates, in first-seen order, plus the file patterns that produced them.
 * Never throws.
 *
 * The email body is read as tables **and** as mail lines. OCR text and
 * attachment text are read as **tables only**: free-form OCR fragments (specs,
 * inspection reports) otherwise masquerade as line items, while genuine
 * BOQ/spreadsheet tables are still captured.
 */
export function parseDocketItemsWithPatterns(
  input: DocketParserInput,
): { items: ParsedDocketItem[]; patterns: DocketItemPattern[] } {
  const maxItems = input.maxItems && input.maxItems > 0 ? input.maxItems : MAX_ITEMS_DEFAULT;
  const candidates: Candidate[] = [];

  const toLines = (raw: string): string[] | null => {
    try {
      return htmlToText(String(raw)).split(/\r?\n/);
    } catch {
      return null;
    }
  };

  for (const body of input.bodies ?? []) {
    const lines = body ? toLines(body) : null;
    if (!lines) continue;
    readTables(lines, candidates);
    readMailLines(lines, candidates);
  }

  for (const raw of [input.ocrText, ...(input.attachmentTexts ?? [])]) {
    const lines = raw ? toLines(raw) : null;
    if (lines) readTables(lines, candidates);
  }

  const seen = new Set<string>();
  const items: ParsedDocketItem[] = [];
  const patterns = new Set<DocketItemPattern>();
  for (const { pattern, ...item } of candidates) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    patterns.add(pattern);
    if (items.length >= maxItems) break;
  }

  return { items, patterns: [...patterns] };
}

export function parseDocketItems(input: DocketParserInput): ParsedDocketItem[] {
  return parseDocketItemsWithPatterns(input).items;
}
