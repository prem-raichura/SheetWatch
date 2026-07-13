import webpush from "web-push";
import prisma from "../prisma";
import { NotifyPayload } from "../types";

// VAPID keys are optional (README: push is opt-in). Configure lazily so the
// API/worker still boot without them — sendPush just becomes a no-op.
let configured: boolean | null = null;

function ensureVapid(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn("VAPID keys not set — web push notifications disabled.");
    configured = false;
    return configured;
  }
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO ?? "mailto:admin@sheetwatch.app",
    pub,
    priv
  );
  configured = true;
  return configured;
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function sendPush(sub: PushSub, payload: NotifyPayload): Promise<void> {
  if (!ensureVapid()) return;
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired/revoked — drop it quietly.
      await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } }).catch(() => {});
      return;
    }
    console.error(
      `Push delivery failed (HTTP ${err.statusCode ?? "?"}):`,
      err.body ?? err.message ?? err
    );
    throw err;
  }
}
