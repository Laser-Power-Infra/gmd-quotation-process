"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { recomputeCfSets, refreshFlangeGaskets } from "@/lib/cfSetItem";

async function assertDeveloper(): Promise<boolean> {
  const session = await auth();
  const role = (session?.user as any)?.role;
  return role === "developer";
}

export type LookupOptionData = {
  id: string;
  type: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  code: string | null;
  defaultState: string | null;
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
    code: r.code,
    defaultState: r.defaultState,
  }));
}

export async function addLookupOptionAction(formData: FormData) {
  if (!(await assertDeveloper())) {
    return { success: false, error: "Unauthorized: developer only" };
  }
  const type = (formData.get("type") as string)?.trim();
  if (!type) {
    return { success: false, error: "Type is required." };
  }

  const rawValues = formData
    .getAll("value")
    .map((v) => String(v).trim())
    .filter(Boolean);

  if (rawValues.length === 0) {
    return { success: false, error: "At least one value is required." };
  }

  // Dedupe within the input itself (exact match, mirroring the DB unique key)
  const uniqueValues = [...new Set(rawValues)];

  // Existing values for this type, for duplicate detection
  const existingRows = await prisma.lookupOption.findMany({
    where: { type, value: { in: uniqueValues } },
    select: { value: true },
  });
  const existingSet = new Set(existingRows.map((r) => r.value));

  const toCreate = uniqueValues.filter((v) => !existingSet.has(v));
  const skipped = uniqueValues.length - toCreate.length;

  if (toCreate.length > 0) {
    const maxSort = await prisma.lookupOption.aggregate({
      where: { type },
      _max: { sortOrder: true },
    });
    let sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    await prisma.lookupOption.createMany({
      data: toCreate.map((value) => ({
        type,
        value,
        sortOrder: sortOrder++,
      })),
    });
  }

  revalidatePath("/admin/lookup-options");
  return { success: true, added: toCreate.length, skipped };
}

export async function updateLookupOptionAction(formData: FormData) {
  if (!(await assertDeveloper())) {
    return { success: false, error: "Unauthorized: developer only" };
  }
  const id = formData.get("id") as string;
  const value = (formData.get("value") as string)?.trim();
  const type = (formData.get("type") as string)?.trim();
  const sortOrderRaw = formData.get("sortOrder") as string;
  // Only sent for UTILITY rows; absent keys leave the columns untouched.
  const code = formData.has("code") ? String(formData.get("code")).trim() || null : undefined;
  const defaultState = formData.has("defaultState")
    ? String(formData.get("defaultState")).trim() || null
    : undefined;

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

  if (code) {
    const codeOwner = await prisma.lookupOption.findUnique({ where: { code } });
    if (codeOwner && codeOwner.id !== id) {
      return { success: false, error: `Code "${code}" is already used by "${codeOwner.value}".` };
    }
  }

  await prisma.lookupOption.update({
    where: { id },
    data: { type, value, sortOrder, code, defaultState },
  });
  // Quote-time CF sets must not go stale when a CF rate is edited.
  // The rate row is already saved: a failed recompute is logged, not reported as a failed save.
  let note: string | undefined;
  if (type.startsWith("CF_")) {
    try {
      await recomputeCfSets();
      if (type === "CF_GASKET_RATE") await refreshFlangeGaskets();
    } catch (e) {
      console.error("[updateLookupOptionAction] CF recompute failed:", e);
      note = "Rate saved, but CF sets could not be re-priced; retry or save again.";
    }
  }

  revalidatePath("/admin/lookup-options");
  return note ? { success: true, note } : { success: true };
}

export async function toggleLookupOptionAction(id: string) {
  if (!(await assertDeveloper())) {
    return { success: false, error: "Unauthorized: developer only" };
  }
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
  if (!(await assertDeveloper())) {
    return { success: false, error: "Unauthorized: developer only" };
  }
  await prisma.lookupOption.delete({ where: { id } });

  revalidatePath("/admin/lookup-options");
  return { success: true };
}
