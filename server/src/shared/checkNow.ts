import { pollSheet, notifySheetChange } from "./poll";
import { enqueueSheetCheck } from "./queues";

// One-off "check now". With a BullMQ worker running (local dev sets
// WORKER_MODE=bullmq) the check is queued; otherwise — e.g. on Vercel where
// no worker process exists — poll and notify inline so the button actually
// does something.
export async function checkSheetNow(sheetId: string): Promise<void> {
  if (process.env.WORKER_MODE === "bullmq") {
    await enqueueSheetCheck(sheetId);
    return;
  }
  const changeLogId = await pollSheet(sheetId);
  if (changeLogId) await notifySheetChange(sheetId, changeLogId);
}
