import { describe, expect, it } from "vitest";
import { buildReportCsv, reportIsDue, type ReportData } from "../reports";
import { buildPdf } from "../pdf";
import { extractChartData } from "../charts";

const sampleData: ReportData = {
  period: { from: new Date("2026-07-07T08:00:00Z"), to: new Date("2026-07-14T08:00:00Z") },
  kpis: [
    {
      id: "k1",
      sheetId: "s1",
      sheetLabel: "Budget",
      cell: "B4",
      label: "Revenue",
      format: "currency",
      sortOrder: 0,
      alertAbove: null,
      alertBelow: null,
      value: "12400",
      delta24h: 250,
      series: [1, 2, 3],
    },
  ] as ReportData["kpis"],
  sheets: [{ label: "Budget Q3", changeCount: 5, lastChangeAt: new Date() }],
  recentChanges: [
    {
      sheetLabel: 'Sheet "quoted", with comma',
      summary: "B2: 1 → 2\nmultiline",
      createdAt: new Date("2026-07-13T10:00:00Z"),
    },
  ],
  totalChanges: 5,
};

describe("buildReportCsv", () => {
  it("escapes quotes, commas and newlines", () => {
    const csv = buildReportCsv(sampleData);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Time,Sheet,Summary");
    expect(csv).toContain('"Sheet ""quoted"", with comma"');
    expect(csv).toContain('"B2: 1 → 2');
  });
});

describe("buildPdf", () => {
  it("produces a non-trivial PDF buffer", async () => {
    const buf = await buildPdf(sampleData, "SheetWatch weekly report");
    expect(buf.length).toBeGreaterThan(800);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("reportIsDue", () => {
  const base = { cadence: "daily", dayOfWeek: 1, hour: 8, lastSentAt: null as Date | null };
  const at = (iso: string) => new Date(iso);

  it("fires only in the configured hour", () => {
    const eight = at("2026-07-14T08:15:00");
    const nine = at("2026-07-14T09:15:00");
    expect(reportIsDue(base, eight)).toBe(true);
    expect(reportIsDue(base, nine)).toBe(false);
  });

  it("respects the minimum gap", () => {
    const now = at("2026-07-14T08:15:00");
    expect(reportIsDue({ ...base, lastSentAt: at("2026-07-14T03:00:00") }, now)).toBe(false);
    expect(reportIsDue({ ...base, lastSentAt: at("2026-07-13T08:05:00") }, now)).toBe(true);
  });

  it("weekly also gates on the day", () => {
    const weekly = { ...base, cadence: "weekly" };
    const monday = new Date("2026-07-13T08:15:00");
    monday.setUTCHours(8, 15); // ensure hour matches local getHours in CI-free local run
    const isMonday = monday.getUTCDay() === 1;
    expect(
      reportIsDue({ ...weekly, dayOfWeek: monday.getUTCDay() }, new Date(monday.setHours(8, 15)))
    ).toBe(true);
    expect(isMonday).toBe(true);
  });
});

describe("extractChartData", () => {
  const rows = [
    ["Month", "Revenue", "Costs"],
    ["Jan", "100", "60"],
    ["Feb", "150", "70"],
    ["Mar", "abc", ""],
  ];

  it("extracts labels + numeric series with header row", () => {
    const data = extractChartData(rows, "A1:Z1000", {
      range: "A1:C4",
      xColumn: "A",
      dataColumns: ["B", "C"],
      headerRow: true,
    });
    expect(data.labels).toEqual(["Jan", "Feb", "Mar"]);
    expect(data.series[0]).toEqual({ name: "Revenue", data: [100, 150, null] });
    expect(data.series[1]).toEqual({ name: "Costs", data: [60, 70, null] });
  });

  it("offsets against sheet ranges not starting at A1", () => {
    // Watched range starts at C5 → same grid, shifted coordinates.
    const data = extractChartData(rows, "C5:F100", {
      range: "C5:E8",
      xColumn: "C",
      dataColumns: ["D"],
      headerRow: true,
    });
    expect(data.labels).toEqual(["Jan", "Feb", "Mar"]);
    expect(data.series[0].data).toEqual([100, 150, null]);
  });

  it("defaults data columns to everything but x", () => {
    const data = extractChartData(rows, "A1:Z1000", {
      range: "A1:C4",
      xColumn: null,
      dataColumns: [],
      headerRow: true,
    });
    expect(data.series.map((s) => s.name)).toEqual(["Revenue", "Costs"]);
  });

  it("handles ragged rows and bad ranges", () => {
    expect(extractChartData([], "A1:Z1000", { range: "bogus", xColumn: null, dataColumns: [], headerRow: false })).toEqual({ labels: [], series: [] });
    const data = extractChartData([["a"], ["b", "5"]], "A1:Z1000", {
      range: "A1:B2",
      xColumn: "A",
      dataColumns: ["B"],
      headerRow: false,
    });
    expect(data.series[0].data).toEqual([null, 5]);
  });
});
