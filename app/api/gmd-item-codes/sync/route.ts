import { NextResponse } from "next/server";
import { syncGmdItemCodes } from "@/lib/gmdItemCodeLookup";

export async function POST() {
  try {
    const { count } = await syncGmdItemCodes();
    return NextResponse.json({ syncedAt: new Date().toISOString(), count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
