import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";

export const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions;
