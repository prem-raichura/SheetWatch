import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { sendWebhook, validateWebhookUrl } from "../../shared/notify/webhook";
import {
  sendTelegram,
  telegramConfigured,
  validateTelegramChatId,
} from "../../shared/notify/telegram";

const KINDS = new Set(["slack", "discord", "generic", "telegram"]);

// For kind="telegram" the url column stores the chat id, so the SSRF URL
// validation does not apply.
function validateTarget(kind: string, value: string): string | null {
  return kind === "telegram" ? validateTelegramChatId(value) : validateWebhookUrl(value);
}

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const webhooks = await prisma.webhook.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { sheets: true } } },
  });
  res.json(
    webhooks.map((w) => ({
      id: w.id,
      kind: w.kind,
      url: w.url,
      label: w.label,
      sheetCount: w._count.sheets,
      createdAt: w.createdAt,
    }))
  );
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { kind, url, label } = req.body as { kind?: string; url?: string; label?: string };

  if (!kind || !KINDS.has(kind)) {
    res.status(400).json({ error: "kind must be slack, discord, generic or telegram" });
    return;
  }
  if (kind === "telegram" && !telegramConfigured()) {
    res.status(400).json({ error: "Telegram is not configured on this server (TELEGRAM_BOT_TOKEN)" });
    return;
  }
  if (!url) {
    res.status(400).json({ error: kind === "telegram" ? "chat id required" : "url required" });
    return;
  }
  const urlError = validateTarget(kind, url);
  if (urlError) {
    res.status(400).json({ error: urlError });
    return;
  }

  const webhook = await prisma.webhook.create({
    data: { userId, kind, url, label: label?.trim() || kind },
  });
  res.status(201).json(webhook);
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { url, label } = req.body as { url?: string; label?: string };

  if (url !== undefined) {
    const existing = await prisma.webhook.findFirst({
      where: { id: req.params.id, userId },
      select: { kind: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Webhook not found" });
      return;
    }
    const urlError = validateTarget(existing.kind, url);
    if (urlError) {
      res.status(400).json({ error: urlError });
      return;
    }
  }

  try {
    const webhook = await prisma.webhook.update({
      where: { id: req.params.id, userId },
      data: {
        ...(url !== undefined && { url }),
        ...(label !== undefined && { label: label.trim() || undefined }),
      },
    });
    res.json(webhook);
  } catch {
    res.status(404).json({ error: "Webhook not found" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    await prisma.webhook.delete({ where: { id: req.params.id, userId } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Webhook not found" });
  }
});

router.post("/:id/test", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const webhook = await prisma.webhook.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!webhook) {
    res.status(404).json({ error: "Webhook not found" });
    return;
  }
  try {
    const payload = {
      title: "SheetWatch test",
      body: "Webhook notifications are working 🎉",
      url: "https://docs.google.com",
    };
    if (webhook.kind === "telegram") await sendTelegram(webhook.url, payload);
    else await sendWebhook(webhook, payload);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Webhook delivery failed" });
  }
});

export default router;
