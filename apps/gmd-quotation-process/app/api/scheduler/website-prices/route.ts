/**
 * Ofelia entry point for the hourly website price push.
 *
 * Sends every RawMaterial erpItemCode + cost to the GM Dalui website, which
 * prices its /purchase ready-stock catalogue from it. Read-only on this side.
 *
 * Deliberately thin: all logic lives in `@/schedular_function`.
 */

export const runtime = "nodejs";

// Matches `wget -T 300` in the ofelia script: one table read plus one HTTP call.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledWebsitePrices,
} from "@/schedular_function";

export async function POST(request: Request) {
  // 503 if GMD_SYNC_API_KEY is unset on the server, 401 if the key is wrong.
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const result = await runScheduledWebsitePrices();

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-website-prices] fatal: ${message}`, err);

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Credential probe: authenticates without running the push.
export async function GET(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  return NextResponse.json({
    success: true,
    job: "website-prices",
    auth: "ok",
    note: "POST to push RawMaterial costs to the website catalogue. Read-only here.",
  });
}
