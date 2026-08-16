-- Five-minute rollups of OpsHeartbeat: the dashboard charts a week from these
-- while raw beats keep their 24h retention.
CREATE TABLE "OpsRollup" (
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "beats" INTEGER NOT NULL DEFAULT 0,
    "degraded" INTEGER NOT NULL DEFAULT 0,
    "redisOk" INTEGER NOT NULL DEFAULT 0,
    "redisAvgMs" INTEGER,
    "redisMaxMs" INTEGER,
    "rssMaxMb" INTEGER,
    "queueMaxWaiting" INTEGER,
    "queueMaxFailed" INTEGER,
    "checked" INTEGER,
    "changed" INTEGER,
    "failed" INTEGER,
    "cronRuns" INTEGER NOT NULL DEFAULT 0,
    "cronErrors" INTEGER NOT NULL DEFAULT 0,
    "notifSent" INTEGER,
    "notifFailed" INTEGER,
    "notifQueued" INTEGER,
    "version" TEXT,
    "queues" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsRollup_pkey" PRIMARY KEY ("bucketStart")
);

CREATE INDEX "OpsRollup_bucketStart_idx" ON "OpsRollup"("bucketStart");

-- Time-bucketed ops queries scan these two tables; every existing index leads
-- with sheetId / userId, so without these the history endpoint is a seq scan
-- that grows with total table size forever. Both tables are append-only, so
-- these are right-edge inserts — the cheapest index shape there is.
CREATE INDEX "ChangeLog_createdAt_idx" ON "ChangeLog"("createdAt");
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
