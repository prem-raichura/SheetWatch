import { Worker, Job } from "bullmq";
import { connection } from "../shared/redis";
import { pollSheet } from "../shared/poll";
import { notifyQueue } from "../shared/queues";

interface PollJobData {
  sheetId: string;
}

export function createPollWorker() {
  return new Worker<PollJobData>(
    "poll",
    async (job: Job<PollJobData>) => {
      const { sheetId } = job.data;

      const changeLogId = await pollSheet(sheetId);
      if (changeLogId) {
        await notifyQueue.add(
          "notify",
          { sheetId, changeLogId },
          { removeOnComplete: true, removeOnFail: 100 }
        );
      }
    },
    { connection, concurrency: 5 }
  );
}
