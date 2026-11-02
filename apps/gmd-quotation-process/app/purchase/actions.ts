"use server";
import { requireAccess } from "@/lib/access";
import { loadGrnReceipts, loadPurchaseView } from "@gmd/purchase/server";
import type { PurchaseView } from "@gmd/purchase/types";

// The Purchase dashboard is read-only: the view and one line's GRNs. Access is
// checked here rather than in the package: the package has no notion of this
// app's sessions.

export async function loadView(view: PurchaseView) {
  await requireAccess();
  return loadPurchaseView(view);
}

export async function loadGrn(poNo: string, poLineNo: string) {
  await requireAccess();
  return loadGrnReceipts(poNo, poLineNo);
}
