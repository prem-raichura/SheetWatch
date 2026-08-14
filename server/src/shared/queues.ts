import { Queue } from "bullmq";
import { getConnection } from "./redis";

// BullMQ is one of two interchangeable execution backends:
//
//   * WORKER_MODE=bullmq — a long-running worker process drains these queues.
//   * unset — the serverless deployment. QStash calls /api/cron/poll on a
//     schedule and the request handler polls, notifies and sweeps inline; no
//     Redis is involved at all.
//
// Every export below is a no-op in the second mode, so the API can import this
// module freely without dragging a Redis connection into a Vercel function.
export const bullmqEnabled = (): boolean => process.env.WORKER_MODE === "bullmq";

let cache: { poll: Queue; notify: Queue; compare: Queue } | null = null;

function queues() {
  if (!cache) {
    const connection = getConnection();
    cache = {
      poll: new Queue("poll", { connection }),
      notify: new Queue("notify", { connection }),
      compare: new Queue("compare", { connection }),
    };
  }
  return cache;
}

export const pollQueue = () => queues().poll;
export const notifyQueue = () => queues().notify;
export const compareQueue = () => queues().compare;

// Periodic sweep that recomputes every comparison group — catches target-only
// edits between polls. Single repeatable job keyed `compare:sweep`.
// (Serverless equivalent: recomputeAllGroups() at the end of /api/cron/poll.)
const COMPARE_SWEEP_MS = 120 * 1000;
export async function scheduleCompareSweep(): Promise<void> {
  if (!bullmqEnabled()) return;
  await compareQueue().upsertJobScheduler(
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
  if (!bullmqEnabled()) return;
  await pollQueue().upsertJobScheduler(
    `poll:${sheet.id}`,
    { every: sheet.pollInterval * 1000 },
    { name: "poll", data: { sheetId: sheet.id } }
  );
}

export async function unscheduleSheetPoll(sheetId: string): Promise<void> {
  if (!bullmqEnabled()) return;
  await pollQueue().removeJobScheduler(`poll:${sheetId}`).catch(() => {});
}

export async function enqueueSheetCheck(sheetId: string): Promise<void> {
  await pollQueue().add(
    "poll",
    { sheetId },
    { removeOnComplete: true, removeOnFail: true }
  );
}
