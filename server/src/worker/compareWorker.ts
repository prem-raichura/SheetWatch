import { Worker } from "bullmq";
import { getConnection } from "../shared/redis";
import { computeSuggestions, recomputeAllGroups } from "../shared/compare";

// Dedicated worker for integrity checks. Each check has its own repeatable job
// (`integrity:{groupId}`) firing at the interval that check is set to, exactly
// like a tracked sheet's poll job. A job with no groupId is the legacy
// `compare:sweep` — handled so a scheduler left over from an older deploy
// still does something sensible until the reconcile drops it.
export function createCompareWorker() {
  return new Worker(
    "compare",
    async (job) => {
      const groupId = (job.data as { groupId?: string } | undefined)?.groupId;
      if (groupId) await computeSuggestions(groupId, { notify: true });
      else await recomputeAllGroups();
    },
    { connection: getConnection(), concurrency: 2 }
  );
}
