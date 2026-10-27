import { OAuth2Client } from "google-auth-library";

let oauth2ClientInstance: InstanceType<typeof OAuth2Client> | null = null;

/**
 * Singleton OAuth2 client built from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
 * GOOGLE_REFRESH_TOKEN. The refresh token never expires on its own, so there is
 * nothing to persist when Google issues a new access token.
 */
export function getOAuthClient() {
  if (oauth2ClientInstance) return oauth2ClientInstance;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google OAuth env vars: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.",
    );
  }

  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  oauth2ClientInstance = client;
  return client;
}
