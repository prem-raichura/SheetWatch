import { describe, it, expect, vi } from "vitest";
import { collectHeartbeat, type HeartbeatDeps } from "../heartbeat";

// collectHeartbeat takes its dependencies so the failure modes that matter can
// be exercised without Redis: the whole point of the design is that the beat
// still lands when Redis does not answer.

let clock = 0;
const deps = (over: Partial<HeartbeatDeps> = {}): HeartbeatDeps => ({
  now: () => (clock += 1),
  ping: () => Promise.resolve("PONG"),
  queues: [
    {
      name: "poll",
      getJobCounts: () => Promise.resolve({ waiting: 2, active: 1 }),
      getJobSchedulersCount: () => Promise.resolve(7),
    },
  ],
  ...over,
});

describe("collectHeartbeat", () => {
  it("reports ok when every collector answers", async () => {
    const out = await collectHeartbeat(deps());
    expect(out.status).toBe("ok");
    expect(out.data.queues).toEqual({ poll: { waiting: 2, active: 1 } });
    expect(out.data.schedulers).toEqual({ poll: 7 });
    expect((out.data.redis as { ok: boolean }).ok).toBe(true);
  });

  it("still produces a beat when the queue read fails", async () => {
    const out = await collectHeartbeat(
      deps({
        queues: [
          {
            name: "poll",
            getJobCounts: () => Promise.reject(new Error("redis gone")),
            getJobSchedulersCount: () => Promise.reject(new Error("redis gone")),
          },
        ],
      })
    );
    // Degraded, not thrown — this is exactly how "worker up, Redis down"
    // reaches the dashboard.
    expect(out.status).toBe("degraded");
    expect(out.data.queues).toEqual({ poll: null });
  });

  it("caps a hung ping instead of waiting out ioredis's 10s timeout", async () => {
    vi.useFakeTimers();
    try {
      const promise = collectHeartbeat(deps({ ping: () => new Promise(() => {}) }));
      await vi.advanceTimersByTimeAsync(2100);
      const out = await promise;
      expect(out.status).toBe("degraded");
      expect(out.data.redis).toEqual({ ok: false, latencyMs: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("always includes process vitals", async () => {
    const out = await collectHeartbeat(deps());
    const proc = out.data.process as { pid: number; host: string; uptimeS: number };
    expect(proc.pid).toBe(process.pid);
    expect(typeof proc.host).toBe("string");
    expect(proc.uptimeS).toBeGreaterThanOrEqual(0);
  });
});
