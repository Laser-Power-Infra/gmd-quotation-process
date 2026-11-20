import { prisma as tenderPrisma } from "@gmd/db-tender";
import {
  DOC_TYPES,
  DRAWING_MOVES,
  DRAWING_STATUSES,
  checkMove,
  revLabel,
  type DrawingActor,
  type DrawingFailure,
  type DrawingFileInput,
} from "@gmd/drawings/columns";
import { addFilesOrLinks, changeStatus, createDrawing, getContractDrawings, suggestNextDrawingNo } from "@gmd/drawings/server";
import { uploadDrawingPdfs } from "@/lib/drawingFiles";
import { MAX_UPLOAD_BYTES, UPLOAD_MAGIC, fileHead } from "@/lib/uploadChecks";
import { requireSyncApiKey } from "@/schedular_function/auth";

// Drawings & QAP for the requester's own Claude, from outside the app (documentation/drawings-api.md).
// It has its own key, GMD_DRAWINGS_API_KEY in x-api-key: the scheduler's sync key is refused here.
// The package owns every rule; this route checks what comes in and refuses what the API may never
// do before it touches the database or Drive.

const KEY_ENV = "GMD_DRAWINGS_API_KEY";
const ACTOR: DrawingActor = { name: "Claude (API)", role: "api" };
const MAX_FILES = 10;
// Stored text can never be edited or removed, so every text value has a ceiling.
const MAX_TEXT = 2000;
const MAX_REF = 100;
const MAX_CODES = 200;
const MAX_COMMENT = 4000;
const MAX_NAME = 200;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_FORM_BYTES = MAX_FILES * MAX_UPLOAD_BYTES + 1024 * 1024;
/** Same rule as createDrawing. */
const DRAWING_NO = /^GMDSPL-\d{2}(0[1-9]|1[0-2])\d{4}$/;
const REV = /^\d{1,3}$/;
/** Same rule as the Contract Review mail-docs links. */
const isLink = (url: string) => url.length <= 2000 && /^https?:\/\/\S+$/i.test(url) && URL.canParse(url);
/** Control characters and bidi overrides in a file name reach staff in Drive and in the register. */
const ODD_NAME = /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/;
/** What the API may move a drawing to: never Washim's two statuses, nor "Superseded" (set by a new revision). */
const API_STATUSES = new Set<string>(DRAWING_MOVES.filter((m) => m.roles.includes(ACTOR.role)).map((m) => m.to));
// The API's own rights are refused up front (403), so a "not-allowed" the package still gives is about the drawing's state.
const HTTP: Record<DrawingFailure["code"], number> = { "not-found": 404, invalid: 400, conflict: 409, stale: 409, "not-allowed": 409, error: 500 };
const TEXT_FIELDS = ["product", "pn", "standard", "flangeDrilling", "preparedBy", "remarks"];
const POST_FIELDS = ["contractNo", "poNo", "drawingNo", "rev", "docType", "itemCodes", ...TEXT_FIELDS];
const PATCH_FIELDS = ["drawingNo", "rev", "from", "status", "comment", "link", "file"];
const isStatus = (s: string) => (DRAWING_STATUSES as readonly string[]).includes(s);

const reply = (status: number, body: object) => Response.json(body, { status });
const invalid = (field: string, error: string) => reply(400, { error, field });
/** Nothing else bounds a body: Node stops it at the declared length, so a declared, capped length caps what json()/formData() read into memory. */
const sizeRefusal = (request: Request, limit: number, error: string) => {
  const length = Number(request.headers.get("content-length"));
  if (!(length > 0)) return reply(411, { error: "Send the body with a Content-Length header (no chunked upload)." });
  return length > limit ? reply(413, { error }) : null;
};
const refused = (res: DrawingFailure) =>
  reply(HTTP[res.code], res.code === "conflict" ? { error: res.error, suggestedDrawingNo: res.suggestion } : { error: res.error });

/** ?contractNo= or ?poNo= → { nextDrawingNo, contract, entries }. */
export async function GET(request: Request) {
  const auth = requireSyncApiKey(request, KEY_ENV);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  const query = new URL(request.url).searchParams;
  const contract = query.get("contractNo")?.trim() || query.get("poNo")?.trim();
  if (!contract) return invalid("contractNo", "Add ?contractNo= or ?poNo= to the URL.");
  if (contract.length > MAX_REF) return invalid("contractNo", `contractNo must be at most ${MAX_REF} characters.`);
  const found = await getContractDrawings(ACTOR, contract);
  if (!found.success) return refused(found);
  const next = await suggestNextDrawingNo(ACTOR);
  if (!next.success) return refused(next);
  return reply(200, { nextDrawingNo: next.data, contract: found.data.contract, entries: found.data.drawings });
}

/** JSON → 201 with the new entry, 200 with the existing one when the same create comes again. */
export async function POST(request: Request) {
  const auth = requireSyncApiKey(request, KEY_ENV);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  const tooBig = sizeRefusal(request, MAX_JSON_BYTES, "Send at most 64 KB of JSON.");
  if (tooBig) return tooBig;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("body", "Send one JSON object.");
  const unknown = Object.keys(body).find((k) => !POST_FIELDS.includes(k));
  if (unknown) return invalid(unknown, `Unknown field "${unknown}"; use ${POST_FIELDS.join(", ")}.`);
  const notRef = ["contractNo", "poNo"].find((k) => body[k] != null && (typeof body[k] !== "string" || body[k].length > MAX_REF));
  if (notRef) return invalid(notRef, `${notRef} must be text of at most ${MAX_REF} characters.`);
  if (body.contractNo?.trim() && body.poNo?.trim()) return invalid("poNo", "Give contractNo or poNo, not both.");
  const contract = body.contractNo?.trim() || body.poNo?.trim();
  if (!contract) return invalid("contractNo", "Give contractNo or poNo.");
  const drawingNo = typeof body.drawingNo === "string" ? body.drawingNo.trim().toUpperCase() : "";
  if (!DRAWING_NO.test(drawingNo)) return invalid("drawingNo", "drawingNo must be GMDSPL-YYMM and 4 digits, e.g. GMDSPL-26110030.");
  const rev = body.rev ?? 0;
  if (!Number.isInteger(rev) || rev < 0 || rev > 999) return invalid("rev", "rev must be a whole number from 0 to 999.");
  if (!(DOC_TYPES as readonly string[]).includes(body.docType)) return invalid("docType", `docType must be one of: ${DOC_TYPES.join(", ")}.`);
  const notText = TEXT_FIELDS.find((k) => body[k] != null && (typeof body[k] !== "string" || body[k].length > MAX_TEXT));
  if (notText) return invalid(notText, `${notText} must be text of at most ${MAX_TEXT} characters.`);
  const codes = body.itemCodes;
  if (codes != null && !(Array.isArray(codes) && codes.length <= MAX_CODES && codes.every((c: unknown) => typeof c === "string" && c.length <= MAX_REF))) {
    return invalid("itemCodes", `itemCodes must be a list of at most ${MAX_CODES} of the contract's item codes, each at most ${MAX_REF} characters.`);
  }
  const start = Date.now();
  const res = await createDrawing(ACTOR, {
    contract,
    drawingNo,
    rev,
    docType: body.docType,
    product: body.product,
    pn: body.pn,
    standard: body.standard,
    flangeDrilling: body.flangeDrilling,
    preparedBy: body.preparedBy?.trim() || "Claude",
    remarks: body.remarks,
    itemCodes: body.itemCodes,
  });
  if (!res.success) return refused(res);
  // A new entry is stamped during this call; a repeat hands back the entry made earlier.
  return reply(Date.parse(res.data.statusAt) >= start ? 201 : 200, { entry: res.data });
}

/** multipart/form-data: drawingNo, rev, from?, status?, comment?, link (repeatable), file (repeatable PDF) → 200 with the entry. */
export async function PATCH(request: Request) {
  const auth = requireSyncApiKey(request, KEY_ENV);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  // formData() holds the whole body in memory (about three times over), so a body bigger than MAX_FILES full-size PDFs is refused unread.
  const tooBig = sizeRefusal(request, MAX_FORM_BYTES, `Send at most ${MAX_FILES} PDFs of 25 MB each per call.`);
  if (tooBig) return tooBig;
  const form = await request.formData().catch(() => null);
  if (!form) return invalid("body", "Send multipart/form-data.");
  const entries = [...form.entries()];
  const unknown = entries.find(([k]) => !PATCH_FIELDS.includes(k));
  if (unknown) return invalid(unknown[0], `Unknown field "${unknown[0]}"; use ${PATCH_FIELDS.join(", ")}.`);
  const misplaced = entries.find(([k, v]) => (k === "file") === (typeof v === "string"));
  if (misplaced) return invalid(misplaced[0], misplaced[0] === "file" ? "file must be an uploaded file." : `${misplaced[0]} must be text.`);
  const twice = ["drawingNo", "rev", "from", "status", "comment"].find((k) => form.getAll(k).length > 1);
  if (twice) return invalid(twice, `Send ${twice} once.`);
  const text = (k: string) => String(form.get(k) ?? "").trim();

  const drawingNo = text("drawingNo").toUpperCase();
  if (!DRAWING_NO.test(drawingNo)) return invalid("drawingNo", "drawingNo must be GMDSPL-YYMM and 4 digits, e.g. GMDSPL-26110030.");
  if (!REV.test(text("rev"))) return invalid("rev", "rev must be a whole number from 0 to 999.");
  const rev = Number(text("rev"));
  const status = text("status");
  if (status && !isStatus(status)) return invalid("status", `status must be one of: ${DRAWING_STATUSES.join("; ")}.`);
  const from = text("from");
  if (from && !isStatus(from)) return invalid("from", `from must be one of: ${DRAWING_STATUSES.join("; ")}.`);
  if (from && !status) return invalid("from", "from goes with status: it is the status you last read.");
  if (status && !API_STATUSES.has(status)) {
    return reply(403, {
      error: `The API cannot set "${status}": only Washim sets "Verified by Washim" and "Correction required", and "Superseded" comes from a new revision in the app.`,
    });
  }
  const comment = text("comment");
  if (comment.length > MAX_COMMENT) return invalid("comment", `comment must be at most ${MAX_COMMENT} characters.`);
  if (comment && !status) return invalid("comment", "A comment is saved with a status change; add status.");
  const links = form.getAll("link").map((l) => String(l).trim());
  const badLink = links.find((l) => !isLink(l));
  if (badLink !== undefined) return invalid("link", `"${badLink.slice(0, 80)}" is not an http(s) link of at most 2000 characters.`);
  const files = form.getAll("file") as File[];
  if (files.length > MAX_FILES || links.length > MAX_FILES) {
    return invalid(files.length > MAX_FILES ? "file" : "link", `At most ${MAX_FILES} files and ${MAX_FILES} links per call.`);
  }
  const oddName = files.find((f) => f.name.length > MAX_NAME || ODD_NAME.test(f.name));
  if (oddName) return invalid("file", `A file name must be at most ${MAX_NAME} characters, with no control characters.`);
  const big = files.find((f) => f.size > MAX_UPLOAD_BYTES);
  if (big) return reply(413, { error: `"${big.name}" is larger than 25 MB.`, field: "file" });
  // Checked here too (uploadDrawingPdfs checks again) so a bad file is a 400 before any read, and an upload failure is Drive's.
  for (const f of files) {
    if (!UPLOAD_MAGIC.get("application/pdf")!.test(await fileHead(f))) return invalid("file", `"${f.name}" is not a PDF file.`);
  }
  if (!status && !files.length && !links.length) return invalid("status", "Nothing to do: send a status, a link or a file.");

  const drawing = await tenderPrisma.contractDrawing
    .findUnique({ where: { drawingNo_rev: { drawingNo, rev } }, select: { id: true, contractNo: true, status: true } })
    .catch((err: unknown) => {
      console.error("[drawings-api] could not read the drawing:", err);
      return undefined;
    });
  if (drawing === undefined) return reply(500, { error: "Could not read the drawing: server error." });
  const name = `${drawingNo} ${revLabel(rev)}`;
  if (!drawing) return reply(404, { error: `${name} is not in the register.` });
  if (drawing.status === "Superseded") return reply(409, { error: `${name} is superseded; use its current revision.` });
  const move = !!status && status !== drawing.status;
  if (move) {
    // Before uploading, so a step that is stale or that the flow refuses leaves nothing in Drive.
    if (from && from !== drawing.status) {
      return reply(409, { error: `${name} is now "${drawing.status}", not "${from}" as you read it; GET it again and decide.` });
    }
    const refusal = checkMove(drawing.status, status, ACTOR.role, { comment, files: files.length + links.length, pdfs: files.length });
    if (refusal) return reply(refusal.code === "invalid" ? 400 : 409, { error: refusal.error });
  } else if (!files.length && !links.length) {
    // The current status asked for again with nothing to attach: a repeat, answered with the entry as it is.
    const found = await getContractDrawings(ACTOR, drawing.contractNo);
    if (!found.success) return refused(found);
    const current = found.data.drawings.find((d) => d.id === drawing.id);
    if (!current) return reply(500, { error: "Could not read the drawing: server error." });
    // unchanged: the status was already there, so this call's comment (and `from`) were not applied.
    return reply(200, { entry: current, unchanged: true });
  }

  let uploaded: DrawingFileInput[] = [];
  if (files.length) {
    // shortcut: Drive keeps a copy the register skips (a retried upload of the same bytes, a step refused after uploading, or the files already sent when a later one fails); clear such spares by hand if they ever pile up.
    const up = await uploadDrawingPdfs(files, drawingNo, rev);
    if (!up.success) {
      console.error("[drawings-api] upload failed:", up.error);
      // A missing folder setting is the server's, and retrying cannot help.
      if (up.error.startsWith("GMD_DRAWINGS_DRIVE_FOLDER_ID")) return reply(503, { error: "Drawing uploads are not set up on the server." });
      return reply(502, { error: "Could not upload the files to Drive; nothing was recorded in the register; some files may already be in Drive. Try again later." });
    }
    uploaded = up.data;
  }
  // sha256 only ever comes from uploadDrawingPdfs, which hashed the bytes: a link carries none.
  const attach = [...uploaded, ...links.map((fileUrl) => ({ fileUrl }))];
  const res = move
    ? await changeStatus(ACTOR, drawing.id, { from: from || drawing.status, to: status, comment, files: attach })
    : await addFilesOrLinks(ACTOR, drawing.id, attach);
  return res.success ? reply(200, move ? { entry: res.data } : { entry: res.data, unchanged: true }) : refused(res);
}
