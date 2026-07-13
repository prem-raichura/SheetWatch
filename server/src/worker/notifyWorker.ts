import { Worker, Job } from "bullmq";
import { connection } from "../shared/redis";
import { notifySheetChange } from "../shared/poll";

interface NotifyJobData {
  sheetId: string;
  changeLogId: string;
}

export function createNotifyWorker() {
  return new Worker<NotifyJobData>(
    "notify",
    async (job: Job<NotifyJobData>) => {
      const { sheetId, changeLogId } = job.data;
      await notifySheetChange(sheetId, changeLogId);
    },
    { connection }
  );
}
