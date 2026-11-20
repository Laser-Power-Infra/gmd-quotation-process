"use server";
import { requireAccess } from "@/lib/access";

import {
  addContractMailDoc,
  applyColumnFlags,
  backfillClearanceMcPending,
  backfillInspection,
  backfillOfferPendingDone,
  backfillPnRating,
  blankOnlyFieldsFor,
  clearDiagram,
  confirmDiagramUpload,
  createDiagramUpload,
  editableFieldsFor,
  setDiagramVerdict,
  updateContractReviewField,
} from "@gmd/contract-review/server";
import type { ActionResult, ContractMail, ContractReviewData, DiagramFileMeta } from "@gmd/contract-review/types";
import { columnAccess } from "@gmd/contract-review/flags";
import { invalidateContractReviewAllocation } from "@/lib/contractReviewView";
import { getContractReviewFlags } from "@/lib/contract-review-flags";
import { coveredLineIds } from "@gmd/drawings/server";
import { findContractMails } from "@/lib/contractMails";
import { GET } from "@/app/api/contract-review/route";
import { POST } from "@/app/api/contract-review/sync/route";
import { runningJobs } from "@/schedular_function/job-latch";

// Contract review in this app is public (no auth), as before the move to
// @gmd/contract-review. Add an auth() check here to restrict it.

const DRAWING = "Upload Drawing";
const MAIL_DOCS = "Mails / Documents";
const NOT_ALLOWED: ActionResult = { success: false, error: "Not allowed in this app." };

// Flags are evaluated again inside every action: the UI hiding a column is
// cosmetic, these checks are what actually protect the data.
async function access() {
  return columnAccess(await getContractReviewFlags());
}

async function fromRoute(res: Response): Promise<ActionResult> {
  const body = await res.json().catch(() => ({}));
  return res.ok
    ? { success: true, data: body }
    : { success: false, error: body.error ?? `Request failed (${res.status})`, busy: body.busy };
}

/** Rows plus quotation-DB extras (RM AVAIL, BOM ID options, item images). */
export async function load() {
  await requireAccess();
  const res = await fromRoute(await GET());
  if (!res.success) return res;
  return {
    success: true,
    data: applyColumnFlags(res.data as ContractReviewData, await getContractReviewFlags()),
  };
}

/** Google Sheets CONTRACTS + DUMP sync and its quotation-side effects. */
export async function sync() {
  await requireAccess();
  const res = await fromRoute(await POST());
  return res;
}

/** True while a CONTRACTS + DUMP sync (the hourly job or a SYNC click) is running. */
export async function syncRunning() {
  await requireAccess();
  return runningJobs.has("contract-review");
}

export async function updateContractReviewFieldAction(
  id: string,
  field: string,
  value: string | null,
) {
  await requireAccess();
  const flags = await getContractReviewFlags();
  const res = await updateContractReviewField(id, field, value, editableFieldsFor(flags), blankOnlyFieldsFor(flags));
  invalidateContractReviewAllocation(); // MC state / qty edits change which lines are live
  return res;
}

/** Which of these lines a current drawing covers: the page makes their APPROVAL DATE read-only. */
export async function loadCoveredLineIdsAction(ids: string[]): Promise<ActionResult<string[]>> {
  await requireAccess();
  try {
    return { success: true, data: [...(await coveredLineIds(ids))] };
  } catch (error) {
    console.error("coveredLineIds failed:", error);
    return { success: false, error: "Could not check which lines Drawings & QAP covers." };
  }
}

export async function createDiagramUploadAction(id: string, file: DiagramFileMeta) {
  await requireAccess();
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  return createDiagramUpload(id, file);
}

export async function confirmDiagramUploadAction(id: string, key: string) {
  await requireAccess();
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  const res = await confirmDiagramUpload(id, key);
  return res;
}

export async function clearContractReviewDiagramAction(id: string) {
  await requireAccess();
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  const res = await clearDiagram(id);
  return res;
}

export async function setContractReviewDiagramVerdictAction(id: string, verdict: string | null) {
  await requireAccess();
  if (!(await access()).isEditable(DRAWING)) return NOT_ALLOWED;
  const res = await setDiagramVerdict(id, verdict);
  return res;
}

export async function backfillContractReviewOfferPendingDoneBatchAction(ids: string[]) {
  await requireAccess();
  if (!(await access()).isEnabled("OFFER PENDING/DONE")) return NOT_ALLOWED;
  const res = await backfillOfferPendingDone(ids);
  invalidateContractReviewAllocation();
  return res;
}

export async function backfillContractReviewInspectionBatchAction(ids: string[]) {
  await requireAccess();
  if (!(await access()).isEnabled("Inspection")) return NOT_ALLOWED;
  const res = await backfillInspection(ids);
  invalidateContractReviewAllocation();
  return res;
}

export async function backfillContractReviewClearanceMcPendingBatchAction(ids: string[]) {
  await requireAccess();
  const a = await access();
  if (!a.isEnabled("CLEARANCE STATUS") || !a.isEnabled("MC Received/Pending")) return NOT_ALLOWED;
  const res = await backfillClearanceMcPending(ids);
  invalidateContractReviewAllocation();
  return res;
}

export async function backfillContractReviewPnRatingBatchAction(ids: string[]) {
  await requireAccess();
  if (!(await access()).isEnabled("PN RATING")) return NOT_ALLOWED;
  return backfillPnRating(ids);
}

export async function addContractMailDocAction(contractNo: string, category: string, url: string) {
  await requireAccess();
  if (!(await access()).isEditable(MAIL_DOCS)) return NOT_ALLOWED;
  const res = await addContractMailDoc(contractNo, category, url);
  return res;
}

/** The contract's docket follow-up mails ("Docket mails"); read-only. */
export async function loadContractMailsAction(contractNo: string): Promise<ActionResult<ContractMail[]>> {
  await requireAccess();
  if (!(await access()).isEnabled(MAIL_DOCS)) return NOT_ALLOWED;
  if (typeof contractNo !== "string" || !contractNo.trim() || contractNo.length > 100) {
    return { success: false, error: "Invalid contract no." };
  }
  try {
    return { success: true, data: await findContractMails(contractNo) };
  } catch (error) {
    console.error("Error loading contract mails:", error);
    return { success: false, error: "Failed to load the docket mails." };
  }
}
