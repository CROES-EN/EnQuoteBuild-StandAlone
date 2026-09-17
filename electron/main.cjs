const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { repositoryFor } = require("./repository.cjs");
const { createOutboundSync } = require("./outboundSync.cjs");

// Loads key=value pairs from an optional .env next to the app so the outbound
// Base44 credentials never have to be baked into the bundle.
function loadEnvFile() {
  const candidates = [
    path.join(process.resourcesPath || "", ".env"),
    path.join(__dirname, "..", ".env")
  ];
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      for (const line of fs.readFileSync(candidate, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
      }
    } catch {
      // A missing/unreadable .env just means outbound sync stays disabled.
    }
  }
}

let quoteRepository;
let outboundSync;
let dataDirectoryWatcher;
let reportsInboxWatcher;
// token -> { filePath } for a file currently awaiting the renderer's auto-import result, so it
// can be moved into Processed/ or Needs Review/ once we hear back (see the
// "reports-inbox:import-result" handler below).
const pendingReportsInboxFiles = new Map();
const REPORTS_INBOX_ACK_TIMEOUT_MS = 2 * 60 * 1000;
let lastDataRefreshAt = 0;
// Timestamp of the most recent write this process itself made to the data file (e.g. via
// the quotes:create/update IPC handlers, or the merge-on-import path). fs.watch can't tell
// us WHO wrote a file, only that it changed - so without this guard, every quote the user
// saves from inside the app would be mistaken for an external import a few ms later. We
// only want to notify the renderer for changes that came from an EXTERNAL source (Base44
// webhook import), not from our own in-app CRUD operations.
let lastOwnWriteAt = 0;
const OWN_WRITE_GRACE_MS = 2000;

// Authoritative (non-timing-based) guard, layered on top of the grace window above.
// A genuine Base44 webhook import is the ONLY thing that ever changes
// meta.last_imported_at / meta.last_snapshot_id (see importData() in repository.cjs) -
// every local CRUD write, and the outbound-sync ack write, always preserves whatever
// values were already there. The timing-based grace window can still be defeated by a
// slow/delayed fs.watch notification (antivirus scanning, a busy disk, or just an
// unlucky race between the rename() completing and the watcher firing) - which was
// happening reliably enough to falsely flag a plain save, delete, or update as new data.
// Comparing this marker removes the race entirely: if it hasn't changed, the file change
// was definitely one of our own writes, no matter how late the watch event arrived.
let lastKnownImportMarker = null;

function readImportMarker() {
  try {
    const dataPath = path.join(app.getPath("userData"), "enquote-demo-data-v1.json");
    let raw = fs.readFileSync(dataPath, "utf8");
    // See the matching comment in electron/repository.cjs's read() - strip a leading UTF-8 BOM
    // defensively so an externally-resaved file (e.g. via a tool that writes BOM'd UTF-8) can
    // never silently break this comparison instead of throwing a clear, catchable error.
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    const meta = parsed.meta || {};
    return `${meta.last_imported_at || ""}|${meta.last_snapshot_id || ""}`;
  } catch {
    return null;
  }
}

function markOwnWrite() {
  lastOwnWriteAt = Date.now();
}

// Tells every window that fresh data landed on disk from an EXTERNAL source (a Base44
// webhook import), so the renderer can soft-refresh (re-fetch via React Query) in place.
// This deliberately never calls window.reload() - a full page navigation firing at a
// random moment (mid-edit, mid-dialog, mid-navigation) was the main cause of the "blank
// page after refresh" bug, since an uncaught render error or a navigation racing with the
// reload could leave the renderer showing nothing. Pushing an IPC event instead lets the
// renderer decide how/when to re-render, and a top-level ErrorBoundary now catches any
// leftover render error instead of the whole window going blank.
function notifyWindowsDataUpdated() {
  const now = Date.now();

  if (now - lastOwnWriteAt < OWN_WRITE_GRACE_MS) {
    console.log('[sync] Skipped notify - change came from this app\'s own save, not an external import');
    return;
  }

  // Belt-and-suspenders: even if the grace window above was missed (slow watch event),
  // don't notify unless a real import actually happened.
  const marker = readImportMarker();
  if (marker === null || marker === lastKnownImportMarker) {
    console.log('[sync] Skipped notify - no new import marker (this was a local save, not a Base44 import)');
    return;
  }
  lastKnownImportMarker = marker;

  if (now - lastDataRefreshAt < 1500) {
    console.log('[sync] Skipped notify - debounced (last notify', now - lastDataRefreshAt, 'ms ago)');
    return;
  }
  lastDataRefreshAt = now;

  const windows = BrowserWindow.getAllWindows();
  console.log('[sync] Notifying', windows.length, 'window(s) of new imported data (soft refresh, no reload)');
  windows.forEach((window) => window.webContents.send("app:data-updated", { at: new Date().toISOString() }));
}

function watchLocalDataFile() {
  const userDataPath = app.getPath("userData");
  console.log('[watch] Watching for data file changes in:', userDataPath);
  if (dataDirectoryWatcher) {
    dataDirectoryWatcher.close();
  }

  try {
    dataDirectoryWatcher = fs.watch(userDataPath, { persistent: false }, (eventType, filename) => {
      console.log('[watch] fs.watch event:', eventType, filename);
      if (filename !== "enquote-demo-data-v1.json") return;
      notifyWindowsDataUpdated();
    });
  } catch (error) {
    console.warn("Could not watch local data directory for changes:", error.message);
  }
}

// --- O&M Reports Inbox: zero-click auto-import for the Supervisor Dashboard ---
//
// No live API access exists to Incorta/NICE CXONE/Salesforce/SharePoint (no credentials, no
// client code anywhere in this app) - so "automatic import" is implemented as a watched local
// folder instead: a supervisor drops an exported report file in, and within a couple seconds
// it's read, auto-mapped, and imported using the exact same parsing pipeline as the manual
// "Import Report" dialog (see reportParsing.js/autoImportWatcher.js on the renderer side). This
// process only ever WATCHES and READS files here - it never writes into a report file, only
// relocates the original (unmodified) file into a Processed/ or Needs Review/ subfolder once
// the renderer has told us the outcome.
const REPORT_FILE_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);

// Incorta "Export to HTML" dashboard dumps can be hundreds of MB (confirmed against real
// exports) - unlike .xlsx/.csv, these are never auto-parsed unattended (picking the "right"
// section among many out of a multi-hundred-MB file with no user present is too ambiguous to
// trust - see readHtmlSectionRows/reportParsing.js) and their bytes are never read into memory
// or shipped over IPC here at all. A dropped HTML export is simply relocated straight to Needs
// Review below so it gets clear, visible feedback instead of silently sitting there forever -
// import it manually via the Import Report dialog, which handles arbitrarily large HTML files
// fine since it reads them directly in the renderer, never through this main process/IPC.
const HTML_REPORT_EXTENSIONS = new Set([".html", ".htm"]);

function getReportsInboxPaths() {
  const root = path.join(app.getPath("documents"), "EnQuote", "O&M Reports Inbox");
  return {
    root,
    processed: path.join(root, "Processed"),
    needsReview: path.join(root, "Needs Review")
  };
}

function ensureReportsInboxFolders() {
  const paths = getReportsInboxPaths();
  [paths.root, paths.processed, paths.needsReview].forEach((dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      console.warn("[reports-inbox] Could not create folder:", dir, error.message);
    }
  });
  return paths;
}

function isCandidateReportFile(filename) {
  if (!filename) return false;
  if (filename.startsWith("~$") || filename.startsWith(".")) return false; // Excel lock files, hidden files
  return REPORT_FILE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function isHtmlDashboardExport(filename) {
  if (!filename) return false;
  return HTML_REPORT_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

// Waits for a file's size to stop changing before treating it as "done being written" - a
// plain spreadsheet save/copy can fire several fs.watch events while the write is still in
// progress, and reading a half-written file would produce a corrupt/unreadable workbook.
function waitForFileStable(filePath, requiredStableChecks = 3, intervalMs = 700) {
  return new Promise((resolve) => {
    let lastSize = -1;
    let stableCount = 0;

    const check = () => {
      let size;
      try {
        size = fs.statSync(filePath).size;
      } catch {
        resolve(false); // file disappeared mid-check (renamed/deleted/moved elsewhere)
        return;
      }
      if (size === lastSize) {
        stableCount += 1;
      } else {
        stableCount = 0;
        lastSize = size;
      }
      if (stableCount >= requiredStableChecks) {
        resolve(true);
        return;
      }
      setTimeout(check, intervalMs);
    };

    check();
  });
}

function moveReportsInboxFile(filePath, destinationDir) {
  try {
    if (!fs.existsSync(filePath)) return;
    const destName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${path.basename(filePath)}`;
    fs.renameSync(filePath, path.join(destinationDir, destName));
  } catch (error) {
    console.warn("[reports-inbox] Could not move processed file:", filePath, error.message);
  }
}

async function processReportsInboxFile(root, filename) {
  const filePath = path.join(root, filename);

  if (isHtmlDashboardExport(filename)) {
    // Never read an HTML dashboard export's bytes here or ship them over IPC (see the
    // HTML_REPORT_EXTENSIONS comment above) - just wait for the copy/save to finish, then
    // relocate it straight to Needs Review so it's clearly flagged for manual import instead of
    // silently sitting untouched in the inbox forever.
    if (!fs.existsSync(filePath)) return;
    const stable = await waitForFileStable(filePath);
    if (!stable || !fs.existsSync(filePath)) return;
    console.log("[reports-inbox] HTML dashboard export requires manual import - moving to Needs Review:", filename);
    const { needsReview } = ensureReportsInboxFolders();
    moveReportsInboxFile(filePath, needsReview);
    return;
  }

  if (!isCandidateReportFile(filename)) return;
  if (!fs.existsSync(filePath)) return; // e.g. a "rename-away" event, or already moved out

  const stable = await waitForFileStable(filePath);
  if (!stable || !fs.existsSync(filePath)) return;

  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (error) {
    console.warn("[reports-inbox] Could not read new file:", filePath, error.message);
    return;
  }

  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    // Nobody's listening yet (very early during app startup) - leave the file in place. The
    // renderer explicitly asks us to re-scan once its listener is ready (see
    // "reports-inbox:scan-now" below), so this isn't a dead end.
    return;
  }

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingReportsInboxFiles.set(token, { filePath });
  setTimeout(() => {
    // Safety net: if the renderer never acknowledges (e.g. the page navigated away mid-parse,
    // or it crashed), don't leave the file stuck in the inbox forever getting re-processed.
    if (!pendingReportsInboxFiles.has(token)) return;
    pendingReportsInboxFiles.delete(token);
    const { needsReview } = ensureReportsInboxFolders();
    moveReportsInboxFile(filePath, needsReview);
  }, REPORTS_INBOX_ACK_TIMEOUT_MS);

  windows.forEach((window) => window.webContents.send("reports-inbox:new-file", {
    token,
    name: filename,
    base64: buffer.toString("base64")
  }));
}

function scanReportsInboxNow() {
  const { root } = ensureReportsInboxFolders();
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    console.warn("[reports-inbox] Could not scan inbox folder:", error.message);
    return;
  }
  entries
    .filter((entry) => entry.isFile())
    .forEach((entry) => { processReportsInboxFile(root, entry.name); });
}

function watchReportsInbox() {
  const { root } = ensureReportsInboxFolders();
  console.log("[reports-inbox] Watching for auto-import report files in:", root);

  if (reportsInboxWatcher) {
    reportsInboxWatcher.close();
  }

  try {
    reportsInboxWatcher = fs.watch(root, { persistent: false }, (_eventType, filename) => {
      processReportsInboxFile(root, filename);
    });
  } catch (error) {
    console.warn("Could not watch O&M Reports Inbox folder:", error.message);
  }
}

function configureAutoUpdater() {
  if (!app.isPackaged) {
    console.log("Auto-update is disabled in development mode.");
    return;
  }

  const updateUrl = process.env.ENQUOTE_UPDATE_URL;
  if (updateUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });
  } else {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: "CROES-EN",
      repo: "EnQuoteBuild-StandAlone"
    });
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("Checking for EnQuote updates...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("Update available:", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("EnQuote is up to date.");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`Update download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("error", (error) => {
    console.error("Auto-update error:", error);
  });

  autoUpdater.on("update-downloaded", () => {
    console.log("Update downloaded; installing and restarting in-place...");
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.checkForUpdatesAndNotify();
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "EnQuote",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#071426",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.openDevTools();

  if (app.isPackaged) {
    // When packaged we copy the renderer 'dist' into resources via extraResources.
    // Try resources/dist first (extraResources), then fallback to packaged dist path.
    const fs = require("node:fs");
    const resourceDist = path.join(process.resourcesPath, "dist", "index.html");
    const packagedDist = path.join(__dirname, "..", "dist", "index.html");
    if (fs.existsSync(resourceDist)) {
      mainWindow.loadFile(resourceDist);
    } else if (fs.existsSync(packagedDist)) {
      mainWindow.loadFile(packagedDist);
    } else {
      console.warn("Renderer index.html not found in resources/dist or packaged dist; attempting packaged path anyway.");
      mainWindow.loadFile(packagedDist);
    }
  } else if (process.env.ENQUOTE_REMOTE_URL) {
    mainWindow.loadURL(process.env.ENQUOTE_REMOTE_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost:5173") || url.startsWith("https://enquote.base44.app")) {
      return { action: "allow" };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });

  // Defensive recovery: if the renderer process itself crashes/OOMs (distinct from a
  // normal quit), the window would otherwise sit permanently blank with no way back
  // short of restarting the whole app. Auto-reload it once instead. This is unrelated
  // to (and much rarer than) the data-sync reload issue fixed elsewhere in this file -
  // this only fires for genuine renderer crashes.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[recovery] Renderer process gone:", details.reason);
    if (details.reason === "clean-exit") return;
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.reload();
    }, 500);
  });
}

app.whenReady().then(() => {
  configureAutoUpdater();

  // Request/response (not fire-and-forget): the renderer awaits this directly to learn
  // the definitive outcome of a manual refresh click, rather than polling /status and
  // hoping a real Base44 delivery happens to land during the poll window. The force-
  // refresh endpoint below deliberately does NOT fabricate a new import (that would reset
  // the receiver's 15-minute throttle and could block the next real Base44 delivery) - it
  // just reports whatever is already cached on disk, which is exactly what "checked, nothing
  // new" means from the renderer's point of view.
  ipcMain.handle("app:refresh", async () => {
    console.log('[refresh] Manual refresh triggered - checking webhook receiver for latest data...');

    // Push any locally-created/edited quotes up to Base44 first, so "Refresh" behaves
    // like a two-way sync instead of only pulling. Without this, a saved edit could sit
    // queued for up to 5 minutes (the background flush interval) before Base44 saw it,
    // even though the user just asked the app to sync. Best-effort only - a failure here
    // never blocks or fails the refresh check itself.
    if (outboundSync) {
      try {
        const outboundResult = await outboundSync.flush();
        markOwnWrite();
        console.log('[refresh] Outbound flush result:', outboundResult);
      } catch (error) {
        console.log('[refresh] Outbound flush failed:', error.message);
      }
    }

    const targetDir = app.getPath('userData');

    // NOTE: this handler intentionally never calls notifyWindowsDataUpdated() itself - the
    // existing fs.watch-based notifyWindowsDataUpdated() (see watchLocalDataFile) still
    // fires separately and correctly whenever the data file actually changes on disk from
    // a REAL Base44 import, as a soft (non-reloading) IPC push independent of this call.
    try {
      const http = require('http');
      const body = JSON.stringify({});
      const result = await new Promise((resolve) => {
        const req = http.request({
          hostname: 'localhost',
          port: 3001,
          path: '/api/base44/webhook/refresh-now',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-ENQuote-Data-Dir': targetDir
          }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              resolve({ ok: true, status: res.statusCode, body: JSON.parse(data) });
            } catch {
              resolve({ ok: true, status: res.statusCode, body: null });
            }
          });
        });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        req.write(body);
        req.end();
      });

      console.log('[refresh] Webhook receiver refresh-check response:', result);

      if (!result.ok || result.status >= 400 || !result.body?.ok) {
        return {
          ok: false,
          unreachable: !result.ok,
          error: result.error || result.body?.error || `HTTP ${result.status}`
        };
      }

      return {
        ok: true,
        reason: "checked",
        storedQuoteCount: result.body.storedQuoteCount,
        storedProductCount: result.body.storedProductCount,
        lastImportedAt: result.body.lastImportedAt
      };
    } catch (error) {
      console.log('[refresh] Refresh check failed (is webhook-receiver.cjs running on port 3001?):', error.message);
      return { ok: false, unreachable: true, error: error.message };
    }
  });

  // Powers the refresh progress popup: renderer polls these while a refresh is in flight.
  ipcMain.handle("app:refresh-status", async () => {
    const http = require('http');
    return new Promise((resolve) => {
      const req = http.request({ hostname: 'localhost', port: 3001, path: '/status', method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ ok: false, error: 'Invalid response from webhook receiver' });
          }
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message, unreachable: true }));
      req.end();
    });
  });

  ipcMain.handle("app:refresh-events", async (_event, sinceSeq) => {
    const http = require('http');
    const qs = sinceSeq ? `?since=${encodeURIComponent(sinceSeq)}` : '';
    return new Promise((resolve) => {
      const req = http.request({ hostname: 'localhost', port: 3001, path: `/events${qs}`, method: 'GET' }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ ok: false, error: 'Invalid response from webhook receiver' });
          }
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message, unreachable: true }));
      req.end();
    });
  });

  quoteRepository = repositoryFor(app.getPath("userData"));
  console.log('[startup] App userData path (data file location):', app.getPath("userData"));
  // Seed the marker from whatever's already on disk so the FIRST incidental fs.watch
  // event after launch isn't mistaken for a new import.
  lastKnownImportMarker = readImportMarker();
  watchLocalDataFile();
  watchReportsInbox();

  // Wraps a repository method so any write it performs is flagged as "our own", suppressing
  // the fs.watch-triggered reload that would otherwise fire a moment later and wipe the
  // in-progress screen (see markOwnWrite/OWN_WRITE_GRACE_MS above).
  const ownWrite = (fn) => async (...args) => {
    const result = await fn(...args);
    markOwnWrite();
    return result;
  };

  ipcMain.handle("quotes:list", () => quoteRepository.list());
  ipcMain.handle("quotes:get", (_event, id) => quoteRepository.get(id));
  ipcMain.handle("quotes:create", (_event, record) => ownWrite(quoteRepository.create)(record));
  ipcMain.handle("quotes:update", (_event, id, changes, expectedVersion) => ownWrite(quoteRepository.update)(id, changes, expectedVersion));
  ipcMain.handle("quotes:delete", (_event, id) => ownWrite(quoteRepository.remove)(id));
  ipcMain.handle("quotes:bulkUpdate", (_event, updates) => ownWrite(quoteRepository.bulkUpdate)(updates));
  ipcMain.handle("quotes:reset", () => ownWrite(quoteRepository.reset)());
  ipcMain.handle("quotes:export", () => quoteRepository.exportData());
  ipcMain.handle("quotes:import", (_event, data) => ownWrite(quoteRepository.importData)(data));
  ipcMain.handle("products:list", () => quoteRepository.listProducts());
  ipcMain.handle("products:create", (_event, record) => ownWrite(quoteRepository.createProduct)(record));
  ipcMain.handle("products:update", (_event, id, changes) => ownWrite(quoteRepository.updateProduct)(id, changes));
  ipcMain.handle("products:delete", (_event, id) => ownWrite(quoteRepository.deleteProduct)(id));
  ipcMain.handle("collections:list", (_event, name) => quoteRepository.listCollection(name));
  ipcMain.handle("collections:create", (_event, name, record) => ownWrite(quoteRepository.createCollectionRecord)(name, record));
  ipcMain.handle("collections:update", (_event, name, id, changes) => ownWrite(quoteRepository.updateCollectionRecord)(name, id, changes));
  ipcMain.handle("collections:delete", (_event, name, id) => ownWrite(quoteRepository.deleteCollectionRecord)(name, id));
  // Opens a previously-imported report file (e.g. a CXONE/Salesforce export) in the user's
  // default application (Excel, etc.) - a pure "reopen the file I picked earlier" convenience
  // for the Supervisor Dashboard. Read-only from this app's perspective: we never write to the
  // file, we just ask the OS shell to open it, exactly like double-clicking it in Explorer.
  ipcMain.handle("shell:openPath", async (_event, targetPath) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) {
      return { ok: false, error: "No file path was provided." };
    }
    if (!fs.existsSync(targetPath)) {
      return { ok: false, error: "That file no longer exists at its original location." };
    }
    const errorMessage = await shell.openPath(targetPath);
    return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
  });
  ipcMain.handle("auth:login", (_event, email, password) => ownWrite(quoteRepository.login)(email, password));
  ipcMain.handle("auth:setPassword", (_event, email, currentPassword, newPassword) => ownWrite(quoteRepository.setPassword)(email, currentPassword, newPassword));

  // O&M Reports Inbox - zero-click auto-import (see watchReportsInbox()/processReportsInboxFile()
  // above for the watcher itself). These handlers let the renderer discover/open the watched
  // folder, ask for an immediate re-scan (e.g. right after it registers its "new-file" listener,
  // to pick up anything dropped in before the app/listener was ready), and report back whether an
  // auto-import attempt succeeded so the source file can be filed into Processed/ or Needs Review/.
  ipcMain.handle("reports-inbox:get-path", () => ensureReportsInboxFolders().root);
  ipcMain.handle("reports-inbox:open-folder", async () => {
    const { root } = ensureReportsInboxFolders();
    const errorMessage = await shell.openPath(root);
    return errorMessage ? { ok: false, error: errorMessage } : { ok: true };
  });
  ipcMain.handle("reports-inbox:scan-now", () => {
    scanReportsInboxNow();
    return true;
  });
  ipcMain.on("reports-inbox:import-result", (_event, { token, success } = {}) => {
    const pending = pendingReportsInboxFiles.get(token);
    if (!pending) return; // already handled (e.g. the ack-timeout safety net already fired)
    pendingReportsInboxFiles.delete(token);
    const { processed, needsReview } = ensureReportsInboxFolders();
    moveReportsInboxFile(pending.filePath, success ? processed : needsReview);
  });

  loadEnvFile();
  outboundSync = createOutboundSync({
    repository: quoteRepository,
    config: {
      serverUrl: process.env.BASE44_SERVER_URL || "https://base44.app",
      appId: process.env.BASE44_APP_ID || "6979390a3f44099ffca06859",
      apiKey: process.env.BASE44_API_KEY || ""
    },
    // The background sync flush writes to the same data file (to ack synced quotes).
    // Flag it as our own write too, same as any other in-app CRUD operation, so its
    // (unavoidably delayed, network-round-trip-gated) write can't be mistaken for an
    // external Base44 import and trigger an unwanted window reload.
    onAfterWrite: markOwnWrite
  });
  outboundSync.start();

  ipcMain.handle("sync:flushOutbound", async () => {
    const result = await outboundSync.flush();
    markOwnWrite();
    return result;
  });
  ipcMain.handle("sync:outboundStatus", async () => ({
    ...(await quoteRepository.getOutboundQueueStatus()),
    configured: outboundSync.isConfigured
  }));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});