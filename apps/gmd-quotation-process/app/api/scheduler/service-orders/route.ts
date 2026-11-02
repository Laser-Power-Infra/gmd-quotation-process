/**
 * Ofelia entry point for the daily Service / Work Orders refresh.
 *
 * Replaces `ServiceItem` and `GrnLine` from the ITEM MASTER ERP and GRN tabs of
 * `GMD_EXECUTION_TRACKING_SPREADSHEET_ID`. PO lines come from the purchase-orders job.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`.
 */

// Must be Node: `lib/googleAuth.ts` uses the Node-only Google OAuth client.
export const runtime = "nodejs";

// Matches `wget -T 600` in the ofelia script.
export const maxDuration = 1800;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledServiceOrders,
} from "@/schedular_function";

export async function POST(request: Request) {
  // 503 if GMD_SYNC_API_KEY is unset on the server, 401 if the key is wrong.
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    return NextResponse.json(await runScheduledServiceOrders({ dryRun }));
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-service-orders] fatal: ${message}`, err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Credential probe: authenticates without running the sync.
export async function GET(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({
    success: true,
    job: "service-orders",
    auth: "ok",
    note: "POST to refresh service items and GRN lines from the sheet.",
  });
}
