/**
 * Ofelia entry point for the daily PBG reminder job.
 *
 * Thin HTTP shim: auth, status codes and response shaping only. The logic lives
 * in `schedular_function/pbg-reminders.ts`.
 */

export const runtime = "nodejs";

// One SMTP send per contact group, with a small delay between sends.
export const maxDuration = 900;

import { NextResponse } from "next/server";
import {
  JobAlreadyRunningError,
  requireSyncApiKey,
  runScheduledPbgReminders,
} from "@/schedular_function";

export async function POST(request: Request) {
  const auth = requireSyncApiKey(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const result = await runScheduledPbgReminders();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 409 },
      );
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[scheduler-pbg-reminders] fatal: ${message}`, err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Credential probe: authenticates without sending any mail.
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
    job: "pbg-reminders",
    auth: "ok",
    runs: ["send"],
    note: "POST to run the reminder pass.",
  });
}
