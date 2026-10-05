const fs = require("node:fs");
const path = require("node:path");

function setupAdminFeatures({
  ipcMain,
  client,
  storageDir,
  getEmail,
  getInboxKey,
  getMainWindow,
  runUsersSync = async () => {},
  logger = console
}) {
  const cachePath = path.join(storageDir, "enquote-access-policy.json");

  function send(channel, payload) {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }

  function readCache() {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      return parsed?.email === String(getEmail() || "").toLowerCase() ? parsed.policy : null;
    } catch {
      return null;
    }
  }

  function writeCache(policy) {
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ email: String(getEmail() || "").toLowerCase(), policy }), "utf8");
    } catch (error) {
      logger.warn?.("[admin] Could not cache access policy:", error.message);
    }
  }

  async function request(name, fn) {
    try {
      const result = await fn();
      return result && typeof result === "object" && "ok" in result ? result : { ok: true, ...(result === undefined ? {} : { result }) };
    } catch (error) {
      if (name === "policy") {
        const cached = readCache();
        if (cached) return { ok: true, ...cached, offline: true };
      }
      return { ok: false, error: error.code || error.message || "error", reason: error.code || "error", offline: Boolean(error.offline) };
    }
  }

  async function policy() {
    return request("policy", async () => {
      const result = await client.get("/api/access/policy");
      writeCache(result);
      return result;
    });
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, (_event, ...args) => request(channel, () => fn(...args)));
  }

  handle("admin:policy", policy);
  handle("admin:overview", () => client.get("/api/admin/overview"));
  handle("admin:setUserOverride", (payload) => client.post("/api/admin/user-override", payload || {}));
  handle("admin:setRolePages", (payload) => client.post("/api/admin/role-pages", payload || {}));
  handle("admin:setAnnouncement", (payload) => client.post("/api/admin/announcement", payload || {}));
  handle("admin:sessions", () => client.get("/api/admin/sessions"));
  handle("admin:clearSessions", (payload) => client.post("/api/admin/sessions/clear", payload || {}));
  handle("admin:command", (payload) => client.post("/api/admin/command", payload || {}));
  handle("admin:removeChatMessage", (messageId) => client.post("/api/admin/chat/remove-message", { messageId }));
  handle("admin:purgeSop", (id) => client.post("/api/admin/sops/purge", { id }));
  handle("admin:resetAvatar", (email) => client.post("/api/admin/profiles/reset-avatar", { email }));
  handle("admin:audit", (payload) => client.get("/api/admin/audit", payload || {}));

  const realtimeHandlers = {
    users_updated: async () => {
      await runUsersSync();
      send("app:users-changed", { at: new Date().toISOString() });
    },
    policy_updated: async () => {
      const result = await policy();
      send("admin:policy-changed", result);
    },
    admin_command: (message) => {
      if (!getInboxKey() || message.key !== getInboxKey()) return;
      if (message.command === "reload") {
        getMainWindow()?.reload();
      } else if (message.command === "sign_out") {
        send("admin:sign-out", { id: message.id });
      }
    }
  };

  return { policy, realtimeHandlers };
}

module.exports = { setupAdminFeatures };
