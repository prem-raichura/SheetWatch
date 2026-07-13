import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { telegramConfigured } from "../../shared/notify/telegram";

const router = Router();

const CHANNELS = new Set(["push", "email", "webhook", "telegram"]);
const STATUSES = new Set(["sent", "failed", "queued", "suppressed"]);

// Delivery log, newest first, cursor-paginated on (createdAt, id).
router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { channel, status, cursor } = req.query as {
    channel?: string;
    status?: string;
    cursor?: string;
  };
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  const rows = await prisma.notificationLog.findMany({
    where: {
      userId,
      ...(channel && CHANNELS.has(channel) ? { channel } : {}),
      ...(status && STATUSES.has(status) ? { status } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  res.json({
    items: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});

// Re-attempt a failed delivery by re-queueing it for immediate flush.
router.post("/:id/retry", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const row = await prisma.notificationLog.findFirst({
    where: { id: req.params.id, userId },
  });
  if (!row) {
    res.status(404).json({ error: "Log entry not found" });
    return;
  }
  if (row.status !== "failed") {
    res.status(400).json({ error: "Only failed deliveries can be retried" });
    return;
  }
  if (row.channel === "webhook" || row.channel === "telegram") {
    res.status(400).json({ error: "Webhook deliveries retry automatically on the next change" });
    return;
  }

  const updated = await prisma.notificationLog.update({
    where: { id: row.id },
    data: { status: "queued", deliverAfter: new Date(), error: null },
  });
  res.json(updated);
});

export default router;

// Feature flags the client needs before showing integration UI.
export const configRouter = Router();
configRouter.get("/", requireAuth, (_req, res) => {
  res.json({
    telegramConfigured: telegramConfigured(),
    emailConfigured: Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST),
  });
});
