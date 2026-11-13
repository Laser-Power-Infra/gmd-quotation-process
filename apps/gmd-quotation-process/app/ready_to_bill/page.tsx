import type { Metadata } from "next";
import { prisma as tenderPrisma } from "@gmd/db-tender";
import ReadyToBillPage from "@gmd/stock-allocation/ready-to-bill";
import * as actions from "./actions";

export const metadata: Metadata = { title: "Ready to Bill | GMD Quotation Process" };
// Reads live data on every request, so render dynamically.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Contract lines are the synced input: their latest sync time drives the stale warning.
  const { _max } = await tenderPrisma.contractReview.aggregate({ _max: { syncedAt: true } });
  return <ReadyToBillPage actions={{ ...actions }} syncedAt={_max.syncedAt?.toISOString() ?? null} />;
}
