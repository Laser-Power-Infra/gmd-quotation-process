import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildMirrorPayload } from "@/lib/lookupMirrorPayload";

/** Pushes LookupOption changes to the mirror app after the response. Never throws. */
export function mirrorLookup({ upsertIds = [], deleteIds = [] }: { upsertIds?: string[]; deleteIds?: string[] }) {
  const url = process.env.LOOKUP_MIRROR_URL;
  const key = process.env.LOOKUP_MIRROR_API_KEY;
  if (!url || !key || (!upsertIds.length && !deleteIds.length)) return;

  const run = async () => {
    try {
      const rows = upsertIds.length ? await prisma.lookupOption.findMany({ where: { id: { in: upsertIds } } }) : [];
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify(buildMirrorPayload(rows, deleteIds)),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) console.error("[lookupMirror]", res.status, { upsertIds, deleteIds });
    } catch (e) {
      console.error("[lookupMirror]", e instanceof Error ? e.message : e, { upsertIds, deleteIds });
    }
  };
  try {
    after(run);
  } catch {
    void run(); // after() throws outside a request scope (scripts/tests)
  }
}
