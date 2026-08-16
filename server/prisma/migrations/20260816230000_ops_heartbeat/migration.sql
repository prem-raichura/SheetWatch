-- Ops telemetry for the admin dashboard: scheduler check-ins from the worker
-- and from the cron endpoints. Retained 24h, pruned by the maintenance pass.
CREATE TABLE "OpsHeartbeat" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "instance" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "durationMs" INTEGER,
    "version" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpsHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OpsHeartbeat_source_createdAt_idx" ON "OpsHeartbeat"("source", "createdAt");
CREATE INDEX "OpsHeartbeat_createdAt_idx" ON "OpsHeartbeat"("createdAt");
