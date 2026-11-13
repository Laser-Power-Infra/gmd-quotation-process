import { denyIfNoAccess } from "@/lib/access";
import { fetchDriveFile } from "@/lib/gdrive";

/**
 * GET /api/attachments/[fileId]
 *
 * Streams a Google Drive file through our own origin so the attachment preview
 * iframe does not depend on Google's third-party cookies / account UI. Google
 * blocks `drive.google.com/file/d/<id>/preview` embeds in that case, showing
 * "Can't access your Google Account".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only these render inline: a Drive HTML or SVG file shown in the preview iframe
// would run its script on our origin, so anything else goes out as a download.
const INLINE_TYPE = /^(application\/pdf|image\/(png|jpeg|gif|webp|bmp|tiff))$/;
const NOSNIFF = { "X-Content-Type-Options": "nosniff" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const denied = await denyIfNoAccess();
  if (denied) return denied;
  const { fileId } = await params;

  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return new Response("Invalid file id", { status: 400, headers: NOSNIFF });
  }

  try {
    const { buffer, mimeType, name } = await fetchDriveFile(fileId);
    const inline = INLINE_TYPE.test(mimeType);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...NOSNIFF,
        "Content-Type": inline ? mimeType : "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error(`[attachments] failed to fetch Drive file ${fileId}:`, err);
    const message =
      err instanceof Error ? err.message : "Failed to load attachment.";
    return new Response(message, { status: 502, headers: NOSNIFF });
  }
}
