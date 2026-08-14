// This process *is* the BullMQ backend, so it declares the mode itself rather
// than trusting the environment to say so. Without this, a .env missing
// WORKER_MODE would leave every scheduleSheetPoll/scheduleCompareSweep call a
// no-op and the worker would sit idle with nothing to drain — silently.
process.env.WORKER_MODE = "bullmq";

import "../shared/env";
import { createPollWorker } from "./pollWorker";
import { createNotifyWorker } from "./notifyWorker";
import { createCompareWorker } from "./compareWorker";
import { ensureAllSheetJobs } from "./scheduler";
import { scheduleCompareSweep } from "../shared/queues";
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
scheduleCompareSweep().catch(console.error);

// The API is on Vercel with WORKER_MODE unset, so it cannot schedule anything
// itself — it has no Redis connection at all. Everything the UI does to a
// sheet (add, pause, archive, delete, change interval) reaches BullMQ only
// through this reconcile, so it runs often enough that a new sheet starts
// polling within a minute.
const RECONCILE_MS = 60 * 1000;
setInterval(() => {
  ensureAllSheetJobs()
    .then((r) => {
      if (r.added || r.retimed || r.removed) {
        console.log(
          `Sheet jobs reconciled: ${r.active} active ` +
            `(+${r.added} new, ~${r.retimed} retimed, -${r.removed} stale)`
        );
      }
    })
    .catch((err) => console.error("Sheet job reconcile failed:", err?.message ?? err));
}, RECONCILE_MS);

// Digest + snapshot retention + quiet-hours flush + scheduled reports. Same
// cadence, and the same functions, as the /api/cron/maintenance fallback.
setInterval(() => {
  sendDueDigests().catch((err) => console.error("Digest run failed:", err?.message ?? err));
  pruneSnapshots().catch((err) => console.error("Snapshot prune failed:", err?.message ?? err));
  flushQueuedNotifications().catch((err) =>
    console.error("Notification flush failed:", err?.message ?? err)
  );
  sendDueReports().catch((err) => console.error("Report run failed:", err?.message ?? err));
}, 5 * 60 * 1000);

console.log("Worker started — poll + notify + compare workers running");
