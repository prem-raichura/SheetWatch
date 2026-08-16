import { describe, it, expect } from "vitest";
import {
  classifyGroups,
  compareVersions,
  classifyHeartbeat,
  classifySheets,
  maskTarget,
  rollupOverall,
  HEARTBEAT_STALE_MS,
  PERMANENT_ERRORS,
  TRANSIENT_ERROR_PREFIX,
  type HeartbeatRow,
  type PollRow,
} from "../ops";

const NOW = new Date("2026-08-16T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms);

function beat(overrides: Partial<HeartbeatRow> = {}): HeartbeatRow {
  return {
    status: "ok",
    createdAt: ago(1000),
    instance: "host:1",
    version: null,
    data: {},
    ...overrides,
  };
}

describe("classifyHeartbeat", () => {
  it("distinguishes a serverless deployment from a dead worker", () => {
    expect(classifyHeartbeat(null, NOW, false).state).toBe("not_applicable");
    // ADMIN_EXPECT_WORKER closes the hole where a worker dead >24h has had its
    // last beat pruned and would otherwise read as "serverless, all fine".
    expect(classifyHeartbeat(null, NOW, true).state).toBe("down");
  });

  it("holds up to three missed beats, then degrades", () => {
    expect(classifyHeartbeat(beat({ createdAt: ago(89_000) }), NOW, true).state).toBe("up");
    expect(classifyHeartbeat(beat({ createdAt: ago(HEARTBEAT_STALE_MS) }), NOW, true).state).toBe("up");
    expect(classifyHeartbeat(beat({ createdAt: ago(91_000) }), NOW, true).state).toBe("stale");
    expect(classifyHeartbeat(beat({ createdAt: ago(10 * 60_000 + 1000) }), NOW, true).state).toBe("down");
  });

  it("treats a clean shutdown as stopped at any age", () => {
    const old = beat({ status: "stopped", createdAt: ago(6 * 3600_000) });
    expect(classifyHeartbeat(old, NOW, true).state).toBe("stopped");
  });

  it("reports age and last beat", () => {
    const v = classifyHeartbeat(beat({ createdAt: ago(5000) }), NOW, true);
    expect(v.ageMs).toBe(5000);
    expect(v.lastBeatAt).toBe(ago(5000).toISOString());
  });
});

describe("rollupOverall", () => {
  it("ranks down over degraded over ok", () => {
    expect(rollupOverall(["up", "up"])).toBe("ok");
    expect(rollupOverall(["up", "stale"])).toBe("degraded");
    expect(rollupOverall(["up", "down"])).toBe("down");
    expect(rollupOverall(["stopped", "down"])).toBe("down");
  });

  it("never degrades on services this deployment doesn't have", () => {
    expect(rollupOverall(["up", "not_applicable", "not_configured"])).toBe("ok");
  });
});

describe("classifySheets", () => {
  const row = (o: Partial<PollRow> = {}): PollRow => ({
    id: "s1",
    label: "Sheet",
    pollInterval: 60,
    lastCheckedAt: ago(10_000),
    errorMessage: null,
    ...o,
  });

  // Pins the poll.ts asymmetry: 401/403/404 set errorMessage and return
  // WITHOUT advancing lastCheckedAt, so these sheets look infinitely overdue
  // under BullMQ. They are a user problem, not an infrastructure one.
  it("buckets permanently-blocked sheets away from overdue", () => {
    for (const message of PERMANENT_ERRORS) {
      const out = classifySheets(
        [row({ errorMessage: message, lastCheckedAt: ago(30 * 86_400_000) })],
        NOW
      );
      expect(out.counts.blocked).toBe(1);
      expect(out.counts.overdue).toBe(0);
      expect(out.overdue).toHaveLength(0);
    }
  });

  it("counts transient Google failures separately", () => {
    const out = classifySheets(
      [row({ errorMessage: `${TRANSIENT_ERROR_PREFIX} (HTTP 503) — will retry next poll.` })],
      NOW
    );
    expect(out.counts.transient).toBe(1);
    expect(out.counts.blocked).toBe(0);
  });

  it("calls a never-polled sheet due, not overdue", () => {
    const out = classifySheets([row({ lastCheckedAt: null })], NOW);
    expect(out.counts.due).toBe(1);
    expect(out.counts.overdue).toBe(0);
  });

  it("needs 2x the interval plus grace before overdue", () => {
    const justUnder = classifySheets([row({ lastCheckedAt: ago(120_000 + 29_000) })], NOW);
    expect(justUnder.counts.due).toBe(1);
    expect(justUnder.counts.overdue).toBe(0);

    const over = classifySheets([row({ lastCheckedAt: ago(120_000 + 31_000) })], NOW);
    expect(over.counts.overdue).toBe(1);
    expect(over.overdue[0].overdueSeconds).toBe(151);
  });

  it("sorts the overdue list worst first", () => {
    const out = classifySheets(
      [
        row({ id: "a", lastCheckedAt: ago(600_000) }),
        row({ id: "b", lastCheckedAt: ago(3_600_000) }),
      ],
      NOW
    );
    expect(out.overdue.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("classifyGroups", () => {
  it("uses the same slack the sweep uses, so both agree on due", () => {
    const rows = [
      { id: "1", name: "n", checkInterval: 60, lastCheckedAt: ago(56_000) }, // within slack
      { id: "2", name: "n", checkInterval: 60, lastCheckedAt: ago(50_000) }, // not yet
      { id: "3", name: "n", checkInterval: 60, lastCheckedAt: ago(200_000) }, // overdue
      { id: "4", name: "n", checkInterval: 60, lastCheckedAt: null },
    ];
    expect(classifyGroups(rows, NOW)).toEqual({ due: 1, overdue: 1, never: 1 });
  });
});

describe("maskTarget", () => {
  it("keeps the domain and drops the person", () => {
    expect(maskTarget("premraichura7@gmail.com")).toBe("pr***@gmail.com");
  });

  it("reduces a push endpoint to its host", () => {
    expect(maskTarget("https://fcm.googleapis.com/fcm/send/abc123")).toBe("fcm.googleapis.com");
  });
});

describe("compareVersions", () => {
  it("matches a full sha against a short one", () => {
    // Vercel injects the full sha; docker-compose is documented with
    // `git rev-parse --short`. Reading that as skew is the obvious false
    // positive, so the comparison is on the first 7 characters.
    expect(compareVersions("a1b2c3d4e5f6", "a1b2c3d")).toBe(true);
    expect(compareVersions("A1B2C3D", "a1b2c3d")).toBe(true);
  });

  it("reports a genuine mismatch", () => {
    expect(compareVersions("a1b2c3d", "9999999")).toBe(false);
  });

  it("is null when either side is unknown", () => {
    expect(compareVersions(null, "a1b2c3d")).toBeNull();
    expect(compareVersions("a1b2c3d", null)).toBeNull();
    expect(compareVersions(null, null)).toBeNull();
    expect(compareVersions("", "a1b2c3d")).toBeNull();
  });
});
