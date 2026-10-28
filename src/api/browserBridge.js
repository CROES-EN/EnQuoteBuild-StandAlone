import { browserApi, workerRequest } from "./workerClient.js";
import { workerAdapter, invalidateWorkerSnapshot, fetchWorkerSnapshot } from "./adapters/workerAdapter.js";
import { entityForCollection } from "../../shared/entityCollections.js";
import { getWebEmail } from "../lib/webAuth.js";

const SHARED = new Set([
  "supervisorDailyMetrics", "supervisorReportTables", "rmas", "pvManufacturers",
  "autoDrafterGeneratedDrafts", "autoDrafterLearnedSwaps", "autoDrafterCustomProducts", "quoteRequestHygieneDaily"
]);
const query = values => new URLSearchParams(Object.entries(values || {}).filter(([, value]) => value != null)).toString();
const get = (path, values) => browserApi(`${path}${values ? `?${query(values)}` : ""}`);
const post = (path, body = {}) => browserApi(path, { method: "POST", body });
const nextStamp = previous => new Date(Math.max(Date.now(), (Date.parse(previous || "") || 0) + 1)).toISOString();
const unavailable = feature => () => { throw new Error(`${feature} requires desktop access to your computer. Use file upload or the desktop app for this operation.`); };

export function installBrowserBridge() {
  if (window.enquoteLocal) return;
  const listeners = new Map();
  const on = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    return () => listeners.get(name)?.delete(callback);
  };
  const emit = (name, payload) => {
    for (const callback of listeners.get(name) || []) {
      try { callback(payload); } catch (error) { console.error("[browser-events]", name, error); }
    }
  };
  const sessionId = crypto.randomUUID();
  let version;
  let socket;
  let reconnect;
  let stopped = false;
  let refreshPending;
  let eventTimer;
  let supervisorVersion;
  let policyVersion;
  let taskVersion;
  let sopVersion;
  let unreadVersion;
  const recordCache = new Map();
  let indexPending;
  let indexAt = 0;
  const sharedIndex = () => {
    if (!indexPending || Date.now() - indexAt > 5000) {
      indexAt = Date.now();
      indexPending = get("/api/supervisor/index").catch(error => { indexPending = undefined; throw error; });
    }
    return indexPending;
  };
  const sharedRecord = entry => {
    const key = `${entry.collection}/${entry.id}/${entry.updatedAt}`;
    if (!recordCache.has(key)) {
      if (recordCache.size >= 32) recordCache.delete(recordCache.keys().next().value);
      recordCache.set(key, get("/api/supervisor/record", { collection: entry.collection, id: entry.id }).catch(error => {
        recordCache.delete(key);
        throw error;
      }));
    }
    return recordCache.get(key);
  };

  async function sharedList(collection) {
    const index = await sharedIndex();
    const entries = index.records.filter(record => record.collection === collection && !record.deleted &&
      !(collection === "supervisorReportTables" && record.id === "care_subscriptions"));
    const records = [];
    // Bound concurrent large-report downloads.
    for (let offset = 0; offset < entries.length; offset += 4) {
      const batch = await Promise.all(entries.slice(offset, offset + 4).map(sharedRecord));
      records.push(...batch.filter(item => !item.deleted).map(item => item.record));
    }
    return records;
  }
  async function listCollection(name) {
    if (SHARED.has(name)) return sharedList(name);
    if (name === "users") return workerAdapter.getUsers();
    if (name === "fsts") return (await get("/api/fsts")).fsts;
    if (name === "appNotifications") {
      const quotes = await workerAdapter.getQuotes();
      return [...quotes].sort((a, b) => String(b.updated_date || "").localeCompare(String(a.updated_date || "")))
        .slice(0, 200).filter(record => record.updated_by).map(record => ({
          id: `quote:${record.id}:${record.updated_date}`, type: "quote_updated",
          quoteId: record.id, quoteNumber: record.quote_number, changedBy: record.updated_by,
          occurredAt: record.updated_date, seq: (Date.parse(record.updated_date) || 0) * 1000
        }));
    }
    if (name === "autoImportSettings" || name === "appErrorLog") {
      const value = localStorage.getItem(`enquote_browser_${getWebEmail()}_${name}`);
      return value ? JSON.parse(value) : [];
    }
    if (!entityForCollection(name)) throw new Error(`Unsupported shared collection: ${name}`);
    return workerAdapter.listLocalCollection(name, undefined, Number.MAX_SAFE_INTEGER);
  }
  async function saveCollection(name, id, changes, create = false) {
    if (SHARED.has(name)) {
      const existing = create ? null : (await listCollection(name)).find(record => record.id === id);
      if (!create && !existing) throw new Error("That shared record no longer exists.");
      const stamp = nextStamp(existing?.updated_date);
      const record = { ...existing, ...changes, id, updated_date: stamp, created_date: existing?.created_date || stamp };
      const result = await post("/api/supervisor/upsert", { collection: name, id, updatedAt: stamp, record });
      if (!result.applied) throw new Error("Another user changed this record. Refresh and retry.");
      indexPending = undefined;
      emit("data", { at: stamp, changedQuoteNumbers: [] });
      return record;
    }
    if (name === "autoImportSettings" || name === "appErrorLog") {
      const records = await listCollection(name);
      const record = { ...records.find(item => item.id === id), ...changes, id };
      localStorage.setItem(`enquote_browser_${getWebEmail()}_${name}`, JSON.stringify([...records.filter(item => item.id !== id), record]));
      return record;
    }
    return create ? workerAdapter.createLocalRecord(name, { ...changes, id }) : workerAdapter.updateLocalRecord(name, id, changes);
  }
  async function deleteCollection(name, id) {
    if (SHARED.has(name)) {
      const result = await post("/api/supervisor/delete", { collection: name, id, deletedAt: new Date().toISOString() });
      if (!result.applied) throw new Error("The shared deletion was not applied. Refresh and retry.");
      indexPending = undefined;
      emit("data", { at: new Date().toISOString(), changedQuoteNumbers: [] });
      return { id };
    }
    return workerAdapter.deleteLocalRecord(name, id);
  }
  async function listTasks() {
    const result = await get("/api/tasks");
    return { ok: true, tasks: result.tasks.filter(item => !item.deleted && item.record).map(item => ({ ...item.record, id: item.id })) };
  }
  async function listSops() {
    const result = await get("/api/sops");
    return { ok: true, sops: result.sops.map(item => ({
      ...item.record, id: item.id, deleted: item.deleted, updated_by: item.updatedBy, updated_date: item.updatedAt
    })) };
  }
  async function upload(path, { bytes, type, name }) {
    return browserApi(path, {
      method: "POST", body: new Uint8Array(bytes),
      headers: { "Content-Type": type || "application/octet-stream", "X-File-Name": encodeURIComponent(name || "Upload") }
    });
  }
  async function imageData(path) {
    const result = await browserApi(path, { binary: true });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the shared image."));
      reader.readAsDataURL(new Blob([result.bytes], { type: result.type }));
    });
    return { ok: true, dataUrl };
  }
  async function refresh() {
    if (!getWebEmail() || stopped) return { ok: false, reason: "authentication_required" };
    if (refreshPending) return refreshPending;
    refreshPending = (async () => {
      const meta = await workerRequest("/api/web-snapshot?meta=1");
      if (meta.version !== version) {
        invalidateWorkerSnapshot();
        await fetchWorkerSnapshot();
        version = meta.version;
        emit("data", { at: meta.lastSavedAt, changedQuoteNumbers: [] });
      }
      if (listeners.get("tasks")?.size) {
        const { tasks } = await listTasks();
        const signature = JSON.stringify(tasks);
        if (signature !== taskVersion) { taskVersion = signature; emit("tasks", tasks); }
      }
      if (listeners.get("sops")?.size) {
        const { sops } = await listSops();
        const signature = JSON.stringify(sops);
        if (signature !== sopVersion) { sopVersion = signature; emit("sops", sops); }
      }
      if (listeners.get("chat")?.size) {
        const result = await get("/api/chat/conversations");
        const signature = JSON.stringify(result.conversations);
        if (signature !== unreadVersion) {
          unreadVersion = signature;
          emit("chat", { unreadTotal: result.conversations.reduce((sum, item) => sum + (item.unread || 0), 0), conversationIds: result.conversations.map(item => item.id) });
        }
      }
      if (listeners.get("data")?.size) {
        const result = await get("/api/supervisor/index");
        const signature = JSON.stringify(result.records);
        if (signature !== supervisorVersion) {
          supervisorVersion = signature;
          indexPending = undefined;
          emit("data", { at: new Date().toISOString(), changedQuoteNumbers: [] });
        }
      }
      if (listeners.get("policy")?.size) {
        const policy = await get("/api/access/policy");
        const signature = JSON.stringify(policy);
        if (signature !== policyVersion) { policyVersion = signature; emit("policy", policy); }
      }
      return { ok: true, reason: "checked", lastImportedAt: meta.lastSavedAt };
    })().finally(() => { refreshPending = undefined; });
    return refreshPending;
  }
  const scheduleRefresh = () => {
    clearTimeout(eventTimer);
    eventTimer = setTimeout(() => refresh().catch(reportRefreshError), 300);
  };
  const reportRefreshError = error => {
    console.error("[browser-sync]", error);
    emit("sync-error", { message: error.message });
  };
  function connect() {
    if (stopped || socket || !getWebEmail()) return;
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onopen = scheduleRefresh;
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "pong") return;
      if (message.type === "profiles_updated") emit("profiles", {});
      if (message.type === "preferences_updated") { emit("preferences", {}); return; }
      if (message.type === "refund_requests_updated") emit("refunds", {});
      if (message.type === "access_policy_updated" || message.type === "users_updated") emit("users", {});
      scheduleRefresh();
    };
    socket.onerror = () => console.warn("[browser-sync] Realtime disconnected; periodic refresh remains active.");
    socket.onclose = () => { socket = undefined; if (!stopped) reconnect = setTimeout(connect, 10000); };
  }
  const bridge = {
    isBrowser: true,
    collections: {
      list: listCollection,
      create: (name, record) => saveCollection(name, record.id || crypto.randomUUID(), record, true),
      update: (name, id, changes) => saveCollection(name, id, changes),
      delete: deleteCollection
    },
    largeTables: {
      get: async id => {
        const index = await sharedIndex();
        const entry = index.records.find(record => record.collection === "supervisorReportTables" && record.id === id && !record.deleted);
        return entry ? (await sharedRecord(entry)).record : null;
      },
      save: (id, record) => saveCollection("supervisorReportTables", id, record, true),
      delete: id => deleteCollection("supervisorReportTables", id)
    },
    quotes: {
      list: workerAdapter.getQuotes, get: workerAdapter.getQuoteById,
      create: workerAdapter.createQuote, update: workerAdapter.updateQuote, delete: workerAdapter.deleteQuote,
      exportData: workerAdapter.exportLocalData
    },
    app: {
      refresh: async () => { invalidateWorkerSnapshot(); version = undefined; return refresh(); },
      onDataUpdated: callback => on("data", callback),
      onUsersChanged: callback => on("users", callback),
      onSyncError: callback => on("sync-error", callback)
    },
    presence: {
      announce: payload => post("/api/presence/heartbeat", { ...payload, sessionId }),
      remove: () => post("/api/presence/remove", { sessionId }),
      list: () => get("/api/presence")
    },
    tasks: {
      list: listTasks,
      save: async input => {
        if (!String(input.title || "").trim() || !Number.isFinite(Date.parse(input.due_at))) throw new Error("Enter a task title and valid due date.");
        const stamp = nextStamp(input.updated_date);
        const task = { type: "other", status: "open", notes: "", ...input, id: input.id || crypto.randomUUID(),
          title: input.title.trim(), created_date: input.created_date || stamp, updated_date: stamp };
        task.completed_at = task.status === "done" ? task.completed_at || stamp : null;
        const result = await post("/api/tasks/upsert", { id: task.id, updatedAt: stamp, record: task });
        if (!result.applied) throw new Error("This task changed. Refresh and retry.");
        emit("tasks", (await listTasks()).tasks);
        return { ok: true, task };
      },
      delete: async id => {
        const result = await post("/api/tasks/delete", { id, deletedAt: new Date().toISOString() });
        if (!result.applied) throw new Error("This task changed. Refresh and retry.");
        emit("tasks", (await listTasks()).tasks);
        return result;
      },
      syncNow: refresh, onChanged: callback => on("tasks", callback)
    },
    sops: {
      list: listSops, sync: refresh, onChanged: callback => on("sops", callback),
      save: async (input, { baseUpdatedAt, force = false } = {}) => {
        if (!String(input.title || "").trim()) throw new Error("Give the SOP a title.");
        const existing = (await listSops()).sops.find(item => item.id === input.id);
        if (existing && baseUpdatedAt && existing.updated_date !== baseUpdatedAt && !force) return { ok: false, reason: "conflict", latest: existing };
        const stamp = nextStamp(existing?.updated_date);
        const record = { category: "General", tags: [], files: [], ...existing, ...input, id: input.id || crypto.randomUUID(),
          created_by: existing?.created_by || getWebEmail(), created_date: existing?.created_date || stamp,
          updated_by: getWebEmail(), updated_date: stamp };
        const result = await post("/api/sops/upsert", {
          id: record.id, updatedAt: stamp, record,
          baseUpdatedAt: force ? undefined : baseUpdatedAt ?? existing?.updated_date
        });
        if (!result.applied) return { ok: false, reason: "conflict", latest: (await listSops()).sops.find(item => item.id === record.id) };
        emit("sops", (await listSops()).sops);
        return { ok: true, record };
      },
      delete: async id => { const result = await post("/api/sops/delete", { id, deletedAt: new Date().toISOString() }); emit("sops", (await listSops()).sops); return result; },
      versions: id => get("/api/sops/versions", { id }),
      uploadFile: async file => { const result = await upload("/api/sops/files", file); return { ok: true, file: { ...result, name: result.name || file.name } }; },
      getFile: async id => {
        const result = await browserApi(`/api/sops/files/${encodeURIComponent(id)}`, { binary: true });
        return { ok: true, ...result };
      },
      prepareOneNote: unavailable("OneNote desktop import"), importOneNote: unavailable("OneNote desktop import"),
      cancelOneNote: unavailable("OneNote desktop import")
    },
    chat: {
      me: async () => {
        const result = await get("/api/chat/conversations");
        return { ok: true, email: getWebEmail(), ready: true, unreadTotal: result.conversations.reduce((sum, item) => sum + (item.unread || 0), 0) };
      },
      directory: () => get("/api/chat/directory"), conversations: () => get("/api/chat/conversations"),
      openDm: email => post("/api/chat/conversations", { kind: "dm", with: email }),
      createGroup: payload => post("/api/chat/conversations", { ...payload, kind: "group" }),
      updateConversation: payload => post("/api/chat/conversations/update", payload),
      messages: payload => get("/api/chat/messages", payload),
      reactions: payload => get("/api/chat/reactions", { ...payload, messageIds: payload?.messageIds?.join(",") }),
      react: payload => post("/api/chat/reactions", payload),
      emojis: () => get("/api/chat/emojis"),
      uploadEmoji: async ({ name, dataUrl }) => {
        const blob = await (await fetch(dataUrl)).blob();
        return upload(`/api/chat/emojis?name=${encodeURIComponent(name)}`, { bytes: await blob.arrayBuffer(), type: blob.type, name });
      },
      getEmoji: id => imageData(`/api/chat/emojis/image?id=${encodeURIComponent(id)}`),
      saveGifEmoji: payload => post("/api/chat/emojis/from-gif", payload),
      getImage: payload => imageData(`/api/chat/images?${query(payload)}`),
      send: async payload => {
        const attachments = [];
        for (const item of payload.attachments || []) {
          if (item.type !== "image" || !item.dataUrl) { attachments.push(item); continue; }
          const blob = await (await fetch(item.dataUrl)).blob();
          const uploaded = await upload(`/api/chat/images?conversationId=${encodeURIComponent(payload.conversationId)}`, {
            bytes: await blob.arrayBuffer(), type: blob.type, name: "Screenshot"
          });
          attachments.push(uploaded.image);
        }
        const result = await post("/api/chat/messages", { ...payload, clientId: payload.clientId || crypto.randomUUID(), attachments });
        scheduleRefresh();
        return result;
      },
      markRead: payload => post("/api/chat/read", { at: new Date().toISOString(), ...payload }),
      setActiveConversation: () => ({ ok: true }),
      onUpdated: callback => on("chat", callback)
    },
    profiles: {
      list: () => get("/api/profiles"),
      setAvatar: async payload => { const result = await upload("/api/profiles/avatar", payload); emit("profiles", {}); return result; },
      removeAvatar: async () => { const result = await post("/api/profiles/avatar/remove"); emit("profiles", {}); return result; },
      getAvatar: id => browserApi(`/api/profiles/avatar/${encodeURIComponent(id)}`, { binary: true }),
      onChanged: callback => on("profiles", callback)
    },
    gifs: { search: payload => get("/api/gifs/search", payload), trending: payload => get("/api/gifs/trending", payload) },
    preferences: {
      list: since => get("/api/preferences", since ? { since } : undefined),
      save: entries => post("/api/preferences/upsert", { entries }),
      onChanged: callback => on("preferences", callback)
    },
    trackingLinks: {
      get: quoteId => get("/api/tracking-links", { quoteId }),
      create: quoteId => post("/api/tracking-links/create", { quoteId }),
      revoke: quoteId => post("/api/tracking-links/revoke", { quoteId })
    },
    refundRequests: {
      list: () => get("/api/refund-requests"),
      submit: payload => post("/api/refund-requests/submit", payload),
      update: payload => post("/api/refund-requests/update", payload),
      importCsv: csv => browserApi("/api/refund-requests/import-csv", {
        method: "POST", body: new Blob([csv], { type: "text/csv" })
      }),
      onChanged: callback => on("refunds", callback),
      workbookStatus: unavailable("Local refund workbook"), connectWorkbook: unavailable("Local refund workbook"),
      syncWorkbook: unavailable("Local refund workbook"), workbookSyncStatus: unavailable("Local refund workbook")
    },
    fsts: { sync: () => get("/api/fsts"), importRows: workerAdapter.importFstRoster },
    panelRmaForms: {
      open: url => {
        const target = new URL(url);
        if (target.protocol !== "https:" || target.username || target.password) throw new Error("Use a public HTTPS form URL.");
        const opened = window.open(target.href, "_blank", "noopener,noreferrer");
        // noopener can intentionally return null even when the new tab opened.
        if (opened) opened.opener = null;
        return { ok: true };
      }
    },
    quoteBacklog: { get: date => get("/api/quote-backlog", { date }) },
    Base44_DTO: {
      list: cursor => get("/api/Base44_DTO", { cursor }), get: email => get("/api/Base44_DTO", { email }),
      save: payload => post("/api/Base44_DTO", payload), remove: () => browserApi("/api/Base44_DTO", { method: "DELETE" })
    },
    retroMail: {
      list: folder => get("/api/retro-mail", { folder }), contacts: () => get("/api/retro-mail", { folder: "contacts" }),
      send: payload => post("/api/retro-mail/send", payload), setState: payload => post("/api/retro-mail/state", payload),
      delete: id => post("/api/retro-mail/delete", { id })
    },
    retroGames: {
      list: () => get("/api/retro-games"), get: id => get("/api/retro-games", { id }),
      act: payload => post("/api/retro-games", payload), scores: () => get("/api/retro-scores"),
      score: payload => post("/api/retro-scores", payload)
    },
    admin: {
      policy: () => get("/api/access/policy"),
      overview: () => get("/api/admin/overview"),
      setUserOverride: payload => post("/api/admin/user-override", payload),
      setRolePages: payload => post("/api/admin/role-pages", payload),
      setAnnouncement: payload => post("/api/admin/announcement", payload),
      sessions: () => get("/api/admin/sessions"), clearSessions: payload => post("/api/admin/sessions/clear", payload),
      removeChatMessage: messageId => post("/api/admin/chat/remove-message", { messageId }),
      purgeSop: id => post("/api/admin/sops/purge", { id }),
      resetAvatar: email => post("/api/admin/profiles/reset-avatar", { email }),
      audit: payload => get("/api/admin/audit", payload),
      command: unavailable("Remote desktop commands"),
      onPolicyChanged: callback => on("policy", callback), onSignOut: callback => on("signout", callback)
    }
  };
  window.enquoteLocal = bridge;
  window.addEventListener("enquote:data-updated", scheduleRefresh);
  window.addEventListener("enquote:session-expired", () => {
    if (stopped || !getWebEmail()) return;
    stopped = true;
    clearTimeout(reconnect);
    clearTimeout(eventTimer);
    socket?.close();
    emit("signout", {});
  });
  window.addEventListener("enquote:session-ended", () => { stopped = true; clearTimeout(reconnect); socket?.close(); });
  window.addEventListener("focus", () => { if (getWebEmail()) { scheduleRefresh(); connect(); } });
  window.addEventListener("pagehide", () => { stopped = true; clearTimeout(reconnect); clearTimeout(eventTimer); socket?.close(); });
  window.addEventListener("pageshow", event => {
    if (event.persisted && getWebEmail()) { stopped = false; connect(); scheduleRefresh(); }
  });
  setInterval(() => {
    if (!stopped && document.visibilityState === "visible" && getWebEmail()) {
      if (socket?.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
      scheduleRefresh();
      connect();
    }
  }, 30000);
  connect();
}
