import { Worker } from "bullmq";
import { connection } from "../shared/redis";
import { recomputeAllGroups } from "../shared/compare";

// Dedicated worker for the comparison feature: the repeatable `compare:sweep`
// job periodically re-diffs every enabled group, surfacing (and notifying on)
// new suggestions even when neither sheet was polled in between.
export function createCompareWorker() {
  return new Worker(
    "compare",
    async () => {
      await recomputeAllGroups();
    },
    { connection, concurrency: 1 }
  );
}
