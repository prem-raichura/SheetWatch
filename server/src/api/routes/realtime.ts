import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { signRealtimeToken } from "../../shared/realtimeToken";

const router = Router();

// Mints a short-lived token the client hands to the worker's /ws endpoint.
// Returns url:null when realtime isn't configured, so the client stays on
// polling without erroring.
router.get("/token", requireAuth, (req, res) => {
  const userId = req.session!.userId as string;
  const secret = process.env.REALTIME_SECRET;
  const url = process.env.REALTIME_URL ?? null;
  if (!secret || !url) {
    res.json({ token: null, url: null });
    return;
  }
  res.json({ token: signRealtimeToken(userId, secret), url });
});

export default router;
