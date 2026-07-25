import express from "express";
import helmet from "helmet";
import { corsMiddleware } from "./middleware/cors";
import { sessionMiddleware } from "./middleware/session";
import authRouter from "./routes/auth";
import sheetsRouter from "./routes/sheets";
import projectsRouter from "./routes/projects";
import overviewRouter from "./routes/overview";
import changesRouter from "./routes/changes";
import pushRouter from "./routes/push";
import cronRouter from "./routes/cron";
import webhooksRouter from "./routes/webhooks";
import kpisRouter from "./routes/kpis";
import notifyRouter from "./routes/notify";
import prefsRouter from "./routes/prefs";
import notificationsRouter, { configRouter } from "./routes/notifications";
import chartsRouter from "./routes/charts";
import reportsRouter from "./routes/reports";
import sharesRouter from "./routes/shares";
import publicRouter from "./routes/public";
import realtimeRouter from "./routes/realtime";
import compareRouter from "./routes/compare";

const app = express();
const isProd = process.env.NODE_ENV === "production";

// Don't advertise the framework; trust the TLS-terminating proxy in prod so
// req.ip (rate limiting) and secure-cookie detection are correct.
app.disable("x-powered-by");
if (isProd) app.set("trust proxy", 1);

// Security headers. CSP/COEP are off — this is a JSON API for a cross-origin
// SPA, and a strict policy would block those fetches while adding little for
// non-HTML responses. CORP is set cross-origin so the SPA can read responses.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(corsMiddleware);
app.options("*", corsMiddleware);
app.use(express.json());
app.use(sessionMiddleware as express.RequestHandler);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/api/sheets", sheetsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/overview", overviewRouter);
app.use("/api/changes", changesRouter);
app.use("/api/push", pushRouter);
app.use("/api/cron", cronRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/kpis", kpisRouter);
app.use("/api/notify", notifyRouter);
app.use("/api/prefs", prefsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/config", configRouter);
app.use("/api/charts", chartsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/shares", sharesRouter);
app.use("/api/realtime", realtimeRouter);
app.use("/api/compare", compareRouter);
app.use("/public", publicRouter);

// Unmatched API paths → JSON 404 (not Express's HTML default).
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler — log the message only, never leak stack/DB internals.
app.use(
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error:", err?.message ?? err);
    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({ error: "Internal server error" });
  }
);

export default app;
