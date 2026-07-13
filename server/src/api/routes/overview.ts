import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const weekAgo = new Date(startOfDay);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const [tracked, paused, errored, projects, changesToday, last, recentWeek] = await Promise.all([
    prisma.sheet.count({ where: { userId, archivedAt: null } }),
    prisma.sheet.count({ where: { userId, archivedAt: null, paused: true } }),
    prisma.sheet.count({
      where: {
        userId,
        archivedAt: null,
        errorMessage: { not: null },
        // Transient Google blips clear themselves next poll — don't alarm.
        NOT: { errorMessage: { startsWith: "Google API temporarily unreachable" } },
      },
    }),
    prisma.project.count({ where: { userId } }),
    prisma.changeLog.count({
      where: { sheet: { userId }, createdAt: { gte: startOfDay } },
    }),
    prisma.changeLog.findFirst({
      where: { sheet: { userId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.changeLog.findMany({
      where: { sheet: { userId }, createdAt: { gte: weekAgo } },
      select: { createdAt: true },
    }),
  ]);

  // Bucket the past 7 days (local time), oldest first.
  const daily: { date: string; count: number }[] = [];
  const counts = new Map<string, number>();
  for (const c of recentWeek) {
    const d = new Date(c.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekAgo);
    d.setDate(d.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    daily.push({ date: key, count: counts.get(key) ?? 0 });
  }

  res.json({
    tracked,
    paused,
    active: tracked - paused,
    errored,
    projects,
    changesToday,
    lastChangeAt: last?.createdAt ?? null,
    daily,
  });
});

export default router;
