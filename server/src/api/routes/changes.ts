import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { changesToCsv } from "../../shared/csv";
import { CellChange } from "../../shared/types";

const router = Router();

// GitHub-style heatmap buckets: change counts per local day. The user's
// timezone shifts bucket boundaries; UTC when unset/invalid.
router.get("/heatmap", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const sheetId = (req.query.sheetId as string) || null;
  const days = Math.min(Math.max(Number(req.query.days) || 365, 7), 400);
  let tz = (req.query.tz as string) || "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    tz = "UTC";
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<{ day: string; count: bigint }[]>`
    SELECT to_char(("ChangeLog"."createdAt" AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day,
           count(*) AS count
    FROM "ChangeLog"
    JOIN "Sheet" ON "Sheet"."id" = "ChangeLog"."sheetId"
    WHERE "Sheet"."userId" = ${userId}
      AND "ChangeLog"."createdAt" >= ${since}
      AND (${sheetId}::text IS NULL OR "ChangeLog"."sheetId" = ${sheetId})
    GROUP BY 1
    ORDER BY 1
  `;

  res.json(rows.map((r) => ({ date: r.day, count: Number(r.count) })));
});

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const q = ((req.query.q as string) ?? "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  if (!q) {
    const changes = await prisma.changeLog.findMany({
      where: { sheet: { userId } },
      include: {
        sheet: { select: { label: true, spreadsheetId: true, archivedAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json(changes);
    return;
  }

  // Search scans the most recent 200 changes in memory — details is a JSON
  // array, which Prisma can't filter by cell values server-side.
  const recent = await prisma.changeLog.findMany({
    where: { sheet: { userId } },
    include: {
      sheet: { select: { label: true, spreadsheetId: true, archivedAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const matches = recent.filter((change) => {
    if (change.summary.toLowerCase().includes(q)) return true;
    if (change.sheet.label.toLowerCase().includes(q)) return true;
    const details = (change.details as unknown as CellChange[]) ?? [];
    return details.some(
      (d) =>
        d.cell.toLowerCase().includes(q) ||
        d.before.toLowerCase().includes(q) ||
        d.after.toLowerCase().includes(q)
    );
  });

  res.json(matches.slice(0, 50));
});

// Unread changes power the in-app bell. Sheets are single-owner, so a
// timestamp on the change row is enough — no per-user read table.
router.get("/unread-count", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const count = await prisma.changeLog.count({
    where: { sheet: { userId }, readAt: null },
  });
  res.json({ count });
});

router.get("/unread", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const changes = await prisma.changeLog.findMany({
    where: { sheet: { userId }, readAt: null },
    include: { sheet: { select: { label: true, spreadsheetId: true, archivedAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  res.json(changes);
});

router.post("/mark-read", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { ids } = req.body as { ids?: string[] };
  const result = await prisma.changeLog.updateMany({
    where: {
      sheet: { userId },
      readAt: null,
      ...(Array.isArray(ids) && ids.length > 0 && { id: { in: ids } }),
    },
    data: { readAt: new Date() },
  });
  res.json({ marked: result.count });
});

router.get("/export.csv", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const changes = await prisma.changeLog.findMany({
    where: { sheet: { userId } },
    include: { sheet: { select: { label: true } } },
    orderBy: { createdAt: "asc" },
  });
  const header = "sheet,changeId,detectedAt,summary,cell,before,after";
  const labelById = new Map(changes.map((c) => [c.id, c.sheet.label]));
  const body = changesToCsv(changes, (c) => [labelById.get(c.id) ?? ""]);
  res
    .type("text/csv; charset=utf-8")
    .set("Content-Disposition", 'attachment; filename="sheetwatch-all-changes.csv"')
    .send(`${header}\n${body}\n`);
});

export default router;
