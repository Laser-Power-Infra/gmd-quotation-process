import type { DataColumn, TableQuery } from "@gmd/ui/components/data-table/types";

// Drawings & QAP: every rule a drawing entry follows (document types, the status flow and who may
// move it, the GMDSPL number), the shapes the server functions take and return, and the Drawings
// page's columns. Plain TS: imported by the server functions, the SQL builder and the client UI alike.

export const DOC_TYPES = ["GAD", "QAP", "Cover & list of drawings", "Datasheet", "Merged set"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** In flow order; the page sorts on this order. "Superseded" is only ever set by a new revision. */
export const DRAWING_STATUSES = [
  "Draft prepared",
  "Sent to Washim for verification",
  "Correction required",
  "Verified by Washim",
  "Sent to client",
  "Client comments received",
  "Approved by client",
  "Superseded",
] as const;
export type DrawingStatus = (typeof DRAWING_STATUSES)[number];

/** Who the host says the caller is. A verifier (Washim) is also an editor; "api" (Claude, outside the app) never verifies. */
export type DrawingRole = "verifier" | "editor" | "viewer" | "api";
export interface DrawingActor {
  /** Stamped on every change as `by`. */
  name: string;
  role: DrawingRole;
}

/** What a move must carry in the same step: a comment, a comment or a file/link, or an uploaded PDF. */
export type MoveNeed = "comment" | "comment-or-file" | "pdf";
export interface DrawingMove {
  from: DrawingStatus;
  to: DrawingStatus;
  roles: readonly DrawingRole[];
  needs?: MoveNeed;
}

const EDIT: readonly DrawingRole[] = ["editor", "verifier", "api"];
const VERIFY: readonly DrawingRole[] = ["verifier"];

/** Every allowed move (anything else is refused), ordered by the status moved to. */
export const DRAWING_MOVES: readonly DrawingMove[] = [
  { from: "Correction required", to: "Draft prepared", roles: EDIT },
  { from: "Draft prepared", to: "Sent to Washim for verification", roles: EDIT },
  { from: "Sent to Washim for verification", to: "Correction required", roles: VERIFY, needs: "comment" },
  { from: "Verified by Washim", to: "Correction required", roles: VERIFY, needs: "comment" },
  { from: "Draft prepared", to: "Verified by Washim", roles: VERIFY },
  { from: "Sent to Washim for verification", to: "Verified by Washim", roles: VERIFY },
  { from: "Verified by Washim", to: "Sent to client", roles: EDIT },
  { from: "Sent to client", to: "Client comments received", roles: EDIT, needs: "comment-or-file" },
  { from: "Sent to client", to: "Approved by client", roles: EDIT, needs: "pdf" },
  { from: "Client comments received", to: "Approved by client", roles: EDIT, needs: "pdf" },
];

/** The moves `role` may make from `status`, in flow order: the status dropdown's options. */
export const movesFor = (status: string, role: DrawingRole) =>
  DRAWING_MOVES.filter((m) => m.from === status && m.roles.includes(role));

const NEED_TEXT: Record<MoveNeed, string> = {
  comment: "a comment saying what to correct",
  "comment-or-file": "the client's comments or their file",
  pdf: "the client-approved PDF uploaded in the same step",
};

/**
 * Why a move from `from` to `to` is refused, or null when it may go ahead. `files` counts the new
 * files and links of this step, `pdfs` the uploaded (hashed) files among them.
 */
export function checkMove(
  from: string,
  to: string,
  role: DrawingRole,
  step: { comment: string; files: number; pdfs: number },
): { code: "not-allowed" | "invalid"; error: string } | null {
  if (to === "Superseded") return { code: "not-allowed", error: '"Superseded" is set only by adding a new revision.' };
  const move = DRAWING_MOVES.find((m) => m.from === from && m.to === to);
  if (!move || !move.roles.includes(role)) {
    return { code: "not-allowed", error: `The ${role} role cannot move a drawing from "${from}" to "${to}".` };
  }
  const comment = step.comment.trim() !== "";
  const has: Record<MoveNeed, boolean> = { comment, "comment-or-file": comment || step.files > 0, pdf: step.pdfs > 0 };
  return !move.needs || has[move.needs] ? null : { code: "invalid", error: `"${to}" needs ${NEED_TEXT[move.needs]}.` };
}

export const revLabel = (rev: number) => `R-${rev}`;

/** The last number used before the app kept the register (Puja, 18 Nov 2026). */
export const LAST_USED_DRAWING_NO = "GMDSPL-26110029";

/** "GMDSPL-YYMM" of `now` in India time (IST has no DST, so a fixed +5:30 is exact). */
export function drawingNoPrefix(now: Date): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return `GMDSPL-${String(ist.getUTCFullYear() % 100).padStart(2, "0")}${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** India calendar days from `statusAt` (ISO) to `now`: the Drawings page's "Days at stage", for one entry. */
export function daysAtStage(statusAt: string, now: Date): number {
  const istDay = (ms: number) => Math.floor((ms + 330 * 60_000) / 86_400_000);
  return istDay(now.getTime()) - istDay(Date.parse(statusAt));
}

/** Highest 4-digit serial under this month's prefix (counting LAST_USED_DRAWING_NO) + 1. Only a suggestion. */
export function nextDrawingNo(existing: readonly string[], now: Date): string {
  const prefix = drawingNoPrefix(now);
  // shortcut: a 10,000th number in one month comes out with 5 digits and createDrawing refuses it; widen both if that ever happens.
  const serial = new RegExp(`^${prefix}(\\d{4})$`);
  const serials = [...existing, LAST_USED_DRAWING_NO].map((no) => Number(serial.exec(no)?.[1] ?? 0));
  return `${prefix}${String(Math.max(...serials) + 1).padStart(4, "0")}`;
}

/** Same rule as normalizeContractKey (apps/gmd-quotation-process/lib/contractDocketMatch.ts): trimmed, spaces collapsed, upper-cased. */
export const contractKey = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// ---- What the server functions take and return ----------------------------------------------

/** "conflict" = the drawing no is another contract's; `suggestion` is the next free number. */
export type DrawingFailure =
  | { success: false; code: "not-found" | "not-allowed" | "invalid" | "stale" | "error"; error: string }
  | { success: false; code: "conflict"; error: string; suggestion: string };
export type DrawingResult<T> = { success: true; data: T } | DrawingFailure;

/** One uploaded file (from lib/drawingFiles: sha256 of its bytes) or one link (no sha256). */
export interface DrawingFileInput {
  fileName?: string | null;
  /** http(s) only. */
  fileUrl: string;
  /** Set only by the server that hashed the bytes; it marks a file as an uploaded PDF. */
  sha256?: string | null;
}

export interface NewDrawingInput {
  /** Contract no or PO no; the entry is stored against the contract no, trimmed and upper-cased. */
  contract: string;
  /** GMDSPL-YYMMxxxx; see suggestNextDrawingNo. */
  drawingNo: string;
  /** Default 0 (R-0). */
  rev?: number;
  /** One of DOC_TYPES. */
  docType: string;
  /** Product & sizes covered. */
  product?: string | null;
  pn?: string | null;
  standard?: string | null;
  flangeDrilling?: string | null;
  preparedBy?: string | null;
  remarks?: string | null;
  /** Contract Review item codes the drawing covers; empty = the whole contract. */
  itemCodes?: string[];
}

export interface StatusStep {
  /** The status the caller saw; the change applies only while the drawing still has it. */
  from: string;
  to: string;
  comment?: string | null;
  /** Attached in the same step (the client's comments, the approved copy). */
  files?: DrawingFileInput[];
}

export interface DrawingEvent {
  id: string;
  /** Set on a status change, null on a file or link. */
  status: string | null;
  comment: string | null;
  fileName: string | null;
  fileUrl: string | null;
  sha256: string | null;
  /** Attached in the approving step or while "Approved by client": the client-approved copy. */
  final: boolean;
  by: string;
  /** ISO time. */
  at: string;
}

export interface DrawingEntry {
  id: string;
  contractNo: string;
  drawingNo: string;
  rev: number;
  docType: string;
  product: string | null;
  pn: string | null;
  standard: string | null;
  flangeDrilling: string | null;
  preparedBy: string | null;
  remarks: string | null;
  itemCodes: string[];
  status: string;
  /** ISO time of the latest status change, and who made it. */
  statusAt: string;
  statusBy: string;
  createdAt: string;
  updatedAt: string;
  /** Oldest first. */
  events: DrawingEvent[];
  /** Statuses the calling actor may move the drawing to now (movesFor). */
  moves: string[];
}

/** One Contract Review line of the contract: what a drawing can be tagged with. */
export interface ContractLine {
  itemCode: string;
  itemName: string | null;
  size: string | null;
  pnRating: string | null;
  orderQty: string | null;
  /** dd-MMM-yyyy, kept in step with the drawings that cover the line. */
  approvalDate: string | null;
}

/** Read live from Contract Review on every call. */
export interface ContractInfo {
  contractNo: string;
  /** PARTY NAME (DUMP). */
  contractor: string | null;
  /** UTILITY. */
  client: string | null;
  /** PROJECT REFERENCE. */
  project: string | null;
  poNo: string | null;
  /** DATE OF CONTRACT, the "Contract / PO date", as typed. */
  contractDate: string | null;
  /** Some line still has a blank STATUS. */
  live: boolean;
  lines: ContractLine[];
}

export interface ContractDrawings {
  contract: ContractInfo;
  /** Every revision, superseded ones included: drawing no, then newest rev first. */
  drawings: DrawingEntry[];
}

// ---- The Drawings page ----------------------------------------------------------------------

/** A live contract with no drawing yet shows as one row with this status. */
export const NO_DRAWINGS = "No drawings";
/** Status sort and facet order. */
export const STATUS_ORDER = [NO_DRAWINGS, ...DRAWING_STATUSES];

/** One current (not superseded) drawing, or one "No drawings" contract. Blank text cells are "". */
export interface DrawingRow {
  /** The drawing id, or "contract:<contract no>" on a "No drawings" row. */
  id: string;
  contractNo: string;
  contractor: string;
  client: string;
  project: string;
  poNo: string;
  contractDate: string;
  drawingNo: string;
  rev: number | null;
  docType: string;
  product: string;
  status: string;
  daysAtStage: number | null;
  owner: string;
  changedBy: string;
}

/** `extra.pending`: only drawings still waiting (no "No drawings" rows, nothing the client approved). */
export type DrawingsQuery = TableQuery & { extra?: { pending?: boolean } };

export const DRAWING_COLUMNS: DataColumn<DrawingRow>[] = [
  { key: "contractNo", label: "Contract", kind: "text", sortable: true, sticky: true, width: 140 },
  { key: "contractor", label: "Contractor", kind: "text", filter: true, sortable: true, width: 220 },
  { key: "client", label: "Client", kind: "text", filter: true, sortable: true, width: 200 },
  { key: "project", label: "Project", kind: "text", sortable: true, width: 220 },
  { key: "poNo", label: "PO no.", kind: "text", sortable: true, width: 160 },
  // shortcut: shown as typed in Contract Review (mixed date formats), so not sorted or filtered; parse it if that is wanted.
  { key: "contractDate", label: "Contract / PO date", kind: "text", width: 130 },
  { key: "drawingNo", label: "Drawing no.", kind: "text", sortable: true, width: 160 },
  { key: "rev", label: "Rev", kind: "number", sortable: true, align: "right", width: 70, render: (r) => (r.rev === null ? "" : revLabel(r.rev)) },
  { key: "docType", label: "Type", kind: "text", filter: true, sortable: true, width: 170 },
  { key: "product", label: "Product & sizes", kind: "text", sortable: true, width: 240 },
  { key: "status", label: "Status", kind: "text", filter: true, sortable: true, width: 230 },
  { key: "daysAtStage", label: "Days at stage", kind: "number", sortable: true, align: "right", width: 110 },
  { key: "owner", label: "Owner", kind: "text", filter: true, sortable: true, width: 130 },
  { key: "changedBy", label: "Last changed by", kind: "text", sortable: true, width: 150 },
];

/** Upload limits, one place: the dialog checks them before sending, the Server Action and lib/drawingFiles enforce them. */
export const MAX_PDFS_PER_CALL = 10;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
/** Under next.config serverActions.bodySizeLimit (100 MB), leaving room for the form's other fields. */
export const MAX_UPLOAD_TOTAL_BYTES = 95 * 1024 * 1024;

/** What is wrong with a chosen set of PDFs, or null when it can go. Names the limit that was exceeded. */
export function checkPdfs(files: readonly { name: string; size: number }[]): string | null {
  if (files.length > MAX_PDFS_PER_CALL) return `Too many files: ${files.length} chosen, at most ${MAX_PDFS_PER_CALL} at a time.`;
  const notPdf = files.find((f) => !/\.pdf$/i.test(f.name));
  if (notPdf) return `"${notPdf.name}" is not a PDF. Only .pdf files can be uploaded.`;
  const big = files.find((f) => f.size > MAX_PDF_BYTES);
  if (big) return `"${big.name}" is ${(big.size / 1048576).toFixed(1)} MB; each file must be 25 MB or less.`;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_UPLOAD_TOTAL_BYTES) return `The files add up to ${(total / 1048576).toFixed(0)} MB; at most 95 MB can be sent at once. Upload them in smaller batches.`;
  return null;
}
