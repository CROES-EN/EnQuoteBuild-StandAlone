const WebSocket = require("ws");

const DEFAULT_PING_INTERVAL_MS = 25 * 1000;
const DEFAULT_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30 * 1000;

function makeWebSocketUrl(workerUrl) {
  const url = new URL(workerUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function startRealtimeSync({
  workerUrl,
  sharedSecret,
  accessHeaders = {},
  onQuotesUpdated,
  onOutboundStatus,
  logger = console,
  WebSocketImpl = WebSocket,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  pingIntervalMs = DEFAULT_PING_INTERVAL_MS
}) {
  if (!workerUrl || !sharedSecret) {
    throw new Error("A Worker URL and snapshot token are required for realtime sync.");
  }

  let stopped = false;
  let socket = null;
  let reconnectTimer = null;
  let pingTimer = null;
  let reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;

  const connect = () => {
    if (stopped) return;
    const headers = {
      "X-ENQuote-Shared-Secret": sharedSecret,
      ...accessHeaders
    };
    try {
      socket = new WebSocketImpl(makeWebSocketUrl(workerUrl), { headers });
    } catch (error) {
      logger.warn("[realtime-sync] Could not open WebSocket:", error.message);
      scheduleReconnect();
      return;
    }

    const connectedSocket = socket;
    connectedSocket.on("open", () => {
      reconnectDelay = DEFAULT_RECONNECT_DELAY_MS;
      logger.info("[realtime-sync] Connected to Cloudflare quote updates.");
      pingTimer = setIntervalFn(() => {
        if (socket === connectedSocket && socket.readyState === WebSocketImpl.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, pingIntervalMs);
    });

    connectedSocket.on("message", (rawMessage) => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        return;
      }
      if (message?.type === "outbound_status") {
        try {
          const result = onOutboundStatus?.(message);
          if (result && typeof result.catch === "function") {
            result.catch((error) => logger.error("[realtime-sync] Outbound status handling failed:", error.message));
          }
        } catch (error) {
          logger.error("[realtime-sync] Outbound status handling failed:", error.message);
        }
        return;
      }
      if (message?.type !== "quotes_updated") return;
      try {
        const result = onQuotesUpdated?.(message);
        if (result && typeof result.catch === "function") {
          result.catch((error) => logger.error("[realtime-sync] Quote refresh failed:", error.message));
        }
      } catch (error) {
        logger.error("[realtime-sync] Quote refresh failed:", error.message);
      }
    });

    connectedSocket.on("error", (error) => {
      logger.warn("[realtime-sync] WebSocket error:", error.message);
    });

    connectedSocket.on("close", () => {
      if (socket !== connectedSocket) return;
      if (pingTimer) clearIntervalFn(pingTimer);
      pingTimer = null;
      socket = null;
      if (stopped || reconnectTimer) return;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
      reconnectTimer = setTimeoutFn(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    });
  };

  connect();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (pingTimer) clearIntervalFn(pingTimer);
      if (reconnectTimer) clearTimeoutFn(reconnectTimer);
      pingTimer = null;
      reconnectTimer = null;
      if (socket && socket.readyState !== WebSocketImpl.CLOSED) socket.close();
      socket = null;
    }
  };
}

module.exports = { startRealtimeSync, makeWebSocketUrl };
