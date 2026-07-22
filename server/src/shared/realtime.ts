// Fire-and-forget publish to the Cloudflare realtime worker. Entirely optional:
// when REALTIME_URL / REALTIME_SECRET are unset the app runs exactly as before
// (30s polling), so this never blocks or breaks the poll path.

export interface RealtimeEvent {
  kind: "change" | "kpi-alert" | "suggestions";
  sheetId?: string;
  changeLogId?: string;
  groupId?: string;
  label: string;
  summary: string;
}

export async function publishRealtime(userId: string, event: RealtimeEvent): Promise<void> {
  const url = process.env.REALTIME_URL;
  const secret = process.env.REALTIME_SECRET;
  if (!url || !secret) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(`${url.replace(/\/$/, "")}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Realtime-Secret": secret },
      body: JSON.stringify({ topic: `user:${userId}`, event }),
      signal: controller.signal,
    });
  } catch (err: any) {
    console.warn("Realtime publish failed:", err?.message ?? err);
  } finally {
    clearTimeout(timer);
  }
}
