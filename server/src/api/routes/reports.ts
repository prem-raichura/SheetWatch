import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import {
  buildReportAttachments,
  buildReportData,
  reportEmailBody,
} from "../../shared/reports";
import { sendEmail } from "../../shared/notify/email";

const router = Router();

const CADENCES = new Set(["daily", "weekly"]);
const FORMATS = new Set(["pdf", "csv", "both"]);

function validate(body: Record<string, unknown>, partial = false): string | null {
  const { cadence, dayOfWeek, hour, format } = body;
  if ((!partial || cadence !== undefined) && (typeof cadence !== "string" || !CADENCES.has(cadence))) {
    return "cadence must be daily or weekly";
  }
  if (dayOfWeek !== undefined && (!Number.isInteger(dayOfWeek) || (dayOfWeek as number) < 0 || (dayOfWeek as number) > 6)) {
    return "dayOfWeek must be 0–6";
  }
  if (hour !== undefined && (!Number.isInteger(hour) || (hour as number) < 0 || (hour as number) > 23)) {
    return "hour must be 0–23";
  }
  if ((!partial || format !== undefined) && (typeof format !== "string" || !FORMATS.has(format))) {
    return "format must be pdf, csv or both";
  }
  return null;
}

async function ownProject(userId: string, projectId: unknown): Promise<boolean> {
  if (projectId === null || projectId === undefined || projectId === "") return true;
  if (typeof projectId !== "string") return false;
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  return Boolean(project);
}

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const reports = await prisma.scheduledReport.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  res.json(reports);
});

router.post("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const body = req.body as Record<string, unknown>;
  const error = validate(body);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (!(await ownProject(userId, body.projectId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const report = await prisma.scheduledReport.create({
    data: {
      userId,
      cadence: body.cadence as string,
      dayOfWeek: (body.dayOfWeek as number | undefined) ?? 1,
      hour: (body.hour as number | undefined) ?? 8,
      format: body.format as string,
      projectId: (body.projectId as string | undefined) || null,
    },
  });
  res.status(201).json(report);
});

router.patch("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const body = req.body as Record<string, unknown>;
  const error = validate(body, true);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  if (body.projectId !== undefined && !(await ownProject(userId, body.projectId))) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  try {
    const report = await prisma.scheduledReport.update({
      where: { id: req.params.id, userId },
      data: {
        ...(body.cadence !== undefined && { cadence: body.cadence as string }),
        ...(body.dayOfWeek !== undefined && { dayOfWeek: body.dayOfWeek as number }),
        ...(body.hour !== undefined && { hour: body.hour as number }),
        ...(body.format !== undefined && { format: body.format as string }),
        ...(body.projectId !== undefined && {
          projectId: (body.projectId as string) || null,
        }),
        ...(body.enabled !== undefined && { enabled: body.enabled as boolean }),
      },
    });
    res.json(report);
  } catch {
    res.status(404).json({ error: "Report not found" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  try {
    await prisma.scheduledReport.delete({ where: { id: req.params.id, userId } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Report not found" });
  }
});

// Immediate send, ignoring the schedule gates.
router.post("/:id/send-now", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const report = await prisma.scheduledReport.findFirst({
    where: { id: req.params.id, userId },
    include: { user: { select: { email: true } } },
  });
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }

  const now = new Date();
  const since = report.lastSentAt ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const data = await buildReportData(userId, since, report.projectId);
  const title = `SheetWatch ${report.cadence} report`;

  try {
    const attachments = await buildReportAttachments(data, report.format, title);
    await sendEmail(
      report.user.email,
      {
        title,
        body: reportEmailBody(data),
        url: process.env.FRONTEND_URL ?? "https://docs.google.com",
      },
      attachments
    );
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Email delivery failed" });
    return;
  }

  await prisma.scheduledReport.update({
    where: { id: report.id },
    data: { lastSentAt: now },
  });
  res.json({ ok: true, totalChanges: data.totalChanges });
});

export default router;
