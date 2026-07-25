import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { rateLimit } from "../middleware/rateLimit";
import { sendPush } from "../../shared/notify/push";

const router = Router();

// Guards the send-heavy / Google-hitting endpoints from abuse.
const expensiveLimiter = rateLimit({ windowMs: 60_000, max: 30 });

router.post("/test", requireAuth, expensiveLimiter, async (req, res) => {
  const userId = req.session!.userId as string;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) {
    res.status(400).json({ error: "No push devices. Click “Enable push” first." });
    return;
  }
  const payload = {
    title: "SheetWatch test",
    body: "Push notifications are working 🎉",
    url: "/",
  };
  const results = await Promise.allSettled(
    subs.map((s) =>
      sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
    )
  );
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length === results.length) {
    const err: any = failed[0].reason;
    res.status(502).json({
      error: `Push failed (HTTP ${err?.statusCode ?? "?"}). Check VAPID keys — if they changed, disable and re-enable push.`,
    });
    return;
  }
  res.json({ ok: true, sent: subs.length - failed.length, failed: failed.length });
});

router.post("/subscribe", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { endpoint, keys } = req.body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "Invalid subscription object" });
    return;
  }

  // A browser endpoint belongs to whoever registered it. Reassign atomically
  // (one transaction) so a concurrent request can't interleave the drop/upsert:
  // remove any row owned by another account, then upsert ours.
  await prisma.$transaction([
    prisma.pushSubscription.deleteMany({ where: { endpoint, userId: { not: userId } } }),
    prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth },
    }),
  ]);

  res.json({ ok: true });
});

router.delete("/subscribe", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ error: "endpoint required" });
    return;
  }
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } }).catch(() => {});
  res.json({ ok: true });
});

export default router;
