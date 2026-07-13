import { Router } from "express";
import prisma from "../../shared/prisma";
import { computeKpis } from "../../shared/kpi";

const router = Router();

// Naive per-IP throttle — adequate for a self-hosted tool. 60 req/min.
const WINDOW_MS = 60_000;
const LIMIT = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  if (hits.size > 10_000) hits.clear(); // memory guard
  return entry.count > LIMIT;
}

// Public read-only KPI board. No auth — the token is the credential.
router.get("/kpis/:token", async (req, res) => {
  const ip = req.ip ?? "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

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
