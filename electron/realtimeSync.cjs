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
  onSupervisorUpdated,
  // Extra message handlers keyed by message type (tasks_updated, sops_updated, inbox_updated...).
  handlers = {},
  // Called with true/false as the live connection opens or drops, so pollers can slow down.
  onConnectionChange,
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
  let connected = false;
  let sawPong = false;
  let lastMessageAt = 0;

  const setConnected = (value) => {
    if (connected === value) return;
    connected = value;
    try {
      onConnectionChange?.(value);
    } catch (error) {
      logger.error("[realtime-sync] Connection state handler failed:", error.message);
    }
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

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
      lastMessageAt = Date.now();
      setConnected(true);
      pingTimer = setIntervalFn(() => {
        if (socket !== connectedSocket || socket.readyState !== WebSocketImpl.OPEN) return;
        // A socket that silently died (sleep, network change) stops answering pings; drop it
        // so the reconnect and the faster fallback polling kick in. Only once the Worker has
        // proven it answers pings, so older Workers are never disconnected by mistake.
        if (sawPong && Date.now() - lastMessageAt > pingIntervalMs * 3) {
          logger.warn("[realtime-sync] Connection stopped responding; reconnecting.");
          try {
            if (typeof socket.terminate === "function") socket.terminate();
            else socket.close();
          } catch {
            // The close handler below still runs the reconnect.
          }
          return;
        }
        socket.send(JSON.stringify({ type: "ping" }));
      }, pingIntervalMs);
    });

    connectedSocket.on("message", (rawMessage) => {
      if (socket === connectedSocket) lastMessageAt = Date.now();
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        return;
      }
      if (message?.type === "pong") {
        sawPong = true;
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
      if (message?.type === "supervisor_updated") {
        try {
          const result = onSupervisorUpdated?.(message);
          if (result && typeof result.catch === "function") {
            result.catch((error) => logger.error("[realtime-sync] Supervisor refresh failed:", error.message));
          }
        } catch (error) {
          logger.error("[realtime-sync] Supervisor refresh failed:", error.message);
        }
        return;
      }
      const extraHandler = typeof message?.type === "string" && Object.hasOwn(handlers, message.type) ? handlers[message.type] : null;
      if (extraHandler) {
        try {
          const result = extraHandler(message);
          if (result && typeof result.catch === "function") {
            result.catch((error) => logger.error(`[realtime-sync] ${message.type} handling failed:`, error.message));
          }
        } catch (error) {
          logger.error(`[realtime-sync] ${message.type} handling failed:`, error.message);
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
      setConnected(false);
      scheduleReconnect();
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
      setConnected(false);
    },
    isConnected() {
      return connected;
    }
  };
}

module.exports = { startRealtimeSync, makeWebSocketUrl };
