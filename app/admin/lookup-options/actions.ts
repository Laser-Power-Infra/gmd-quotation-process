"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export type LookupOptionData = {
  id: string;
  type: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
};

export async function getLookupOptions(): Promise<LookupOptionData[]> {
  const rows = await prisma.lookupOption.findMany({
    orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    value: r.value,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  }));
}

export async function addLookupOptionAction(formData: FormData) {
  const type = (formData.get("type") as string)?.trim();
  const value = (formData.get("value") as string)?.trim();

  if (!type || !value) {
    return { success: false, error: "Type and value are required." };
  }

  const existing = await prisma.lookupOption.findUnique({
    where: { type_value: { type, value } },
  });
  if (existing) {
    return { success: false, error: `"${value}" already exists for ${type}.` };
  }

  const maxSort = await prisma.lookupOption.aggregate({
    where: { type },
    _max: { sortOrder: true },
  });

  await prisma.lookupOption.create({
    data: {
      type,
      value,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });

  revalidatePath("/admin/lookup-options");
  return { success: true };
}

export async function updateLookupOptionAction(formData: FormData) {
  const id = formData.get("id") as string;
  const value = (formData.get("value") as string)?.trim();
  const type = (formData.get("type") as string)?.trim();
  const sortOrderRaw = formData.get("sortOrder") as string;

  if (!id || !value || !type) {
    return { success: false, error: "id, type and value are required." };
  }

  const sortOrder = parseInt(sortOrderRaw || "", 10);
  if (isNaN(sortOrder)) {
    return { success: false, error: "sortOrder must be a number." };
  }

  const existing = await prisma.lookupOption.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "Option not found." };
  }

  const duplicate = await prisma.lookupOption.findUnique({
    where: { type_value: { type, value } },
  });
  if (duplicate && duplicate.id !== id) {
    return { success: false, error: `"${value}" already exists for ${type}.` };
  }

  await prisma.lookupOption.update({
    where: { id },
    data: { type, value, sortOrder },
  });

  revalidatePath("/admin/lookup-options");
  return { success: true };
}

export async function toggleLookupOptionAction(id: string) {
  const existing = await prisma.lookupOption.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "Option not found." };
  }

  await prisma.lookupOption.update({
    where: { id },
    data: { isActive: !existing.isActive },
  });

  revalidatePath("/admin/lookup-options");
  return { success: true };
}

export async function deleteLookupOptionAction(id: string) {
  await prisma.lookupOption.delete({ where: { id } });

  revalidatePath("/admin/lookup-options");
  return { success: true };
}
