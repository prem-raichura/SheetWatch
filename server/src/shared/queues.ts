import { Queue } from "bullmq";
import { connection } from "./redis";

export const pollQueue = new Queue("poll", { connection });
export const notifyQueue = new Queue("notify", { connection });
export const compareQueue = new Queue("compare", { connection });

// Periodic sweep that recomputes every comparison group — catches target-only
// edits between polls. Single repeatable job keyed `compare:sweep`.
const COMPARE_SWEEP_MS = 120 * 1000;
export async function scheduleCompareSweep(): Promise<void> {
  await compareQueue.upsertJobScheduler(
    "compare:sweep",
    { every: COMPARE_SWEEP_MS },
    { name: "sweep", data: {} }
  );
}

// Single source for the repeatable poll job keyed `poll:{sheetId}` —
// sheets routes, bulk project actions, and the worker scheduler all
// go through these so interval/name/data never drift.
export async function scheduleSheetPoll(sheet: {
  id: string;
  pollInterval: number;
}): Promise<void> {
  await pollQueue.upsertJobScheduler(
    `poll:${sheet.id}`,
    { every: sheet.pollInterval * 1000 },
    { name: "poll", data: { sheetId: sheet.id } }
  );
}

export async function unscheduleSheetPoll(sheetId: string): Promise<void> {
  await pollQueue.removeJobScheduler(`poll:${sheetId}`).catch(() => {});
}

export async function enqueueSheetCheck(sheetId: string): Promise<void> {
  await pollQueue.add(
    "poll",
    { sheetId },
    { removeOnComplete: true, removeOnFail: true }
  );
}
