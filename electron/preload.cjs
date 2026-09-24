const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("enquoteLocal", {
  app: {
    // Returns a promise resolving with the definitive check result ({ ok, reason,
    // storedQuoteCount, storedProductCount, ... } or { ok: false, unreachable, error }) -
    // NOT fire-and-forget, so the caller learns the real outcome instead of having to
    // guess by polling.
    refresh: () => invoke("app:refresh"),
    getRefreshStatus: () => invoke("app:refresh-status"),
    getRefreshEvents: (sinceSeq) => invoke("app:refresh-events", sinceSeq),
    // Subscribes to soft "new data landed on disk" notifications (fired when a Base44
    // webhook import writes fresh data, whether from the 15-min schedule or a manual
    // refresh) WITHOUT a page reload - the renderer decides how to react (e.g.
    // React Query cache invalidation). Returns an unsubscribe function.
    onDataUpdated: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("app:data-updated", listener);
      return () => ipcRenderer.removeListener("app:data-updated", listener);
    }
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
  // Read-only view of the primary manager's supervisorReportTables, synced via a shared
  // OneDrive file (see main.cjs's exportSupervisorReportTablesToOneDrive()). This machine
  // never writes through this channel -- it only reads whatever the primary manager's
  // machine last exported.
  onedrive: {
    getSharedReportTables: () => invoke("onedrive:get-shared-report-tables")
  },
  auth: {
    login: (email, password) => invoke("auth:login", email, password),
    setPassword: (email, currentPassword, newPassword) => invoke("auth:setPassword", email, currentPassword, newPassword)
  },
  remoteSync: {
    checkStatus: (signedInEmail) => invoke("remoteSync:checkStatus", signedInEmail),
    saveSecret: (url, secret) => invoke("remoteSync:saveSecret", url, secret)
  },
  diagnostics: {
    sendReport: (senderEmail) => invoke("diagnostics:send", senderEmail),
    listReports: () => invoke("diagnostics:listReports")
  },
    presence: {
    announce: (payload) => invoke("presence:announce", payload),
    remove: (payload) => invoke("presence:remove", payload),
    list: () => invoke("presence:list")
  },
  sync: {
    flushOutbound: () => invoke("sync:flushOutbound"),
    outboundStatus: () => invoke("sync:outboundStatus")
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
      ipcRenderer.on("salesforce:file-downloaded", listener);
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
      ipcRenderer.on("eodb-email-inbox:new-file", listener);
      return () => ipcRenderer.removeListener("eodb-email-inbox:new-file", listener);
    },
    reportOutcome: (token, outcome) => ipcRenderer.send("eodb-email-inbox:report-outcome", { token, ...outcome })
  }
});

// Separate, additive bridge for update status visibility -- does not modify any
// existing exposeInMainWorld() call, to avoid any risk to already-working bridge
// methods. A second exposeInMainWorld() call is valid and does not conflict.
try {
  const { contextBridge: __ub_contextBridge, ipcRenderer: __ub_ipcRenderer } = require("electron");
  __ub_contextBridge.exposeInMainWorld("enquoteUpdater", {
    onUpdateStatus: (callback) => __ub_ipcRenderer.on("updater:status", (_event, data) => callback(data))
  });
} catch (error) {
  console.error("Failed to expose enquoteUpdater bridge:", error);
}