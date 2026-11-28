// Checks shared by the Drive upload actions (BIS licence copies, drawing PDFs).

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// The dashboard previews these inline from our own origin, so only PDFs and plain images,
// matched on their first bytes so a renamed HTML or script file can't pass as one.
export const UPLOAD_MAGIC = new Map([
  ["application/pdf", /^%PDF-/],
  ["image/png", /^\x89PNG/],
  ["image/jpeg", /^\xff\xd8\xff/],
  ["image/gif", /^GIF8/],
  ["image/webp", /^RIFF[\s\S]{4}WEBP/],
]);

/** A file's first bytes as latin1 text, for UPLOAD_MAGIC. */
export const fileHead = async (file: Blob) => Buffer.from(await file.slice(0, 12).arrayBuffer()).toString("latin1");
