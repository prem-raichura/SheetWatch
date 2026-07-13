import { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { mergePrefs, type UserPrefs } from "../prefs";
import { isQuiet, nextQuietEnd } from "../quietHours";
import { NotifyPayload } from "../types";
import { sendEmail } from "./email";
import { sendPush, type PushSub } from "./push";
import { sendWebhook } from "./webhook";
import { sendTelegram } from "./telegram";

export type ChannelTarget =
  | { channel: "email"; email: string }
  | { channel: "push"; sub: PushSub; endpointHost: string }
  | { channel: "webhook"; kind: string; url: string; label: string }
  | { channel: "telegram"; chatId: string; label: string };

export interface DispatchInput {
  userId: string;
  sheetId?: string;
  changeLogId?: string;
  payload: NotifyPayload;
  targets: ChannelTarget[];
  prefs?: UserPrefs; // pass to avoid a re-read when the caller already has it
  now?: Date;
}

// Pure decision: deliver now, or queue until quiet hours end. Webhooks and
// telegram are machine channels — they are never held.
export function planDelivery(
  channel: ChannelTarget["channel"],
  prefs: UserPrefs,
  now = new Date()
): { queue: false } | { queue: true; deliverAfter: Date } {
  if (channel === "webhook" || channel === "telegram") return { queue: false };
  const quiet = prefs.notifications.quietHours;
  const tz = prefs.notifications.timezone;
  if (!isQuiet(quiet, tz, now)) return { queue: false };
  return { queue: true, deliverAfter: nextQuietEnd(quiet, tz, now) };
}

function targetLabel(t: ChannelTarget): string {
  switch (t.channel) {
    case "email":
      return t.email;
    case "push":
      return t.endpointHost;
    case "webhook":
      return t.label;
    case "telegram":
      return t.label || t.chatId;
  }
}

function logChannel(t: ChannelTarget): string {
  return t.channel;
}

async function deliver(t: ChannelTarget, payload: NotifyPayload): Promise<void> {
  switch (t.channel) {
    case "email":
      return sendEmail(t.email, payload);
    case "push":
      return sendPush(t.sub, payload);
    case "webhook":
      return sendWebhook({ kind: t.kind, url: t.url }, payload);
    case "telegram":
      return sendTelegram(t.chatId, payload);
  }
}

async function writeLog(
  input: DispatchInput,
  t: ChannelTarget,
  status: "sent" | "failed" | "queued",
  extra: { error?: string; deliverAfter?: Date } = {}
): Promise<void> {
  await prisma.notificationLog
    .create({
      data: {
        userId: input.userId,
        sheetId: input.sheetId ?? null,
        changeLogId: input.changeLogId ?? null,
        channel: logChannel(t),
        target: targetLabel(t),
        title: input.payload.title,
        body: input.payload.body,
        status,
        error: extra.error ?? null,
        deliverAfter: extra.deliverAfter ?? null,
        sentAt: status === "sent" ? new Date() : null,
        // queued rows carry the payload target so the flush can re-send
        // without re-deriving subscriptions/webhooks.
      },
    })
    .catch((err) => console.error("NotificationLog write failed:", err?.message ?? err));
}

// Sends (or queues) the payload to every target, recording one log row per
// target. Failures are isolated per target.
export async function dispatch(input: DispatchInput): Promise<void> {
  const prefs =
    input.prefs ??
    mergePrefs(
      (await prisma.user.findUnique({ where: { id: input.userId }, select: { prefs: true } }))
        ?.prefs ?? null
    );
  const now = input.now ?? new Date();

  await Promise.allSettled(
    input.targets.map(async (t) => {
      const plan = planDelivery(t.channel, prefs, now);
      if (plan.queue) {
        await writeQueued(input, t, plan.deliverAfter);
        return;
      }
      try {
        await deliver(t, input.payload);
        await writeLog(input, t, "sent");
      } catch (err: any) {
        await writeLog(input, t, "failed", { error: String(err?.message ?? err).slice(0, 300) });
      }
    })
  );
}

// Queued rows re-derive their live targets at flush time (current push subs,
// current email) rather than freezing endpoints in the row — see
// resolveQueuedTargets.
async function writeQueued(input: DispatchInput, t: ChannelTarget, deliverAfter: Date) {
  await prisma.notificationLog
    .create({
      data: {
        userId: input.userId,
        sheetId: input.sheetId ?? null,
        changeLogId: input.changeLogId ?? null,
        channel: logChannel(t),
        target: targetLabel(t),
        title: input.payload.title,
        body: input.payload.body,
        status: "queued",
        deliverAfter,
        attempts: 0,
      },
    })
    .catch((err) => console.error("NotificationLog write failed:", err?.message ?? err));
}

// Re-resolve a queued row into a live target. Push fans out to the user's
// current devices; email uses the user's address. (Webhook/telegram rows are
// never queued.)
async function resolveQueuedTargets(row: {
  userId: string;
  channel: string;
}): Promise<ChannelTarget[]> {
  if (row.channel === "email") {
    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { email: true },
    });
    return user ? [{ channel: "email", email: user.email }] : [];
  }
  if (row.channel === "push") {
    const subs = await prisma.pushSubscription.findMany({ where: { userId: row.userId } });
    return subs.map((sub) => ({
      channel: "push" as const,
      sub: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      endpointHost: safeHost(sub.endpoint),
    }));
  }
  return [];
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 60);
  }
}

// Delivers everything whose quiet window has ended. Called from the worker
// interval and the Vercel cron. One queued row may fan out to several pushes;
// the row itself flips to sent/failed once.
export async function flushQueuedNotifications(now = new Date()): Promise<number> {
  const due = await prisma.notificationLog.findMany({
    where: { status: "queued", deliverAfter: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  let flushed = 0;
  for (const row of due) {
    const payload: NotifyPayload = {
      title: row.title,
      body: row.body,
      url: row.sheetId
        ? await sheetUrl(row.sheetId)
        : "https://sheetwatch.local",
    };
    const targets = await resolveQueuedTargets(row);
    let error: string | null = null;
    for (const t of targets) {
      try {
        await deliver(t, payload);
      } catch (err: any) {
        error = String(err?.message ?? err).slice(0, 300);
      }
    }
    await prisma.notificationLog.update({
      where: { id: row.id },
      data: {
        status: error ? "failed" : "sent",
        error,
        attempts: { increment: 1 },
        sentAt: error ? null : new Date(),
      } as Prisma.NotificationLogUpdateInput,
    });
    flushed += 1;
  }
  return flushed;
}

async function sheetUrl(sheetId: string): Promise<string> {
  const sheet = await prisma.sheet.findUnique({
    where: { id: sheetId },
    select: { spreadsheetId: true },
  });
  return sheet
    ? `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}`
    : "https://sheetwatch.local";
}
