import { Router } from "express";
import prisma from "../../shared/prisma";
import { computeKpis } from "../../shared/kpi";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

// Public read-only KPI board. No auth — the token is the credential. Per-IP
// throttle guards against token brute-force / scraping.
router.get("/kpis/:token", rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  const link = await prisma.shareLink.findUnique({
    where: { token: req.params.token },
  });
  if (!link || link.revokedAt) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Fire-and-forget view counter.
  prisma.shareLink
    .update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => {});

  const widgets = await computeKpis(
    link.userId,
    link.widgetIds.length > 0 ? link.widgetIds : undefined
  );

  res.json({
    title: link.title,
    createdAt: link.createdAt,
    // sheetId is internal — strip it from the public payload.
    widgets: widgets.map(({ sheetId: _sheetId, ...rest }) => rest),
  });
});

export default router;
