import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { computeSuggestions, applySuggestions } from "../../shared/compare";
import { oauthClientFor } from "../../shared/google/oauthClient";
import {
  extractSpreadsheetId,
  validateAndSnapshot,
  fetchRange,
  buildRange,
  listTabs,
} from "../../shared/google/sheets";
import { listSpreadsheets } from "../../shared/google/drive";

const router = Router();

// Build a Google auth client for the request's user.
async function authFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return oauthClientFor(user);
}

function parseColumns(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((c) => typeof c === "string")) return null;
  return v.map((c) => c.trim()).filter(Boolean);
}

// A sheet chosen for a comparison. Compare stores these coordinates itself, so
// no tracking `Sheet` row is involved. Accepts either a raw spreadsheetId or a
// full Google Sheets URL.
interface SheetInput {
  spreadsheetId: string;
  tab: string | null;
  range: string;
}

function parseSheetInput(v: unknown): SheetInput | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const raw =
    typeof o.spreadsheetId === "string" && o.spreadsheetId.trim()
      ? o.spreadsheetId.trim()
      : typeof o.url === "string" && o.url.trim()
        ? o.url.trim()
        : null;
  if (!raw) return null;
  let spreadsheetId: string;
  try {
    spreadsheetId = raw.includes("/") ? extractSpreadsheetId(raw) : raw;
  } catch {
    return null;
  }
  const tab = typeof o.tab === "string" && o.tab.trim() ? o.tab.trim() : null;
  const range = typeof o.range === "string" && o.range.trim() ? o.range.trim() : "A1:Z1000";
  return { spreadsheetId, tab, range };
}

// Confirm the user can read the sheet and pull its authoritative title. Throws
// (403/404) up to the caller when access is missing.
async function resolveSheet(
  input: SheetInput,
  auth: Awaited<ReturnType<typeof authFor>>
): Promise<{ input: SheetInput; label: string }> {
  const { label } = await validateAndSnapshot(
    input.spreadsheetId,
    buildRange(input.tab, input.range),
    auth
  );
  return { input, label };
}

// GET /api/compare/drive-sheets — the user's Drive spreadsheets, for the picker.
router.get("/drive-sheets", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    const auth = await authFor(userId);
    const files = await listSpreadsheets(auth);
    res.json(
      files.map((f) => ({
        spreadsheetId: f.spreadsheetId,
        name: f.name,
        ownedByMe: f.ownedByMe,
        modifiedTime: f.modifiedTime,
      }))
    );
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 401 || status === 403) {
      res.status(403).json({ error: "Drive access not granted — sign out and sign in again." });
      return;
    }
    console.error("Compare drive-sheets error:", err);
    res.status(500).json({ error: "Failed to list your sheets" });
  }
});

// GET /api/compare/preview?spreadsheetId=&tab=&rows= — grid preview for pickers.
router.get("/preview", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const spreadsheetId = typeof req.query.spreadsheetId === "string" ? req.query.spreadsheetId : "";
  if (!spreadsheetId) {
    res.status(400).json({ error: "spreadsheetId required" });
    return;
  }
  const tab = (req.query.tab as string) || null;
  const rowsWanted = Math.min(Number(req.query.rows) || 60, 200);
  try {
    const auth = await authFor(userId);
    const rows = await fetchRange(spreadsheetId, buildRange(tab, `A1:Z${rowsWanted}`), auth);
    res.json({ rows, tab });
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 403 || status === 404) {
      res.status(status).json({ error: "Cannot read this sheet" });
      return;
    }
    console.error("Compare preview error:", err);
    res.status(500).json({ error: "Failed to load sheet preview" });
  }
});

// GET /api/compare/tabs?spreadsheetId= — tab titles for the tab dropdown.
router.get("/tabs", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const spreadsheetId = typeof req.query.spreadsheetId === "string" ? req.query.spreadsheetId : "";
  if (!spreadsheetId) {
    res.status(400).json({ error: "spreadsheetId required" });
    return;
  }
  try {
    const auth = await authFor(userId);
    res.json({ tabs: await listTabs(spreadsheetId, auth) });
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 403 || status === 404) {
      res.status(status).json({ error: "Cannot read this sheet" });
      return;
    }
    console.error("Compare tabs error:", err);
    res.status(500).json({ error: "Failed to list tabs" });
  }
});

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
    include: { targets: true },
  });

  const counts = await prisma.suggestion.groupBy({
    by: ["groupId", "status"],
    where: { group: { userId } },
    _count: true,
  });
  const pendingBy = new Map<string, number>();
  for (const c of counts) {
    if (c.status === "pending") pendingBy.set(c.groupId, c._count);
  }
  const conflicts = await prisma.suggestion.groupBy({
    by: ["groupId"],
    where: { group: { userId }, status: "pending", conflict: true },
    _count: true,
  });
  const conflictBy = new Map<string, number>();
  for (const c of conflicts) conflictBy.set(c.groupId, c._count);

  res.json(
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      enabled: g.enabled,
      keyColumn: g.keyColumn,
      compareColumns: g.compareColumns,
      master: {
        id: g.masterSpreadsheetId,
        label: g.masterLabel,
        spreadsheetId: g.masterSpreadsheetId,
        tab: g.masterTab,
      },
      targets: g.targets.map((t) => ({
        id: t.id,
        label: t.label,
        spreadsheetId: t.spreadsheetId,
        tab: t.tab,
      })),
      pendingCount: pendingBy.get(g.id) ?? 0,
      conflictCount: conflictBy.get(g.id) ?? 0,
      lastCheckedAt: g.lastCheckedAt,
      createdAt: g.createdAt,
    }))
  );
});

// POST /api/compare/groups — create a comparison group from picked sheets.
router.post("/groups", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { name, master, targets, keyColumn, compareColumns } = req.body as {
    name?: unknown;
    master?: unknown;
    targets?: unknown;
    keyColumn?: unknown;
    compareColumns?: unknown;
  };

  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
    res.status(400).json({ error: "name must be 1–80 characters" });
    return;
  }
  const masterInput = parseSheetInput(master);
  if (!masterInput) {
    res.status(400).json({ error: "master sheet is required" });
    return;
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    res.status(400).json({ error: "at least one target sheet is required" });
    return;
  }
  const targetInputs = targets.map(parseSheetInput);
  if (targetInputs.some((t) => t === null)) {
    res.status(400).json({ error: "invalid target sheet" });
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

  try {
    const auth = await authFor(userId);
    const masterResolved = await resolveSheet(masterInput, auth);
    const targetsResolved = await Promise.all(
      (targetInputs as SheetInput[]).map((t) => resolveSheet(t, auth))
    );

    const group = await prisma.comparisonGroup.create({
      data: {
        userId,
        name: name.trim(),
        masterSpreadsheetId: masterInput.spreadsheetId,
        masterTab: masterInput.tab,
        masterRange: masterInput.range,
        masterLabel: masterResolved.label,
        keyColumn: typeof keyColumn === "string" && keyColumn.trim() ? keyColumn.trim() : null,
        compareColumns: cols,
        targets: {
          create: targetsResolved.map((t) => ({
            spreadsheetId: t.input.spreadsheetId,
            tab: t.input.tab,
            range: t.input.range,
            label: t.label,
          })),
        },
      },
    });
    await computeSuggestions(group.id).catch(() => {});
    res.status(201).json({ id: group.id });
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 403) {
      res.status(403).json({ error: "No access to one of the sheets" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: "A sheet was not found" });
      return;
    }
    console.error("Compare create group error:", err);
    res.status(500).json({ error: "Failed to create comparison" });
  }
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
  const { name, enabled, keyColumn, compareColumns, targets } = req.body as {
    name?: unknown;
    enabled?: unknown;
    keyColumn?: unknown;
    compareColumns?: unknown;
    targets?: unknown;
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

  let newTargets:
    | { spreadsheetId: string; tab: string | null; range: string; label: string }[]
    | null = null;
  if (targets !== undefined) {
    if (!Array.isArray(targets) || targets.length === 0) {
      res.status(400).json({ error: "at least one target sheet is required" });
      return;
    }
    const inputs = targets.map(parseSheetInput);
    if (inputs.some((t) => t === null)) {
      res.status(400).json({ error: "invalid target sheet" });
      return;
    }
    try {
      const auth = await authFor(userId);
      const resolved = await Promise.all(
        (inputs as SheetInput[]).map((t) => resolveSheet(t, auth))
      );
      newTargets = resolved.map((t) => ({
        spreadsheetId: t.input.spreadsheetId,
        tab: t.input.tab,
        range: t.input.range,
        label: t.label,
      }));
    } catch (err: any) {
      const status = err?.code ?? err?.status ?? err?.response?.status;
      if (status === 403) {
        res.status(403).json({ error: "No access to one of the sheets" });
        return;
      }
      if (status === 404) {
        res.status(404).json({ error: "A sheet was not found" });
        return;
      }
      console.error("Compare patch validate error:", err);
      res.status(500).json({ error: "Failed to update comparison" });
      return;
    }
  }

  if (newTargets) {
    // Replacing targets drops their suggestions (cascade) — recompute repopulates.
    await prisma.comparisonTarget.deleteMany({ where: { groupId: group.id } });
    await prisma.comparisonTarget.createMany({
      data: newTargets.map((t) => ({ groupId: group.id, ...t })),
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
  });
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  try {
    const auth = await authFor(userId);
    const rows = await fetchRange(
      group.masterSpreadsheetId,
      buildRange(group.masterTab, "A1:Z1"),
      auth
    );
    const header = (rows[0] ?? []) as string[];
    res.json({ columns: header.filter((h) => typeof h === "string" && h.trim()) });
  } catch (err: any) {
    console.error("Compare columns error:", err);
    res.json({ columns: [] });
  }
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
    include: { target: { select: { id: true, label: true } } },
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
        s.target.label.toLowerCase().includes(needle)
    )
    .map((s) => ({
      id: s.id,
      target: s.target,
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
