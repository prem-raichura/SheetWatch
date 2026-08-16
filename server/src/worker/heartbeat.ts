import os from "os";
import { compareQueue, notifyQueue, pollQueue } from "../shared/queues";
import { getRedis } from "../shared/redis";
import { HEARTBEAT_INTERVAL_MS, recordOps, type OpsStatus } from "../shared/ops";
import { reconcileState, workCounters } from "./state";

// The worker is the only process that can see Redis, so it is the only thing
// that can report on it. Every 30s it writes what it sees into Postgres, which
// the API can read — that indirection is what lets the serverless API report
// queue depth and worker liveness without ever opening a Redis connection.

type Counts = Record<string, number>;

export interface HeartbeatDeps {
  queues: { name: string; getJobCounts: () => Promise<Counts>; getJobSchedulersCount: () => Promise<number> }[];
  ping: () => Promise<unknown>;
  now: () => number;
}

// Each collector is capped independently. Without this a hung Redis socket
// blocks for ioredis's 10s connectTimeout, beats stack up behind it, and the
// one signal that matters ("worker alive, Redis dead") never gets written.
async function capped<T>(work: () => Promise<T>, ms = 2000): Promise<T | null> {
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms).unref?.()
      ),
    ]);
  } catch {
    return null;
  }
}

export function defaultDeps(): HeartbeatDeps {
  return {
    queues: [pollQueue(), notifyQueue(), compareQueue()].map((q) => ({
      name: q.name,
      getJobCounts: () => q.getJobCounts(),
      getJobSchedulersCount: () => q.getJobSchedulersCount(),
    })),
    ping: () => getRedis().ping(),
    now: () => Date.now(),
  };
}

export async function collectHeartbeat(
  deps: HeartbeatDeps
): Promise<{ status: OpsStatus; durationMs: number; data: Record<string, unknown> }> {
  const started = deps.now();

  const pingStarted = deps.now();
  const pong = await capped(() => deps.ping());
  const redis =
    pong === null
      ? { ok: false, latencyMs: null }
      : { ok: true, latencyMs: deps.now() - pingStarted };

  const queues: Record<string, Counts | null> = {};
  const schedulers: Record<string, number | null> = {};
  for (const queue of deps.queues) {
    queues[queue.name] = await capped(() => queue.getJobCounts());
    schedulers[queue.name] = await capped(() => queue.getJobSchedulersCount());
  }

  // Any collector coming back null means we could read Postgres but not Redis:
  // the worker is up, its view of the queues is not.
  const degraded =
    !redis.ok ||
    Object.values(queues).some((v) => v === null) ||
    Object.values(schedulers).some((v) => v === null);

  const mem = process.memoryUsage();

  return {
    status: degraded ? "degraded" : "ok",
    durationMs: deps.now() - started,
    data: {
      redis,
      queues,
      schedulers,
      reconcile: {
        at: reconcileState.at ? new Date(reconcileState.at).toISOString() : null,
        sheets: reconcileState.sheets,
        integrity: reconcileState.integrity,
        error: reconcileState.error,
      },
      // Cumulative since process start; the rollup differences consecutive
      // beats, and treats a decrease as a restart rather than negative work.
      work: { ...workCounters },
      process: {
        uptimeS: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        pid: process.pid,
        host: os.hostname(),
        node: process.version,
      },
    },
  };
}

export const instanceId = (): string => `${os.hostname()}:${process.pid}`;

// GIT_COMMIT_SHA is set in docker-compose. Deliberately not read from
// package.json — tsconfig's rootDir is ./src, so importing it fails the build.
const version = (): string | null => process.env.GIT_COMMIT_SHA ?? process.env.APP_VERSION ?? null;

export async function beat(deps = defaultDeps()): Promise<void> {
  const { status, durationMs, data } = await collectHeartbeat(deps);
  await recordOps({
    source: "worker",
    status,
    durationMs,
    data,
    instance: instanceId(),
    version: version(),
  });
}

export function startHeartbeat(): NodeJS.Timeout {
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return; // a slow beat must not queue more behind it
    inFlight = true;
    try {
      await beat();
    } catch (err) {
      console.error("Heartbeat failed:", (err as Error)?.message ?? err);
    } finally {
      inFlight = false;
    }
  };

  void tick(); // one immediately, so a restart is visible without waiting 30s
  // Never hand an async function straight to setInterval: an unhandled
  // rejection inside a timer terminates the process under Node 20, which would
  // make telemetry able to kill the worker it is measuring.
  return setInterval(() => {
    void tick();
  }, HEARTBEAT_INTERVAL_MS);
}

// Final beat on a clean shutdown, so "someone is deploying" never looks like
// "the worker crashed". Awaited, unlike every other beat.
export async function recordStopped(reason: string): Promise<void> {
  await recordOps({
    source: "worker",
    status: "stopped",
    data: { reason },
    instance: instanceId(),
    version: version(),
  });
}
