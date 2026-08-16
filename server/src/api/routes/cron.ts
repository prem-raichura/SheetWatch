import { Router, type RequestHandler } from "express";
import { timingSafeEqual } from "crypto";
import prisma from "../../shared/prisma";
import { pollSheet, notifySheetChange } from "../../shared/poll";
import { sendDueDigests } from "../../shared/digest";
import { pruneSnapshots } from "../../shared/snapshots";
import { flushQueuedNotifications } from "../../shared/notify/dispatch";
import { sendDueReports } from "../../shared/reports";
import { recomputeAllGroups } from "../../shared/compare";

// Scheduler entry points — together these replace the BullMQ worker in the
// serverless deployment. Upstash QStash (or Vercel Cron) calls them on a fixed
// schedule with `Authorization: Bearer ${CRON_SECRET}`. No Redis involved.
//
// Deliberately split into two endpoints on independent schedules:
//
//   /poll        — sheets only. Parallel, short, safe to run every minute.
//   /integrity   — integrity checks that are due, on their own schedule for the
//                  same reason sheets have one: they read Google live per
//                  target, so they must not share a time budget with polling.
//                  Run it every minute — that's the shortest cadence a check
//                  can be set to, and each check only runs when it's due.
//   /maintenance — digests, reports, snapshot prune, quiet-hours flush.
//
// ALL THREE must be scheduled. Pointing a single schedule at /poll silently
// leaves digests, reports and integrity checks dead. See DEPLOY.md.
//
// Every route is mounted on GET and POST: QStash publishes with POST by
// default, Vercel Cron and manual curl checks use GET.
const router = Router();

// Constant-time bearer-token check — avoids leaking CRON_SECRET via response
// timing. Length is compared first (timingSafeEqual throws on length mismatch).
function authorized(header: string | undefined, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const requireCronAuth: RequestHandler = (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(req.headers.authorization, secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

router.use(requireCronAuth);

// Claim a sheet for this run by advancing lastCheckedAt, but only if no one
// else has touched it since we read it. Overlapping cron runs are a real
// possibility at short intervals — a run that takes longer than the schedule
// period is still working when the next fires — and without this both runs see
// the same sheet as due, both poll it, and both raise a ChangeLog and a
// notification for one edit.
//
// Losing the race is not an error: it means another run owns this sheet.
//
// Note this advances lastCheckedAt *before* the fetch, so a sheet whose poll
// then fails waits a full interval before being retried. That matches what
// pollSheet already does on transient Google errors, deliberately, to stop a
// broken sheet from being hammered every tick.
async function claimSheet(id: string, lastCheckedAt: Date | null): Promise<boolean> {
  const { count } = await prisma.sheet.updateMany({
    // Compare-and-swap: `lastCheckedAt: null` compiles to IS NULL, so a
    // never-polled sheet is matched correctly too.
    where: { id, lastCheckedAt },
    data: { lastCheckedAt: new Date() },
  });
  return count === 1;
}

// Poll every sheet whose lastCheckedAt is older than its pollInterval, and
// notify inline. Sheets are polled in parallel; the per-sheet work is one
// Google read plus a diff, so this stays well inside the function budget.
const pollHandler: RequestHandler = async (_req, res) => {
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

  const claims = await Promise.all(
    due.map(async (s) => ((await claimSheet(s.id, s.lastCheckedAt)) ? s.id : null))
  );
  const claimed = claims.filter((id): id is string => id !== null);

  const results = await Promise.allSettled(
    claimed.map(async (id) => {
      const changeLogId = await pollSheet(id);
      if (changeLogId) await notifySheetChange(id, changeLogId);
      return changeLogId;
    })
  );

  const changed = results.filter(
    (r) => r.status === "fulfilled" && r.value !== null
  ).length;
  const failed = results.filter((r) => r.status === "rejected").length;

  res.json({
    due: due.length,
    checked: claimed.length,
    // Non-zero means another run was still going when this one started — a
    // sign the schedule is tighter than a run actually takes.
    skipped: due.length - claimed.length,
    changed,
    failed,
  });
};

// Everything the worker's 5-minute setInterval owns, plus the compare sweep the
// dedicated compare worker owns. Slow and mostly sequential — keep it on its
// own, slacker schedule.
const maintenanceHandler: RequestHandler = async (_req, res) => {
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

  res.json({ digests, flushed, reports });
};

// Integrity checks — the no-BullMQ equivalent of the per-check repeatable jobs
// (`integrity:{groupId}`). recomputeAllGroups() runs only the checks whose own
// interval is up, so calling this every minute honours a "1 min" setting
// without re-reading every sheet on every tick.
const integrityHandler: RequestHandler = async (_req, res) => {
  await recomputeAllGroups().catch((err) =>
    console.error("Integrity run failed:", err?.message ?? err)
  );
  res.json({ ok: true });
};

router.get("/poll", pollHandler);
router.post("/poll", pollHandler);
router.get("/integrity", integrityHandler);
router.post("/integrity", integrityHandler);
router.get("/maintenance", maintenanceHandler);
router.post("/maintenance", maintenanceHandler);

export default router;
