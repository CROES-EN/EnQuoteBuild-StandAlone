const { contextBridge, ipcRenderer } = require("electron");
const readonlyViewing = process.argv.includes("--enquote-readonly-preview");
if (readonlyViewing) {
  contextBridge.exposeInMainWorld("enquotePreview", {
    active: true,
    context: () => ipcRenderer.invoke("viewing:context"),
    recheck: () => ipcRenderer.invoke("viewing:recheck"),
    selectUser: (email) => ipcRenderer.invoke("viewing:select-user", email),
    exit: () => ipcRenderer.invoke("viewing:exit")
  });
}

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel, listener) => {
  if (!readonlyViewing) ipcRenderer.on(channel, listener);
};
const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  listen(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("enquoteLocal", {
  viewing: {
    status: () => invoke("viewing:status"),
    start: (email) => invoke("viewing:start", email),
    onEnded: (callback) => subscribe("viewing:ended", callback)
  },
  app: {
    // Returns a promise resolving with the definitive check result ({ ok, reason,
    // storedQuoteCount, storedProductCount, ... } or { ok: false, unreachable, error }) -
    // NOT fire-and-forget, so the caller learns the real outcome instead of having to
    // guess by polling.
    refresh: () => invoke("app:refresh"),
    onRefreshProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      listen("app:refresh-progress", listener);
      return () => ipcRenderer.removeListener("app:refresh-progress", listener);
    },
    getRefreshStatus: () => invoke("app:refresh-status"),
    getRefreshEvents: (sinceSeq) => invoke("app:refresh-events", sinceSeq),
    // Subscribes to soft "new data landed on disk" notifications (fired when a Base44
    // webhook import writes fresh data, whether from the 15-min schedule or a manual
    // refresh) WITHOUT a page reload - the renderer decides how to react (e.g.
    // React Query cache invalidation). Returns an unsubscribe function.
    onDataUpdated: (callback) => {
      const listener = (_event, payload) => callback(payload);
      listen("app:data-updated", listener);
      return () => ipcRenderer.removeListener("app:data-updated", listener);
    },
    onUsersChanged: (callback) => subscribe("app:users-changed", callback)
  },
  quotes: {
    list: () => invoke("quotes:list"),
    get: id => invoke("quotes:get", id),
    create: record => invoke("quotes:create", record),
    // expectedVersion is optional: pass the quote's last-known `_rev` to enable
    // optimistic-concurrency conflict detection (see repository.cjs update()); omit it to
    // update unconditionally (bulk/admin operations that don't track a client-side copy).
    update: (id, changes, expectedVersion) => invoke("quotes:update", id, changes, expectedVersion),
    delete: id => invoke("quotes:delete", id),
    bulkUpdate: updates => invoke("quotes:bulkUpdate", updates),
    reset: () => invoke("quotes:reset"),
    exportData: () => invoke("quotes:export"),
    importData: data => invoke("quotes:import", data)
  },
  products: {
    list: () => invoke("products:list"),
    create: record => invoke("products:create", record),
    update: (id, changes) => invoke("products:update", id, changes),
    delete: id => invoke("products:delete", id)
  },
  collections: {
    list: name => invoke("collections:list", name),
    create: (name, record) => invoke("collections:create", name, record),
    update: (name, id, changes) => invoke("collections:update", name, id, changes),
    delete: (name, id) => invoke("collections:delete", name, id)
  },
    auth: {
    login: (email, password) => invoke("auth:login", email, password),
    hasAccount: (email) => invoke("auth:hasAccount", email),
    provisionNewAccount: (email, newPassword) => invoke("auth:provisionNewAccount", email, newPassword),
    getVerifiedIdentity: () => invoke("auth:getVerifiedIdentity"),
    reauthenticate: () => invoke("cloudflareAuth:reauthenticate"),
    signOutEverywhere: () => invoke("cloudflareAuth:signOutEverywhere"),
    setPassword: (email, currentPassword, newPassword) => invoke("auth:setPassword", email, currentPassword, newPassword),
    // Admin-only: the actual admin-status check happens on the main-process side
    // (repository.cjs's resetUserPassword re-verifies app_role === "admin" against the
    // locally-synced users collection) - this bridge method just forwards the call, it
    // enforces nothing itself.
    resetUserPassword: (actingAdminEmail, targetEmail) => invoke("auth:resetUserPassword", actingAdminEmail, targetEmail)
  },
  remoteSync: {
    checkStatus: (signedInEmail) => invoke("remoteSync:checkStatus", signedInEmail),
    saveSecret: (url, secret) => invoke("remoteSync:saveSecret", url, secret)
  },
  diagnostics: {
    sendReport: (senderEmail) => invoke("diagnostics:send", senderEmail),
    listReports: () => invoke("diagnostics:listReports"),
    inspect: (command) => invoke("diagnostics:inspect", command),
    refreshSupervisor: () => invoke("diagnostics:refresh-supervisor")
  },
    presence: {
    announce: (payload) => invoke("presence:announce", payload),
    remove: (payload) => invoke("presence:remove", payload),
    list: () => invoke("presence:list")
  },
  // Fire-and-forget error reports from the UI (see electron/errorReporter.cjs).
  errors: {
    report: details => ipcRenderer.send("errors:report", details)
  },
  // UI hotfix channel: downloaded UI updates (see electron/uiUpdate.cjs).
  ui: {
    getInfo: () => invoke("ui:get-info"),
    check: () => invoke("ui:check"),
    apply: () => invoke("ui:apply"),
    onUpdateReady: (callback) => {
      const listener = (_event, data) => callback(data);
      listen("ui:update-ready", listener);
      return () => ipcRenderer.removeListener("ui:update-ready", listener);
    }
  },
  // Report tables too big for the main data file (stored one per file).
  largeTables: {
    get: id => invoke("largeTables:get", id),
    save: (id, record) => invoke("largeTables:save", id, record),
    delete: id => invoke("largeTables:delete", id)
  },
  // Shared FST roster (seeded locally, kept in sync with other installs via the Worker).
  fsts: {
    sync: () => invoke("fsts:sync"),
    importRows: rows => invoke("fsts:import", rows)
  },
  sync: {
    flushOutbound: () => invoke("sync:flushOutbound"),
    outboundStatus: () => invoke("sync:outboundStatus"),
    forceEntitySnapshot: () => invoke("sync:forceEntitySnapshot")
  },
  shell: {
    // Opens a local file path (e.g. a previously-imported CXONE/Salesforce spreadsheet) in
    // its default application - never writes to the file, just asks the OS to open it.
    openPath: (targetPath) => invoke("shell:openPath", targetPath)
  },
  dialogs: {
    selectFolder: () => invoke("dialog:select-folder"),
    readFolderFiles: (folderPath) => invoke("reports-folder:read-files", folderPath),
    createFolder: (folderPath) => invoke("reports-folder:create", folderPath),
    checkFolderExists: (folderPath) => invoke("reports-folder:exists", folderPath)
  },  zoom: {
    in: () => invoke("zoom:in"),
    out: () => invoke("zoom:out"),
    reset: () => invoke("zoom:reset"),
    get: () => invoke("zoom:get")
  },
  salesforce: {
    openReport: (reportUrl, userEmail) => invoke("salesforce:open-report", reportUrl, userEmail),
    close: () => invoke("salesforce:close"),
    onFileDownloaded: (callback) => {
      const listener = (_event, payload) => callback(payload);
      listen("salesforce:file-downloaded", listener);
      return () => ipcRenderer.removeListener("salesforce:file-downloaded", listener);
    }
  },
  // reportsInbox bridge removed - System A (the old "O&M Reports Inbox") is fully retired.
  // EODB/Email Auto-Import - separate bridge object from reportsInbox above, backing a
  // second, independently start/stop-able watcher pointed at a per-user, dynamically-chosen
  // folder (see autoImportSettings.js / AutoImportSettingsPanel.jsx), rather than one fixed
  // folder watched unconditionally from app launch.
  eodbEmailInbox: {
    // Starts (or re-points) the watcher at `folderPath` - called whenever the user chooses/
    // changes their watched folder, or when the app launches with auto-import already enabled.
    configure: (folderPath) => invoke("eodb-email-inbox:configure", folderPath),
    stop: () => invoke("eodb-email-inbox:stop"),
    scanNow: () => invoke("eodb-email-inbox:scan-now"),
    onNewFile: (callback) => {
      const listener = (_event, payload) => callback(payload);
      listen("eodb-email-inbox:new-file", listener);
      return () => ipcRenderer.removeListener("eodb-email-inbox:new-file", listener);
    },
    reportOutcome: (token, outcome) => ipcRenderer.send("eodb-email-inbox:report-outcome", { token, ...outcome })
  },
  geo: {
    geocode: (address) => invoke("geo:geocode", address),
    routes: (payload) => invoke("geo:routes", payload)
  },
  tasks: {
    list: () => invoke("tasks:list"),
    save: (record) => invoke("tasks:save", record),
    delete: (id) => invoke("tasks:delete", id),
    syncNow: () => invoke("tasks:syncNow"),
    onChanged: (callback) => subscribe("tasks:changed", callback),
    onDue: (callback) => subscribe("tasks:due", callback)
  },
  sops: {
    list: () => invoke("sops:list"),
    sync: () => invoke("sops:sync"),
    save: (record, options) => invoke("sops:save", record, options),
    delete: (id) => invoke("sops:delete", id),
    versions: (id) => invoke("sops:versions", id),
    uploadFile: (file) => invoke("sops:uploadFile", file),
    getFile: (fileId, meta) => invoke("sops:getFile", fileId, meta),
    prepareOneNote: () => invoke("sops:prepareOneNote"),
    importOneNote: (payload) => invoke("sops:importOneNote", payload),
    cancelOneNote: (sessionId) => invoke("sops:cancelOneNote", sessionId),
    onOneNoteProgress: (callback) => subscribe("sops:onenote-progress", callback),
    onChanged: (callback) => subscribe("sops:changed", callback)
  },
  chat: {
    me: () => invoke("chat:me"),
    directory: (options) => invoke("chat:directory", options),
    conversations: () => invoke("chat:conversations"),
    openDm: (email) => invoke("chat:openDm", email),
    createGroup: (payload) => invoke("chat:createGroup", payload),
    updateConversation: (payload) => invoke("chat:updateConversation", payload),
    messages: (query) => invoke("chat:messages", query),
    reactions: (query) => invoke("chat:reactions", query),
    react: (payload) => invoke("chat:react", payload),
    emojis: () => invoke("chat:emojis"),
    uploadEmoji: (payload) => invoke("chat:uploadEmoji", payload),
    getEmoji: (id) => invoke("chat:getEmoji", id),
    saveGifEmoji: (payload) => invoke("chat:saveGifEmoji", payload),
    onReactionsChanged: (callback) => subscribe("chat:reactionsChanged", callback),
    getImage: (query) => invoke("chat:getImage", query),
    send: (payload) => invoke("chat:send", payload),
    markRead: (payload) => invoke("chat:markRead", payload),
    setActiveConversation: (id) => invoke("chat:setActiveConversation", id),
    onUpdated: (callback) => subscribe("chat:updated", callback),
    onChanged: (callback) => subscribe("chat:changed", callback)
  },
  profiles: {
    list: () => invoke("profiles:list"),
    setAvatar: (payload) => invoke("profiles:setAvatar", payload),
    removeAvatar: () => invoke("profiles:removeAvatar"),
    getAvatar: (avatarId) => invoke("profiles:getAvatar", avatarId),
    onChanged: (callback) => subscribe("profiles:changed", callback)
  },
  gifs: {
    search: (payload) => invoke("gifs:search", payload),
    trending: (payload) => invoke("gifs:trending", payload)
  },
  admin: {
    policy: () => invoke("admin:policy"),
    overview: () => invoke("admin:overview"),
    setUserOverride: (payload) => invoke("admin:setUserOverride", payload),
    setRolePages: (payload) => invoke("admin:setRolePages", payload),
    setAnnouncement: (payload) => invoke("admin:setAnnouncement", payload),
    sessions: () => invoke("admin:sessions"),
    clearSessions: (payload) => invoke("admin:clearSessions", payload),
    command: (payload) => invoke("admin:command", payload),
    removeChatMessage: (messageId) => invoke("admin:removeChatMessage", messageId),
    purgeSop: (id) => invoke("admin:purgeSop", id),
    resetAvatar: (email) => invoke("admin:resetAvatar", email),
    audit: (payload) => invoke("admin:audit", payload),
    onPolicyChanged: (callback) => subscribe("admin:policy-changed", callback),
    onSignOut: (callback) => subscribe("admin:sign-out", callback)
  },
  Base44_DTO: {
    list: (cursor) => invoke("Base44_DTO:list", cursor),
    get: (email) => invoke("Base44_DTO:get", email),
    save: (profile) => invoke("Base44_DTO:save", profile),
    remove: () => invoke("Base44_DTO:remove")
  },
  navigation: {
    // Main asks the window to open a page (e.g. after clicking a Windows notification).
    onNavigate: (callback) => subscribe("app:navigate", callback)
  }
});

// Separate, additive bridge for update status visibility -- does not modify any
// existing exposeInMainWorld() call, to avoid any risk to already-working bridge
// methods. A second exposeInMainWorld() call is valid and does not conflict.
try {
  const { contextBridge: __ub_contextBridge, ipcRenderer: __ub_ipcRenderer } = require("electron");
  __ub_contextBridge.exposeInMainWorld("enquoteUpdater", {
    onUpdateStatus: (callback) => {
      const listener = (_event, data) => callback(data);
      listen("updater:status", listener);
      return () => __ub_ipcRenderer.removeListener("updater:status", listener);
    },
    getState: () => __ub_ipcRenderer.invoke("updater:get-state"),
    check: () => __ub_ipcRenderer.invoke("updater:check"),
    installNow: () => __ub_ipcRenderer.invoke("updater:install-now")
  });
} catch (error) {
  console.error("Failed to expose enquoteUpdater bridge:", error);
}