import { describe, expect, it } from "vitest";
import {
  normalizeToV2,
  matchRulesV2,
  validateRules,
  matchesRules,
  type AlertRulesV2,
} from "../rules";
import { isQuiet, nextQuietEnd, localHourWeekday } from "../quietHours";
import { planDelivery } from "../notify/dispatch";
import { thresholdState } from "../kpi";
import { DEFAULT_PREFS, type UserPrefs } from "../prefs";
import type { CellChange } from "../types";

const change = (cell: string, before: string, after: string): CellChange => ({
  cell,
  before,
  after,
});

describe("normalizeToV2", () => {
  it("returns null for empty inputs", () => {
    expect(normalizeToV2(null)).toBeNull();
    expect(normalizeToV2(undefined)).toBeNull();
    expect(normalizeToV2([])).toBeNull();
    expect(normalizeToV2({ version: 2, groups: [] })).toBeNull();
  });

  it("upgrades v1 arrays to one-condition groups with all channels", () => {
    const v2 = normalizeToV2([
      { column: "c", op: "gt", value: " 100 " },
      { column: "B", op: "eq", value: "done" },
    ]);
    expect(v2?.groups).toHaveLength(2);
    expect(v2?.groups[0].conditions).toEqual([{ column: "C", op: "gt", value: "100" }]);
    expect(v2?.groups[0].channels).toBeNull();
    expect(v2?.groups[0].id).toBeTruthy();
  });

  it("passes v2 through, filling missing ids", () => {
    const v2 = normalizeToV2({
      version: 2,
      groups: [
        {
          id: "",
          conditions: [{ column: "a", op: "contains", value: "x" }],
          channels: ["push"],
        },
      ],
    });
    expect(v2?.groups[0].id).toBeTruthy();
    expect(v2?.groups[0].conditions[0].column).toBe("A");
    expect(v2?.groups[0].channels).toEqual(["push"]);
  });
});

describe("matchRulesV2", () => {
  const rules = (groups: AlertRulesV2["groups"]): AlertRulesV2 => ({ version: 2, groups });

  it("no rules → always matched, all channels", () => {
    const r = matchRulesV2([change("R1C1", "a", "b")], null, "A1:Z100");
    expect(r.matched).toBe(true);
    expect(r.channels).toBe("all");
  });

  it("ANDs conditions within a group", () => {
    const g = rules([
      {
        id: "1",
        conditions: [
          { column: "A", op: "eq", value: "done" },
          { column: "B", op: "gt", value: "10" },
        ],
        channels: null,
      },
    ]);
    // Only A matches → no fire.
    expect(matchRulesV2([change("R2C1", "x", "done")], g, "A1:Z100").matched).toBe(false);
    // A and B match via different cells → fire.
    expect(
      matchRulesV2(
        [change("R2C1", "x", "done"), change("R3C2", "5", "25")],
        g,
        "A1:Z100"
      ).matched
    ).toBe(true);
  });

  it("ORs groups and unions their channels", () => {
    const g = rules([
      {
        id: "1",
        conditions: [{ column: "A", op: "eq", value: "done" }],
        channels: ["push"],
      },
      {
        id: "2",
        conditions: [{ column: "B", op: "gt", value: "10" }],
        channels: ["webhook:w1"],
      },
    ]);
    const r = matchRulesV2(
      [change("R2C1", "x", "done"), change("R3C2", "5", "25")],
      g,
      "A1:Z100"
    );
    expect(r.matched).toBe(true);
    expect(r.channels).toEqual(new Set(["push", "webhook:w1"]));
  });

  it("null channels on any matched group wins as all", () => {
    const g = rules([
      { id: "1", conditions: [{ column: "A", op: "eq", value: "done" }], channels: null },
      { id: "2", conditions: [{ column: "A", op: "eq", value: "done" }], channels: ["push"] },
    ]);
    const r = matchRulesV2([change("R2C1", "x", "done")], g, "A1:Z100");
    expect(r.channels).toBe("all");
  });

  it("respects the range's start column offset", () => {
    const g = rules([
      { id: "1", conditions: [{ column: "D", op: "eq", value: "hit" }], channels: null },
    ]);
    // Range starts at C, so grid column 2 is sheet column D.
    expect(matchRulesV2([change("R1C2", "", "hit")], g, "C1:F100").matched).toBe(true);
  });

  it("keeps v1 wrapper behavior", () => {
    expect(
      matchesRules([change("R1C1", "1", "20")], [{ column: "A", op: "gt", value: "10" }], "A1:Z10")
    ).toBe(true);
  });
});

describe("validateRules v2", () => {
  it("accepts valid v2 with owned webhook channels", () => {
    const err = validateRules(
      {
        version: 2,
        groups: [
          {
            id: "g1",
            conditions: [{ column: "A", op: "eq", value: "x" }],
            channels: ["push", "webhook:w1"],
          },
        ],
      },
      new Set(["w1"])
    );
    expect(err).toBeNull();
  });

  it("rejects foreign webhook references", () => {
    const err = validateRules(
      {
        version: 2,
        groups: [
          {
            id: "g1",
            conditions: [{ column: "A", op: "eq", value: "x" }],
            channels: ["webhook:other"],
          },
        ],
      },
      new Set(["w1"])
    );
    expect(err).toMatch(/don't own/);
  });

  it("rejects empty groups and bad ops", () => {
    expect(validateRules({ version: 2, groups: [{ id: "1", conditions: [], channels: null }] }))
      .toMatch(/at least one condition/);
    expect(
      validateRules({
        version: 2,
        groups: [{ id: "1", conditions: [{ column: "A", op: "nope", value: "x" }], channels: null }],
      })
    ).toMatch(/op must be/);
  });
});

describe("quiet hours", () => {
  const quiet = { enabled: true, start: "22:00", end: "07:00" };
  // 2026-07-13T23:30 in UTC
  const nightUTC = new Date("2026-07-13T23:30:00Z");
  const dayUTC = new Date("2026-07-13T12:00:00Z");

  it("detects inside an over-midnight window", () => {
    expect(isQuiet(quiet, "UTC", nightUTC)).toBe(true);
    expect(isQuiet(quiet, "UTC", dayUTC)).toBe(false);
    expect(isQuiet(quiet, "UTC", new Date("2026-07-14T06:59:00Z"))).toBe(true);
    expect(isQuiet(quiet, "UTC", new Date("2026-07-14T07:00:00Z"))).toBe(false);
  });

  it("respects the timezone", () => {
    // 23:30 UTC = 05:00 next day in Asia/Calcutta (UTC+5:30) → inside window
    expect(isQuiet(quiet, "Asia/Calcutta", nightUTC)).toBe(true);
    // 12:00 UTC = 17:30 in Asia/Calcutta → outside
    expect(isQuiet(quiet, "Asia/Calcutta", dayUTC)).toBe(false);
  });

  it("fails open on missing/invalid timezone", () => {
    expect(isQuiet(quiet, "", nightUTC)).toBe(false);
    expect(isQuiet(quiet, "Not/AZone", nightUTC)).toBe(false);
  });

  it("computes the next window end", () => {
    const end = nextQuietEnd(quiet, "UTC", nightUTC);
    expect(end.toISOString()).toBe("2026-07-14T07:00:00.000Z");
  });
});

describe("localHourWeekday", () => {
  // 2026-07-14T05:15:00Z: Tue 05:15 in UTC, Mon 22:15 in Los Angeles.
  const utc = new Date("2026-07-14T05:15:00Z");

  it("returns hour/weekday in the given timezone", () => {
    expect(localHourWeekday(utc, "UTC")).toEqual({ hour: 5, weekday: 2 });
    expect(localHourWeekday(utc, "America/Los_Angeles")).toEqual({ hour: 22, weekday: 1 });
  });

  it("falls back to server-local for empty/invalid timezone", () => {
    expect(localHourWeekday(utc, "")).toEqual({ hour: utc.getHours(), weekday: utc.getDay() });
    expect(localHourWeekday(utc, "Not/AZone")).toEqual({
      hour: utc.getHours(),
      weekday: utc.getDay(),
    });
  });
});

describe("planDelivery", () => {
  const prefsWithQuiet: UserPrefs = {
    ...DEFAULT_PREFS,
    notifications: {
      ...DEFAULT_PREFS.notifications,
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
      timezone: "UTC",
    },
  };
  const night = new Date("2026-07-13T23:30:00Z");

  it("queues push/email during quiet hours", () => {
    const plan = planDelivery("push", prefsWithQuiet, night);
    expect(plan.queue).toBe(true);
    if (plan.queue) expect(plan.deliverAfter.toISOString()).toBe("2026-07-14T07:00:00.000Z");
  });

  it("never queues machine channels", () => {
    expect(planDelivery("webhook", prefsWithQuiet, night)).toEqual({ queue: false });
    expect(planDelivery("telegram", prefsWithQuiet, night)).toEqual({ queue: false });
  });

  it("delivers immediately outside the window", () => {
    expect(planDelivery("email", prefsWithQuiet, new Date("2026-07-13T12:00:00Z"))).toEqual({
      queue: false,
    });
  });
});

describe("thresholdState", () => {
  it("classifies crossings", () => {
    expect(thresholdState(150, 100, null)).toBe("above");
    expect(thresholdState(50, 100, 60)).toBe("below");
    expect(thresholdState(80, 100, 60)).toBe("normal");
    expect(thresholdState(null, 100, 60)).toBe("unknown");
  });
});
