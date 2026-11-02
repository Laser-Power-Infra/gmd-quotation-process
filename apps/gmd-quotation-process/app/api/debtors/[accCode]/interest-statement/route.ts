import { NextResponse } from "next/server";
import { denyIfNoAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getFollowUps, loadMsmeSettings } from "@/lib/debtors-server";
import { outstanding } from "@/lib/debtorsAgeing";
import { msmeBills } from "@/lib/msme";
import { buildInterestStatementHtml } from "@/lib/msmeStatement";
import { generateOfferLetterPdf } from "@/lib/generatePdf";

/** GET /api/debtors/[accCode]/interest-statement: MSME interest statement / notice PDF for one client. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: { toString(): string } | null) => (v === null ? null : Number(v.toString()));

export async function GET(_request: Request, { params }: { params: Promise<{ accCode: string }> }) {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  const { accCode } = await params;
  try {
    const [rows, followUps, settings] = await Promise.all([
      prisma.debtor.findMany({ where: { accCode }, orderBy: { vrDate: "asc" }, select: { accName: true, vrNo: true, vrDate: true, unAllocDr: true, unAllocCr: true } }),
      getFollowUps("debtor"),
      loadMsmeSettings(),
    ]);
    const cd = Number(followUps[accCode]?.creditDays ?? NaN); // blank = no written agreement, same as the table
    const today = new Date();
    const bills = msmeBills(
      rows.map((r) => ({ vrNo: r.vrNo, vrDate: r.vrDate?.toISOString() ?? null, bal: outstanding({ unAllocDr: num(r.unAllocDr), unAllocCr: num(r.unAllocCr) }) })),
      Number.isFinite(cd) ? cd : null,
      settings,
      today,
    );
    if (!bills.length) return NextResponse.json({ error: "No open bills for this party." }, { status: 404 });
    const html = buildInterestStatementHtml({ accCode, accName: rows[0]?.accName ?? null, bills, settings, today });
    // The markup carries no Handlebars tokens, so the data arg is unused (same as docketSnapshotPdf).
    const pdf = await generateOfferLetterPdf(html, {} as never, {});
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="msme-interest-${accCode.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
