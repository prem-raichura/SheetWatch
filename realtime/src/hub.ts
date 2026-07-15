// Durable Object holding every live WebSocket. Uses the hibernation API so
// idle sockets cost nothing: topics ride as connection tags, ping/pong is
// auto-answered without waking the object.

export class Hub {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const userId = request.headers.get("X-User-Id");
      if (!userId) return new Response("missing user", { status: 400 });

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      // Tag = subscription topic; survives hibernation.
      this.state.acceptWebSocket(server, [`user:${userId}`]);
      server.send(JSON.stringify({ type: "ready", topic: `user:${userId}` }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      const { topic, event } = (await request.json()) as {
        topic?: string;
        event?: unknown;
      };
      if (!topic) return Response.json({ error: "topic required" }, { status: 400 });

      const message = JSON.stringify({ type: "event", event });
      let delivered = 0;
      for (const ws of this.state.getWebSockets(topic)) {
        try {
          ws.send(message);
          delivered++;
        } catch {
          // socket already closing — hibernation API cleans it up
        }
      }
      return Response.json({ ok: true, delivered });
    }

    return new Response("not found", { status: 404 });
  }

  // Clients only ever send pings (auto-answered) — ignore anything else.
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closed
    }
  }
}
