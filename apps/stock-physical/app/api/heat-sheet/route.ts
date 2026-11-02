import { NextResponse } from "next/server";
import { attachHeatSheet } from "@gmd/physical-stock/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { uploadHeatSheet } from "@/lib/gdrive";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

/** POST multipart { entryId, file }: stores the printed serial sheet on Drive and attaches it to the heat entry. */
export async function POST(req: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData();
  const entryId = form.get("entryId");
  const file = form.get("file");
  if (typeof entryId !== "string" || !entryId || !(file instanceof File)) {
    return NextResponse.json({ error: "entryId and file are required" }, { status: 400 });
  }
  if (!TYPES.has(file.type)) return NextResponse.json({ error: "Upload a photo or PDF" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File larger than 10 MB" }, { status: 400 });
  try {
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
    const fileId = await uploadHeatSheet(`${entryId}${ext}`, file.type, Buffer.from(await file.arrayBuffer()));
    const res = await attachHeatSheet(entryId, fileId);
    return res.success ? NextResponse.json(res) : NextResponse.json({ error: res.error }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
