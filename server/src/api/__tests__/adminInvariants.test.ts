import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const API_DIR = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("admin API invariants", () => {
  // The API must never open Redis: getRedis() throws without REDIS_URL, so one
  // stray import turns every request on Vercel into a 500 — and invites someone
  // to "fix" it by setting REDIS_URL there, which breaks the whole design.
  // Queue data reaches the API through the worker's heartbeat rows instead.
  it("never imports shared/redis anywhere under src/api", () => {
    const offenders = walk(API_DIR)
      .filter((file) => !file.includes("__tests__"))
      .filter((file) => /from\s+["'].*shared\/redis["']/.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("loads the admin router with no worker env present", async () => {
    delete process.env.WORKER_MODE;
    delete process.env.REDIS_URL;
    const mod = await import("../routes/admin");
    expect(mod.default).toBeTruthy();
  });

  // Read-only is a security property of this dashboard, not a convention:
  // enforce it structurally so a future POST can't be added by accident.
  it("still exposes the history route", async () => {
    const mod = await import("../routes/admin");
    const paths = (mod.default as unknown as { stack: { route?: { path: string } }[] }).stack
      .filter((l) => l.route)
      .map((l) => l.route!.path);
    expect(paths).toEqual(expect.arrayContaining(["/health", "/pulse", "/stats", "/history"]));
  });

  // The rollup writer is the one legitimate write in the ops path, and it
  // belongs to the cron route. The read path stays read-only.
  it("writes OpsRollup from the cron route only", () => {
    const offenders = walk(API_DIR)
      .filter((file) => !file.includes("__tests__") && !file.endsWith("routes/cron.ts"))
      .filter((file) => /opsRollup\.upsert|rollupOps\(/.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("exposes GET routes only", async () => {
    const mod = await import("../routes/admin");
    const layers = (mod.default as unknown as { stack: { route?: { methods: Record<string, boolean> } }[] }).stack;
    const routed = layers.filter((l) => l.route);
    expect(routed.length).toBeGreaterThan(0);
    for (const layer of routed) {
      expect(Object.keys(layer.route!.methods)).toEqual(["get"]);
    }
  });
});
