import { isIP } from "net";
import { NotifyPayload } from "../types";

export interface WebhookTarget {
  kind: string; // slack | discord | generic
  url: string;
}

// SSRF guard for user-supplied webhook URLs: https only, no IP literals,
// no obviously-internal hostnames. DNS rebinding is out of scope for a
// self-hosted tool, but the cheap checks are worth having.
export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Invalid URL";
  }
  if (url.protocol !== "https:") return "Webhook URLs must use https";
  const host = url.hostname.toLowerCase();
  if (isIP(host) || host.startsWith("[")) return "IP addresses are not allowed";
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  ) {
    return "Internal hostnames are not allowed";
  }
  return null;
}

function buildBody(kind: string, payload: NotifyPayload): unknown {
  const text = `*${payload.title}*\n${payload.body}\n${payload.url}`;
  switch (kind) {
    case "slack":
      return {
        text: `${payload.title} — ${payload.body}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ],
      };
    case "discord":
      return {
        embeds: [
          {
            title: payload.title,
            description: payload.body,
            url: payload.url,
            color: 0x0fa3a3,
          },
        ],
      };
    default:
      return { source: "sheetwatch", ...payload };
  }
}

export async function sendWebhook(target: WebhookTarget, payload: NotifyPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(target.kind, payload)),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Webhook responded ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
