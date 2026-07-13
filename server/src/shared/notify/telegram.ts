import { NotifyPayload } from "../types";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

// Chat ids are numeric (groups negative). Stored in Webhook.url for
// kind="telegram" rows.
export function validateTelegramChatId(raw: string): string | null {
  if (!/^-?\d{5,20}$/.test(raw.trim())) {
    return "Telegram chat id must be a number like 123456789 (or -100… for groups)";
  }
  return null;
}

export async function sendTelegram(chatId: string, payload: NotifyPayload): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: `<b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.body)}\n${payload.url}`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Telegram responded ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
