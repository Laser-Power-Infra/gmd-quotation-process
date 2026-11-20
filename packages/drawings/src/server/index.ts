import "server-only";
import { Prisma, prisma, type ContractDrawing, type ContractDrawingEvent } from "@gmd/db-tender";
import {
  DOC_TYPES,
  checkMove,
  contractKey,
  drawingNoPrefix,
  movesFor,
  nextDrawingNo,
  revLabel,
  type ContractDrawings,
  type ContractInfo,
  type DrawingActor,
  type DrawingEntry,
  type DrawingFailure,
  type DrawingFileInput,
  type DrawingResult,
  type DrawingRole,
  type DrawingStatus,
  type NewDrawingInput,
  type StatusStep,
} from "../columns";
import { contractKeySql } from "./query";

export { listDrawingsFacet, listDrawingsPage } from "./query";

// Drawings & QAP entries in the tender DB. The host app owns auth and sessions and passes an actor
// whose role it decided; every rule about who may do what is enforced here. Nothing is ever deleted.

const sql = Prisma.sql;
const DRAWING_NO = /^GMDSPL-\d{2}(0[1-9]|1[0-2])\d{4}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EVENTS = { events: { orderBy: [{ at: "asc" as const }, { id: "asc" as const }] } };
const DRAFT: DrawingStatus = "Draft prepared";
const APPROVED: DrawingStatus = "Approved by client";
const SUPERSEDED: DrawingStatus = "Superseded";

type Tx = Prisma.TransactionClient;
type Drawing = ContractDrawing & { events: ContractDrawingEvent[] };
type CleanFile = { fileName: string | null; fileUrl: string; sha256: string | null };

const fail = (code: "not-found" | "not-allowed" | "invalid" | "stale" | "error", error: string): DrawingFailure => ({ success: false, code, error });
const ok = <T>(data: T): DrawingResult<T> => ({ success: true, data });
const VIEW_ONLY = fail("not-allowed", "You can view drawings but not change them.");
// Also thrown inside a transaction to roll it back.
const STALE = fail("stale", "This drawing was changed meanwhile; reload and try again.");
const NOT_FOUND = fail("not-found", "Drawing not found.");
const canWrite = (actor: DrawingActor) => actor.role !== "viewer" && !!actor.name?.trim();
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";
const readDrawing = (id: string) => prisma.contractDrawing.findUnique({ where: { id }, include: EVENTS });

async function run<T>(what: string, fn: () => Promise<DrawingResult<T>>): Promise<DrawingResult<T>> {
  try {
    return await fn();
  } catch (err) {
    // The details (SQL, table names) stay in the server log: callers may be outside the app.
    console.error(`[drawings] could not ${what}:`, err);
    return fail("error", `Could not ${what}: server error.`);
  }
}

/** Queues this transaction behind any other holding `key`, until it ends (a Postgres advisory lock). */
const lock = (tx: Tx, key: string) => tx.$executeRaw(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);

function toEntry({ events, statusAt, createdAt, updatedAt, ...rest }: Drawing, role: DrawingRole): DrawingEntry {
  return {
    ...rest,
    statusAt: statusAt.toISOString(),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    events: events.map(({ drawingId: _, at, ...e }) => ({ ...e, at: at.toISOString() })),
    moves: movesFor(rest.status, role).map((m) => m.to),
  };
}

const isWebLink = (url: string) => {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
};

/** The step's files and links, trimmed; a message instead when they are not a list, a link is not http(s) or a sha256 is malformed. */
function cleanFiles(files: unknown): CleanFile[] | string {
  if (!Array.isArray(files)) return "Files must be a list of files or links.";
  const out: CleanFile[] = [];
  for (const f of files as DrawingFileInput[]) {
    const fileUrl = text(f?.fileUrl);
    const sha256 = text(f?.sha256)?.toLowerCase() ?? null;
    if (!fileUrl || !isWebLink(fileUrl)) return `"${fileUrl ?? ""}" is not a web link.`;
    if (sha256 && !SHA256.test(sha256)) return `"${text(f.fileName) ?? fileUrl}" has a malformed sha256.`;
    out.push({ fileName: text(f.fileName), fileUrl, sha256 });
  }
  return out;
}

/** Files whose bytes are not on the drawing yet, each once; links always count. */
function newFiles(files: CleanFile[], events: { sha256: string | null }[]): CleanFile[] {
  const seen = new Set(events.map((e) => e.sha256));
  return files.filter((f) => {
    if (!f.sha256) return true;
    if (seen.has(f.sha256)) return false;
    seen.add(f.sha256);
    return true;
  });
}

/**
 * SQL: drawing `d` (ContractDrawing) is a current drawing covering the ContractReview line aliased
 * `line`: that line's contract, not superseded, and untagged (every line) or tagging the line's item
 * code. The one definition of "covered", used by the approval-date sync and coveredLineIds.
 */
export function coversLine(line: string): Prisma.Sql {
  if (!/^[A-Za-z_]\w*$/.test(line)) throw new Error(`coversLine: "${line}" is not a SQL alias.`);
  const key = (column: string) => contractKeySql(Prisma.raw(`${line}."${column}"`));
  return sql`d."contractNo" = ${key("contractNo")} AND d."status" <> ${SUPERSEDED}
    AND (cardinality(d."itemCodes") = 0 OR ${key("itemCode")} = ANY (d."itemCodes"))`;
}

/** The ids among `lineIds` (ContractReview) that a current drawing covers: their APPROVAL DATE belongs to the drawings. One query. */
export async function coveredLineIds(lineIds: string[]): Promise<Set<string>> {
  if (!lineIds.length) return new Set();
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    sql`SELECT DISTINCT r.id FROM "ContractReview" r JOIN "ContractDrawing" d ON ${coversLine("r")} WHERE r.id = ANY (${lineIds}::text[])`,
  );
  return new Set(rows.map((r) => r.id));
}

type LineRow = {
  contractNo: string;
  poKey: string;
  itemCode: string;
  itemName: string | null;
  size: string | null;
  pnRating: string | null;
  orderQty: string | null;
  approvalDate: string | null;
  status: string | null;
  contractor: string | null;
  client: string | null;
  project: string | null;
  poNo: string | null;
  contractDate: string | null;
};

/** The contract `ref` names (its contract no, else its PO no) with all of its Contract Review lines. */
async function findContract(ref: unknown): Promise<DrawingResult<ContractInfo>> {
  const key = typeof ref === "string" ? contractKey(ref) : "";
  if (!key) return fail("not-found", "Enter a contract no or PO no.");
  const no = (alias: string) => contractKeySql(Prisma.raw(`${alias}."contractNo"`));
  const po = (alias: string) => contractKeySql(Prisma.raw(`${alias}."poNo"`));
  // shortcut: a PO no must equal Contract Review's PO NO text (case and spaces aside); add a contains-match if callers need one.
  const lines = await prisma.$queryRaw<LineRow[]>(sql`SELECT ${no("r")} AS "contractNo", ${po("r")} AS "poKey",
      r."itemCode", r."itemName", r."size", r."pnRating", r."orderQty", r."approvalDate", r."status",
      r."partyNameDump" AS "contractor", r."utility" AS "client", r."projectReference" AS "project", r."poNo",
      r."dateOfContract" AS "contractDate"
    FROM "ContractReview" r
    WHERE ${no("r")} IN (SELECT ${no("x")} FROM "ContractReview" x WHERE ${no("x")} <> '' AND (${no("x")} = ${key} OR ${po("x")} = ${key}))
    ORDER BY r."itemCode", r.id`);
  const direct = lines.some((l) => l.contractNo === key);
  const contracts = [...new Set(lines.filter((l) => (direct ? l.contractNo === key : l.poKey === key)).map((l) => l.contractNo))];
  if (!contracts.length) return fail("not-found", `No contract or PO "${key}" in Contract Review.`);
  if (contracts.length > 1) return fail("invalid", `PO "${key}" is on contracts ${contracts.join(", ")}; use the contract no.`);
  const mine = lines.filter((l) => l.contractNo === contracts[0]);
  // The first filled value in item-code order: the same pick the Drawings page makes.
  const first = (k: "contractor" | "client" | "project" | "poNo" | "contractDate") => mine.map((l) => text(l[k])).find(Boolean) ?? null;
  return ok({
    contractNo: contracts[0],
    contractor: first("contractor"),
    client: first("client"),
    project: first("project"),
    poNo: first("poNo"),
    contractDate: first("contractDate"),
    live: mine.some((l) => !text(l.status)),
    lines: mine.map((l) => ({
      itemCode: contractKey(l.itemCode),
      itemName: l.itemName,
      size: l.size,
      pnRating: l.pnRating,
      orderQty: l.orderQty,
      approvalDate: l.approvalDate,
    })),
  });
}

/**
 * Contract Review's APPROVAL DATE (dd-MMM-yyyy) on every line the contract's current drawings cover
 * (coversLine): the India day of the last approval once every covering drawing is "Approved by
 * client", else blank. Lines no drawing covers keep what they have; lines already right are not
 * rewritten. Runs inside the caller's transaction, after its write.
 */
async function syncApprovalDates(tx: Tx, contractNo: string) {
  // One sync per contract at a time: under READ COMMITTED the UPDATE then sees what another
  // drawing's sync of this contract committed while we waited, instead of both writing blank.
  await lock(tx, `drawings:${contractNo}`);
  await tx.$executeRaw(sql`UPDATE "ContractReview" AS c SET "approvalDate" = v."day", "updatedAt" = now() AT TIME ZONE 'UTC'
    FROM (
      SELECT r.id, CASE WHEN bool_and(d."status" = ${APPROVED})
        THEN to_char((max(d."statusAt") AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'DD-Mon-YYYY') END AS "day"
      FROM "ContractReview" r JOIN "ContractDrawing" d ON ${coversLine("r")}
      WHERE d."contractNo" = ${contractNo}
      GROUP BY r.id
    ) AS v
    WHERE c.id = v.id AND c."approvalDate" IS DISTINCT FROM v."day"`);
}

/** The contracts that have a current (non-superseded) drawing: the ones whose approval dates the register owns. */
export async function contractsWithCurrentDrawings(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ contractNo: string }[]>(
    sql`SELECT DISTINCT "contractNo" FROM "ContractDrawing" WHERE "status" <> ${SUPERSEDED}`,
  );
  return rows.map((r) => r.contractNo);
}

/** Re-runs the locked approval-date sync of one contract in its own transaction (for the hourly Contract Review job). */
export function syncContractApprovalDates(contractNo: string): Promise<void> {
  return prisma.$transaction((tx) => syncApprovalDates(tx, contractNo));
}

async function nextFreeDrawingNo(client: Tx = prisma): Promise<string> {
  const now = new Date();
  const taken = await client.contractDrawing.findMany({ where: { drawingNo: { startsWith: drawingNoPrefix(now) } }, select: { drawingNo: true } });
  return nextDrawingNo(taken.map((d) => d.drawingNo), now);
}

async function conflict(client: Tx, why: string): Promise<DrawingFailure> {
  const suggestion = await nextFreeDrawingNo(client);
  return { success: false, code: "conflict", error: `${why}; next free number ${suggestion}.`, suggestion };
}

/** The contract's header (read live from Contract Review) and every drawing revision with its history. */
export function getContractDrawings(actor: DrawingActor, contract: string): Promise<DrawingResult<ContractDrawings>> {
  return run("load the drawings", async () => {
    const found = await findContract(contract);
    if (!found.success) return found;
    const drawings = await prisma.contractDrawing.findMany({
      where: { contractNo: found.data.contractNo },
      include: EVENTS,
      orderBy: [{ drawingNo: "asc" }, { rev: "desc" }],
    });
    return ok({ contract: found.data, drawings: drawings.map((d) => toEntry(d, actor.role)) });
  });
}

/** This month's next GMDSPL number. A suggestion only: createDrawing decides. */
export function suggestNextDrawingNo(actor: DrawingActor): Promise<DrawingResult<string>> {
  return run("suggest a drawing no", async () => (canWrite(actor) ? ok(await nextFreeDrawingNo()) : VIEW_ONLY));
}

/**
 * A new entry in "Draft prepared". The same create again (number, rev and document type) returns the
 * existing entry, a safe retry; a number another contract or another document holds is a conflict
 * with a fresh suggestion.
 */
export function createDrawing(actor: DrawingActor, input: NewDrawingInput): Promise<DrawingResult<DrawingEntry>> {
  return run("add the drawing", async () => {
    if (!canWrite(actor)) return VIEW_ONLY;
    const drawingNo = String(input.drawingNo ?? "").trim().toUpperCase();
    const rev = input.rev ?? 0;
    if (!DRAWING_NO.test(drawingNo)) return fail("invalid", "Drawing no. must be GMDSPL-YYMM and 4 digits, e.g. GMDSPL-26110030.");
    if (!Number.isInteger(rev) || rev < 0) return fail("invalid", "Rev must be a whole number from 0 (R-0).");
    if (!(DOC_TYPES as readonly string[]).includes(input.docType)) return fail("invalid", `Document type must be one of: ${DOC_TYPES.join(", ")}.`);
    if (input.itemCodes != null && !Array.isArray(input.itemCodes)) return fail("invalid", "itemCodes must be a list of item codes.");
    const found = await findContract(input.contract);
    if (!found.success) return found;
    const contract = found.data;
    const itemCodes = [...new Set((input.itemCodes ?? []).map((c) => contractKey(String(c))).filter(Boolean))];
    const unknown = itemCodes.filter((c) => !contract.lines.some((l) => l.itemCode === c));
    if (unknown.length) return fail("invalid", `Not on contract ${contract.contractNo}: ${unknown.join(", ")}.`);
    const by = actor.name.trim();
    const at = new Date();
    return prisma.$transaction(async (tx): Promise<DrawingResult<DrawingEntry>> => {
      // One create per drawing no at a time, so the checks below see every revision of it already committed.
      await lock(tx, `drawing-no:${drawingNo}`);
      const taken = await tx.contractDrawing.findMany({ where: { drawingNo }, include: EVENTS });
      const other = taken.find((d) => d.contractNo !== contract.contractNo);
      if (other) return conflict(tx, `${drawingNo} is already used on contract ${other.contractNo}`);
      const same = taken.find((d) => d.rev === rev);
      if (same) {
        return same.docType === input.docType
          ? ok(toEntry(same, actor.role))
          : conflict(tx, `${drawingNo} ${revLabel(rev)} is already this contract's ${same.docType}`);
      }
      if (taken.length) {
        const latest = revLabel(Math.max(...taken.map((d) => d.rev)));
        return fail("invalid", `${drawingNo} is already on this contract up to ${latest}; add a new revision instead.`);
      }
      const created = await tx.contractDrawing.create({
        data: {
          contractNo: contract.contractNo,
          drawingNo,
          rev,
          docType: input.docType,
          product: text(input.product),
          pn: text(input.pn),
          standard: text(input.standard),
          flangeDrilling: text(input.flangeDrilling),
          preparedBy: text(input.preparedBy),
          remarks: text(input.remarks),
          itemCodes,
          status: DRAFT,
          statusAt: at,
          statusBy: by,
          events: { create: { status: DRAFT, by, at } },
        },
        include: EVENTS,
      });
      await syncApprovalDates(tx, contract.contractNo);
      return ok(toEntry(created, actor.role));
    });
  });
}

/** Attaches uploaded files and/or links to a current revision. Bytes already on the drawing are not recorded again. */
export function addFilesOrLinks(actor: DrawingActor, drawingId: string, files: DrawingFileInput[]): Promise<DrawingResult<DrawingEntry>> {
  return run("attach the files", async () => {
    if (!canWrite(actor)) return VIEW_ONLY;
    const clean = cleanFiles(files);
    if (typeof clean === "string") return fail("invalid", clean);
    if (!clean.length) return fail("invalid", "Add at least one file or link.");
    const drawing = await readDrawing(drawingId);
    if (!drawing) return NOT_FOUND;
    if (drawing.status === SUPERSEDED) {
      return fail("not-allowed", `${drawing.drawingNo} ${revLabel(drawing.rev)} is superseded; attach files to its current revision.`);
    }
    const fresh = newFiles(clean, drawing.events);
    if (!fresh.length) return ok(toEntry(drawing, actor.role));
    const final = drawing.status === APPROVED;
    const by = actor.name.trim();
    const at = new Date();
    await prisma.contractDrawingEvent.createMany({ data: fresh.map((f) => ({ drawingId: drawing.id, ...f, final, by, at })), skipDuplicates: true });
    return ok(toEntry((await readDrawing(drawing.id))!, actor.role));
  });
}

/** One move of the status flow (DRAWING_MOVES), with its comment and files, stamped with who and when. */
export function changeStatus(actor: DrawingActor, drawingId: string, step: StatusStep): Promise<DrawingResult<DrawingEntry>> {
  return run("change the status", async () => {
    if (!canWrite(actor)) return VIEW_ONLY;
    if (!text(step?.from)) return fail("invalid", 'Say which status the drawing had when you read it ("from").');
    const files = cleanFiles(step.files ?? []);
    if (typeof files === "string") return fail("invalid", files);
    const drawing = await readDrawing(drawingId);
    if (!drawing) return NOT_FOUND;
    if (drawing.status !== step.from) return STALE;
    const comment = text(step.comment);
    const counts = (list: CleanFile[]) => ({ comment: comment ?? "", files: list.length, pdfs: list.filter((f) => f.sha256).length });
    const fresh = newFiles(files, drawing.events);
    const refused = checkMove(drawing.status, step.to, actor.role, counts(fresh));
    // Refused only because the files sent are already on the drawing: say that, not "needs a file".
    if (refused && !checkMove(drawing.status, step.to, actor.role, counts(files))) {
      return fail("invalid", `That file is already on this drawing (attached earlier), so it does not count for "${step.to}"; attach a new one.`);
    }
    if (refused) return { success: false, ...refused };
    const final = step.to === APPROVED;
    const by = actor.name.trim();
    const at = new Date();
    const rows = [{ drawingId: drawing.id, status: step.to, comment, by, at }, ...fresh.map((f) => ({ drawingId: drawing.id, ...f, final, by, at }))];
    try {
      const moved = await prisma.$transaction(async (tx) => {
        const { count } = await tx.contractDrawing.updateMany({ where: { id: drawing.id, status: drawing.status }, data: { status: step.to, statusAt: at, statusBy: by } });
        if (!count) throw STALE;
        // Fewer rows than sent: the same bytes landed meanwhile through another request, and this step
        // would go through without its file (an approval without its FINAL copy). Roll it back.
        if ((await tx.contractDrawingEvent.createMany({ data: rows, skipDuplicates: true })).count < rows.length) throw STALE;
        await syncApprovalDates(tx, drawing.contractNo);
        return (await tx.contractDrawing.findUnique({ where: { id: drawing.id }, include: EVENTS }))!;
      });
      return ok(toEntry(moved, actor.role));
    } catch (err) {
      if (err === STALE) return STALE;
      throw err;
    }
  });
}

/** Rev + 1 in "Draft prepared", copying the entry's details; the old revision turns "Superseded" and keeps its files. */
export function newRevision(actor: DrawingActor, drawingId: string, comment?: string | null): Promise<DrawingResult<DrawingEntry>> {
  return run("add the revision", async () => {
    if (!canWrite(actor)) return VIEW_ONLY;
    const old = await prisma.contractDrawing.findUnique({ where: { id: drawingId } });
    if (!old) return NOT_FOUND;
    if (old.status === SUPERSEDED) return fail("not-allowed", `${old.drawingNo} ${revLabel(old.rev)} is superseded; revise its current revision.`);
    const { id, rev, status: _s, statusAt: _a, statusBy: _b, createdAt: _c, updatedAt: _u, ...details } = old;
    const by = actor.name.trim();
    const at = new Date();
    try {
      const created = await prisma.$transaction(async (tx) => {
        const { count } = await tx.contractDrawing.updateMany({ where: { id, status: { not: SUPERSEDED } }, data: { status: SUPERSEDED, statusAt: at, statusBy: by } });
        if (!count) throw STALE;
        await tx.contractDrawingEvent.createMany({ data: [{ drawingId: id, status: SUPERSEDED, by, at }] });
        const next = await tx.contractDrawing.create({
          data: { ...details, rev: rev + 1, status: DRAFT, statusAt: at, statusBy: by, events: { create: { status: DRAFT, comment: text(comment), by, at } } },
          include: EVENTS,
        });
        await syncApprovalDates(tx, old.contractNo);
        return next;
      });
      return ok(toEntry(created, actor.role));
    } catch (err) {
      // Another user's new revision got there first: their supersede, or their rev + 1.
      if (err === STALE || isUniqueViolation(err)) return STALE;
      throw err;
    }
  });
}
