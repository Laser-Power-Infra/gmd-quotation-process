// In-memory stand-in for lib/gdrive. Importing this file makes every later import
// of lib/gdrive resolve here, so upload actions run without Google Drive.
import { registerHooks } from "node:module";

export const uploads = [];
// A test can set `duringUpload` to act while an upload is in flight (e.g. paste a link onto the row).
/** @type {{ duringUpload: null | (() => void | Promise<void>) }} */
export const hooks = { duringUpload: null };
// fetchDriveFile serves whatever a test puts here: fileId -> { buffer, mimeType, name }.
export const driveFiles = new Map();

export async function uploadFileToDrive(fileName, mimeType, base64Data) {
  uploads.push({ fileName, mimeType, base64Data });
  await hooks.duringUpload?.();
  const fileId = `drive-${uploads.length}`;
  return { success: true, fileId, url: `https://drive.google.com/file/d/${fileId}/view` };
}

export async function fetchDriveFile(fileId) {
  const file = driveFiles.get(fileId);
  if (!file) throw new Error(`Drive file ${fileId} not found`);
  return file;
}

registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    return resolved.url.endsWith("/lib/gdrive.ts") ? { url: import.meta.url, shortCircuit: true } : resolved;
  },
});
