import type { ReconcileResult } from "./scheduler";

// The reconcile loop already computes exactly the numbers the dashboard needs
// (how many sheets and checks *should* have a scheduler) and currently throws
// them away into a console.log. Park the last result here so the heartbeat can
// publish it — the delta between this and the live scheduler count in Redis is
// the clearest signal that scheduling has broken.
export interface ReconcileState {
  at: number;
  sheets: ReconcileResult | null;
  integrity: ReconcileResult | null;
  error: string | null;
}

export const reconcileState: ReconcileState = {
  at: 0,
  sheets: null,
  integrity: null,
  error: null,
};

export function noteReconcile(
  kind: "sheets" | "integrity",
  result: ReconcileResult
): void {
  reconcileState[kind] = result;
  reconcileState.at = Date.now();
  reconcileState.error = null;
}

export function noteReconcileError(err: unknown): void {
  reconcileState.error = (err as Error)?.message ?? String(err);
  reconcileState.at = Date.now();
}

// Cumulative work counters. The heartbeat publishes these and the rollup turns
// consecutive-beat deltas into per-bucket throughput.
//
// Deliberately NOT derived from queues.poll.completed: `removeOnComplete`
// truncates that counter, so its deltas go negative constantly and undercount.
export interface WorkCounters {
  checked: number;
  changed: number;
  failed: number;
}

export const workCounters: WorkCounters = { checked: 0, changed: 0, failed: 0 };

export function noteWork(kind: keyof WorkCounters, by = 1): void {
  workCounters[kind] += by;
}
