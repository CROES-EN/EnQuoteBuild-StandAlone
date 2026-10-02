import { json } from "./util.js";

const ROOM_NAME = "enquote-quotes";

function hasSnapshotToken(request, env) {
  return Boolean(env.SNAPSHOT_TOKEN) &&
    request.headers.get("X-ENQuote-Shared-Secret") === env.SNAPSHOT_TOKEN;
}

export class QuoteSyncRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      if (request.headers.get("X-Internal-Sync-Key") !== this.env.SNAPSHOT_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }

      const payload = await request.json();
      const message = JSON.stringify(payload);
      let delivered = 0;
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(message);
          delivered += 1;
        } catch (error) {
          console.warn("[realtime] Could not notify a connected client:", error.message);
        }
      }
      return json({ ok: true, delivered });
    }

    if (url.pathname !== "/ws" || request.method !== "GET") {
      return json({ error: "not_found" }, 404);
    }
    if (!hasSnapshotToken(request, this.env)) {
      return json({ error: "unauthorized" }, 401);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket_upgrade_required" }, 426);
    }

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(socket, message) {
    if (message === "ping") socket.send("pong");
  }
}

export async function handleRealtimeSocket(request, env) {
  if (!hasSnapshotToken(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!env.QUOTE_SYNC_ROOM) {
    return json({ error: "realtime_not_configured" }, 503);
  }

  const room = env.QUOTE_SYNC_ROOM.get(env.QUOTE_SYNC_ROOM.idFromName(ROOM_NAME));
  return room.fetch(request);
}

export async function broadcastMessage(env, message) {
  if (!env.QUOTE_SYNC_ROOM) {
    console.warn("[realtime] Durable Object binding is unavailable; periodic polling remains active.");
    return;
  }
  const room = env.QUOTE_SYNC_ROOM.get(env.QUOTE_SYNC_ROOM.idFromName(ROOM_NAME));
  const response = await room.fetch("https://quote-sync-room/broadcast", {
    method: "POST",
    headers: { "X-Internal-Sync-Key": env.SNAPSHOT_TOKEN || "" },
    body: JSON.stringify(message)
  });
  if (!response.ok) {
    console.warn(`[realtime] Broadcast failed with HTTP ${response.status}.`);
  }
}

export async function broadcastQuoteUpdate(env, data) {
  return broadcastMessage(env, { type: "quotes_updated", ...data });
}
