// Wires the per-user features (Tasks, SOP Library, Messages) into the app: IPC for the
// renderer, Windows notifications, and realtime nudges from the Worker.
const { createCollabClient } = require("./collabClient.cjs");
const { createTasksSync } = require("./tasksSync.cjs");
const { createSopLibrary } = require("./sopLibrary.cjs");
const { createChatService } = require("./chatService.cjs");
const { createProfileService } = require("./profileService.cjs");
const { setupAdminFeatures } = require("./adminFeatures.cjs");
const {createOneNoteImport} = require("./oneNoteImport.cjs");
const {createRefundWorkbook} = require("./refundWorkbook.cjs");
const {createRefundFormWindow} = require("./refundFormWindow.cjs");
const {createRefundCsv} = require("./refundCsv.cjs");
const {createRefundCsvSource} = require("./refundCsvSource.cjs");
const {createRefundSubmission} = require("./refundSubmission.cjs");
const refundFeature = require("../shared/refundFeature.json");
const {BrowserWindow, WebContentsView, session} = require("electron");

const PREVIEW_LENGTH = 140;

function preview(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH - 1)}\u2026` : clean;
}

function formatDue(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function setupCollabFeatures({
  ipcMain,
  Notification,
  dialog,
  getMainWindow,
  showMainWindow,
  storageDir,
  workerUrl,
  getEmail,
  getOutboundToken,
  getAccessHeaders,
  addBellNotification = async () => {},
  onUsersUpdated = async () => {},
  onAccessPolicyChanged = async () => {},
  logger = console
}) {
  let userToken = "";
  let inboxKey = "";
  let activeConversationId = null;
  let started = false;

  const client = createCollabClient({
    workerUrl,
    getOutboundToken,
    getUserToken: () => userToken,
    getAccessHeaders
  });
  const refundWorkbook = createRefundWorkbook({ storageDir, dialog, getMainWindow, getEmail, client, logger });
  const refundSubmission = createRefundSubmission({storageDir, getEmail, client, workbook: refundWorkbook});
  const refundCsv = createRefundCsv({storageDir, dialog, getMainWindow, getEmail, client});
  const refundCsvSource = createRefundCsvSource({
    storageDir, dialog, getMainWindow, getEmail, client, logger,
    onChanged: (payload) => {
      sendToRenderer("refundRequests:sourceChanged", payload);
      sendToRenderer("refundRequests:changed", {});
    }
  });
  const refundForm = createRefundFormWindow({
    BrowserWindow, WebContentsView, session, getMainWindow, getEmail, logger,
    onStatus: (payload) => sendToRenderer("refundRequests:formStatus", payload)
  });

  function sendToRenderer(channel, payload) {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }

  function notify({ title, body, route }) {
    try {
      if (!Notification?.isSupported?.()) return;
      const notification = new Notification({ title, body, silent: false });
      notification.on("click", () => {
        showMainWindow();
        if (route) sendToRenderer("app:navigate", route);
      });
      notification.show();
    } catch (error) {
      logger.warn?.("[collab] Could not show a notification:", error.message);
    }
  }

  const tasks = createTasksSync({
    client,
    getEmail,
    storageDir,
    logger,
    onChanged: (list) => sendToRenderer("tasks:changed", list),
    onDue: ({ tasks: dueTasks, summary }) => {
      sendToRenderer("tasks:due", dueTasks);
      for (const task of dueTasks) {
        void addBellNotification({
          type: "task_due",
          taskId: task.id,
          taskTitle: task.title,
          quoteId: task.quote_id || null,
          quoteNumber: task.quote_label || null,
          occurredAt: new Date().toISOString(),
          read: false
        }).catch(() => {});
      }
      if (summary) {
        notify({ title: "EnQuote reminders", body: `${dueTasks.length} reminders are due.`, route: "/Tasks" });
        return;
      }
      for (const task of dueTasks) {
        const parts = [task.quote_label, task.contact_name, task.contact_phone].filter(Boolean);
        notify({
          title: task.type === "call" ? `Call reminder: ${task.title}` : `Reminder: ${task.title}`,
          body: preview([parts.join(" \u00b7 "), task.due_at ? `Due ${formatDue(task.due_at)}` : ""].filter(Boolean).join("\n")) || "Open EnQuote to view the task.",
          route: `/Tasks?task=${encodeURIComponent(task.id)}`
        });
      }
    }
  });

  const sops = createSopLibrary({
    client,
    getEmail,
    storageDir,
    logger,
    onChanged: (list) => sendToRenderer("sops:changed", list)
  });
  const oneNoteImport = createOneNoteImport({
    sops,
    logger,
    getEmail,
    chooseFile: async () => {
      const options = {title: "Import OneNote sections", filters: [{name: "OneNote section", extensions: ["one"]}], properties: ["openFile", "multiSelections"]};
      const window = getMainWindow();
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },
    onProgress: (progress) => sendToRenderer("sops:onenote-progress", progress)
  });

  const chat = createChatService({
    client,
    getEmail,
    storageDir,
    logger,
    onUpdated: (update) => sendToRenderer("chat:updated", update),
    onNewMessages: ({ messages, summary }) => {
      const window = getMainWindow();
      const focused = Boolean(window && !window.isDestroyed() && window.isFocused());
      // Skip the pop-up for the conversation the user is already reading.
      const unseen = messages.filter((message) => !(focused && message.conversationId === activeConversationId));
      if (!unseen.length) return;
      if (summary || unseen.length > 3) {
        notify({ title: "EnQuote Messages", body: `${unseen.length} new messages.`, route: "/Messages" });
        return;
      }
      for (const message of unseen) {
        const quotes = (message.attachments || []).filter((item) => item?.type === "quote").map((item) => item.label);
        notify({
          title: message.senderName || message.sender,
          body: preview(message.body || (quotes.length ? `Shared ${quotes.join(", ")}` : "New message")),
          route: `/Messages?c=${encodeURIComponent(message.conversationId)}`
        });
      }
    }
  });

  const profiles = createProfileService({
    client,
    storageDir,
    logger,
    onChanged: (update) => sendToRenderer("profiles:changed", update)
  });

  // Every handler returns { ok:false, error, reason } instead of throwing, so the renderer gets
  // a readable message rather than Electron's "Error invoking remote method" wrapper.
  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
      if (!refundFeature.enabled && (channel.startsWith("refundRequests:") || channel.startsWith("refundWorkbook:")) &&
          !["refundRequests:hideForm"].includes(channel)) {
        return {ok: false, error: "Refund features are temporarily disabled pending the approved integration.", reason: "feature_disabled"};
      }
      try {
        const result = await fn(...args);
        return result && typeof result === "object" && "ok" in result ? result : { ok: true, ...(result === undefined ? {} : { result }) };
      } catch (error) {
        return { ok: false, error: error.message, reason: error.code || "error", offline: Boolean(error.offline) };
      }
    });
  }

  handle("tasks:list", () => ({ ok: true, tasks: tasks.list() }));
  handle("tasks:save", (record) => ({ ok: true, task: tasks.save(record) }));
  handle("tasks:delete", (id) => ({ ok: tasks.remove(String(id || "")) }));
  handle("tasks:syncNow", () => tasks.sync());

  handle("refundRequests:list", () => client.get("/api/refund-requests"));
  handle("refundRequests:submit", (payload) => client.post("/api/refund-requests/submit", payload || {}));
  handle("refundRequests:update", (payload) => client.post("/api/refund-requests/update", payload || {}));
  handle("refundRequests:openForm", (url) => refundForm.open(url));
  handle("refundRequests:showForm", (url, bounds) => refundForm.show(url, bounds));
  handle("refundRequests:hideForm", () => refundForm.hide());
  handle("refundRequests:csvStatus", () => refundCsv.status());
  handle("refundRequests:selectCsv", () => refundCsv.select());
  handle("refundRequests:submitNative", (payload) => refundCsv.submit(payload));
  handle("refundRequests:retryCsv", () => refundCsv.retry());
  handle("refundRequests:sourceStatus", () => refundCsvSource.status());
  handle("refundRequests:trackerStatus", () => refundSubmission.status());
  handle("refundRequests:connectTracker", () => refundSubmission.select());
  handle("refundRequests:submitToTracker", (payload) => refundSubmission.submit(payload));
  handle("refundRequests:retryTracker", () => refundSubmission.retry());
  handle("refundRequests:selectSource", () => refundCsvSource.select());
  handle("refundRequests:syncSource", () => refundCsvSource.sync());
  handle("refundWorkbook:status", () => refundWorkbook.status());
  handle("refundWorkbook:select", () => refundWorkbook.select());
  handle("refundWorkbook:sync", () => refundWorkbook.sync());
  handle("refundWorkbook:syncStatus", () => refundWorkbook.syncStatus());
  handle("refundWorkbook:resolveConflict", (payload) =>
    refundWorkbook.resolveConflict(payload?.externalResponseId, payload?.field, payload?.choice));

  handle("sops:list", () => ({ ok: true, sops: sops.list() }));
  handle("sops:sync", () => sops.sync());
  handle("sops:save", (record, options) => sops.save(record, options || {}));
  handle("sops:delete", (id) => sops.remove(String(id || "")));
  handle("sops:versions", (id) => sops.versions(String(id || "")));
  handle("sops:uploadFile", (file) => sops.uploadFile(file || {}));
  handle("sops:getFile", (fileId, meta) => sops.getFile(String(fileId || ""), meta || {}));
  handle("sops:prepareOneNote", () => oneNoteImport.prepare());
  handle("sops:importOneNote", (payload) => oneNoteImport.importSection(payload || {}));
  handle("sops:cancelOneNote", (sessionId) => oneNoteImport.cancel(sessionId));

  handle("chat:me", () => ({ ok: true, ...chat.me(), unreadTotal: chat.getUnreadTotal(), ready: client.isReady() }));
  handle("chat:directory", (options) => chat.directory(options || {}));
  handle("chat:conversations", () => chat.conversations());
  handle("chat:openDm", (email) => chat.openDm(email));
  handle("chat:createGroup", (payload) => chat.createGroup(payload || {}));
  handle("chat:updateConversation", (payload) => chat.updateConversation(payload));
  handle("chat:messages", (query) => chat.messages(query || {}));
  handle("chat:reactions", (query) => chat.reactions(query || {}));
  handle("chat:react", (payload) => chat.react(payload || {}));
  handle("chat:emojis", () => chat.emojis());
  handle("chat:uploadEmoji", (payload) => chat.uploadEmoji(payload || {}));
  handle("chat:getEmoji", (id) => chat.getEmoji(id));
  handle("chat:saveGifEmoji", (payload) => chat.saveGifEmoji(payload || {}));
  handle("chat:getImage", (query) => chat.getImage(query || {}));
  handle("chat:send", async (payload) => {
    const result = await chat.send(payload || {});
    void chat.poll();
    return result;
  });
  handle("chat:markRead", (payload) => chat.markRead(payload || {}));
  handle("chat:setActiveConversation", (id) => {
    activeConversationId = typeof id === "string" && id ? id : null;
    return { ok: true };
  });

  handle("profiles:list", () => profiles.list());
  handle("Base44_DTO:list", (cursor) => client.get("/api/Base44_DTO", {cursor: cursor || ""}));
  handle("Base44_DTO:get", (email) => client.get("/api/Base44_DTO", {email: String(email || "")}));
  handle("Base44_DTO:save", (profile) => client.post("/api/Base44_DTO", profile));
  handle("Base44_DTO:remove", () => client.delete("/api/Base44_DTO"));
  handle("profiles:setAvatar", (payload) => profiles.setAvatar(payload || {}));
  handle("profiles:removeAvatar", () => profiles.removeAvatar());
  handle("profiles:getAvatar", (avatarId) => profiles.getAvatar(String(avatarId || "")));
  handle("retroMail:list", (folder) => client.get("/api/retro-mail", {folder: String(folder || "inbox")}));
  handle("retroMail:contacts", () => client.get("/api/retro-mail", {folder: "contacts"}));
  handle("retroMail:send", (message) => client.post("/api/retro-mail/send", message || {}));
  handle("retroMail:setState", (payload) => client.post("/api/retro-mail/state", payload || {}));
  handle("retroMail:delete", (id) => client.post("/api/retro-mail/delete", {id: String(id || "")}));
  handle("gifs:search", (payload) => client.get("/api/gifs/search", { q: payload?.q || "", offset: payload?.offset || 0 }));
  handle("gifs:trending", (payload) => client.get("/api/gifs/trending", { offset: payload?.offset || 0 }));

  const admin = setupAdminFeatures({
    ipcMain,
    client,
    storageDir,
    getEmail,
    getInboxKey: () => inboxKey,
    getMainWindow,
    runUsersSync: onUsersUpdated,
    onAccessPolicyChanged,
    logger
  });

  const realtimeHandlers = {
    chat_reactions_updated: (message) => {
      if (inboxKey && Array.isArray(message.keys) && message.keys.includes(inboxKey)) {
        sendToRenderer("chat:reactionsChanged", {conversationId: message.conversationId, messageId: message.messageId});
      }
    },
    tasks_updated: (message) => {
      if (inboxKey && message.key === inboxKey) return tasks.sync();
      return undefined;
    },
    refund_requests_updated: () => sendToRenderer("refundRequests:changed", {}),
    sops_updated: () => sops.sync(),
    inbox_updated: (message) => {
      if (inboxKey && Array.isArray(message.keys) && message.keys.includes(inboxKey)) {
        sendToRenderer("chat:changed", {});
        return chat.poll();
      }
      return undefined;
    },
    profiles_updated: () => profiles.changed(),
    retro_mail_updated: (message) => {
      if (inboxKey && Array.isArray(message.keys) && message.keys.includes(inboxKey)) {
        sendToRenderer("retroMail:changed", {});
      }
    },
    ...admin.realtimeHandlers
  };

  function applyCredentials(credentials) {
    userToken = credentials?.userToken || "";
    inboxKey = credentials?.inboxKey || "";
    if (!userToken) {
      logger.warn?.("[collab] The sync service did not issue a user token - Tasks sync, SOP Library and Messages are offline this session.");
      return;
    }
    start();
  }

  function start() {
    if (started) return;
    started = true;
    tasks.start();
    sops.start();
    chat.start();
  }

  // Reminders still fire before (or without) a connection - they're stored locally.
  function startOfflineReminders() {
    if (!started) tasks.start();
  }

  function stop() {
    refundCsvSource.stop();
    refundForm.close();
    started = false;
    tasks.stop();
    sops.stop();
    chat.stop();
  }

  return { applyCredentials, realtimeHandlers, startOfflineReminders, stop, tasks, sops, chat, profiles, admin };
}

module.exports = { setupCollabFeatures };
