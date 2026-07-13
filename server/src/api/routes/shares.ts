import { randomBytes } from "crypto";
import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const links = await prisma.shareLink.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(links);
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { title, widgetIds } = req.body as { title?: unknown; widgetIds?: unknown };

  if (title !== undefined && (typeof title !== "string" || title.length > 80)) {
    res.status(400).json({ error: "title must be up to 80 characters" });
    return;
  }
  let ids: string[] = [];
  if (widgetIds !== undefined) {
    if (!Array.isArray(widgetIds) || !widgetIds.every((id) => typeof id === "string")) {
      res.status(400).json({ error: "widgetIds must be an array of ids" });
      return;
    }
    ids = widgetIds as string[];
    if (ids.length > 0) {
      const owned = await prisma.kpiWidget.count({ where: { userId, id: { in: ids } } });
      if (owned !== new Set(ids).size) {
        res.status(404).json({ error: "KPI widget not found" });
        return;
      }
    }
  }

  const link = await prisma.shareLink.create({
    data: {
      userId,
      token: randomBytes(24).toString("base64url"),
      title: title ? (title as string).trim() : null,
      widgetIds: ids,
    },
  });
  res.status(201).json(link);
});

// Soft revoke — the row stays for the view-count history.
router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    await prisma.shareLink.update({
      where: { id: req.params.id, userId },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Share link not found" });
  }
});

export default router;
