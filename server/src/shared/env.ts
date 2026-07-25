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

// CRON_SECRET is optional (only the Vercel cron path needs it) but guards the
// unauthenticated /api/cron/poll endpoint — warn loudly if a deploy forgot it.
if (!process.env.CRON_SECRET) {
  console.warn("CRON_SECRET is not set — the /api/cron/poll endpoint will reject all calls.");
}
