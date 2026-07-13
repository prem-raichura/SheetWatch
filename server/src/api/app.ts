import express from "express";
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

const app = express();

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
app.use("/public", publicRouter);

export default app;
