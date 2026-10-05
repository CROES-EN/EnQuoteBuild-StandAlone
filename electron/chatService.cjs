// Direct and group messages. Conversations live on the Worker; this module forwards the
// renderer's requests and watches the user's inbox so new messages raise a Windows alert and
// update the unread badge, even when the Messages page isn't open.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FALLBACK_POLL_MS = 60 * 1000;
const DIRECTORY_TTL_MS = 30 * 60 * 1000;
const MAX_INDIVIDUAL_ALERTS = 3;

function createChatService({
  client,
  getEmail,
  storageDir,
  logger = console,
  now = () => Date.now(),
  onUpdated = () => {},
  onNewMessages = () => {}
}) {
  let cursorState = null;
  let polling = null;
  let repollRequested = false;
  let timer = null;
  let directoryCache = { at: 0, users: [] };
  let unreadTotal = 0;

  const me = () => String(getEmail() || "").toLowerCase();

  function cursorFile(email) {
    const hash = crypto.createHash("sha256").update(email).digest("hex").slice(0, 16);
    return path.join(storageDir, `enquote-chat-${hash}.json`);
  }

  function loadCursor() {
    const email = me();
    if (!email) return null;
    if (cursorState?.owner === email) return cursorState;
    try {
      const parsed = JSON.parse(fs.readFileSync(cursorFile(email), "utf8"));
      cursorState = { owner: email, since: typeof parsed.since === "string" ? parsed.since : "" };
    } catch {
      cursorState = { owner: email, since: "" };
    }
    return cursorState;
  }

  function saveCursor() {
    if (!cursorState) return;
    try {
      fs.mkdirSync(storageDir, { recursive: true });
      fs.writeFileSync(cursorFile(cursorState.owner), JSON.stringify({ since: cursorState.since }), "utf8");
    } catch (error) {
      logger.warn?.("[chat] Could not save the inbox position:", error.message);
    }
  }

  async function directory({ refresh = false } = {}) {
    if (!refresh && directoryCache.users.length && now() - directoryCache.at < DIRECTORY_TTL_MS) {
      return { ok: true, users: directoryCache.users };
    }
    const result = await client.get("/api/chat/directory");
    directoryCache = { at: now(), users: Array.isArray(result.users) ? result.users : [] };
    return { ok: true, users: directoryCache.users };
  }

  function nameFor(email) {
    const match = directoryCache.users.find((user) => user.email === email);
    return match?.name || String(email || "").split("@")[0];
  }

  async function runPoll() {
    const cursor = loadCursor();
    if (!cursor || !client.isReady()) return { ok: false, reason: "not_connected" };
    try {
      // First run on this PC: start from "now" rather than alerting on old history.
      const firstRun = !cursor.since;
      const since = cursor.since || new Date(now()).toISOString();
      const fresh = [];
      let total = unreadTotal;
      let next = since;
      for (let page = 0; page < 10; page += 1) {
        const result = await client.get("/api/chat/inbox", { since: next });
        const messages = Array.isArray(result.messages) ? result.messages : [];
        total = Number(result.unreadTotal) || 0;
        fresh.push(...messages);
        const latest = messages.at(-1)?.createdAt;
        if (!latest || latest <= next) break;
        next = latest;
        if (messages.length < 50) break;
      }
      cursor.since = next;
      saveCursor();
      const unreadChanged = total !== unreadTotal;
      unreadTotal = total;
      if (fresh.length || unreadChanged || firstRun) {
        try {
          onUpdated({ unreadTotal, conversationIds: [...new Set(fresh.map((message) => message.conversationId))] });
        } catch (error) {
          logger.warn?.("[chat] Update listener failed:", error.message);
        }
      }
      if (fresh.length) {
        await directory().catch(() => {});
        const decorated = fresh.map((message) => ({ ...message, senderName: nameFor(message.sender) }));
        try {
          onNewMessages({ messages: decorated, summary: decorated.length > MAX_INDIVIDUAL_ALERTS });
        } catch (error) {
          logger.warn?.("[chat] Message listener failed:", error.message);
        }
      }
      return { ok: true, unreadTotal };
    } catch (error) {
      if (!error.offline) logger.warn?.("[chat] Inbox check failed:", error.message);
      return { ok: false, reason: error.code || "error" };
    }
  }

  function poll() {
    if (polling) {
      repollRequested = true;
      return polling;
    }
    polling = (async () => {
      let result;
      do {
        repollRequested = false;
        result = await runPoll();
      } while (repollRequested && result.ok);
      return result;
    })().finally(() => {
      polling = null;
    });
    return polling;
  }

  async function conversations() {
    const result = await client.get("/api/chat/conversations");
    const list = Array.isArray(result.conversations) ? result.conversations : [];
    const total = list.reduce((sum, conversation) => sum + (Number(conversation.unread) || 0), 0);
    if (total !== unreadTotal) {
      unreadTotal = total;
      try {
        onUpdated({ unreadTotal, conversationIds: [] });
      } catch {
        // Listener errors are logged by the poll path.
      }
    }
    return { ok: true, conversations: list };
  }

  async function openDm(email) {
    const result = await client.post("/api/chat/conversations", { kind: "dm", with: String(email || "").toLowerCase() });
    return { ok: true, conversation: result.conversation };
  }

  async function createGroup({ name, members }) {
    const result = await client.post("/api/chat/conversations", {
      kind: "group",
      name: String(name || "").trim(),
      members: (Array.isArray(members) ? members : []).map((email) => String(email).toLowerCase())
    });
    return { ok: true, conversation: result.conversation };
  }

  async function updateConversation(payload) {
    const result = await client.post("/api/chat/conversations/update", payload || {});
    return { ok: true, conversation: result.conversation };
  }

  async function messages({ conversationId, before, after, limit } = {}) {
    const result = await client.get("/api/chat/messages", { conversationId, before, after, limit });
    return { ok: true, messages: Array.isArray(result.messages) ? result.messages : [] };
  }

  async function send({ conversationId, clientId, body, attachments }) {
    const result = await client.post("/api/chat/messages", {
      conversationId,
      clientId: clientId || crypto.randomUUID(),
      body: String(body || ""),
      attachments: Array.isArray(attachments) ? attachments : []
    });
    return { ok: true, message: result.message };
  }

  async function markRead({ conversationId, at }) {
    await client.post("/api/chat/read", { conversationId, at: at || new Date(now()).toISOString() });
    void poll();
    return { ok: true };
  }

  function start() {
    stop();
    timer = setInterval(() => { void poll(); }, FALLBACK_POLL_MS);
    timer.unref?.();
    void poll();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    me: () => ({ email: me() }),
    getUnreadTotal: () => unreadTotal,
    nameFor,
    directory,
    conversations,
    openDm,
    createGroup,
    updateConversation,
    messages,
    send,
    markRead,
    poll,
    start,
    stop
  };
}

module.exports = { createChatService };
