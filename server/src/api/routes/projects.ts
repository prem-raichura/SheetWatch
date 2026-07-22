import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import {
  scheduleSheetPoll,
  unscheduleSheetPoll,
} from "../../shared/queues";
import { checkSheetNow } from "../../shared/checkNow";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { sheets: true } } },
  });
  res.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      sortOrder: p.sortOrder,
      notifyEmail: p.notifyEmail,
      notifyPush: p.notifyPush,
      sheetCount: p._count.sheets,
    }))
  );
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { name, color } = req.body as { name?: string; color?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const max = await prisma.project.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });
  const project = await prisma.project.create({
    data: {
      userId,
      name: name.trim(),
      ...(color && { color }),
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  res.status(201).json(project);
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { name, color, notifyEmail, notifyPush, sortOrder, applyNotifyToSheets } =
    req.body as {
      name?: string;
      color?: string;
      notifyEmail?: boolean;
      notifyPush?: boolean;
      sortOrder?: number;
      applyNotifyToSheets?: boolean;
    };

  try {
    const project = await prisma.project.update({
      where: { id: req.params.id, userId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
        ...(notifyEmail !== undefined && { notifyEmail }),
        ...(notifyPush !== undefined && { notifyPush }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    // Optionally cascade notification defaults onto member sheets.
    if (applyNotifyToSheets && (notifyEmail !== undefined || notifyPush !== undefined)) {
      await prisma.sheet.updateMany({
        where: { projectId: project.id, userId },
        data: {
          ...(notifyEmail !== undefined && { notifyEmail }),
          ...(notifyPush !== undefined && { notifyPush }),
        },
      });
    }

    res.json(project);
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

router.post("/:id/bulk", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { action } = req.body as { action?: string };

  if (action !== "pause" && action !== "resume" && action !== "check") {
    res.status(400).json({ error: "action must be pause, resume or check" });
    return;
  }

  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const sheets = await prisma.sheet.findMany({
    where: { projectId: project.id, userId, archivedAt: null },
    select: { id: true, pollInterval: true, paused: true },
  });

  if (action === "pause") {
    await prisma.sheet.updateMany({
      where: { projectId: project.id, userId, archivedAt: null },
      data: { paused: true },
    });
    await Promise.all(sheets.map((s) => unscheduleSheetPoll(s.id)));
    res.json({ affected: sheets.length });
    return;
  }

  if (action === "resume") {
    await prisma.sheet.updateMany({
      where: { projectId: project.id, userId, archivedAt: null },
      data: { paused: false },
    });
    await Promise.all(sheets.map((s) => scheduleSheetPoll(s)));
    res.json({ affected: sheets.length });
    return;
  }

  // check: one-off poll for every non-paused sheet in the project. Fire-and-
  // forget — a single inline poll failure must not fail the whole request.
  const active = sheets.filter((s) => !s.paused);
  await Promise.allSettled(active.map((s) => checkSheetNow(s.id)));
  res.json({ affected: active.length });
});

router.post("/reorder", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    res.status(400).json({ error: "ids must be a non-empty array of project ids" });
    return;
  }
  const owned = await prisma.project.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((p) => p.id));
  if (!ids.every((id) => ownedIds.has(id))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  await prisma.$transaction(
    ids.map((id, i) => prisma.project.update({ where: { id, userId }, data: { sortOrder: i } }))
  );
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    // Detach sheets (keep them) then delete the project.
    await prisma.sheet.updateMany({
      where: { projectId: req.params.id, userId },
      data: { projectId: null },
    });
    await prisma.project.delete({ where: { id: req.params.id, userId } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Project not found" });
  }
});

export default router;
