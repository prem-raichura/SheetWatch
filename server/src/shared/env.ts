import "dotenv/config";

const required = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "FRONTEND_URL",
];

for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const keyBuf = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex");
if (keyBuf.length !== 32) {
  throw new Error("TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
}

// CRON_SECRET is optional (only the Vercel cron path needs it) but guards the
// unauthenticated /api/cron/poll endpoint — warn loudly if a deploy forgot it.
if (!process.env.CRON_SECRET) {
  console.warn("CRON_SECRET is not set — the /api/cron/poll endpoint will reject all calls.");
}
