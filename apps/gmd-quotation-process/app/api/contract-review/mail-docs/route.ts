import { NextResponse } from "next/server";
import { addContractMailDoc } from "@gmd/contract-review/server";
import { requireSyncApiKey } from "@/schedular_function";
import { invalidateContractReviewCache } from "@/lib/contractReviewView";

// Entry point for the external email-tracking agent: appends one mail / saved
// attachment link to a contract. Same API key as the scheduler routes
// (GMD_SYNC_API_KEY, sent in SYNC_API_KEY_HEADER).
// Body: { contractNo: string, category: "PO"|"Amendment"|"MC"|"Drawing approval"|"Inspection"|"DI"|"Dispatch", url: string }
export async function POST(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.contractNo !== "string" || typeof body.category !== "string" || typeof body.url !== "string") {
    return NextResponse.json(
      { success: false, error: "contractNo, category and url (strings) are required." },
      { status: 400 },
    );
  }
  const res = await addContractMailDoc(body.contractNo, body.category, body.url);
  if (res.success) invalidateContractReviewCache();
  return NextResponse.json(res, { status: res.success ? 200 : res.error === "Contract not found." ? 404 : 400 });
}
