import { Worker, Job } from "bullmq";
import { getConnection } from "../shared/redis";
import { pollSheet } from "../shared/poll";
import { notifyQueue } from "../shared/queues";
import { noteWork } from "./state";

interface PollJobData {
  sheetId: string;
}

export function createPollWorker() {
  return new Worker<PollJobData>(
    "poll",
    async (job: Job<PollJobData>) => {
      const { sheetId } = job.data;

      // Counted here rather than read back off the queue: BullMQ's completed
      // counter is truncated by removeOnComplete, so it can't be differenced.
      try {
        const changeLogId = await pollSheet(sheetId);
        noteWork("checked");
        if (changeLogId) {
          noteWork("changed");
          await notifyQueue().add(
            "notify",
            { sheetId, changeLogId },
            { removeOnComplete: true, removeOnFail: 100 }
          );
        }
      } catch (err) {
        noteWork("failed");
        throw err; // BullMQ still owns retry/failure accounting
      }
    },
    { connection: getConnection(), concurrency: 5 }
  );
}
