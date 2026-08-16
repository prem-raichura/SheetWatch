// This process *is* the BullMQ backend, so it declares the mode itself rather
// than trusting the environment to say so. Without this, a .env missing
// WORKER_MODE would leave every scheduleSheetPoll/scheduleIntegrityCheck call a
// no-op and the worker would sit idle with nothing to drain — silently.
process.env.WORKER_MODE = "bullmq";

import "../shared/env";
import { createPollWorker } from "./pollWorker";
import { createNotifyWorker } from "./notifyWorker";
import { createCompareWorker } from "./compareWorker";
import { ensureAllIntegrityJobs, ensureAllSheetJobs } from "./scheduler";
import { startHeartbeat, recordStopped } from "./heartbeat";
import { noteReconcile, noteReconcileError } from "./state";
import { pruneOps } from "../shared/ops";
import { rollupOps, pruneRollups } from "../shared/opsRollup";
import { sendDueDigests } from "../shared/digest";
import { pruneSnapshots } from "../shared/snapshots";
import { flushQueuedNotifications } from "../shared/notify/dispatch";
import { sendDueReports } from "../shared/reports";

const pollWorker = createPollWorker();
const notifyWorker = createNotifyWorker();
const compareWorker = createCompareWorker();

pollWorker.on("failed", (job, err) => {
  console.error(`Poll job ${job?.id} failed:`, err.message);
});

notifyWorker.on("failed", (job, err) => {
  console.error(`Notify job ${job?.id} failed:`, err.message);
});

compareWorker.on("failed", (job, err) => {
  console.error(`Compare job ${job?.id} failed:`, err.message);
});

ensureAllSheetJobs()
  .then((r) => console.log(`Scheduled ${r.active} sheet poll job(s)`))
  .catch(console.error);
ensureAllIntegrityJobs()
  .then((r) => console.log(`Scheduled ${r.active} integrity check job(s)`))
  .catch(console.error);

// The API is on Vercel with WORKER_MODE unset, so it cannot schedule anything
// itself — it has no Redis connection at all. Everything the UI does to a
// sheet (add, pause, archive, delete, change interval) reaches BullMQ only
// through this reconcile, so it runs often enough that a new sheet starts
// polling within a minute.
const RECONCILE_MS = 60 * 1000;
const reconcileTimer = setInterval(() => {
  ensureAllSheetJobs()
    .then((r) => {
      noteReconcile("sheets", r);
      if (r.added || r.retimed || r.removed) {
        console.log(
          `Sheet jobs reconciled: ${r.active} active ` +
            `(+${r.added} new, ~${r.retimed} retimed, -${r.removed} stale)`
        );
      }
    })
    .catch((err) => {
      noteReconcileError(err);
      console.error("Sheet job reconcile failed:", err?.message ?? err);
    });

  ensureAllIntegrityJobs()
    .then((r) => {
      noteReconcile("integrity", r);
      if (r.added || r.retimed || r.removed) {
        console.log(
          `Integrity jobs reconciled: ${r.active} active ` +
            `(+${r.added} new, ~${r.retimed} retimed, -${r.removed} stale)`
        );
      }
    })
    .catch((err) => {
      noteReconcileError(err);
      console.error("Integrity job reconcile failed:", err?.message ?? err);
    });
}, RECONCILE_MS);

// Digest + snapshot retention + quiet-hours flush + scheduled reports. Same
// cadence, and the same functions, as the /api/cron/maintenance fallback.
const maintenanceTimer = setInterval(() => {
  sendDueDigests().catch((err) => console.error("Digest run failed:", err?.message ?? err));
  pruneSnapshots().catch((err) => console.error("Snapshot prune failed:", err?.message ?? err));
  // Roll up before pruning: raw beats are the rollup's only input, so a
  // maintenance pass that has been down must never prune what it hasn't read.
  rollupOps()
    .then(() => pruneOps())
    .then(() => pruneRollups())
    .catch((err) => console.error("Ops rollup/prune failed:", err?.message ?? err));
  flushQueuedNotifications().catch((err) =>
    console.error("Notification flush failed:", err?.message ?? err)
  );
  sendDueReports().catch((err) => console.error("Report run failed:", err?.message ?? err));
}, 5 * 60 * 1000);

// Publishes queue depth, scheduler counts, Redis health and process stats to
// Postgres for the ops dashboard — the API can read none of that itself.
const heartbeatTimer = startHeartbeat();

// Without this, `docker compose restart` SIGKILLs the worker mid-poll after the
// grace period and the dashboard cannot tell a deploy from a crash.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Worker shutting down (${signal})…`);

  // Hard cap: a stuck close must not outlive docker's grace period.
  const kill = setTimeout(() => {
    console.error("Shutdown timed out — exiting hard");
    process.exit(1);
  }, 15_000);
  kill.unref();

  clearInterval(reconcileTimer);
  clearInterval(maintenanceTimer);
  clearInterval(heartbeatTimer);

  // close() waits for in-flight jobs rather than abandoning them mid-write.
  await Promise.allSettled([pollWorker.close(), notifyWorker.close(), compareWorker.close()]);
  await recordStopped(signal).catch(() => {});

  clearTimeout(kill);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log("Worker started — poll + notify + integrity workers running");
