/**
 * Read-only O/S summary for the daily GMD Accounts WhatsApp message (n8n pulls this and posts `text`).
 *
 * Thin HTTP shim: auth and response shaping only. The maths lives in `lib/osSummary.ts`.
 * Bank balance and payments released are not here: they have no source in this repo.
 */

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireSyncApiKey } from "@/schedular_function";
import { getDebtors } from "@/lib/debtors-server";
import { getCreditors } from "@/lib/creditors-server";
import { buildOsSummary } from "@/lib/osSummary";

export async function GET(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const [debtors, creditors] = await Promise.all([getDebtors(), getCreditors()]);
    const summary = buildOsSummary(debtors.rows, creditors.summary, new Date(), {
      msmeDays: debtors.msme.defaultCreditDays,
      debtorsSyncedAt: debtors.syncedAt,
      creditorsSyncedAt: creditors.syncedAt,
    });
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-os-summary] fatal: ${message}`, err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
