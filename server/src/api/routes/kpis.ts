import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { computeKpis } from "../../shared/kpi";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  res.json(await computeKpis(userId));
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { sheetId, cell, label, format } = req.body as {
    sheetId?: string;
    cell?: string;
    label?: string;
    format?: string;
  };

  if (!sheetId || !cell || !/^[A-Za-z]{1,3}\d+$/.test(cell.trim())) {
    res.status(400).json({ error: "sheetId and a cell like B4 are required" });
    return;
  }
  if (format !== undefined && !["number", "currency", "percent"].includes(format)) {
    res.status(400).json({ error: "format must be number, currency or percent" });
    return;
  }

  const sheet = await prisma.sheet.findFirst({
    where: { id: sheetId, userId },
    select: { id: true, label: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }

  const max = await prisma.kpiWidget.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });

  const widget = await prisma.kpiWidget.create({
    data: {
      userId,
      sheetId,
      cell: cell.trim().toUpperCase(),
      label: label?.trim() || `${sheet.label} · ${cell.trim().toUpperCase()}`,
      ...(format && { format }),
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  res.status(201).json(widget);
});

router.post("/reorder", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { ids } = req.body as { ids?: unknown };

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string")
  ) {
    res.status(400).json({ error: "ids must be a non-empty array of widget ids" });
    return;
  }

  const owned = await prisma.kpiWidget.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((w) => w.id));
  if (!ids.every((id) => ownedIds.has(id))) {
    res.status(404).json({ error: "Widget not found" });
    return;
  }

  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.kpiWidget.update({ where: { id, userId }, data: { sortOrder: i } })
    )
  );
  res.json({ ok: true });
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { label, format, alertAbove, alertBelow } = req.body as {
    label?: unknown;
    format?: unknown;
    alertAbove?: unknown;
    alertBelow?: unknown;
  };

  if (format !== undefined && !["number", "currency", "percent"].includes(format as string)) {
    res.status(400).json({ error: "format must be number, currency or percent" });
    return;
  }
  if (
    label !== undefined &&
    (typeof label !== "string" || !label.trim() || label.trim().length > 60)
  ) {
    res.status(400).json({ error: "label must be 1–60 characters" });
    return;
  }
  const badThreshold = (v: unknown) =>
    v !== undefined && v !== null && (typeof v !== "number" || Number.isNaN(v));
  if (badThreshold(alertAbove) || badThreshold(alertBelow)) {
    res.status(400).json({ error: "thresholds must be numbers or null" });
    return;
  }

  try {
    const widget = await prisma.kpiWidget.update({
      where: { id: req.params.id, userId },
      data: {
        ...(label !== undefined && { label: (label as string).trim() }),
        ...(format !== undefined && { format: format as string }),
        // Changing thresholds resets crossing state so the next poll re-evaluates.
        ...(alertAbove !== undefined && {
          alertAbove: alertAbove as number | null,
          lastAlertState: "unknown",
        }),
        ...(alertBelow !== undefined && {
          alertBelow: alertBelow as number | null,
          lastAlertState: "unknown",
        }),
      },
    });
    res.json(widget);
  } catch {
    res.status(404).json({ error: "Widget not found" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    await prisma.kpiWidget.delete({ where: { id: req.params.id, userId } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Widget not found" });
  }
});

export default router;
