const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
const { Buffer } = require("node:buffer");

const DEFAULT_INTERVAL_MS = 45 * 1000;

function createPresenceSync({
  workerUrl,
  getIdentity,
  getOutboundToken,
  getAccessHeaders,
  intervalMs = DEFAULT_INTERVAL_MS,
  sessionId = crypto.randomUUID(),
  logger = console
}) {
  let timer = null;
  let presenceName = "";

  async function request(action, name = "") {
    const identity = getIdentity();
    const email = typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "";
    const token = getOutboundToken();
    if (!email) return { ok: false, error: "Verified Cloudflare identity is unavailable." };
    if (!token) return { ok: false, error: "Cloudflare sync credentials are unavailable." };

    const isList = action === "list";
    const route = isList ? "/api/presence" : action === "remove" ? "/api/presence/remove" : "/api/presence/heartbeat";
    const payload = isList ? null : JSON.stringify({
      email,
      name: String(name || email).trim().slice(0, 120),
      sessionId
    });

    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(route, workerUrl);
      } catch {
        reject(new Error("Invalid Cloudflare Worker URL for presence sync."));
        return;
      }
      const transport = url.protocol === "http:" ? http : https;
      const req = transport.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: isList ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          } : {}),
          ...getAccessHeaders()
        }
      }, (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            reject(new Error("Cloudflare presence returned invalid JSON."));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300 || !body?.ok) {
            reject(new Error(body?.error || `Cloudflare presence responded with HTTP ${res.statusCode}.`));
            return;
          }
          resolve(body);
        });
      });
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error("Cloudflare presence request timed out."));
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function heartbeat(name) {
    if (typeof name === "string" && name.trim()) {
      presenceName = name.trim().slice(0, 120);
    }
    try {
      return await request("heartbeat", presenceName);
    } catch (error) {
      logger.warn("[presence] Heartbeat failed:", error.message);
      return { ok: false, error: error.message };
    }
  }

  function start() {
    if (timer) return;
    void heartbeat(presenceName);
    timer = setInterval(() => { void heartbeat(presenceName); }, intervalMs);
    timer.unref?.();
  }

  async function remove() {
    if (timer) clearInterval(timer);
    timer = null;
    try {
      return await request("remove");
    } catch (error) {
      logger.warn("[presence] Sign-out update failed:", error.message);
      return { ok: false, error: error.message };
    }
  }

  async function list() {
    try {
      return await request("list");
    } catch (error) {
      return { ok: false, error: error.message, sessions: [] };
    }
  }

  return { start, heartbeat, remove, list };
}

module.exports = { createPresenceSync };
