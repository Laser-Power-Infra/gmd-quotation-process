/**
 * Read-only per-party outstanding feed for the n8n follow-up workflows
 * (staff reminders, client payment messages). Pairs with `os-summary`, which
 * gives the totals; this gives the parties, owners, contacts and open bills.
 *
 * Thin HTTP shim: auth and response shaping only. The shaping lives in
 * `lib/osFollowUps.ts`.
 */

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireSyncApiKey } from "@/schedular_function";
import { getDebtors } from "@/lib/debtors-server";
import { buildOsFollowUpFeed } from "@/lib/osFollowUps";

export async function GET(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const debtors = await getDebtors();
    const feed = buildOsFollowUpFeed(debtors.rows, debtors.followUps, debtors.legalCases, debtors.billInfo, new Date());
    return NextResponse.json({ success: true, syncedAt: debtors.syncedAt, ...feed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-os-followups] fatal: ${message}`, err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
