import { drive } from "@googleapis/drive";
import { Readable } from "stream";
import { getOAuthClient } from "./googleAuth";

/** Uploads a heat-sheet file to the Drive folder in STOCK_HEAT_SHEET_DRIVE_FOLDER_ID; returns the file id. */
export async function uploadHeatSheet(fileName: string, mimeType: string, buffer: Buffer): Promise<string> {
  const folderId = process.env.STOCK_HEAT_SHEET_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("STOCK_HEAT_SHEET_DRIVE_FOLDER_ID is not set.");
  const api = drive({ version: "v3", auth: getOAuthClient() });
  const res = await api.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id",
  });
  if (!res.data.id) throw new Error("Google Drive returned no file id.");
  return res.data.id;
}
