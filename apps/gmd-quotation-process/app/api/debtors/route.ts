import { denyIfNoAccess } from "@/lib/access";
import { NextResponse } from "next/server";
import { getDebtors } from "@/lib/debtors-server";

export async function GET() {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  try {
    const data = await getDebtors();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
