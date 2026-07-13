import prisma from "./prisma";
import { computeKpis, type ComputedKpi } from "./kpi";
import { csvRow } from "./csv";
import { sendEmail, type EmailAttachment } from "./notify/email";
import { buildPdf } from "./pdf";

export interface ReportData {
  period: { from: Date; to: Date };
  kpis: ComputedKpi[];
  sheets: { label: string; changeCount: number; lastChangeAt: Date }[];
  recentChanges: { sheetLabel: string; summary: string; createdAt: Date }[];
  totalChanges: number;
}

// Lookback window when a report has never been sent.
const CADENCE_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// Minimum gap between sends — slightly under the nominal period so a report
// that fired at 8:03 still fires at 8:00 the next day/week (mirrors digest.ts).
const MIN_GAP_MS: Record<string, number> = {
  daily: 20 * 60 * 60 * 1000,
  weekly: 6 * 24 * 60 * 60 * 1000,
};

// Pure due-check: hour gate (like digestHour), weekly day gate, min-gap.
export function reportIsDue(
  report: { cadence: string; dayOfWeek: number; hour: number; lastSentAt: Date | null },
  now: Date
): boolean {
  const gap = MIN_GAP_MS[report.cadence];
  if (!gap) return false;
  if (now.getHours() !== report.hour) return false;
  if (report.cadence === "weekly" && now.getUTCDay() !== report.dayOfWeek) return false;
  if (report.lastSentAt && now.getTime() - report.lastSentAt.getTime() < gap) return false;
  return true;
}

export async function buildReportData(
  userId: string,
  since: Date,
  projectId?: string | null
): Promise<ReportData> {
  const [kpis, changes] = await Promise.all([
    computeKpis(userId),
    prisma.changeLog.findMany({
      where: {
        createdAt: { gte: since },
        sheet: { userId, ...(projectId ? { projectId } : {}) },
      },
      include: { sheet: { select: { label: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Per-sheet rollup; changes are newest-first so the first hit per sheet is
  // its most recent change.
  const bySheet = new Map<string, { label: string; changeCount: number; lastChangeAt: Date }>();
  for (const c of changes) {
    const entry = bySheet.get(c.sheetId);
    if (entry) {
      entry.changeCount++;
    } else {
      bySheet.set(c.sheetId, {
        label: c.sheet.label,
        changeCount: 1,
        lastChangeAt: c.createdAt,
      });
    }
  }

  return {
    period: { from: since, to: new Date() },
    kpis,
    sheets: [...bySheet.values()].sort((a, b) => b.changeCount - a.changeCount),
    recentChanges: changes.slice(0, 30).map((c) => ({
      sheetLabel: c.sheet.label,
      summary: c.summary,
      createdAt: c.createdAt,
    })),
    totalChanges: changes.length,
  };
}

// CSV of the recent changes — same escaping rules as the export endpoints.
export function buildReportCsv(data: ReportData): string {
  const lines = [csvRow(["Time", "Sheet", "Summary"])];
  for (const c of data.recentChanges) {
    lines.push(csvRow([c.createdAt.toISOString(), c.sheetLabel, c.summary]));
  }
  return lines.join("\n");
}

export function reportEmailBody(data: ReportData): string {
  return `${data.totalChanges} change${data.totalChanges !== 1 ? "s" : ""} across ${
    data.sheets.length
  } sheet${data.sheets.length !== 1 ? "s" : ""} — report attached.`;
}

export async function buildReportAttachments(
  data: ReportData,
  format: string,
  title: string
): Promise<EmailAttachment[]> {
  const stamp = data.period.to.toISOString().slice(0, 10);
  const attachments: EmailAttachment[] = [];
  if (format === "pdf" || format === "both") {
    attachments.push({
      filename: `sheetwatch-report-${stamp}.pdf`,
      content: await buildPdf(data, title),
    });
  }
  if (format === "csv" || format === "both") {
    attachments.push({
      filename: `sheetwatch-report-${stamp}.csv`,
      content: Buffer.from(buildReportCsv(data), "utf8"),
    });
  }
  return attachments;
}

// Send due scheduled reports. Called from the Vercel cron (every 5 min) and
// from an interval in the local worker — cheap when nobody is due.
export async function sendDueReports(now = new Date()): Promise<number> {
  const reports = await prisma.scheduledReport.findMany({
    where: { enabled: true },
    include: { user: { select: { email: true } } },
  });

  let sent = 0;
  for (const report of reports) {
    if (!reportIsDue(report, now)) continue;

    const since =
      report.lastSentAt ?? new Date(now.getTime() - (CADENCE_MS[report.cadence] ?? CADENCE_MS.weekly));
    const data = await buildReportData(report.userId, since, report.projectId);

    // Mark as sent even when empty so we don't re-scan every 5 minutes.
    await prisma.scheduledReport.update({
      where: { id: report.id },
      data: { lastSentAt: now },
    });

    if (data.totalChanges === 0 && data.kpis.length === 0) continue;

    const title = `SheetWatch ${report.cadence} report`;
    const attachments = await buildReportAttachments(data, report.format, title);
    await sendEmail(
      report.user.email,
      {
        title,
        body: reportEmailBody(data),
        url: process.env.FRONTEND_URL ?? "https://docs.google.com",
      },
      attachments
    ).catch((err) =>
      console.error(`Report email to ${report.user.email} failed:`, err?.message ?? err)
    );
    sent++;
  }
  return sent;
}
