import type { Request, Response, NextFunction } from "express";

// Naive in-memory per-IP fixed-window limiter — adequate for a single API
// instance. For horizontal scaling, back this with the existing Redis instead.
// Returns an Express middleware; each call keeps its own bucket so limits are
// independent per mount point.
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || entry.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
      if (entry.count > max) {
        res.status(429).json({ error: "Too many requests" });
        return;
      }
    }

    if (hits.size > 10_000) hits.clear(); // coarse memory guard
    next();
  };
}
