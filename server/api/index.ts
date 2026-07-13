// Vercel serverless entry — exposes the Express app as a function handler.
// Note: this only runs the API. The BullMQ *worker* (src/worker) is a
// long-running process and CANNOT run on Vercel — deploy it on Render /
// Railway / Fly, pointing at the same DATABASE_URL and REDIS_URL.
import "../src/shared/env";
import app from "../src/api/app";

export default app;
