import prisma from "./prisma";
import { sendEmail, escapeHtml } from "./notify/email";
import { mergePrefs } from "./prefs";
import { localHourWeekday } from "./quietHours";

// Minimum gap between digests — slightly under the nominal period so a
// digest that fired at 8:03 still fires at 8:00 the next day/week.
const MIN_GAP_MS: Record<string, number> = {
  daily: 20 * 60 * 60 * 1000,
  weekly: 6.5 * 24 * 60 * 60 * 1000,
};

// Send due digest emails. Called from the Vercel cron (every 5 min) and
// from an interval in the local worker — cheap when nobody is due.
export async function sendDueDigests(now = new Date()): Promise<number> {
  const users = await prisma.user.findMany({
    where: { digest: { in: ["daily", "weekly"] } },
    select: {
      id: true,
      email: true,
      digest: true,
      digestHour: true,
      lastDigestAt: true,
      prefs: true,
    },
  });

  let sent = 0;
  for (const user of users) {
    // digestHour is the user's intended *local* hour — compare in their timezone.
    const tz = mergePrefs(user.prefs).notifications.timezone;
    if (localHourWeekday(now, tz).hour !== user.digestHour) continue;
    const gap = MIN_GAP_MS[user.digest];
    if (user.lastDigestAt && now.getTime() - user.lastDigestAt.getTime() < gap) continue;

    const since =
      user.lastDigestAt ??
      new Date(now.getTime() - (user.digest === "daily" ? 24 : 24 * 7) * 60 * 60 * 1000);

    const changes = await prisma.changeLog.findMany({
      where: { sheet: { userId: user.id }, createdAt: { gte: since } },
      include: { sheet: { select: { label: true, spreadsheetId: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Mark as sent even when empty so we don't re-scan every 5 minutes.
    await prisma.user.update({
      where: { id: user.id },
      data: { lastDigestAt: now },
    });

    if (changes.length === 0) continue;

    await sendEmail(user.email, {
      title: `SheetWatch ${user.digest} digest — ${changes.length} change${changes.length !== 1 ? "s" : ""}`,
      body: buildDigestText(changes),
      url: process.env.FRONTEND_URL ?? "https://docs.google.com",
    }).catch((err) => console.error(`Digest email to ${user.email} failed:`, err?.message ?? err));
    sent++;
  }
  return sent;
}

interface DigestChange {
  summary: string;
  createdAt: Date;
  sheet: { label: string; spreadsheetId: string };
}

// Plain-text body (sendEmail escapes HTML): one line per sheet with counts,
// then the most recent few summaries.
export function buildDigestText(changes: DigestChange[]): string {
  const bySheet = new Map<string, { label: string; count: number }>();
  for (const c of changes) {
    const entry = bySheet.get(c.sheet.spreadsheetId) ?? { label: c.sheet.label, count: 0 };
    entry.count++;
    bySheet.set(c.sheet.spreadsheetId, entry);
  }
  const lines = [...bySheet.values()]
    .sort((a, b) => b.count - a.count)
    .map((s) => `${s.label}: ${s.count} change${s.count !== 1 ? "s" : ""}`);
  return lines.join(" · ");
}

// Suppress instant per-change emails for users who chose a digest.
export function digestSuppressesEmail(digest: string): boolean {
  return digest === "daily" || digest === "weekly";
}

// re-export for digest email building elsewhere
export { escapeHtml };
