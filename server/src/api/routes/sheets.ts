import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { oauthClientFor } from "../../shared/google/oauthClient";
import {
  extractSpreadsheetId,
  validateAndSnapshot,
  fetchScoped,
  fetchRange,
  buildRange,
  listTabs,
} from "../../shared/google/sheets";
import {
  listSpreadsheets,
  trashSpreadsheet,
  restoreSpreadsheet,
  deleteSpreadsheetForever,
  listTrashedSpreadsheets,
} from "../../shared/google/drive";
import { hashGrid, diffGrid } from "../../shared/google/diff";
import { changesToCsv } from "../../shared/csv";
import { validateRules, normalizeToV2, AlertRule, AlertRulesV2 } from "../../shared/rules";
import {
  scheduleSheetPoll,
  unscheduleSheetPoll,
} from "../../shared/queues";
import { checkSheetNow } from "../../shared/checkNow";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheets = await prisma.sheet.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      project: { select: { id: true, name: true, color: true } },
      webhooks: { select: { webhookId: true } },
    },
  });
  res.json(
    sheets.map(({ webhooks, ...s }) => ({
      ...s,
      webhookIds: webhooks.map((w) => w.webhookId),
    }))
  );
});

router.get("/available", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    const [files, tracked] = await Promise.all([
      listSpreadsheets(auth),
      prisma.sheet.findMany({
        where: { userId, archivedAt: null },
        select: { id: true, spreadsheetId: true },
      }),
    ]);

    const trackedMap = new Map(tracked.map((s) => [s.spreadsheetId, s.id]));

    const result = files.map((f) => ({
      spreadsheetId: f.spreadsheetId,
      name: f.name,
      ownedByMe: f.ownedByMe,
      modifiedTime: f.modifiedTime,
      tracked: trackedMap.has(f.spreadsheetId),
      sheetId: trackedMap.get(f.spreadsheetId) ?? null,
    }));

    res.json(result);
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 401 || status === 403) {
      res.status(403).json({ error: "Drive access not granted — sign out and sign in again." });
      return;
    }
    console.error("List available error:", err);
    res.status(500).json({ error: "Failed to list your sheets" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { url, spreadsheetId: bodyId, projectId } = req.body as {
    url?: string;
    spreadsheetId?: string;
    projectId?: string;
  };

  if (!url && !bodyId) {
    res.status(400).json({ error: "url or spreadsheetId required" });
    return;
  }

  try {
    const spreadsheetId = bodyId ?? extractSpreadsheetId(url!);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    const { label, rows } = await validateAndSnapshot(spreadsheetId, "A1:Z1000", auth);

    // Untracked earlier? Revive the archived row so its change history
    // reattaches, with a fresh baseline so the gap doesn't fire as one
    // giant change.
    const archived = await prisma.sheet.findFirst({
      where: { userId, spreadsheetId, archivedAt: { not: null } },
    });
    if (archived) {
      const revived = await prisma.sheet.update({
        where: { id: archived.id },
        data: {
          archivedAt: null,
          paused: false,
          label,
          ...(projectId && { projectId }),
          lastHash: hashGrid(rows),
          lastSnapshot: rows,
          lastCheckedAt: new Date(),
          errorMessage: null,
        },
      });
      await scheduleSheetPoll(revived);
      res.status(201).json(revived);
      return;
    }

    // Inherit notification defaults from the project, if one is assigned.
    let notifyEmail = true;
    let notifyPush = true;
    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { notifyEmail: true, notifyPush: true },
      });
      if (project) {
        notifyEmail = project.notifyEmail;
        notifyPush = project.notifyPush;
      }
    }

    // Append after existing sheets so manual ordering is preserved.
    const maxOrder = await prisma.sheet.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });

    const sheet = await prisma.sheet.create({
      data: {
        userId,
        spreadsheetId,
        label,
        ...(projectId && { projectId }),
        notifyEmail,
        notifyPush,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        lastHash: hashGrid(rows),
        lastSnapshot: rows,
        lastCheckedAt: new Date(),
      },
    });

    await scheduleSheetPoll(sheet);

    res.status(201).json(sheet);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Sheet already tracked" });
      return;
    }
    if (err.message === "Not a valid Google Sheets URL") {
      res.status(400).json({ error: err.message });
      return;
    }
    const status = err.code ?? err.status ?? err?.response?.status;
    if (status === 403) {
      res.status(403).json({ error: "No access to this sheet" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    console.error("Add sheet error:", err);
    res.status(500).json({ error: "Failed to add sheet" });
  }
});

// Reorder sheets and/or move them between projects. Body carries the full
// desired order of the affected groups: for each group, the listed sheets get
// projectId = group.projectId and sortOrder = their index. Sending source +
// target groups makes this a move-between-projects operation too.
router.post("/reorder", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { groups } = req.body as {
    groups?: { projectId: string | null; ids: unknown }[];
  };

  if (!Array.isArray(groups) || groups.length === 0) {
    res.status(400).json({ error: "groups must be a non-empty array" });
    return;
  }

  const allIds: string[] = [];
  for (const g of groups) {
    if (!g || (g.projectId !== null && typeof g.projectId !== "string")) {
      res.status(400).json({ error: "each group needs a projectId (string or null)" });
      return;
    }
    if (!Array.isArray(g.ids) || !g.ids.every((id) => typeof id === "string")) {
      res.status(400).json({ error: "each group needs an ids array of strings" });
      return;
    }
    allIds.push(...(g.ids as string[]));
  }

  // Every sheet must belong to the user (and, when moving into a project, the
  // project must be theirs too).
  const owned = await prisma.sheet.findMany({
    where: { id: { in: allIds }, userId, archivedAt: null },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((s) => s.id));
  if (!allIds.every((id) => ownedIds.has(id))) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }

  const targetProjectIds = groups
    .map((g) => g.projectId)
    .filter((p): p is string => typeof p === "string");
  if (targetProjectIds.length > 0) {
    const projects = await prisma.project.findMany({
      where: { id: { in: targetProjectIds }, userId },
      select: { id: true },
    });
    const projectIds = new Set(projects.map((p) => p.id));
    if (!targetProjectIds.every((id) => projectIds.has(id))) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
  }

  await prisma.$transaction(
    groups.flatMap((g) =>
      (g.ids as string[]).map((id, index) =>
        prisma.sheet.update({
          where: { id, userId },
          data: { projectId: g.projectId, sortOrder: index },
        })
      )
    )
  );
  res.json({ ok: true });
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const body = req.body as {
    notifyEmail?: boolean;
    notifyPush?: boolean;
    paused?: boolean;
    label?: string;
    projectId?: string | null;
    tab?: string | null;
    range?: string;
    watchMode?: string;
    matchColumn?: string | null;
    matchValue?: string | null;
    pollInterval?: number;
    snoozedUntil?: string | null;
    alertColumns?: string[];
    alertRules?: AlertRule[] | AlertRulesV2 | null;
    webhookIds?: string[];
  };

  if (
    body.pollInterval !== undefined &&
    (!Number.isInteger(body.pollInterval) ||
      body.pollInterval < 60 ||
      body.pollInterval > 86400)
  ) {
    res.status(400).json({ error: "pollInterval must be 60–86400 seconds" });
    return;
  }
  if (body.snoozedUntil != null && Number.isNaN(Date.parse(body.snoozedUntil))) {
    res.status(400).json({ error: "snoozedUntil must be an ISO date string or null" });
    return;
  }
  if (body.alertColumns !== undefined) {
    if (
      !Array.isArray(body.alertColumns) ||
      !body.alertColumns.every((c) => typeof c === "string" && /^[A-Za-z]{1,3}$/.test(c.trim()))
    ) {
      res.status(400).json({ error: "alertColumns must be column letters (A, C, AA)" });
      return;
    }
  }
  if (body.alertRules !== undefined && body.alertRules !== null) {
    const owned = await prisma.webhook.findMany({ where: { userId }, select: { id: true } });
    const ruleError = validateRules(body.alertRules, new Set(owned.map((w) => w.id)));
    if (ruleError) {
      res.status(400).json({ error: ruleError });
      return;
    }
  }

  try {
    const existing = await prisma.sheet.findFirst({
      where: { id: req.params.id, userId, archivedAt: null },
    });
    if (!existing) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    // webhookIds: replace the attached set; every id must be the caller's.
    if (body.webhookIds !== undefined) {
      if (!Array.isArray(body.webhookIds) || !body.webhookIds.every((w) => typeof w === "string")) {
        res.status(400).json({ error: "webhookIds must be an array of ids" });
        return;
      }
      const owned = await prisma.webhook.count({
        where: { id: { in: body.webhookIds }, userId },
      });
      if (owned !== new Set(body.webhookIds).size) {
        res.status(400).json({ error: "Unknown webhook id" });
        return;
      }
    }

    // projectId must reference the caller's own project.
    if (typeof body.projectId === "string") {
      const project = await prisma.project.findFirst({
        where: { id: body.projectId, userId },
        select: { id: true },
      });
      if (!project) {
        res.status(400).json({ error: "Project not found" });
        return;
      }
    }

    const scopeChanged =
      (body.tab !== undefined && body.tab !== existing.tab) ||
      (body.range !== undefined && body.range !== existing.range) ||
      (body.watchMode !== undefined && body.watchMode !== existing.watchMode) ||
      (body.matchColumn !== undefined && body.matchColumn !== existing.matchColumn) ||
      (body.matchValue !== undefined && body.matchValue !== existing.matchValue);

    const data: Record<string, unknown> = {
      ...(body.notifyEmail !== undefined && { notifyEmail: body.notifyEmail }),
      ...(body.notifyPush !== undefined && { notifyPush: body.notifyPush }),
      ...(body.paused !== undefined && { paused: body.paused }),
      ...(body.label !== undefined && { label: body.label.trim() || existing.label }),
      ...(body.projectId !== undefined && { projectId: body.projectId }),
      ...(body.tab !== undefined && { tab: body.tab }),
      ...(body.range !== undefined && { range: body.range.trim() || "A1:Z1000" }),
      ...(body.watchMode !== undefined && { watchMode: body.watchMode }),
      ...(body.matchColumn !== undefined && { matchColumn: body.matchColumn }),
      ...(body.matchValue !== undefined && { matchValue: body.matchValue }),
      ...(body.pollInterval !== undefined && { pollInterval: body.pollInterval }),
      ...(body.snoozedUntil !== undefined && {
        snoozedUntil: body.snoozedUntil === null ? null : new Date(body.snoozedUntil),
      }),
      ...(body.alertColumns !== undefined && {
        alertColumns: [...new Set(body.alertColumns.map((c) => c.trim().toUpperCase()))],
      }),
      // Both v1 arrays and v2 group objects are accepted; storage is always
      // normalized v2 (or cleared when empty).
      ...(body.alertRules !== undefined && {
        alertRules: (() => {
          const v2 = body.alertRules === null ? null : normalizeToV2(body.alertRules);
          return v2 === null ? Prisma.DbNull : (v2 as unknown as Prisma.InputJsonValue);
        })(),
      }),
    };

    // Re-baseline against the new scope so the next poll doesn't fire spuriously.
    if (scopeChanged) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const auth = oauthClientFor(user);
      const merged = { ...existing, ...data } as typeof existing;
      const rows = await fetchScoped(
        {
          spreadsheetId: merged.spreadsheetId,
          tab: merged.tab,
          range: merged.range,
          watchMode: merged.watchMode,
          matchColumn: merged.matchColumn,
          matchValue: merged.matchValue,
        },
        auth
      );
      data.lastHash = hashGrid(rows);
      data.lastSnapshot = rows;
      data.lastCheckedAt = new Date();
      data.errorMessage = null;
    }

    if (body.webhookIds !== undefined) {
      await prisma.$transaction([
        prisma.sheetWebhook.deleteMany({ where: { sheetId: req.params.id } }),
        prisma.sheetWebhook.createMany({
          data: [...new Set(body.webhookIds)].map((webhookId) => ({
            sheetId: req.params.id,
            webhookId,
          })),
        }),
      ]);
    }

    const sheet = await prisma.sheet.update({
      where: { id: req.params.id, userId },
      data,
      include: {
        project: { select: { id: true, name: true, color: true } },
        webhooks: { select: { webhookId: true } },
      },
    });

    // Pause/resume: drop or (re)create the repeatable poll job.
    if (body.paused !== undefined && body.paused !== existing.paused) {
      if (body.paused) {
        await unscheduleSheetPoll(sheet.id);
      } else {
        await scheduleSheetPoll(sheet);
      }
    } else if (
      !sheet.paused &&
      body.pollInterval !== undefined &&
      body.pollInterval !== existing.pollInterval
    ) {
      // Reschedule the poll job if the interval changed (and not paused).
      await scheduleSheetPoll(sheet);
    }

    const { webhooks, ...rest } = sheet;
    res.json({ ...rest, webhookIds: webhooks.map((w) => w.webhookId) });
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 400) {
      res.status(400).json({ error: "Invalid range or tab for this sheet" });
      return;
    }
    console.error("Update sheet error:", err);
    res.status(500).json({ error: "Failed to update sheet" });
  }
});

router.get("/:id/tabs", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    const sheet = await prisma.sheet.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    const tabs = await listTabs(sheet.spreadsheetId, auth);
    res.json(tabs);
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 403 || status === 404) {
      res.status(status).json({ error: "Cannot read this sheet's tabs" });
      return;
    }
    console.error("List tabs error:", err);
    res.status(500).json({ error: "Failed to list tabs" });
  }
});

// Grid preview for the visual range picker: first rows × 26 cols of a tab.
router.get("/:id/preview", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const tab = (req.query.tab as string) || null;
  const rowsWanted = Math.min(Number(req.query.rows) || 60, 200);
  try {
    const sheet = await prisma.sheet.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    const rows = await fetchRange(
      sheet.spreadsheetId,
      buildRange(tab, `A1:Z${rowsWanted}`),
      auth
    );
    res.json({ rows, tab });
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 403 || status === 404) {
      res.status(status).json({ error: "Cannot read this sheet" });
      return;
    }
    console.error("Preview error:", err);
    res.status(500).json({ error: "Failed to load sheet preview" });
  }
});

router.post("/:id/check", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheet = await prisma.sheet.findFirst({
    where: { id: req.params.id, userId, archivedAt: null },
    select: { id: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }
  // One-off poll now: queued when a worker is running, inline otherwise.
  await checkSheetNow(sheet.id);
  res.json({ ok: true });
});

// Drive trash helpers share one error shape.
function driveErrorResponse(res: any, err: any, fallback: string): void {
  const status = err?.code ?? err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) {
    res.status(403).json({
      error: "Drive permission missing — sign out and sign in again to grant it.",
    });
    return;
  }
  if (status === 404) {
    res.status(404).json({ error: "File not found in Drive" });
    return;
  }
  console.error(`${fallback}:`, err);
  res.status(500).json({ error: fallback });
}

// Spreadsheets sitting in the Drive bin.
router.get("/drive/trash", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    const files = await listTrashedSpreadsheets(auth);
    res.json(files);
  } catch (err: any) {
    driveErrorResponse(res, err, "Couldn’t load the Drive bin");
  }
});

router.post("/drive/:spreadsheetId/restore", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    await restoreSpreadsheet(req.params.spreadsheetId, auth);
    res.json({ ok: true });
  } catch (err: any) {
    driveErrorResponse(res, err, "Couldn’t restore the sheet");
  }
});

// Permanent delete — no recovery. Client double-confirms.
router.delete("/drive/:spreadsheetId/forever", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    await deleteSpreadsheetForever(req.params.spreadsheetId, auth);
    res.json({ ok: true });
  } catch (err: any) {
    driveErrorResponse(res, err, "Couldn’t delete the sheet permanently");
  }
});

// Move the actual Google Drive file to trash, and untrack it if watched.
router.delete("/drive/:spreadsheetId", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const spreadsheetId = req.params.spreadsheetId;
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const auth = oauthClientFor(user);
    await trashSpreadsheet(spreadsheetId, auth);

    // Stop watching it too — polling a trashed sheet would just error.
    // Archive (not delete) so activity history survives.
    const tracked = await prisma.sheet.findFirst({
      where: { userId, spreadsheetId, archivedAt: null },
      select: { id: true },
    });
    if (tracked) {
      await prisma.sheet.update({
        where: { id: tracked.id },
        data: { archivedAt: new Date() },
      });
      await unscheduleSheetPoll(tracked.id);
    }

    res.json({ ok: true, untracked: !!tracked });
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;
    if (status === 401 || status === 403) {
      res.status(403).json({
        error: "Drive delete permission missing — sign out and sign in again to grant it.",
      });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: "File not found in Drive" });
      return;
    }
    console.error("Trash sheet error:", err);
    res.status(500).json({ error: "Couldn’t move the sheet to trash" });
  }
});

// Untrack = archive. Change history stays and reattaches if the sheet is
// tracked again later.
router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    await prisma.sheet.update({
      where: { id: req.params.id, userId },
      data: { archivedAt: new Date() },
    });
    await unscheduleSheetPoll(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Sheet not found" });
  }
});

router.get("/:id/changes.csv", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheet = await prisma.sheet.findFirst({
    where: { id: req.params.id, userId },
    select: { label: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }
  const changes = await prisma.changeLog.findMany({
    where: { sheetId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  const slug = sheet.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sheet";
  const header = "changeId,detectedAt,summary,cell,before,after";
  res
    .type("text/csv; charset=utf-8")
    .set("Content-Disposition", `attachment; filename="sheetwatch-${slug}-history.csv"`)
    .send(`${header}\n${changesToCsv(changes)}\n`);
});

// Diff-viewer context: the change plus a window of the current snapshot
// around the touched cells.
router.get("/:id/changes/:changeId/context", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheet = await prisma.sheet.findFirst({
    where: { id: req.params.id, userId },
    select: { range: true, lastSnapshot: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }
  const change = await prisma.changeLog.findFirst({
    where: { id: req.params.changeId, sheetId: req.params.id },
  });
  if (!change) {
    res.status(404).json({ error: "Change not found" });
    return;
  }

  const details = (change.details as unknown as { cell: string }[]) ?? [];
  const rowNums = details
    .map((d) => /^R(\d+)C\d+$/.exec(d.cell))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]));

  const rows = (sheet.lastSnapshot as string[][] | null) ?? [];
  const CONTEXT = 3;
  const MAX_ROWS = 60;
  const minRow = rowNums.length ? Math.max(1, Math.min(...rowNums) - CONTEXT) : 1;
  const maxRow = rowNums.length
    ? Math.min(rows.length, Math.max(...rowNums) + CONTEXT, minRow + MAX_ROWS - 1)
    : Math.min(rows.length, MAX_ROWS);

  res.json({
    change,
    range: sheet.range,
    startRow: minRow, // 1-based, relative to the fetched grid
    rows: rows.slice(minRow - 1, maxRow),
  });
});

// --- Snapshots (time travel) ---

router.get("/:id/snapshots", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheet = await prisma.sheet.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }
  const snapshots = await prisma.snapshot.findMany({
    where: { sheetId: sheet.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, hash: true, createdAt: true },
    take: 100,
  });
  res.json(snapshots);
});

// Diff any two snapshots (a = older, b = newer by convention; the diff is
// computed a → b either way).
router.get("/:id/snapshots/compare", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { a, b } = req.query as { a?: string; b?: string };
  if (!a || !b) {
    res.status(400).json({ error: "a and b snapshot ids are required" });
    return;
  }
  const sheet = await prisma.sheet.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }
  const [snapA, snapB] = await Promise.all([
    prisma.snapshot.findFirst({ where: { id: a, sheetId: sheet.id } }),
    prisma.snapshot.findFirst({ where: { id: b, sheetId: sheet.id } }),
  ]);
  if (!snapA || !snapB) {
    res.status(404).json({ error: "Snapshot not found" });
    return;
  }
  const rowsA = (snapA.rows as unknown as string[][]) ?? [];
  const rowsB = (snapB.rows as unknown as string[][]) ?? [];
  res.json({
    a: { id: snapA.id, createdAt: snapA.createdAt },
    b: { id: snapB.id, createdAt: snapB.createdAt },
    rows: rowsB,
    diff: diffGrid(rowsA, rowsB),
  });
});

router.get("/:id/snapshots/:snapId", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheet = await prisma.sheet.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true, lastSnapshot: true },
  });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }
  const snapshot = await prisma.snapshot.findFirst({
    where: { id: req.params.snapId, sheetId: sheet.id },
  });
  if (!snapshot) {
    res.status(404).json({ error: "Snapshot not found" });
    return;
  }
  const rows = (snapshot.rows as unknown as string[][]) ?? [];
  const current = (sheet.lastSnapshot as string[][] | null) ?? [];
  res.json({
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    rows,
    diffToCurrent: diffGrid(rows, current),
  });
});

router.get("/:id/changes", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheet = await prisma.sheet.findFirst({ where: { id: req.params.id, userId } });
  if (!sheet) {
    res.status(404).json({ error: "Sheet not found" });
    return;
  }
  const changes = await prisma.changeLog.findMany({
    where: { sheetId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(changes);
});

export default router;
