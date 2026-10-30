import { existsSync } from "node:fs";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

export type PbgMailInput = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  text: string;
};

export type PbgMailResult = {
  ok: boolean;
  messageId?: string;
  accepted: string[];
  rejected: string[];
  error?: string;
};

let transporter: Transporter | null = null;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined ? undefined : value.trim();
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/** True when the minimum SMTP settings are present. */
export function isSmtpConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

function fromAddress(): string {
  const from = env("MAIL_FROM") ?? env("SMTP_USER");
  if (!from) {
    throw new Error("Missing MAIL_FROM (or SMTP_USER) environment variable.");
  }
  const name = env("MAIL_FROM_NAME");
  return name ? `"${name.replace(/"/g, "'")}" <${from}>` : from;
}

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = env("SMTP_HOST");
  const user = env("SMTP_USER");
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error(
      "Missing SMTP configuration: set SMTP_HOST, SMTP_USER and SMTP_PASS.",
    );
  }

  const port = Number(env("SMTP_PORT") ?? "587");
  const secure = parseBoolean(env("SMTP_SECURE"), port === 465);

  transporter = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });

  return transporter;
}

function addressList(value: unknown): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "address" in entry) {
        return String((entry as { address?: unknown }).address ?? "");
      }
      return "";
    })
    .filter(Boolean);
}

/** Verifies the SMTP connection and credentials without sending a mail. */
export async function verifySmtp(): Promise<void> {
  await getTransporter().verify();
}

/** Closes the pooled SMTP connection so CLI scripts can exit cleanly. */
export async function closeMailer(): Promise<void> {
  if (!transporter) return;
  const current = transporter;
  transporter = null;
  current.close();
}

function logoAttachment(): { filename: string; path: string; cid: string } | null {
  const candidates = [
    env("PBG_MAIL_LOGO_PATH"),
    path.join(process.cwd(), "public", "logo.jpg"),
    path.join(process.cwd(), "apps", "gmd-quotation-process", "public", "logo.jpg"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { filename: "gmd-logo.jpg", path: candidate, cid: "gmd-logo" };
    }
  }
  return null;
}

/** Sends one message. Never throws; the caller decides how to log a failure. */
export async function sendPbgMail(input: PbgMailInput): Promise<PbgMailResult> {
  try {
    const logo = logoAttachment();
    const info = await getTransporter().sendMail({
      from: fromAddress(),
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: logo ? [logo] : undefined,
    });

    return {
      ok: true,
      messageId: info.messageId,
      accepted: addressList(info.accepted),
      rejected: addressList(info.rejected),
    };
  } catch (error) {
    return {
      ok: false,
      accepted: [],
      rejected: [],
      error: error instanceof Error ? error.message : "Failed to send mail.",
    };
  }
}
