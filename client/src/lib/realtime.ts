export interface RealtimeEvent {
  kind: "change" | "kpi-alert" | "suggestions";
  sheetId?: string;
  changeLogId?: string;
  groupId?: string;
  label: string;
  summary: string;
}

export type RealtimeStatus = "off" | "connecting" | "connected";

interface Options {
  // Returns { token, url } or nulls when realtime isn't configured.
  getToken: () => Promise<{ token: string | null; url: string | null }>;
  onEvent: (event: RealtimeEvent) => void;
  onStatus: (status: RealtimeStatus) => void;
}

// Opens and maintains one WebSocket to the realtime worker: fresh token per
// attempt, 25s heartbeat ping, exponential backoff reconnect (1s→30s). Returns
// a cleanup function. No-ops gracefully when realtime is unconfigured.
export function connectRealtime({ getToken, onEvent, onStatus }: Options): () => void {
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;

  const clearTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    if (retryTimer) clearTimeout(retryTimer);
    pingTimer = null;
    retryTimer = null;
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(1000 * 2 ** attempt, 30_000);
    attempt++;
    retryTimer = setTimeout(connect, delay);
  };

  async function connect() {
    if (closed) return;
    onStatus("connecting");
    let creds: { token: string | null; url: string | null };
    try {
      creds = await getToken();
    } catch {
      scheduleReconnect();
      return;
    }
    if (!creds.token || !creds.url) {
      onStatus("off");
      return; // realtime not configured — stay silent, polling covers it
    }

    const wsUrl = creds.url.replace(/^http/, "ws").replace(/\/$/, "");
    try {
      ws = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(creds.token)}`);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      onStatus("connected");
      pingTimer = setInterval(() => {
        try {
          ws?.send("ping");
        } catch {
          // socket gone — onclose will handle reconnect
        }
      }, 25_000);
    };

    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "event" && msg.event) onEvent(msg.event as RealtimeEvent);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      clearTimers();
      if (!closed) {
        onStatus("connecting");
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        // already closing
      }
    };
  }

  connect();

  return () => {
    closed = true;
    clearTimers();
    try {
      ws?.close();
    } catch {
      // already closed
    }
  };
}
