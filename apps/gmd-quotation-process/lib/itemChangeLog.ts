import { prisma } from "@/lib/prisma";

type Change = { itemId: string; enquiryId: string; field: string; oldValue: unknown; newValue: unknown };

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** Records who changed VA% / quoted rate / validation. Never fails the save it describes. */
export async function logItemChanges(changes: Change[]) {
  const rows = changes
    .map((c) => ({ ...c, oldValue: str(c.oldValue), newValue: str(c.newValue) }))
    .filter((c) => c.oldValue !== c.newValue);
  if (rows.length === 0) return;
  try {
    const { auth } = await import("@/auth");
    const user = (await auth())?.user as { email?: string; id?: string } | undefined;
    const changedBy = user?.email ?? user?.id ?? "unknown";
    await prisma.itemChangeLog.createMany({ data: rows.map((r) => ({ ...r, changedBy })) });
  } catch (e) {
    console.error("[itemChangeLog] failed to record changes:", e);
  }
}