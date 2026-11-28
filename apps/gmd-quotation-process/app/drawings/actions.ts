"use server";
import { revalidatePath } from "next/cache";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import {
  addFilesOrLinks,
  changeStatus,
  createDrawing,
  getContractDrawings,
  listDrawingsFacet,
  listDrawingsPage,
  newRevision,
  suggestNextDrawingNo,
} from "@gmd/drawings/server";
import {
  MAX_PDFS_PER_CALL,
  checkMove,
  revLabel,
  type ContractDrawings,
  type DrawingActor,
  type DrawingEntry,
  type DrawingResult,
  type DrawingRow,
  type DrawingsQuery,
  type NewDrawingInput,
} from "@gmd/drawings/columns";
import type { TablePage } from "@gmd/ui/components/data-table/types";
import { drawingVerifiers } from "@/flags";
import { loginRequired, requireDrawingsAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth-helpers";
import { uploadDrawingPdfs, type UploadedDrawingFile } from "@/lib/drawingFiles";
import { drawingRole } from "@/lib/drawingRole";

// Drawings & QAP. @gmd/drawings enforces every rule; these actions name the caller (the actor) and
// upload the browser's PDFs. A sha256 only ever comes from hashing the uploaded bytes here: one taken
// from the browser would pass a link off as an uploaded PDF (an approval without the approved copy).

type Result<T> = DrawingResult<T> | { success: false; error: string };

const MAX_FILES_PER_CALL = MAX_PDFS_PER_CALL;

// Never throws to the client. A write that went through refreshes the Drawings page and Contract
// Review, whose APPROVAL DATE follows the drawings.
async function run<T>(fn: () => Promise<Result<T>>, write = false): Promise<Result<T>> {
  try {
    const res = await fn();
    if (write && res.success) {
      revalidatePath("/drawings");
      revalidatePath("/contract_review");
    }
    return res;
  } catch (err) {
    // Database or SQL text stays in the server log; only a refused login is worth showing as it is.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[drawings]", err);
    return { success: false, error: /unauthori[sz]ed|forbidden|sign in|log ?in/i.test(message) ? message : "Something went wrong. Please try again." };
  }
}

/** The caller as the drawings rules see them: their login email, and only a viewer when signed out. */
async function drawingActor() {
  const [user, verifiers] = await Promise.all([getCurrentUser(), drawingVerifiers()]);
  const email = user?.email?.trim() ?? "";
  return { name: email, role: drawingRole(email, (user as { role?: string } | null)?.role, verifiers) ?? "viewer" };
}

const VIEW_ONLY = { success: false as const, code: "not-allowed" as const, error: "You can view drawings but not change them." };

const links = (urls: string[]) => urls.map((fileUrl) => ({ fileUrl }));

/**
 * The PDFs in Drive, named after the drawing's number and rev, once the step is known to be allowed
 * against the drawing as stored: a refused step (viewer, superseded, changed meanwhile, a move the
 * rules refuse) uploads nothing. `move` is the status change the files travel with, if any.
 */
async function upload(
  actor: DrawingActor,
  drawingId: string,
  files: File[],
  move?: { from: string; to: string; comment: string; links: number },
): Promise<Result<UploadedDrawingFile[]>> {
  if (!files.length) return { success: true, data: [] };
  if (actor.role === "viewer") return { success: false, code: "not-allowed", error: "You can view drawings but not change them." };
  if (files.length > MAX_FILES_PER_CALL) return { success: false, code: "invalid", error: `Upload at most ${MAX_FILES_PER_CALL} files at a time.` };
  const drawing = await tenderPrisma.contractDrawing.findUnique({ where: { id: drawingId }, select: { drawingNo: true, rev: true, status: true } });
  if (!drawing) return { success: false, code: "not-found", error: "Drawing not found." };
  if (move) {
    // "stale" makes the window reload, as the package's own answer does.
    if (drawing.status !== move.from) return { success: false, code: "stale", error: "This drawing was changed meanwhile; reload and try again." };
    const refused = checkMove(drawing.status, move.to, actor.role, { comment: move.comment, files: files.length + move.links, pdfs: files.length });
    if (refused) return { success: false, ...refused };
  } else if (drawing.status === "Superseded") {
    return { success: false, code: "not-allowed", error: `${drawing.drawingNo} ${revLabel(drawing.rev)} is superseded; attach files to its current revision.` };
  }
  // shortcut: a change landing between this check and the package's write (or bytes already on the drawing) leaves the upload in Drive unrecorded; clear such spares by hand if they pile up.
  return uploadDrawingPdfs(files, drawing.drawingNo, drawing.rev);
}

/** One page of the Drawings register (server-side filter, sort and search). */
export async function loadPage(query: DrawingsQuery): Promise<Result<TablePage<DrawingRow>>> {
  return run(async () => {
    await requireDrawingsAccess();
    return { success: true, data: await listDrawingsPage(query) };
  });
}

/** A filter's options under the other active filters. */
export async function loadFacet(key: string, query: DrawingsQuery): Promise<Result<string[]>> {
  return run(async () => {
    await requireDrawingsAccess();
    return { success: true, data: await listDrawingsFacet(key, query) };
  });
}

/** One contract (by contract no or PO no) with every drawing revision and its history. */
export async function loadContractDrawings(contract: string): Promise<Result<ContractDrawings>> {
  return run(async () => {
    await requireDrawingsAccess();
    const actor = await drawingActor();
    const res = await getContractDrawings(actor, contract);
    // Contract Review lines (item names, sizes, quantities) are for those who tag drawings; a viewer gets the header only.
    if (res.success && actor.role === "viewer") res.data.contract.lines = [];
    return res;
  });
}

/** This month's next GMDSPL number, to pre-fill a new entry; viewers get none. */
export async function suggestDrawingNo(): Promise<Result<string>> {
  return run(async () => {
    await requireDrawingsAccess();
    return suggestNextDrawingNo(await drawingActor());
  });
}

/** The caller's role, so the UI can hide what the server would refuse anyway. */
export async function getDrawingRights(): Promise<Result<{ role: "verifier" | "editor" | "viewer" }>> {
  return run(async () => {
    await requireDrawingsAccess();
    return { success: true, data: { role: (await drawingActor()).role } };
  });
}

export async function createDrawingEntry(input: NewDrawingInput): Promise<Result<DrawingEntry>> {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => {
    await requireDrawingsAccess();
    const actor = await drawingActor();
    if (actor.role === "viewer") return VIEW_ONLY;
    return createDrawing(actor, input);
  }, true);
}

/** Uploads PDFs (at most 10 a call) and/or adds Drive links to a drawing. */
export async function attachDrawingFiles(drawingId: string, files: File[] = [], urls: string[] = []): Promise<Result<DrawingEntry>> {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => {
    await requireDrawingsAccess();
    const actor = await drawingActor();
    if (actor.role === "viewer") return VIEW_ONLY;
    const uploaded = await upload(actor, drawingId, files);
    if (!uploaded.success) return uploaded;
    return addFilesOrLinks(actor, drawingId, [...uploaded.data, ...links(urls)]);
  }, true);
}

/**
 * One status move with its comment, PDFs and links in a single call, so a move that needs the
 * client-approved PDF gets it only by uploading it here. A move the rules refuse never reaches Drive.
 */
export async function changeDrawingStatus(
  drawingId: string,
  step: { from: string; to: string; comment?: string | null },
  files: File[] = [],
  urls: string[] = [],
): Promise<Result<DrawingEntry>> {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => {
    await requireDrawingsAccess();
    const actor = await drawingActor();
    if (actor.role === "viewer") return VIEW_ONLY;
    const uploaded = await upload(actor, drawingId, files, { from: step.from, to: step.to, comment: step.comment ?? "", links: urls.length });
    if (!uploaded.success) return uploaded;
    return changeStatus(actor, drawingId, { from: step.from, to: step.to, comment: step.comment, files: [...uploaded.data, ...links(urls)] });
  }, true);
}

/** R-(n+1) in "Draft prepared"; the old revision turns "Superseded" and keeps its files. */
export async function newDrawingRevision(drawingId: string, comment?: string | null): Promise<Result<DrawingEntry>> {
  const denied = await loginRequired(); if (denied) return denied;
  return run(async () => {
    await requireDrawingsAccess();
    const actor = await drawingActor();
    if (actor.role === "viewer") return VIEW_ONLY;
    return newRevision(actor, drawingId, comment);
  }, true);
}
