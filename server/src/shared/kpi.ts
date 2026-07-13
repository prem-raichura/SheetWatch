import type { Sheet } from "@prisma/client";
import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { columnToIndex, rangeStartColumn } from "./google/sheets";
import { parseNumeric } from "./rules";
import { dispatch, safeHost, type ChannelTarget } from "./notify/dispatch";

// Absolute A1 cell ("B4") → value in the watched grid, which starts at the
// range's first cell. Returns null when the cell is outside the grid.
export function cellValue(rows: string[][], cell: string, range: string): string | null {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec(cell.trim());
  if (!m) return null;
  const col = columnToIndex(m[1]) - rangeStartColumn(range);
  const rowStart = Number((range.trim().match(/^[A-Za-z]{1,3}(\d+)/) ?? [])[1] ?? 1);
  const row = Number(m[2]) - rowStart;
  if (row < 0 || col < 0) return null;
  return rows[row]?.[col] ?? null;
}

export interface ComputedKpi {
  id: string;
  sheetId: string;
  sheetLabel: string;
  cell: string;
  label: string;
  format: string;
  sortOrder: number;
  alertAbove: number | null;
  alertBelow: number | null;
  value: string | null;
  delta24h: number | null;
  series: (number | null)[];
}

// Compute a user's KPI widgets (current value, 24h delta, 30-snapshot series).
// Shared by the dashboard route, scheduled reports and public share links.
// When widgetIds is a non-empty array, only those widgets are computed.
export async function computeKpis(
  userId: string,
  widgetIds?: string[]
): Promise<ComputedKpi[]> {
  const widgets = await prisma.kpiWidget.findMany({
    where: {
      userId,
      ...(widgetIds && widgetIds.length > 0 && { id: { in: widgetIds } }),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { sheet: { select: { label: true, range: true, lastSnapshot: true } } },
  });

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return Promise.all(
    widgets.map(async (w) => {
      const rows = (w.sheet.lastSnapshot as string[][] | null) ?? [];
      const value = cellValue(rows, w.cell, w.sheet.range);

      // History for sparkline + 24h delta, oldest→newest.
      const snapshots = await prisma.snapshot.findMany({
        where: { sheetId: w.sheetId },
        orderBy: { createdAt: "desc" },
        select: { rows: true, createdAt: true },
        take: 30,
      });

      const series = snapshots
        .reverse()
        .map((s) => {
          const v = cellValue((s.rows as unknown as string[][]) ?? [], w.cell, w.sheet.range);
          const n = v === null ? NaN : parseNumeric(v);
          return Number.isNaN(n) ? null : n;
        });

      let delta24h: number | null = null;
      const current = value === null ? NaN : parseNumeric(value);
      if (!Number.isNaN(current)) {
        const old = snapshots.find((s) => s.createdAt <= dayAgo);
        if (old) {
          const v = cellValue((old.rows as unknown as string[][]) ?? [], w.cell, w.sheet.range);
          const n = v === null ? NaN : parseNumeric(v);
          if (!Number.isNaN(n)) delta24h = current - n;
        }
      }

      return {
        id: w.id,
        sheetId: w.sheetId,
        sheetLabel: w.sheet.label,
        cell: w.cell,
        label: w.label,
        format: w.format,
        sortOrder: w.sortOrder,
        alertAbove: w.alertAbove,
        alertBelow: w.alertBelow,
        value,
        delta24h,
        series,
      };
    })
  );
}

type AlertState = "above" | "below" | "normal" | "unknown";

export function thresholdState(
  value: number | null,
  alertAbove: number | null,
  alertBelow: number | null
): AlertState {
  if (value === null || Number.isNaN(value)) return "unknown";
  if (alertAbove !== null && value > alertAbove) return "above";
  if (alertBelow !== null && value < alertBelow) return "below";
  return "normal";
}

// Fires when a pinned cell crosses into above/below — once per crossing, not
// on every poll while it stays there.
export async function checkKpiThresholds(sheet: Sheet, rows: string[][]): Promise<void> {
  const widgets = await prisma.kpiWidget.findMany({
    where: {
      sheetId: sheet.id,
      OR: [{ alertAbove: { not: null } }, { alertBelow: { not: null } }],
    },
  });
  if (widgets.length === 0) return;

  const user = await prisma.user.findUnique({
    where: { id: sheet.userId },
    include: { pushSubs: true },
  });
  if (!user) return;

  for (const w of widgets) {
    const raw = cellValue(rows, w.cell, sheet.range);
    const n = raw === null ? NaN : parseNumeric(raw);
    const state = thresholdState(Number.isNaN(n) ? null : n, w.alertAbove, w.alertBelow);
    if (state === w.lastAlertState) continue;

    await prisma.kpiWidget.update({
      where: { id: w.id },
      data: { lastAlertState: state } as Prisma.KpiWidgetUpdateInput,
    });

    if (state !== "above" && state !== "below") continue;

    const threshold = state === "above" ? w.alertAbove : w.alertBelow;
    const payload = {
      title: `KPI alert: ${w.label}`,
      body: `${w.label} is ${raw ?? "—"} — crossed ${state} ${threshold}`,
      url: `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}`,
    };

    const targets: ChannelTarget[] = [{ channel: "email", email: user.email }];
    for (const sub of user.pushSubs) {
      targets.push({
        channel: "push",
        sub: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        endpointHost: safeHost(sub.endpoint),
      });
    }

    await dispatch({
      userId: sheet.userId,
      sheetId: sheet.id,
      payload,
      targets,
    });
  }
}
