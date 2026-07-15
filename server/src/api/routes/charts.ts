import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { extractChartData, parseA1Range } from "../../shared/charts";

const router = Router();

const TYPES = new Set(["line", "bar", "area", "donut"]);
const COL_RE = /^[A-Za-z]{1,3}$/;

function validate(body: Record<string, unknown>, partial = false): string | null {
  const { label, type, range, xColumn, dataColumns, headerRow } = body;
  if (!partial || label !== undefined) {
    if (typeof label !== "string" || !label.trim() || label.trim().length > 60) {
      return "label must be 1–60 characters";
    }
  }
  if (!partial || type !== undefined) {
    if (typeof type !== "string" || !TYPES.has(type)) return "type must be line, bar, area or donut";
  }
  if (!partial || range !== undefined) {
    if (typeof range !== "string" || !parseA1Range(range)) {
      return "range must be A1 notation like A1:C30";
    }
  }
  if (xColumn !== undefined && xColumn !== null) {
    if (typeof xColumn !== "string" || !COL_RE.test(xColumn)) return "xColumn must be column letters";
  }
  if (dataColumns !== undefined) {
    if (
      !Array.isArray(dataColumns) ||
      !dataColumns.every((c) => typeof c === "string" && COL_RE.test(c))
    ) {
      return "dataColumns must be column letters";
    }
  }
  if (headerRow !== undefined && typeof headerRow !== "boolean") {
    return "headerRow must be a boolean";
  }
  return null;
}

// Widgets with their current data, computed from each sheet's last snapshot.
router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const widgets = await prisma.chartWidget.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { sheet: { select: { label: true, range: true, lastSnapshot: true } } },
  });

  res.json(
    widgets.map((w) => ({
      id: w.id,
      sheetId: w.sheetId,
      sheetLabel: w.sheet.label,
      label: w.label,
      type: w.type,
      range: w.range,
      xColumn: w.xColumn,
      dataColumns: w.dataColumns,
      headerRow: w.headerRow,
      sortOrder: w.sortOrder,
      data: extractChartData(
        (w.sheet.lastSnapshot as string[][] | null) ?? [],
        w.sheet.range,
        w
      ),
    }))
  );
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const body = req.body as Record<string, unknown>;
  const error = validate(body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const sheet = await prisma.sheet.findFirst({
    where: { id: body.sheetId as string, userId },
    select: { id: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }

  const max = await prisma.chartWidget.aggregate({ where: { userId }, _max: { sortOrder: true } });
  const widget = await prisma.chartWidget.create({
    data: {
      userId,
      sheetId: sheet.id,
      label: (body.label as string).trim(),
      type: body.type as string,
      range: (body.range as string).trim().toUpperCase(),
      xColumn: body.xColumn ? (body.xColumn as string).toUpperCase() : null,
      dataColumns: Array.isArray(body.dataColumns)
        ? (body.dataColumns as string[]).map((c) => c.toUpperCase())
        : [],
      headerRow: body.headerRow !== false,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  res.status(201).json(widget);
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const body = req.body as Record<string, unknown>;
  const error = validate(body, true);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  try {
    const widget = await prisma.chartWidget.update({
      where: { id: req.params.id, userId },
      data: {
        ...(body.label !== undefined && { label: (body.label as string).trim() }),
        ...(body.type !== undefined && { type: body.type as string }),
        ...(body.range !== undefined && { range: (body.range as string).trim().toUpperCase() }),
        ...(body.xColumn !== undefined && {
          xColumn: body.xColumn ? (body.xColumn as string).toUpperCase() : null,
        }),
        ...(body.dataColumns !== undefined && {
          dataColumns: (body.dataColumns as string[]).map((c) => c.toUpperCase()),
        }),
        ...(body.headerRow !== undefined && { headerRow: body.headerRow as boolean }),
      },
    });
    res.json(widget);
  } catch {
    res.status(404).json({ error: "Chart not found" });
  }
});

router.post("/reorder", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    res.status(400).json({ error: "ids must be a non-empty array of chart ids" });
    return;
  }
  const owned = await prisma.chartWidget.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((w) => w.id));
  if (!ids.every((id) => ownedIds.has(id))) {
    res.status(404).json({ error: "Chart not found" });
    return;
  }
  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.chartWidget.update({ where: { id, userId }, data: { sortOrder: i } })
    )
  );
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    await prisma.chartWidget.delete({ where: { id: req.params.id, userId } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Chart not found" });
  }
});

export default router;
