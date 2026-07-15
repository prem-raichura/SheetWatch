import { describe, it, expect } from "vitest";
import { mergePrefs, applyPrefsPatch, DEFAULT_PREFS, UserPrefs } from "../prefs";

describe("mergePrefs", () => {
  it("returns full defaults for null/undefined", () => {
    expect(mergePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(mergePrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it("does not return the DEFAULT_PREFS object itself", () => {
    const merged = mergePrefs(null);
    expect(merged).not.toBe(DEFAULT_PREFS);
    merged.dashboard.sectionOrder.pop();
    expect(DEFAULT_PREFS.dashboard.sectionOrder).toHaveLength(7);
  });

  it("overlays a partial store on top of defaults", () => {
    const merged = mergePrefs({
      appearance: { theme: "dark" },
      notifications: { quietHours: { enabled: true } },
    });
    expect(merged.appearance.theme).toBe("dark");
    expect(merged.appearance.accent).toBe("#0FA3A3");
    expect(merged.notifications.quietHours).toEqual({
      enabled: true,
      start: "22:00",
      end: "07:00",
    });
    expect(merged.landingTab).toBe("/overview");
  });

  it("drops unknown keys and falls back on wrong-typed values", () => {
    const merged = mergePrefs({
      bogus: true,
      appearance: { theme: "neon", accent: 42, extra: "x" },
      time: { hour12: "yes" },
      landingTab: "/nope",
    }) as UserPrefs & { bogus?: unknown };
    expect(merged.bogus).toBeUndefined();
    expect((merged.appearance as Record<string, unknown>).extra).toBeUndefined();
    expect(merged.appearance.theme).toBe("system");
    expect(merged.appearance.accent).toBe("#0FA3A3");
    expect(merged.time.hour12).toBe(true);
    expect(merged.landingTab).toBe("/overview");
  });

  it("survives outright garbage", () => {
    expect(mergePrefs("garbage")).toEqual(DEFAULT_PREFS);
    expect(mergePrefs(42)).toEqual(DEFAULT_PREFS);
    expect(mergePrefs([1, 2, 3])).toEqual(DEFAULT_PREFS);
    expect(mergePrefs({ dashboard: { sectionOrder: "not-an-array" } })).toEqual(DEFAULT_PREFS);
  });

  it("filters stale section ids out of stored arrays", () => {
    const merged = mergePrefs({
      dashboard: { sectionOrder: ["kpis", "removed-section", "stats"], hiddenSections: [7] },
    });
    expect(merged.dashboard.sectionOrder).toEqual(["kpis", "stats"]);
    expect(merged.dashboard.hiddenSections).toEqual([]);
  });
});

describe("applyPrefsPatch", () => {
  it("accepts a valid patch and merges it", () => {
    const { prefs, error } = applyPrefsPatch(DEFAULT_PREFS, {
      appearance: { theme: "dark", accent: "#FF00aa" },
      dashboard: { hiddenSections: ["heatmap"] },
      tables: { tracking: { columns: ["status", "label"] } },
      notifications: {
        sound: "chime",
        quietHours: { enabled: true, start: "23:30", end: "06:15" },
        timezone: "Europe/London",
      },
      time: { hour12: false },
      landingTab: "/tracking",
    });
    expect(error).toBeNull();
    expect(prefs.appearance.theme).toBe("dark");
    expect(prefs.appearance.accent).toBe("#FF00aa");
    expect(prefs.dashboard.hiddenSections).toEqual(["heatmap"]);
    expect(prefs.tables.tracking.columns).toEqual(["status", "label"]);
    expect(prefs.notifications.sound).toBe("chime");
    expect(prefs.notifications.quietHours).toEqual({
      enabled: true,
      start: "23:30",
      end: "06:15",
    });
    expect(prefs.notifications.timezone).toBe("Europe/London");
    expect(prefs.time.hour12).toBe(false);
    expect(prefs.landingTab).toBe("/tracking");
  });

  it("keeps untouched branches intact on deep-merge", () => {
    const current = mergePrefs({
      appearance: { theme: "dark", accent: "#123456" },
      tables: { sheets: { columns: ["name", "tracked"] } },
    });
    const { prefs, error } = applyPrefsPatch(current, {
      notifications: { quietHours: { start: "21:00" } },
    });
    expect(error).toBeNull();
    // patched leaf
    expect(prefs.notifications.quietHours.start).toBe("21:00");
    // siblings of the patched leaf
    expect(prefs.notifications.quietHours.enabled).toBe(false);
    expect(prefs.notifications.quietHours.end).toBe("07:00");
    // untouched branches
    expect(prefs.appearance.theme).toBe("dark");
    expect(prefs.appearance.accent).toBe("#123456");
    expect(prefs.tables.sheets.columns).toEqual(["name", "tracked"]);
    expect(prefs.dashboard.sectionOrder).toEqual(DEFAULT_PREFS.dashboard.sectionOrder);
    // views branch defaults in for users who predate it
    expect(prefs.views).toEqual(DEFAULT_PREFS.views);
  });

  it("does not mutate the current prefs object", () => {
    const current = mergePrefs(null);
    applyPrefsPatch(current, { appearance: { theme: "light" } });
    expect(current.appearance.theme).toBe("system");
  });

  it("keeps an empty timezone as sent", () => {
    const { prefs, error } = applyPrefsPatch(mergePrefs({ notifications: { timezone: "Asia/Kolkata" } }), {
      notifications: { timezone: "" },
    });
    expect(error).toBeNull();
    expect(prefs.notifications.timezone).toBe("");
  });

  it("rejects a bad enum value", () => {
    const { prefs, error } = applyPrefsPatch(DEFAULT_PREFS, {
      appearance: { density: "cozy" },
    });
    expect(error).toMatch(/appearance\.density/);
    expect(prefs).toBe(DEFAULT_PREFS);
  });

  it("rejects a bad accent hex", () => {
    for (const accent of ["red", "#12345", "#12345G", "0FA3A3"]) {
      expect(applyPrefsPatch(DEFAULT_PREFS, { appearance: { accent } }).error).toMatch(
        /appearance\.accent/
      );
    }
  });

  it("rejects bad quiet-hours times", () => {
    for (const start of ["24:00", "9:00", "12:60", "noon"]) {
      expect(
        applyPrefsPatch(DEFAULT_PREFS, { notifications: { quietHours: { start } } }).error
      ).toMatch(/quietHours\.start/);
    }
    expect(
      applyPrefsPatch(DEFAULT_PREFS, { notifications: { quietHours: { end: "7:5" } } }).error
    ).toMatch(/quietHours\.end/);
  });

  it("rejects a bad timezone but accepts valid ones", () => {
    expect(
      applyPrefsPatch(DEFAULT_PREFS, { notifications: { timezone: "Mars/Olympus" } }).error
    ).toMatch(/timezone/);
    expect(
      applyPrefsPatch(DEFAULT_PREFS, { notifications: { timezone: "America/New_York" } }).error
    ).toBeNull();
  });

  it("rejects unknown section ids", () => {
    expect(
      applyPrefsPatch(DEFAULT_PREFS, { dashboard: { sectionOrder: ["stats", "nope"] } }).error
    ).toMatch(/sectionOrder/);
    expect(
      applyPrefsPatch(DEFAULT_PREFS, { dashboard: { hiddenSections: ["nope"] } }).error
    ).toMatch(/hiddenSections/);
    expect(
      applyPrefsPatch(DEFAULT_PREFS, { tables: { sheets: { columns: ["status"] } } }).error
    ).toMatch(/tables\.sheets\.columns/);
  });

  it("rejects a bad landingTab", () => {
    expect(applyPrefsPatch(DEFAULT_PREFS, { landingTab: "/settings" }).error).toMatch(
      /landingTab/
    );
  });

  it("accepts valid view modes", () => {
    const { prefs, error } = applyPrefsPatch(DEFAULT_PREFS, {
      views: { tracking: "list", sheets: "cards", activity: "table", kpis: "strip" },
    });
    expect(error).toBeNull();
    expect(prefs.views).toEqual({
      tracking: "list",
      sheets: "cards",
      activity: "table",
      kpis: "strip",
    });
  });

  it("rejects bad view modes and unknown surfaces", () => {
    expect(applyPrefsPatch(DEFAULT_PREFS, { views: { tracking: "grid" } }).error).toMatch(
      /views\.tracking/
    );
    expect(applyPrefsPatch(DEFAULT_PREFS, { views: { kpis: "cards" } }).error).toBeNull();
    expect(applyPrefsPatch(DEFAULT_PREFS, { views: { mystery: "cards" } }).error).toMatch(
      /unknown pref key "views\.mystery"/
    );
  });

  it("allows reordering table columns (order = display order)", () => {
    const { prefs, error } = applyPrefsPatch(DEFAULT_PREFS, {
      tables: { tracking: { columns: ["label", "status", "actions"] } },
    });
    expect(error).toBeNull();
    expect(prefs.tables.tracking.columns).toEqual(["label", "status", "actions"]);
  });

  it("rejects unknown keys and non-object patches", () => {
    expect(applyPrefsPatch(DEFAULT_PREFS, { mystery: 1 }).error).toMatch(/unknown pref key/);
    expect(applyPrefsPatch(DEFAULT_PREFS, "nope").error).toBeTruthy();
    expect(applyPrefsPatch(DEFAULT_PREFS, null).error).toBeTruthy();
  });
});
