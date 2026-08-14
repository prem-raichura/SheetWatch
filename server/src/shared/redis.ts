import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";

// Redis exists purely to feed BullMQ, and BullMQ only matters when a
// long-running worker process is draining the queues (WORKER_MODE=bullmq).
// The serverless deployment has no worker — QStash calls /api/cron/poll and
// everything runs inline — so nothing here is ever constructed there and
// REDIS_URL can stay unset.
//
// Lazy on purpose: a module-level `new IORedis(...)` would open a socket on
// every Vercel cold start and retry-loop forever against a URL that deployment
// has no use for.
let client: IORedis | null = null;

export function getRedis(): IORedis {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required when WORKER_MODE=bullmq");

  client = new IORedis(url, {
    // BullMQ workers issue blocking reads (BZPOPMIN) that must never be
    // aborted mid-wait, which is exactly what a retry cap would do.
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
    // rediss:// (Upstash and friends) turns TLS on automatically.
  });

  // ioredis emits 'error' on every reconnect attempt; with no listener Node
  // treats it as unhandled and takes the process down.
  client.on("error", (err) => {
    console.error("Redis error:", err?.message ?? err);
  });

  return client;
}

export function getConnection(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}
