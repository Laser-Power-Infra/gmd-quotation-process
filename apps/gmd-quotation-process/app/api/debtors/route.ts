import { NextResponse } from "next/server";
import { getDebtors } from "@/lib/debtors";

export async function GET() {
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
