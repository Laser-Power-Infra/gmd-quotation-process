import { denyIfNoAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { fetchGMDCategorySheet } from "@/lib/gmd_lib/google-sheets";

export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const data = await fetchGMDCategorySheet();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({});
  }
}
