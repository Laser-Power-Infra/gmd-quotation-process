/** n8n entry point: debtors/creditors O/S for the daily GMD accounts WhatsApp message. */
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireSyncApiKey } from "@/schedular_function";
import { getDebtors } from "@/lib/debtors-server";
import { getCreditors } from "@/lib/creditors-server";
import { summarise } from "@/lib/debtorsAgeing";
import { buildOsSummary } from "@/lib/accountsSummary";

export async function GET(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  try {
    const today = new Date();
    const [deb, cred] = await Promise.all([getDebtors(), getCreditors()]);
    // shortcut: ">45 days (MSME)" is not split out; overdue and >90 days only, add once Pritha's doc defines it.
    const summary = buildOsSummary(summarise(deb.rows, today), cred.summary, today, deb.syncedAt);
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
