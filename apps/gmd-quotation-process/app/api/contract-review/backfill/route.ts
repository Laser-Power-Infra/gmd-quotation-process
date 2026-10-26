import { NextResponse } from "next/server";
import { runContractReviewBackfills } from "@/lib/contractReviewBackfill";

// A route rather than a server action: Next runs a client's server actions one
// at a time, so a long backfill would hold up every page / filter request.
export async function POST() {
  const result = await runContractReviewBackfills();
  return NextResponse.json(result);
}
