import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { computeSuggestions, applySuggestions } from "../../shared/compare";

const router = Router();

// Verify every id is a sheet the user owns. Returns true when all present.
async function ownsAllSheets(userId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  const owned = await prisma.sheet.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true },
  });
  return owned.length === new Set(ids).size;
}

function parseColumns(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((c) => typeof c === "string")) return null;
  return v.map((c) => c.trim()).filter(Boolean);
}

// GET /api/compare/pending-count — total pending suggestions for the nav badge.
router.get("/pending-count", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const count = await prisma.suggestion.count({
    where: { status: "pending", group: { userId } },
  });
  res.json({ count });
});

// GET /api/compare/groups — groups with pending suggestion counts + labels.
router.get("/groups", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const groups = await prisma.comparisonGroup.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      masterSheet: { select: { id: true, label: true } },
      targets: { include: { sheet: { select: { id: true, label: true } } } },
    },
  });

  const counts = await prisma.suggestion.groupBy({
    by: ["groupId", "status"],
    where: { group: { userId } },
    _count: true,
  });
  const pendingBy = new Map<string, number>();
  const conflictBy = new Map<string, number>();
  for (const c of counts) {
    if (c.status === "pending") pendingBy.set(c.groupId, c._count);
  }
  const conflicts = await prisma.suggestion.groupBy({
    by: ["groupId"],
    where: { group: { userId }, status: "pending", conflict: true },
    _count: true,
  });
  for (const c of conflicts) conflictBy.set(c.groupId, c._count);

  res.json(
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      enabled: g.enabled,
      keyColumn: g.keyColumn,
      compareColumns: g.compareColumns,
      master: g.masterSheet,
      targets: g.targets.map((t) => t.sheet),
      pendingCount: pendingBy.get(g.id) ?? 0,
      conflictCount: conflictBy.get(g.id) ?? 0,
      createdAt: g.createdAt,
    }))
  );
});

// POST /api/compare/groups — create a comparison group.
router.post("/groups", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { name, masterSheetId, targetSheetIds, keyColumn, compareColumns } = req.body as {
    name?: unknown;
    masterSheetId?: unknown;
    targetSheetIds?: unknown;
    keyColumn?: unknown;
    compareColumns?: unknown;
  };

  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
    res.status(400).json({ error: "name must be 1–80 characters" });
    return;
  }
  if (typeof masterSheetId !== "string") {
    res.status(400).json({ error: "masterSheetId is required" });
    return;
  }
  if (
    !Array.isArray(targetSheetIds) ||
    targetSheetIds.length === 0 ||
    !targetSheetIds.every((id) => typeof id === "string" && id !== masterSheetId)
  ) {
    res.status(400).json({ error: "targetSheetIds must be a non-empty array excluding the master" });
    return;
  }
  const cols = parseColumns(compareColumns);
  if (!cols || cols.length === 0) {
    res.status(400).json({ error: "compareColumns must be a non-empty array of column names" });
    return;
  }
  if (keyColumn !== undefined && keyColumn !== null && typeof keyColumn !== "string") {
    res.status(400).json({ error: "keyColumn must be a string or null" });
    return;
  }
  if (!(await ownsAllSheets(userId, [masterSheetId, ...targetSheetIds]))) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }

  const group = await prisma.comparisonGroup.create({
    data: {
      userId,
      name: name.trim(),
      masterSheetId,
      keyColumn: typeof keyColumn === "string" && keyColumn.trim() ? keyColumn.trim() : null,
      compareColumns: cols,
      targets: { create: targetSheetIds.map((sheetId) => ({ sheetId })) },
    },
  });
  await computeSuggestions(group.id).catch(() => {});
  res.status(201).json({ id: group.id });
});

// Load a group the user owns, or null.
async function ownedGroup(userId: string, id: string) {
  return prisma.comparisonGroup.findFirst({ where: { id, userId } });
}

// PATCH /api/compare/groups/:id — update settings and/or target set.
router.patch("/groups/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const group = await ownedGroup(userId, req.params.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const { name, enabled, keyColumn, compareColumns, targetSheetIds } = req.body as {
    name?: unknown;
    enabled?: unknown;
    keyColumn?: unknown;
    compareColumns?: unknown;
    targetSheetIds?: unknown;
  };

  const data: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      res.status(400).json({ error: "name must be 1–80 characters" });
      return;
    }
    data.name = name.trim();
  }
  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }
    data.enabled = enabled;
  }
  if (keyColumn !== undefined) {
    if (keyColumn !== null && typeof keyColumn !== "string") {
      res.status(400).json({ error: "keyColumn must be a string or null" });
      return;
    }
    data.keyColumn = typeof keyColumn === "string" && keyColumn.trim() ? keyColumn.trim() : null;
  }
  if (compareColumns !== undefined) {
    const cols = parseColumns(compareColumns);
    if (!cols || cols.length === 0) {
      res.status(400).json({ error: "compareColumns must be a non-empty array" });
      return;
    }
    data.compareColumns = cols;
  }

  if (targetSheetIds !== undefined) {
    if (
      !Array.isArray(targetSheetIds) ||
      targetSheetIds.length === 0 ||
      !targetSheetIds.every((id) => typeof id === "string" && id !== group.masterSheetId)
    ) {
      res.status(400).json({ error: "targetSheetIds must be a non-empty array excluding the master" });
      return;
    }
    if (!(await ownsAllSheets(userId, targetSheetIds as string[]))) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    await prisma.comparisonTarget.deleteMany({ where: { groupId: group.id } });
    await prisma.comparisonTarget.createMany({
      data: (targetSheetIds as string[]).map((sheetId) => ({ groupId: group.id, sheetId })),
    });
  }

  await prisma.comparisonGroup.update({ where: { id: group.id }, data });
  await computeSuggestions(group.id).catch(() => {});
  res.json({ ok: true });
});

// DELETE /api/compare/groups/:id
router.delete("/groups/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const group = await ownedGroup(userId, req.params.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  await prisma.comparisonGroup.delete({ where: { id: group.id } });
  res.json({ ok: true });
});

// GET /api/compare/groups/:id/columns — master's header row for pickers.
router.get("/groups/:id/columns", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const group = await prisma.comparisonGroup.findFirst({
    where: { id: req.params.id, userId },
    include: { masterSheet: { select: { lastSnapshot: true } } },
  });
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const snapshot = group.masterSheet.lastSnapshot;
  const header = Array.isArray(snapshot) ? ((snapshot[0] as string[]) ?? []) : [];
  res.json({ columns: header.filter((h) => typeof h === "string" && h.trim()) });
});

// POST /api/compare/groups/:id/run — recompute + return fresh suggestions.
router.post("/groups/:id/run", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const group = await ownedGroup(userId, req.params.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  await computeSuggestions(group.id);
  res.json(await listSuggestions(group.id, "pending", ""));
});

// Shared suggestion query with optional status + free-text filter.
async function listSuggestions(groupId: string, status: string, q: string) {
  const rows = await prisma.suggestion.findMany({
    where: { groupId, ...(status && status !== "all" ? { status } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { targetSheet: { select: { id: true, label: true } } },
    take: 500,
  });
  const needle = q.trim().toLowerCase();
  return rows
    .filter(
      (s) =>
        !needle ||
        s.keyValue.toLowerCase().includes(needle) ||
        s.column.toLowerCase().includes(needle) ||
        s.masterValue.toLowerCase().includes(needle) ||
        s.targetSheet.label.toLowerCase().includes(needle)
    )
    .map((s) => ({
      id: s.id,
      target: s.targetSheet,
      keyValue: s.keyValue,
      column: s.column,
      masterValue: s.masterValue,
      targetValue: s.targetValue,
      status: s.status,
      conflict: s.conflict,
      error: s.error,
      createdAt: s.createdAt,
    }));
}

// GET /api/compare/groups/:id/suggestions?status=&q=
router.get("/groups/:id/suggestions", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const group = await ownedGroup(userId, req.params.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json(await listSuggestions(group.id, status, q));
});

function parseIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (!v.every((id) => typeof id === "string")) return null;
  return v as string[];
}

// POST /api/compare/suggestions/accept — write accepted suggestions.
router.post("/suggestions/accept", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const ids = parseIds((req.body as { ids?: unknown }).ids);
  if (!ids) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  try {
    res.json(await applySuggestions(userId, ids));
  } catch (err: any) {
    if (err?.code === "NO_WRITE_SCOPE") {
      res.status(403).json({ error: "Reconnect Google to enable applying changes", code: "NO_WRITE_SCOPE" });
      return;
    }
    res.status(500).json({ error: "Failed to apply changes" });
  }
});

// POST /api/compare/groups/:id/accept-all — apply all pending (optionally skip conflicts).
router.post("/groups/:id/accept-all", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const group = await ownedGroup(userId, req.params.id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const excludeConflicts = (req.body as { excludeConflicts?: unknown }).excludeConflicts === true;
  const pending = await prisma.suggestion.findMany({
    where: { groupId: group.id, status: "pending", ...(excludeConflicts ? { conflict: false } : {}) },
    select: { id: true },
  });
  if (pending.length === 0) {
    res.json({ applied: 0, failed: 0 });
    return;
  }
  try {
    res.json(await applySuggestions(userId, pending.map((s) => s.id)));
  } catch (err: any) {
    if (err?.code === "NO_WRITE_SCOPE") {
      res.status(403).json({ error: "Reconnect Google to enable applying changes", code: "NO_WRITE_SCOPE" });
      return;
    }
    res.status(500).json({ error: "Failed to apply changes" });
  }
});

// POST /api/compare/suggestions/ignore — mute suggestions.
router.post("/suggestions/ignore", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const ids = parseIds((req.body as { ids?: unknown }).ids);
  if (!ids) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }
  const { count } = await prisma.suggestion.updateMany({
    where: { id: { in: ids }, status: "pending", group: { userId } },
    data: { status: "ignored", resolvedAt: new Date() },
  });
  res.json({ ignored: count });
});

export default router;
