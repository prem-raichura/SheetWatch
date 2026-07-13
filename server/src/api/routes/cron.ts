import { Router } from "express";
import prisma from "../../shared/prisma";
import { pollSheet, notifySheetChange } from "../../shared/poll";
import { sendDueDigests } from "../../shared/digest";
import { pruneSnapshots } from "../../shared/snapshots";
import { flushQueuedNotifications } from "../../shared/notify/dispatch";
import { sendDueReports } from "../../shared/reports";

const router = Router();

// Vercel Cron entry point. Vercel invokes this with
// `Authorization: Bearer ${CRON_SECRET}` (set CRON_SECRET in the project env).
// Polls every sheet that is due (lastCheckedAt older than its pollInterval)
// and sends notifications inline — no Redis/BullMQ needed on Vercel.
router.get("/poll", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sheets = await prisma.sheet.findMany({
    where: { paused: false, archivedAt: null },
    select: { id: true, pollInterval: true, lastCheckedAt: true },
  });

  const now = Date.now();
  const due = sheets.filter(
    (s) =>
      !s.lastCheckedAt ||
      now - s.lastCheckedAt.getTime() >= s.pollInterval * 1000
  );

  const results = await Promise.allSettled(
    due.map(async (s) => {
      const changeLogId = await pollSheet(s.id);
      if (changeLogId) await notifySheetChange(s.id, changeLogId);
      return changeLogId;
    })
  );

  const changed = results.filter(
    (r) => r.status === "fulfilled" && r.value !== null
  ).length;
  const failed = results.filter((r) => r.status === "rejected").length;

  const digests = await sendDueDigests().catch((err) => {
    console.error("Digest run failed:", err?.message ?? err);
    return 0;
  });
  await pruneSnapshots().catch((err) =>
    console.error("Snapshot prune failed:", err?.message ?? err)
  );
  const flushed = await flushQueuedNotifications().catch((err) => {
    console.error("Notification flush failed:", err?.message ?? err);
    return 0;
  });
  const reports = await sendDueReports().catch((err) => {
    console.error("Report run failed:", err?.message ?? err);
    return 0;
  });

  res.json({ checked: due.length, changed, failed, digests, flushed, reports });
});

export default router;
