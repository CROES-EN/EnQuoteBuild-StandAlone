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
  auth: {
    login: (email, password) => invoke("auth:login", email, password),
    setPassword: (email, currentPassword, newPassword) => invoke("auth:setPassword", email, currentPassword, newPassword)
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
  reportsInbox: {
    // The watched local folder (see main.cjs's watchReportsInbox()) a supervisor can drop CXONE/
    // NICE, Salesforce, Incorta, Care, or escalations report exports into for zero-click
    // auto-import - no live API access exists to any of those source systems, so this is the
    // "automatic import" mechanism.
    getPath: () => invoke("reports-inbox:get-path"),
    openFolder: () => invoke("reports-inbox:open-folder"),
    // Asks main to immediately re-scan the inbox folder - call this right after subscribing via
    // onNewFile so anything dropped in before this listener existed (app was closed, or this is
    // the very first subscriber after launch) still gets picked up instead of silently missed.
    scanNow: () => invoke("reports-inbox:scan-now"),
    // Fires once per detected file, after main has confirmed it's finished being written
    // (stable file size) and read it from disk. Payload: { token, name, base64 } - the renderer
    // decodes/parses/imports it, then MUST call sendImportResult(token, ...) so main knows
    // whether to file the original into Processed/ or Needs Review/. Returns an unsubscribe fn.
    onNewFile: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("reports-inbox:new-file", listener);
      return () => ipcRenderer.removeListener("reports-inbox:new-file", listener);
    },
    // Fire-and-forget acknowledgment (not invoke/await - main doesn't block on this) telling
    // main whether the auto-import for `token` succeeded, so it can move the source file.
    sendImportResult: (token, result) => ipcRenderer.send("reports-inbox:import-result", { token, ...result })
  }
});
