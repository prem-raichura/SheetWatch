import { Resend } from "resend";
import nodemailer, { Transporter } from "nodemailer";
import { NotifyPayload } from "../types";

const FROM = process.env.EMAIL_FROM ?? "SheetWatch <noreply@sheetwatch.app>";

// Two delivery backends, first configured one wins:
//   1. Resend  — RESEND_API_KEY
//   2. SMTP    — SMTP_HOST + SMTP_USER + SMTP_PASS (e.g. Gmail app password)
let resend: Resend | null = null;
let smtp: Transporter | null = null;
let warnedNoBackend = false;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resend) resend = new Resend(key);
  return resend;
}

function getSmtp(): Transporter | null {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    smtp = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return smtp;
}

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
}

// Sheet labels come from the Google sheet title, which any collaborator can
// edit — escape before interpolating into HTML.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export async function sendEmail(
  to: string,
  payload: NotifyPayload,
  attachments?: EmailAttachment[]
): Promise<void> {
  const html = `
    <h2>${escapeHtml(payload.title)}</h2>
    <p>${escapeHtml(payload.body)}</p>
    <p><a href="${escapeHtml(payload.url)}">Open sheet →</a></p>
  `;

  const resendClient = getResend();
  if (resendClient) {
    const { error } = await resendClient.emails.send({
      from: FROM,
      to,
      subject: payload.title,
      html,
      ...(attachments &&
        attachments.length > 0 && {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString("base64"),
          })),
        }),
    });
    if (error) throw new Error(`Resend: ${error.message}`);
    return;
  }

  const smtpClient = getSmtp();
  if (smtpClient) {
    await smtpClient.sendMail({
      from: FROM,
      to,
      subject: payload.title,
      html,
      ...(attachments && attachments.length > 0 && { attachments }),
    });
    return;
  }

  if (!warnedNoBackend) {
    console.warn(
      "Email not configured — set RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS (e.g. Gmail app password). Email notifications are disabled."
    );
    warnedNoBackend = true;
  }
}
