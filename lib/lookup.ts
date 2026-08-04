import { prisma } from "@/lib/prisma";

export async function getActiveLookupValuesByType(): Promise<Record<string, string[]>> {
  const rows = await prisma.lookupOption.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }],
  });
  const grouped: Record<string, string[]> = {};
  for (const row of rows) (grouped[row.type] ??= []).push(row.value);
  return grouped;
}
