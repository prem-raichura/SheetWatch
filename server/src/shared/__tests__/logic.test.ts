import { describe, it, expect } from "vitest";
import { diffGrid, diffGridSmart, hashGrid } from "../google/diff";
import { columnToIndex, indexToColumn, rangeStartColumn } from "../google/sheets";
import { matchesRules, validateRules, parseNumeric, AlertRule } from "../rules";
import { csvEscape, changesToCsv } from "../csv";
import { validateWebhookUrl } from "../notify/webhook";

describe("diffGrid", () => {
  it("reports cell edits with 1-based refs", () => {
    const changes = diffGrid([["a", "b"]], [["a", "c"]]);
    expect(changes).toEqual([{ cell: "R1C2", before: "b", after: "c" }]);
  });

  it("handles ragged rows and growth", () => {
    const changes = diffGrid([["a"]], [["a", "x"], ["y"]]);
    expect(changes).toContainEqual({ cell: "R1C2", before: "", after: "x" });
    expect(changes).toContainEqual({ cell: "R2C1", before: "", after: "y" });
  });
});

describe("diffGridSmart", () => {
  const rows = [
    ["h1", "h2"],
    ["a", "1"],
    ["b", "2"],
    ["c", "3"],
  ];

  it("detects a single row insertion instead of cascading edits", () => {
    const withInsert = [rows[0], rows[1], ["NEW", "9"], rows[2], rows[3]];
    const { changes, summary } = diffGridSmart(rows, withInsert);
    expect(summary).toBe("1 row inserted at row 3");
    expect(changes).toEqual([
      { cell: "R3C1", before: "", after: "NEW" },
      { cell: "R3C2", before: "", after: "9" },
    ]);
  });

  it("detects row deletion", () => {
    const withDelete = [rows[0], rows[1], rows[3]];
    const { summary } = diffGridSmart(rows, withDelete);
    expect(summary).toBe("1 row deleted at row 3");
  });

  it("falls back to cell diff when rows change and shift", () => {
    const edited = [rows[0], ["a", "42"], rows[2], rows[3]];
    const { summary, changes } = diffGridSmart(rows, edited);
    expect(summary).toBe("1 cell changed");
    expect(changes).toEqual([{ cell: "R2C2", before: "1", after: "42" }]);
  });

  it("hash differs for different grids", () => {
    expect(hashGrid([["a"]])).not.toBe(hashGrid([["b"]]));
  });
});

describe("column helpers", () => {
  it("round-trips letters and indexes", () => {
    expect(columnToIndex("A")).toBe(0);
    expect(columnToIndex("AA")).toBe(26);
    expect(indexToColumn(0)).toBe("A");
    expect(indexToColumn(26)).toBe("AA");
    expect(indexToColumn(columnToIndex("XFD"))).toBe("XFD");
  });

  it("finds a range's start column", () => {
    expect(rangeStartColumn("B2:D50")).toBe(1);
    expect(rangeStartColumn("5:5")).toBe(0);
    expect(rangeStartColumn("A1:Z1000")).toBe(0);
  });
});

describe("alert rules", () => {
  const rules: AlertRule[] = [
    { column: "C", op: "changes_to", value: "Done" },
    { column: "F", op: "gt", value: "100" },
  ];

  it("matches changes_to on the right column with offset ranges", () => {
    // Range starts at B → grid C2 is sheet column C… grid col 2 = C.
    const changes = [{ cell: "R4C2", before: "Open", after: "Done" }];
    expect(matchesRules(changes, rules, "B2:F50")).toBe(true);
  });

  it("ignores matches on other columns", () => {
    const changes = [{ cell: "R4C1", before: "Open", after: "Done" }]; // column B
    expect(matchesRules(changes, rules, "B2:F50")).toBe(false);
  });

  it("evaluates numeric gt with currency formatting", () => {
    const changes = [{ cell: "R2C5", before: "$50", after: "$1,250.50" }]; // column F
    expect(matchesRules(changes, rules, "B2:F50")).toBe(true);
  });

  it("does not fire changes_to when value was already the target", () => {
    const changes = [{ cell: "R4C2", before: "Done", after: "done" }];
    expect(matchesRules(changes, rules, "B2:F50")).toBe(false);
  });

  it("empty rules always pass", () => {
    expect(matchesRules([{ cell: "R1C1", before: "", after: "x" }], [], "A1")).toBe(true);
  });

  it("validateRules rejects bad shapes", () => {
    expect(validateRules([{ column: "C", op: "eq", value: "x" }])).toBeNull();
    expect(validateRules([{ column: "1", op: "eq", value: "x" }])).toMatch(/column/);
    expect(validateRules([{ column: "C", op: "nope", value: "x" }])).toMatch(/op/);
    expect(validateRules([{ column: "C", op: "gt", value: "abc" }])).toMatch(/numeric/);
  });

  it("parseNumeric strips formatting", () => {
    expect(parseNumeric("$1,250.50")).toBe(1250.5);
    expect(parseNumeric("87%")).toBe(87);
  });
});

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvEscape('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvEscape("plain")).toBe("plain");
  });

  it("flattens change logs to one row per cell", () => {
    const csv = changesToCsv([
      {
        id: "c1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        summary: "1 cell changed",
        details: [{ cell: "R1C1", before: "a", after: "b" }],
      },
    ]);
    expect(csv).toBe("c1,2026-01-01T00:00:00.000Z,1 cell changed,R1C1,a,b");
  });
});

describe("webhook url validation", () => {
  it("accepts normal https hosts", () => {
    expect(validateWebhookUrl("https://hooks.slack.com/services/T/B/x")).toBeNull();
  });
  it("rejects http, IPs and internal hosts", () => {
    expect(validateWebhookUrl("http://hooks.slack.com/x")).toMatch(/https/);
    expect(validateWebhookUrl("https://127.0.0.1/x")).toMatch(/IP/);
    expect(validateWebhookUrl("https://localhost/x")).toMatch(/Internal/);
    expect(validateWebhookUrl("https://foo.internal/x")).toMatch(/Internal/);
    expect(validateWebhookUrl("not a url")).toMatch(/Invalid/);
  });
});
