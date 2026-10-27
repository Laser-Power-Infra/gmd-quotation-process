/**
 * Technical-evaluation follow-up send via n8n.
 *
 * The app does not send mail itself — it POSTs a JSON payload to an n8n Webhook
 * node which waits 24 hours and then relays it through a Gmail (OAuth) node.
 *
 * Configure `N8N_TECH_EVAL_FOLLOWUP_WEBHOOK_URL` (server-only).
 */

export interface TechEvalFollowupPayload {
  docketNumber: string;
  /** Primary recipient — Enquiry.senderEmail. */
  to: string;
  /** Comma-separated recipients — docket email addresses plus the fixed Cc. */
  cc: string;
  subject: string;
  html: string;
  /** ISO timestamp of the "Yes" mark, for logging inside n8n. */
  markedAt: string;
}

export interface TechEvalFollowupResult {
  success: boolean;
  error?: string;
}

export async function sendTechEvalFollowupViaN8n(
  payload: TechEvalFollowupPayload,
): Promise<TechEvalFollowupResult> {
  const webhookUrl = process.env.N8N_TECH_EVAL_FOLLOWUP_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("[n8n-tech-eval-followup] N8N_TECH_EVAL_FOLLOWUP_WEBHOOK_URL not set, skipping send");
    return { success: false, error: "Follow-up webhook is not configured (N8N_TECH_EVAL_FOLLOWUP_WEBHOOK_URL)." };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text().catch(() => "");

    if (!response.ok) {
      console.warn("[n8n-tech-eval-followup] queue failed", {
        docketNumber: payload.docketNumber,
        status: response.status,
        body: text,
      });
      return { success: false, error: `n8n responded ${response.status}` };
    }

    console.log("[n8n-tech-eval-followup] queued", {
      docketNumber: payload.docketNumber,
      status: response.status,
    });
    return { success: true };
  } catch (error) {
    console.error("[n8n-tech-eval-followup] error", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reach the follow-up webhook.",
    };
  }
}
