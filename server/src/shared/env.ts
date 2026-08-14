import "dotenv/config";

const required = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "FRONTEND_URL",
];

// Redis backs BullMQ and nothing else, so it's required only in the mode that
// actually runs a worker. The serverless deployment drives everything from
// QStash → /api/cron/poll and never touches it.
if (process.env.WORKER_MODE === "bullmq") required.push("REDIS_URL");

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const keyBuf = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex");
if (keyBuf.length !== 32) {
  throw new Error("TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
}
// Reject a placeholder/low-entropy key (all-zero or a single repeated byte).
if (keyBuf.every((b) => b === keyBuf[0])) {
  throw new Error("TOKEN_ENCRYPTION_KEY looks weak (all bytes identical) — generate a random 32-byte key");
}

if ((process.env.SESSION_SECRET as string).length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters");
}

// In production a wildcard/relative FRONTEND_URL would make CORS-with-credentials
// unsafe — require a concrete origin.
if (process.env.NODE_ENV === "production") {
  const url = process.env.FRONTEND_URL!;
  if (url.includes("*") || !/^https?:\/\//.test(url)) {
    throw new Error("FRONTEND_URL must be a concrete https origin (no wildcard) in production");
  }
}

// CRON_SECRET is the bearer token an external scheduler presents to
// /api/cron/poll and /api/cron/maintenance — the only thing standing in front
// of otherwise unauthenticated endpoints. It is optional: in the default
// deployment a separate worker process owns the recurring work and these
// endpoints go unused. Only a deployment with no worker depends on them, and
// there a missing secret is a silent outage.
if (!process.env.CRON_SECRET) {
  console.warn(
    "CRON_SECRET is not set — /api/cron/* will reject every call. Fine if a " +
      "BullMQ worker process owns polling; a silent outage if nothing else does."
  );
}
