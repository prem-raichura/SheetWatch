import { Hub } from "./hub";
import { verifyToken } from "./token";

export { Hub };

interface Env {
  HUB: DurableObjectNamespace;
  REALTIME_SECRET: string;
}

// One shared DO instance holds every connection — plenty for self-hosted scale.
function hub(env: Env): DurableObjectStub {
  return env.HUB.get(env.HUB.idFromName("global"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json(
        { ok: true },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Client WebSocket upgrade. Auth is the short-lived token in the query
    // string (headers aren't settable on a browser WebSocket).
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const token = url.searchParams.get("token") ?? "";
      const userId = await verifyToken(token, env.REALTIME_SECRET);
      if (!userId) return new Response("unauthorized", { status: 401 });

      const req = new Request("https://hub/ws", {
        headers: { "X-User-Id": userId, Upgrade: "websocket" },
      });
      return hub(env).fetch(req);
    }

    // Server → worker publish. Shared-secret header; server-to-server only.
    if (url.pathname === "/notify" && request.method === "POST") {
      if (request.headers.get("X-Realtime-Secret") !== env.REALTIME_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const body = await request.text();
      const req = new Request("https://hub/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      return hub(env).fetch(req);
    }

    return new Response("not found", { status: 404 });
  },
};
