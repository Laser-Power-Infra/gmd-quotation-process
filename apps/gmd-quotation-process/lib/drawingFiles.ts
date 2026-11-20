import "server-only";
import { createHash } from "node:crypto";
import { revLabel } from "@gmd/drawings/columns";
import { uploadFileToDrive } from "./gdrive";
import { MAX_UPLOAD_BYTES, UPLOAD_MAGIC, fileHead } from "./uploadChecks";

/** One drawing PDF in Drive, in the shape addFilesOrLinks / changeStatus (@gmd/drawings/server) take. */
export interface UploadedDrawingFile {
  /** "<drawing no> R-<rev> <original name>", its name in Drive. */
  fileName: string;
  fileUrl: string;
  /** Hex sha256 of the bytes: how the register spots the same file uploaded twice. */
  sha256: string;
}

/**
 * Checks every file is a real PDF (by its first bytes) of at most 25 MB, then uploads each to the
 * Drive folder GMD_DRAWINGS_DRIVE_FOLDER_ID (anyone with the link can view). Nothing is uploaded
 * unless every file passes.
 */
export async function uploadDrawingPdfs(
  files: File[],
  drawingNo: string,
  rev: number,
): Promise<{ success: true; data: UploadedDrawingFile[] } | { success: false; error: string }> {
  if (!files.length) return { success: false, error: "No files selected." };
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) return { success: false, error: `"${file.name}" is larger than 25 MB.` };
    if (!UPLOAD_MAGIC.get("application/pdf")!.test(await fileHead(file))) return { success: false, error: `"${file.name}" is not a PDF file.` };
  }
  const folderId = process.env.GMD_DRAWINGS_DRIVE_FOLDER_ID?.trim();
  if (!folderId) return { success: false, error: "GMD_DRAWINGS_DRIVE_FOLDER_ID is not set, so drawings cannot be uploaded." };
  try {
    const uploaded: UploadedDrawingFile[] = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const fileName = `${drawingNo} ${revLabel(rev)} ${file.name || "drawing.pdf"}`;
      const { url } = await uploadFileToDrive(fileName, "application/pdf", bytes.toString("base64"), folderId);
      uploaded.push({ fileName, fileUrl: url, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    return { success: true, data: uploaded };
  } catch (error) {
    console.error("[uploadDrawingPdfs] failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Upload failed." };
  }
}
