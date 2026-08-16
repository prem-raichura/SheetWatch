import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { rateLimit } from "../middleware/rateLimit";
import { getHealth, getPulse, getStats } from "../../shared/adminStats";
import { getHistory } from "../../shared/opsHistory";

// Internal ops dashboard API. Read-only by design: there is no POST/PATCH/
// DELETE here and a test asserts there never will be. A page that can see the
// whole system should not also be able to change it.
//
// Guards are mounted with router.use so no route can forget them (the
// /api/cron precedent). The limiter goes first so unauthenticated probes cost
// the least; the session cookie is the real gate.
const router = Router();

router.use(rateLimit({ windowMs: 60_000, max: 60 }), requireAuth, requireAdmin);

// Express 4 does not catch rejections from async handlers, so every route
// owns its try/catch — an uncaught one would hang the request until the
// function times out.

// Services only — cheap enough to poll from an uptime checker.
router.get("/health", async (_req, res) => {
  try {
    res.json(await getHealth());
  } catch (err) {
    console.error("Admin health failed:", err);
    res.status(500).json({ error: "Failed to read health" });
  }
});

// Health + queue depth + cron liveness. The 10s half of the dashboard.
router.get("/pulse", async (_req, res) => {
  try {
    res.json(await getPulse());
  } catch (err) {
    console.error("Admin pulse failed:", err);
    res.status(500).json({ error: "Failed to read pulse" });
  }
});

// Aggregates over every sheet, check and notification. The 60s half.
router.get("/stats", async (_req, res) => {
  try {
    res.json(await getStats());
  } catch (err) {
    console.error("Admin stats failed:", err);
    res.status(500).json({ error: "Failed to read stats" });
  }
});

// Time series for every chart on the page. One window, so no two charts can
// disagree about which minutes they are showing.
router.get("/history", async (req, res) => {
  try {
    res.json(await getHistory(typeof req.query.range === "string" ? req.query.range : undefined));
  } catch (err) {
    console.error("Admin history failed:", err);
    res.status(500).json({ error: "Failed to read history" });
  }
});

export default router;
