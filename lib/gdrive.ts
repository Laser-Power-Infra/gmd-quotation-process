import { google } from "googleapis";
import { Readable } from "stream";
import fs from "fs";
import path from "path";

// Singleton instances for OAuth2 and Drive clients
let oauth2ClientInstance: any = null;
let driveInstance: any = null;

const DRIVE_FOLDER_ID = "1Zj4-Uwg_YC-p-NtyU7xWTEWfedGsEvMz";

/**
 * Initializes and returns the singleton OAuth2 and Drive clients.
 * Reads config and persists token updates dynamically.
 */
function getGoogleClients() {
  if (oauth2ClientInstance && driveInstance) {
    return { oauth2Client: oauth2ClientInstance, drive: driveInstance };
  }

  const credentialsPath = path.join(process.cwd(), "credentials.json");
  const tokenPath = path.join(process.cwd(), "token.json");

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Missing credentials.json in project root. Expected path: ${credentialsPath}`);
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Missing token.json in project root. Expected path: ${tokenPath}`);
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const tokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8"));

  const clientInfo = credentials.installed || credentials.web;
  if (!clientInfo) {
    throw new Error("Invalid credentials.json format. Expected 'installed' or 'web' root key.");
  }

  const { client_id, client_secret, redirect_uris } = clientInfo;
  const redirectUri = redirect_uris && redirect_uris[0] ? redirect_uris[0] : "http://localhost";

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirectUri
  );

  // Set initial token credentials on OAuth2 client
  oauth2Client.setCredentials({
    access_token: tokenData.token || tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date: tokenData.expiry ? new Date(tokenData.expiry).getTime() : undefined,
    scope: tokenData.scopes ? tokenData.scopes.join(" ") : undefined,
  });

  // Register token refresh listener to automatically keep token.json up to date
  oauth2Client.on("tokens", (tokens) => {
    try {
      const currentTokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
      const updatedTokenData = {
        ...currentTokenData,
        token: tokens.access_token || currentTokenData.token,
        refresh_token: tokens.refresh_token || currentTokenData.refresh_token,
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : currentTokenData.expiry,
      };
      fs.writeFileSync(tokenPath, JSON.stringify(updatedTokenData, null, 2), "utf8");
      console.log("Successfully refreshed and updated token.json with new OAuth2 access token.");
    } catch (err) {
      console.error("Failed to persist refreshed OAuth2 tokens to token.json:", err);
    }
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  oauth2ClientInstance = oauth2Client;
  driveInstance = drive;

  return { oauth2Client, drive };
}

/**
 * Uploads a base64 encoded file directly to the configured Google Drive folder.
 */
export async function uploadFileToDrive(fileName: string, mimeType: string, base64Data: string) {
  try {
    const { drive } = getGoogleClients();
    const buffer = Buffer.from(base64Data, "base64");
    const fileMetadata = {
      name: fileName,
      parents: [DRIVE_FOLDER_ID],
    };
    const media = {
      mimeType,
      body: Readable.from(buffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    const fileId = response.data.id;

    if (!fileId) {
      throw new Error("Failed to retrieve file ID from Google Drive upload response.");
    }

    // Set permission so that anyone with the link can view it (shares public access for spreadsheet linking)
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    return {
      success: true,
      fileId,
      url: response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    };
  } catch (error: any) {
    console.error("Error uploading file to Google Drive via OAuth2:", error);
    throw error;
  }
}
