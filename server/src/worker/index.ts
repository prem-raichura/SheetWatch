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

ensureAllSheetJobs().catch(console.error);
scheduleCompareSweep().catch(console.error);

// Digest + snapshot retention + quiet-hours flush: same cadence as the
// Vercel cron path.
setInterval(() => {
  sendDueDigests().catch((err) => console.error("Digest run failed:", err?.message ?? err));
  pruneSnapshots().catch((err) => console.error("Snapshot prune failed:", err?.message ?? err));
  flushQueuedNotifications().catch((err) =>
    console.error("Notification flush failed:", err?.message ?? err)
  );
  sendDueReports().catch((err) => console.error("Report run failed:", err?.message ?? err));
}, 5 * 60 * 1000);

console.log("Worker started — poll + notify + compare workers running");
