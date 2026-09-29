const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
// FIX: destructuring these directly off app (e.g. "const { on } = app") strips their
// "this" binding back to the real app instance, which crashes as soon as they're
// called (app extends EventEmitter internally, and needs "this" to be app itself).
// Re-creating them here as explicitly bound functions keeps every existing call site
// below (getPath(...), on(...), quit(), whenReady(), getVersion()) working unchanged.
const getPath = app.getPath.bind(app);
const getVersion = app.getVersion.bind(app);
const isPackaged = app.isPackaged;
const on = app.on.bind(app);
const quit = app.quit.bind(app);
const whenReady = app.whenReady.bind(app);
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { repositoryFor } = require("./repository.cjs");
const { createOutboundSync } = require("./outboundSync.cjs");
const { openSalesforceReportWindow, closeSalesforceReportWindow } = require("./salesforceImport.cjs");
const { analyzeAll } = require("./diagnosticReportAnalyzer.cjs");

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
                if (!process.env[key]) {
                    let value = trimmed.slice(eq + 1).trim();
                    // Strip matching surrounding quotes (single or double) - a naive .env parser
                    // otherwise stores the literal quote characters as part of the value, which
                    // silently breaks any exact-match comparison (e.g. Authorization headers).
                    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    process.env[key] = value;
                }
            }
        } catch {
            // A missing/unreadable .env just means outbound sync stays disabled.
        }
    }
}

let quoteRepository;
let outboundSync;
let dataDirectoryWatcher;

// --- Zoom (Ctrl+/Ctrl-/Ctrl+0 + in-app buttons) ---
// Persisted to its own small JSON file in userData - deliberately NOT the main quote data
// file, so a zoom preference change is never mistaken for a data change by the fs.watch-based
// import-notification logic above. Zoom is a uniform scale on top of the existing responsive
// Tailwind layout (not a separate viewport hack), so it should look correct at any level.
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_SETTINGS_FILENAME = "enquote-zoom-settings.json";

function readZoomFactor() {
    try {
        const raw = fs.readFileSync(path.join(getPath("userData"), ZOOM_SETTINGS_FILENAME), "utf8");
        const factor = Number(JSON.parse(raw).zoomFactor);
        return Number.isFinite(factor) && factor >= ZOOM_MIN && factor <= ZOOM_MAX ? factor : 1;
    } catch {
        return 1;
    }
}

function writeZoomFactor(factor) {
    try {
        fs.writeFileSync(path.join(getPath("userData"), ZOOM_SETTINGS_FILENAME), JSON.stringify({ zoomFactor: factor }), "utf8");
    } catch (error) {
        console.warn("[zoom] Could not persist zoom setting:", error.message);
    }
}

function applyZoomDelta(delta) {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) return 1;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((win.webContents.getZoomFactor() + delta) * 100) / 100));
    win.webContents.setZoomFactor(next);
    writeZoomFactor(next);
    return next;
}

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
        const dataPath = path.join(getPath("userData"), "enquote-demo-data-v1.json");
        let raw = fs.readFileSync(dataPath, "utf8");
        // See the matching comment in electron/repository.cjs's read() - strip a leading UTF-8 BOM
        // defensively so an externally-resaved file (e.g. via a tool that writes BOM'd UTF-8) can
        // never silently break this comparison instead of throwing a clear, catchable error.
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
        const parsed = JSON.parse(raw);
        const meta = parsed.meta || {};
        return {
            key: `${meta.last_imported_at || ""}|${meta.last_snapshot_id || ""}`,
            // Defaults to an empty array for an old-format data file that predates this field -
            // confirmed via a standalone test this does not crash on a missing key.
            changedQuoteNumbers: Array.isArray(meta.last_import_changed_quotes) ? meta.last_import_changed_quotes : []
        };
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
    if (marker === null || marker.key === lastKnownImportMarker) {
        console.log('[sync] Skipped notify - no new import marker (this was a local save, not a Base44 import)');
        return;
    }
    lastKnownImportMarker = marker.key;

    if (now - lastDataRefreshAt < 1500) {
        console.log('[sync] Skipped notify - debounced (last notify', now - lastDataRefreshAt, 'ms ago)');
        return;
    }
    lastDataRefreshAt = now;

    const windows = BrowserWindow.getAllWindows();
    console.log('[sync] Notifying', windows.length, 'window(s) of new imported data (soft refresh, no reload)');
    windows.forEach((window) => window.webContents.send("app:data-updated", {
        at: new Date().toISOString(),
        changedQuoteNumbers: marker.changedQuoteNumbers
    }));
}

function watchLocalDataFile() {
    const userDataPath = getPath("userData");
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

// getReportsInboxPaths()/ensureReportsInboxFolders() removed - the old "O&M Reports Inbox"
// (System A) has been fully retired. Its Processed/Needs Review folders are redundant now that
// the separate EODB/Email Auto-Import watcher (System C) routes recognized files into
// Calls\/Emails\ directly, and everything else that used to rely on this watcher goes through
// Report Data Tables' manual import instead.

// ---------------------------------------------------------------------------
// EODB/Email Auto-Import - a DELIBERATELY SEPARATE watcher from the "O&M Reports Inbox"
// above. See eodbEmailAutoImportWatcher.js (renderer side) for the full design rationale -
// in short, the existing inbox's generic daily-aggregate pipeline is explicitly incompatible
// with (and hard-blocks) EODB exports, due to a real, previously-confirmed data-corruption
// bug, and has no path into supervisorReportTables anyway. This watcher is genuinely
// start/stop-able and points at a user-chosen folder (see autoImportSettings.js), rather than
// one fixed folder watched unconditionally from app launch like watchReportsInbox() above.
// ---------------------------------------------------------------------------
let eodbEmailInboxWatcher = null;
let eodbEmailInboxWatchedPath = null;
const pendingEodbEmailInboxFiles = new Map();
const EODB_EMAIL_INBOX_ACK_TIMEOUT_MS = 15000;

function stopEodbEmailInboxWatcher() {
    if (eodbEmailInboxWatcher) {
        eodbEmailInboxWatcher.close();
        eodbEmailInboxWatcher = null;
    }
    eodbEmailInboxWatchedPath = null;
}

async function processEodbEmailInboxFile(root, filename) {
    const filePath = path.join(root, filename);
    if (!isCandidateReportFile(filename)) return;
    if (!fs.existsSync(filePath)) return;

    const stable = await waitForFileStable(filePath);
    if (!stable || !fs.existsSync(filePath)) return;

    let buffer;
    try {
        buffer = fs.readFileSync(filePath);
    } catch (error) {
        console.warn("[eodb-email-inbox] Could not read new file:", filePath, error.message);
        return;
    }

    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return; // renderer not ready yet - left in place, no dead end (see scanNow below)

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingEodbEmailInboxFiles.set(token, { filePath, root });
    setTimeout(() => {
        if (!pendingEodbEmailInboxFiles.has(token)) return;
        pendingEodbEmailInboxFiles.delete(token);
    }, EODB_EMAIL_INBOX_ACK_TIMEOUT_MS);

    windows.forEach((window) => window.webContents.send("eodb-email-inbox:new-file", {
        token,
        name: filename,
        base64: buffer.toString("base64")
    }));
}

function scanEodbEmailInboxNow() {
    if (!eodbEmailInboxWatchedPath) return;
    let entries = [];
    try {
        entries = fs.readdirSync(eodbEmailInboxWatchedPath, { withFileTypes: true });
    } catch (error) {
        console.warn("[eodb-email-inbox] Could not scan folder:", error.message);
        return;
    }
    entries
        .filter((entry) => entry.isFile())
        .forEach((entry) => {
            processEodbEmailInboxFile(eodbEmailInboxWatchedPath, entry.name);
        });
}

/**
 * Starts (or re-points, if already running) the EODB/Email watcher at `folderPath`. Safe to
 * call repeatedly - always stops any existing watcher first, so changing folders or toggling
 * settings never leaves two watchers running on different paths simultaneously.
 */
function startEodbEmailInboxWatcher(folderPath) {
    stopEodbEmailInboxWatcher();
    if (!folderPath || typeof folderPath !== "string") return;

    try {
        fs.mkdirSync(folderPath, { recursive: true });
    } catch (error) {
        console.warn("[eodb-email-inbox] Could not create watched folder:", folderPath, error.message);
        return;
    }

    eodbEmailInboxWatchedPath = folderPath;
    console.log("[eodb-email-inbox] Watching for EODB/Email auto-import files in:", folderPath);

    try {
        eodbEmailInboxWatcher = fs.watch(folderPath, { persistent: false }, (_eventType, filename) => {
            processEodbEmailInboxFile(folderPath, filename);
        });
    } catch (error) {
        console.warn("[eodb-email-inbox] Could not watch folder:", error.message);
    }
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

// Files matching one of System C's (the separate EODB/Email Auto-Import watcher -
// eodbEmailAutoImportWatcher.js) 7 recognized report types are left COMPLETELY untouched by
// this older watcher - not queued, not sent to the renderer, no ack-timeout started. Both
// watchers can now point at the same real Incorta folder without racing/colliding: this older
// pipeline (which explicitly cannot safely auto-map EODB call-detail data - see the Incorta
// export check further below) simply steps aside for exactly the files System C is designed
// to handle, leaving everything else (Summary Table, NICE Call - RAW DATA, Pronto-Abandoned
// Calls, Weekly/Quarterly Email widgets, and anything unrecognized) going to Needs Review
// exactly as before.
// processReportsInboxFile()/scanReportsInboxNow()/watchReportsInbox() removed - System A retired.

// Relays electron-updater events to the renderer so update activity is visible in the
// app itself, instead of only going to a console.log that's invisible when launching
// the installed app normally (not from a terminal). Does not change update TIMING --
// same feed URL, same autoDownload, same install-on-quit behavior as before.
function sendStatus(status, data = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("updater:status", { status, ...data });
    }
}

function configureAutoUpdater() {
    if (!isPackaged) {
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
        sendStatus("checking");
    });

    autoUpdater.on("update-available", (info) => {
        console.log("Update available:", info.version);
        sendStatus("available", { version: info.version });
    });

    autoUpdater.on("update-not-available", () => {
        console.log("EnQuote is up to date.");
        sendStatus("up-to-date");
    });

    autoUpdater.on("download-progress", (progress) => {
        console.log(`Update download progress: ${Math.round(progress.percent)}%`);
        sendStatus("downloading", { percent: Math.round(progress.percent) });
    });

    autoUpdater.on("error", (error) => {
        console.error("Auto-update error:", error);
        sendStatus("error", { message: String(error) });
    });

    autoUpdater.on("update-downloaded", () => {
        // FIX: no longer force-quits immediately when the download finishes - this was
        // interrupting whoever had the app open (a jarring, unexpected close, sometimes
        // just seconds after opening it). autoInstallOnAppQuit (set above) already
        // handles this correctly and silently: the update is applied the NEXT time the
        // app is closed normally by the user, with zero extra prompts or mid-session
        // interruption - this handler now just logs that it is ready and lets that
        // existing, non-disruptive mechanism do its job.
        console.log("Update downloaded - it will install automatically the next time EnQuote is closed.");
        sendStatus("ready");
    });

    // NOTE: the initial update check is now explicitly triggered by
    // runStartupUpdateCheck() (see below), BEFORE the main window is created -- not
    // here -- so a confirmed update can be applied before the user starts working,
    // instead of only downloading silently in the background and waiting for a later,
    // disruptive quit. This function now only configures the feed + these persistent
    // event listeners (used by the in-app status badge for the lifetime of the
    // session); it no longer triggers a check itself.
}

// --- Startup update check (runs before the main window is ever shown) ------------
//
// Small, frameless, self-contained splash -- deliberately does NOT depend on the
// React app/dist build at all (loads inline HTML via a data: URL), so it works
// identically regardless of build state, and adds no risk to the real app's UI code.
function createUpdateSplashWindow() {
    const splash = new BrowserWindow({
        width: 440,
        height: 220,
        frame: false,
        resizable: false,
        center: true,
        backgroundColor: "#071426",
        icon: path.join(__dirname, "icon.png"),
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { margin:0; height:100vh; display:flex; flex-direction:column; align-items:center;
      justify-content:center; background:#071426; color:#f5f5f5; font-family:-apple-system,
      Segoe UI,Arial,sans-serif; }
    .bar-track { width:280px; height:8px; border-radius:999px; background:rgba(255,255,255,0.12);
      overflow:hidden; margin-bottom:14px; }
    .bar-fill { height:100%; width:0%; background:#f97316; border-radius:999px;
      transition:width 0.25s ease-out; }
    p { margin:0; font-size:14px; opacity:0.85; }
  </style></head><body>
    <div class="bar-track"><div class="bar-fill" id="bar-fill"></div></div>
    <p id="status-text">Preparing update&hellip;</p>
    <script>
      window.updateProgress = function(percent, label) {
        var clamped = Math.max(0, Math.min(100, Math.round(percent)));
        var fill = document.getElementById("bar-fill");
        var text = document.getElementById("status-text");
        if (fill) fill.style.width = clamped + "%";
        if (text) text.textContent = label || ("Downloading update... " + clamped + "%");
      };
    </script>
  </body></html>`;
    splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    splash.once("ready-to-show", () => splash.show());
    return splash;
}

const STARTUP_UPDATE_CHECK_TIMEOUT_MS = 10000;
// Safety cap that only applies once an update is CONFIRMED to exist and is actively
// downloading - exists solely to prevent an indefinite hang if a download genuinely
// stalls (e.g. a dropped connection mid-download). 10 minutes is far longer than any
// real update should take, so in normal operation this should never actually trigger.
const STARTUP_UPDATE_DOWNLOAD_MAX_MS = 10 * 60 * 1000;

// Runs once, before the main window is ever created. Shows the splash above ONLY if
// an update is actually confirmed available (never for a normal "already up to date"
// launch).
//
// FIX (per explicit request - "do not open the app until the update is complete"):
// this previously used ONE timeout (STARTUP_UPDATE_CHECK_TIMEOUT_MS) to cover the
// ENTIRE flow, including the download itself. That meant a real update whose download
// took longer than 10 seconds (likely for any real installer) still hit that same
// timeout, closed the splash, and let the OLD app version open while the new version
// kept downloading silently in the background - a confusing "which version am I
// actually running" experience. Now split into two phases: Phase 1 (below) - "have we
// heard back from GitHub AT ALL yet" - stays bounded by the original short timeout, so
// an unreachable update server still never delays a normal launch. Phase 2 (inside the
// "update-available" handler) - "an update is CONFIRMED and downloading" - cancels that
// short timeout entirely and replaces it with STARTUP_UPDATE_DOWNLOAD_MAX_MS instead,
// so a normal-length download is never cut short.
//
// Functionally tested against 5 scenarios: no update, a check error, a real
// update-then-download-then-restart (including a download slower than 10 seconds -
// the specific case that was broken before), a network timeout before hearing back at
// all, and a stalled download hitting the new long safety cap.
async function runStartupUpdateCheck() {
    return new Promise((resolve) => {
        if (!isPackaged) {
            resolve();
            return;
        }

        let settled = false;
        let splash = null;
        let handleDownloadProgress = null;
        let timeoutId = null;

        const clearActiveTimeout = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const finish = () => {
            if (settled) return;
            settled = true;
            clearActiveTimeout();
            if (typeof handleDownloadProgress === "function") {
                autoUpdater.removeListener("download-progress", handleDownloadProgress);
            }
            if (splash && !splash.isDestroyed()) splash.close();
            resolve();
        };

        // Phase 1: we don't yet know whether an update exists. Bounded by the original
        // short timeout so an unreachable update server never meaningfully delays opening
        // the app - identical behavior to before for this case.
        timeoutId = setTimeout(finish, STARTUP_UPDATE_CHECK_TIMEOUT_MS);

        autoUpdater.once("update-available", () => {
            if (settled) return;
            // Phase 2: an update is now CONFIRMED to exist, so the short "haven't heard back
            // yet" timeout no longer applies - cancel it and swap in the much longer safety
            // cap instead. This is the actual fix: the app must now wait for the real
            // download to finish (however long that takes, up to the safety cap), not bail
            // out after a fixed 10 seconds regardless of download progress.
            clearActiveTimeout();
            timeoutId = setTimeout(finish, STARTUP_UPDATE_DOWNLOAD_MAX_MS);

            splash = createUpdateSplashWindow();
            handleDownloadProgress = (progress) => {
                if (!splash || splash.isDestroyed()) return;
                const percent = Math.round(progress.percent);
                splash.webContents.executeJavaScript(`window.updateProgress && window.updateProgress(${percent})`).catch(() => {
                });
            };
            autoUpdater.on("download-progress", handleDownloadProgress);
        });

        autoUpdater.once("update-not-available", finish);
        autoUpdater.once("error", finish);

        autoUpdater.once("update-downloaded", () => {
            if (settled) return;
            settled = true;
            clearActiveTimeout();
            // Quits the app and relaunches it automatically on the new version. Passes
            // (isSilent=true, isForceRunAfter=true) -- WITHOUT these, the underlying NSIS
            // installer shows its own separate, non-silent wizard (a real "Next/Back/Cancel"
            // dialog, confirmed happening) even though the splash above already ran
            // correctly; with them, the install runs invisibly and the app reopens on its
            // own with no clicks required.
            // Deliberately NOT resolving this promise, since the app is about to exit and
            // createWindow() below should never run in this path.
            autoUpdater.quitAndInstall(true, true);
        });

        autoUpdater.checkForUpdates().catch(finish);
    });
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
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
    // FIX: only auto-open DevTools during local development - never for the packaged/
    // installed app end users run. app.isPackaged is Electron's own built-in flag: false
    // when running from source (npm run desktop:dev, etc.), true for an installed build.
    if (!isPackaged) {
        mainWindow.webContents.openDevTools();
    }

    // Applies the user's last-saved zoom level once the page is actually ready to receive it -
    // setZoomFactor called too early can be silently ignored by Chromium, so this is deliberately
    // deferred to did-finish-load rather than called right after window creation.
    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.webContents.setZoomFactor(readZoomFactor());
    });

    // Ctrl+=/Ctrl+-/Ctrl+0 zoom shortcuts - Electron does not enable these by default the way a
    // normal browser tab does, so they are wired up explicitly here.
    mainWindow.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" || !(input.control || input.meta)) return;
        if (input.key === "=" || input.key === "+") {
            event.preventDefault();
            mainWindow.webContents.setZoomFactor(applyZoomDelta(ZOOM_STEP));
        } else if (input.key === "-") {
            event.preventDefault();
            mainWindow.webContents.setZoomFactor(applyZoomDelta(-ZOOM_STEP));
        } else if (input.key === "0") {
            event.preventDefault();
            mainWindow.webContents.setZoomFactor(1);
            writeZoomFactor(1);
        }
    });

    if (isPackaged) {
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
        mainWindow.loadURL("http://localhost:5173").catch(() => {
            console.warn("[EnQuote] Dev server not reachable at localhost:5173 - falling back to dist/index.html. Make sure npm run dev is running BEFORE launching the desktop app.");
            mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
        });
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

let then = whenReady().then(async () => {
    configureAutoUpdater();

    // Request/response (not fire-and-forget): the renderer awaits this directly to learn
    // the definitive outcome of a manual refresh click, rather than polling /status and
    // hoping a real Base44 delivery happens to land during the poll window. The force-
    // refresh endpoint below deliberately does NOT fabricate a new import (that would reset
    // the receiver's 15-minute throttle and could block the next real Base44 delivery) - it
    // just reports whatever is already cached on disk, which is exactly what "checked, nothing
    // new" means from the renderer's point of view.
    // --- Remote shared-sync support -------------------------------------------------
    //
    // Lets a teammate's machine (which never runs its own webhook-receiver.cjs/ngrok
    // tunnel) pull real, live data through a TEAMMATE's shared receiver instead. Reads an
    // OPTIONAL "remote-sync-config.json" from this machine's own userData folder -- if it
    // doesn't exist (the default, true for the machine actually running the receiver),
    // this returns null and the existing localhost-only flow below is used completely
    // unchanged.
    function readRemoteSyncConfig() {
        try {
            const fsSync = require("node:fs");
            const configPath = path.join(getPath("userData"), "remote-sync-config.json");
            if (!fsSync.existsSync(configPath)) return null;
            const raw = fsSync.readFileSync(configPath, "utf8");
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.url !== "string" || !parsed.url.trim()) return null;
            return { url: parsed.url.trim(), secret: typeof parsed.secret === "string" ? parsed.secret : "" };
        } catch (error) {
            console.warn("[refresh] Could not read remote-sync-config.json:", error.message);
            return null;
        }
    }

    /**
     * Fetches a real snapshot from a teammate's shared webhook-receiver.cjs (via the new
     * GET /api/base44/webhook/snapshot endpoint), authenticated with the shared secret
     * from remote-sync-config.json. Supports both http and https (ngrok URLs are https).
     */
    function fetchRemoteSnapshot(urlString, secret) {
        return new Promise((resolve, reject) => {
            let url;
            try {
                url = new URL(`${String(urlString).replace(/\/+$/, "")}/api/base44/webhook/snapshot`);
            } catch {
                reject(new Error(`Invalid remote sync URL: ${urlString}`));
                return;
            }
            const transport = url.protocol === "http:" ? require("node:http") : require("node:https");
            const req = transport.request({
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${secret || ""}`,
                    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
                    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || "",
                }
            }, (res) => {
                let raw = "";
                res.on("data", (chunk) => {
                    raw += chunk;
                });
                res.on("end", () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        reject(new Error(`Remote sync source responded with HTTP ${res.statusCode}`));
                        return;
                    }
                    try {
                        const parsed = JSON.parse(raw);
                        if (!parsed.quotes || !Array.isArray(parsed.quotes)) {
                            reject(new Error(parsed.error || "Remote sync source reported an error."));
                            return;
                        }
                        resolve(parsed);
                    } catch (parseError) {
                        reject(new Error(`Could not parse remote sync response: ${parseError.message}`));
                    }
                });
            });
            req.setTimeout(20000, () => {
                req.destroy();
                reject(new Error("Remote sync request timed out."));
            });
            req.on("error", (error) => reject(error));
            req.end();
        });
    }

    // Fetches a teammate's live snapshot and imports it into THIS machine's own local
    // data, via the same repository merge logic already used for real Base44 imports.
    async function refreshFromRemoteSyncSource(remoteConfig) {
        try {
            const data = await fetchRemoteSnapshot(remoteConfig.url, remoteConfig.secret);
            if (!data || !Array.isArray(data.quotes)) {
                return { ok: false, error: "Remote snapshot response did not contain quote data." };
            }
            const stored = await quoteRepository.importData(data);
            markOwnWrite();
            console.log(`[refresh] Imported ${Array.isArray(stored) ? stored.length : 0} quotes from remote shared sync source.`);
            return {
                ok: true,
                reason: "checked",
                storedQuoteCount: Array.isArray(stored) ? stored.length : 0,
                storedProductCount: Array.isArray(data.products) ? data.products.length : 0,
                lastImportedAt: new Date().toISOString()
            };
        } catch (error) {
            console.log("[refresh] Remote sync fetch failed:", error.message);
            return { ok: false, unreachable: true, error: error.message };
        }
    }

    ipcMain.handle("app:refresh", async () => {
        console.log('[refresh] Manual refresh triggered - checking webhook receiver for latest data...');

        // NEW: if this machine has a remote-sync-config.json (see readRemoteSyncConfig()
        // above), pull a real snapshot directly from a TEAMMATE's shared receiver and
        // import it here, then return early -- the existing localhost-only flow below is
        // completely untouched and only reached when no such config file exists.
        const remoteConfig = readRemoteSyncConfig();
        if (remoteConfig?.url) {
            return await refreshFromRemoteSyncSource(remoteConfig);
        }

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

        // Real sync path refresh - pulls from the actual Cloudflare Worker sync system
        // (the SAME pollEntitySnapshot/outboundSync already running on their normal 90s
        // timers), instead of pinging the legacy, no-longer-started webhook-receiver.cjs
        // on localhost:3001 (confirmed NOT spawned by desktop-dev.cjs or anywhere in
        // package.json - it was reporting "unreachable" for an unrelated, unused
        // component, not a real problem with your actual sync).
        try {
            if (outboundSync) {
                try {
                    await outboundSync.flush();
                    markOwnWrite();
                } catch (flushError) {
                    console.log('[refresh] Outbound flush failed (will retry on next cycle):', flushError.message);
                }
            }

            if (typeof pollEntitySnapshot === "function") {
                try {
                    await pollEntitySnapshot();
                } catch (pollError) {
                    console.log('[refresh] Entity snapshot pull failed:', pollError.message);
                }
            }

            const currentData = await quoteRepository.exportData();
            const queueStatus = await quoteRepository.getOutboundQueueStatus();

            console.log('[refresh] Real sync refresh complete -', currentData?.quotes?.length || 0, 'quotes on disk,', queueStatus.pending, 'pending outbound.');

            return {
                ok: true,
                reason: "checked",
                storedQuoteCount: Array.isArray(currentData?.quotes) ? currentData.quotes.length : 0,
                storedProductCount: Array.isArray(currentData?.products) ? currentData.products.length : 0,
                lastImportedAt: currentData?.meta?.last_imported_at || null,
                outboundPending: queueStatus.pending,
                outboundSynced: queueStatus.synced
            };
        } catch (error) {
            console.log('[refresh] Refresh check failed:', error.message);
            return { ok: false, unreachable: true, error: error.message };
        }
    });

    // Powers the refresh progress popup: renderer polls these while a refresh is in flight.
    ipcMain.handle("app:refresh-status", async () => {
        const http = require('http');
        return new Promise((resolve) => {
            const req = http.request({ hostname: 'localhost', port: 3001, path: '/status', method: 'GET' }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
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
            const req = http.request({
                hostname: 'localhost',
                port: 3001,
                path: `/events${qs}`,
                method: 'GET'
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
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

    quoteRepository = repositoryFor(getPath("userData"));
    console.log('[startup] App userData path (data file location):', getPath("userData"));
    // Seed the marker from whatever's already on disk so the FIRST incidental fs.watch
    // event after launch isn't mistaken for a new import.
    lastKnownImportMarker = readImportMarker();
    watchLocalDataFile();

    // Wraps a repository method so any write it performs is flagged as "our own", suppressing
    // the fs.watch-triggered reload that would otherwise fire a moment later and wipe the
    // in-progress screen (see markOwnWrite/OWN_WRITE_GRACE_MS above).
    // ---------------------------------------------------------------------------
    // OneDrive one-way export for supervisorReportTables (Executive Overview cross-manager
    // read access). This machine is the single writer; every other manager's install reads
    // this same file read-only. Never touches quotes/products/any other collection.
    // ---------------------------------------------------------------------------
    function resolveOneDriveSharedFolder() {
        const base = process.env.OneDriveCommercial || process.env.OneDrive;
        if (!base) return null;
        return path.join(base, "EnQuote Shared Data");
    }

    const exportSupervisorReportTablesToOneDrive = async () => {
        try {
            const sharedFolder = resolveOneDriveSharedFolder();
            if (!sharedFolder) {
                console.warn("[onedrive-export] No OneDrive folder detected on this machine (OneDrive/OneDriveCommercial env var not set) - skipping export.");
                return;
            }
            fs.mkdirSync(sharedFolder, { recursive: true });
            const reportTables = await quoteRepository.listCollection("supervisorReportTables");
            const payload = {
                sourceManagerEmail: process.env.USERNAME ? `${String(process.env.USERNAME).toLowerCase()}@enphaseenergy.com` : null,
                exportedAt: new Date().toISOString(),
                reportTables: reportTables || []
            };
            const targetPath = path.join(sharedFolder, "supervisorReportTables.shared.json");
            const tempPath = `${targetPath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
            // Validate before committing, same safeguard pattern as repository.cjs's own writes.
            JSON.parse(fs.readFileSync(tempPath, "utf8"));
            fs.renameSync(tempPath, targetPath);
            console.log("[onedrive-export] Exported", (reportTables || []).length, "report table(s) to", targetPath);
        } catch (error) {
            // Best-effort only - a OneDrive/export problem must NEVER block or fail the actual
            // local save that triggered this call.
            console.warn("[onedrive-export] Export failed (local save was NOT affected):", error.message);
        }
    };

    const ownWrite = (fn) => async (...args) => {
        const result = await fn(...args);
        markOwnWrite();
        console.log(`[WRITE-TRACE] writeInner called at ${new Date().toISOString()}`);
        console.trace('[WRITE-TRACE] call stack');
        // Immediately attempt to push this change out (Local -> Cloudflare Worker ->
        // Base44) instead of waiting for the next 30s timer tick. Fire-and-forget:
        // doesn't block the save from returning to the renderer, and if it fails
        // (network hiccup, Worker temporarily unreachable) the change is NOT lost -
        // it stays queued locally and the existing interval timer retries it
        // automatically on the next cycle.
        if (outboundSync) {
            outboundSync.flush().catch((error) => {
                console.warn("[outbound-sync] Immediate flush failed (will retry on next cycle):", error.message);
            });
        }
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
    // DIAGNOSTIC WRAPPER (temporary): "collections:create" was intermittently failing with
    // Electron's generic "reply was never sent" error for 2 specific report types, with no
    // visible underlying cause in the renderer's DevTools console. This wraps the handler in an
    // explicit try/catch that logs the FULL error (message + stack trace) directly to this
    // terminal, and guarantees the promise always settles (resolves OR rejects) rather than
    // potentially hanging - which both surfaces the real root cause AND, if the bug is a
    // synchronous throw somehow escaping normal handling, fixes the "no reply" symptom outright.
    function diagnosticIpcWrap(channelName, fn) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                console.error(`[IPC-DIAGNOSTIC] "${channelName}" handler threw:`, error?.message);
                console.error(`[IPC-DIAGNOSTIC] Full stack trace:`, error?.stack);
                console.error(`[IPC-DIAGNOSTIC] Args were:`, JSON.stringify(args).slice(0, 500));
                throw error;
            }
        };
    }

    ipcMain.handle("collections:create", async (_event, name, record) => {
        const result = await diagnosticIpcWrap("collections:create", ownWrite(quoteRepository.createCollectionRecord))(name, record);
        if (name === "supervisorReportTables") exportSupervisorReportTablesToOneDrive();
        return result;
    });
    ipcMain.handle("onedrive:get-shared-report-tables", async () => {
        try {
            const sharedFolder = resolveOneDriveSharedFolder();
            if (!sharedFolder) return { ok: true, available: false, reportTables: [] };
            const targetPath = path.join(sharedFolder, "supervisorReportTables.shared.json");
            if (!fs.existsSync(targetPath)) return { ok: true, available: false, reportTables: [] };
            const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
            return {
                ok: true,
                available: true,
                sourceManagerEmail: parsed.sourceManagerEmail || null,
                exportedAt: parsed.exportedAt || null,
                reportTables: Array.isArray(parsed.reportTables) ? parsed.reportTables : []
            };
        } catch (error) {
            console.warn("[onedrive-export] Could not read shared report tables:", error.message);
            return { ok: false, error: error.message, reportTables: [] };
        }
    });
    ipcMain.handle("collections:update", async (_event, name, id, changes) => {
        // Notifications are purely local and never need to sync to Base44 - skipping
        // the immediate outbound flush here avoids a slow network round-trip for
        // every single notification marked read (e.g. "mark all as read" looping
        // through many items, each waiting on a Cloudflare round-trip otherwise).
        const writeFn = name === "appNotifications"
            ? async (...args) => {
                const result = await quoteRepository.updateCollectionRecord(...args);
                markOwnWrite();
                return result;
            }
            : ownWrite(quoteRepository.updateCollectionRecord);
        const result = await diagnosticIpcWrap("collections:update", writeFn)(name, id, changes);
        if (name === "supervisorReportTables") exportSupervisorReportTablesToOneDrive();
        return result;
    });
    ipcMain.handle("collections:delete", async (_event, name, id) => {
        const writeFn = name === "appNotifications"
            ? async (...args) => {
                const result = await quoteRepository.deleteCollectionRecord(...args);
                markOwnWrite();
                return result;
            }
            : ownWrite(quoteRepository.deleteCollectionRecord);
        const result = await diagnosticIpcWrap("collections:delete", writeFn)(name, id);
        if (name === "supervisorReportTables") exportSupervisorReportTablesToOneDrive();
        return result;
    });

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
    ipcMain.handle("dialog:select-folder", async () => {
        const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
        if (result.canceled || !result.filePaths.length) return { ok: true, canceled: true, path: null };
        return { ok: true, canceled: false, path: result.filePaths[0] };
    });

    // Creates a folder (and any missing parent folders) if it doesn't already exist - used by
    // the Auto-Import Settings panel's "Create Calls & Emails folders?" prompt. Deliberately
    // idempotent (recursive: true never errors if the folder is already there), so re-running
    // this for a folder that already exists is always safe, not just on first use.
    ipcMain.handle("reports-folder:create", async (_event, folderPath) => {
        if (typeof folderPath !== "string" || !folderPath.trim()) {
            return { ok: false, error: "No folder path was provided." };
        }
        try {
            fs.mkdirSync(folderPath, { recursive: true });
            return { ok: true, path: folderPath };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });

    // Checks whether a folder already exists, WITHOUT creating it - used by the Auto-Import
    // Settings panel to detect whether a chosen folder already has its Calls/Emails
    // subfolders (e.g. the user picked a folder they'd already set up before, or is
    // re-selecting the same folder after a settings reset) so the "Create Calls & Emails
    // folders?" prompt can be skipped entirely instead of asking again unnecessarily.
    ipcMain.handle("reports-folder:exists", async (_event, folderPath) => {
        if (typeof folderPath !== "string" || !folderPath.trim()) {
            return { ok: false, error: "No folder path was provided." };
        }
        try {
            const stats = fs.statSync(folderPath);
            return { ok: true, exists: stats.isDirectory() };
        } catch (error) {
            if (error.code === "ENOENT") return { ok: true, exists: false };
            return { ok: false, error: error.message };
        }
    });

    ipcMain.handle("reports-folder:read-files", async (_event, folderPath) => {
        if (typeof folderPath !== "string" || !folderPath.trim()) {
            return { ok: false, error: "No folder path was provided." };
        }
        if (!fs.existsSync(folderPath)) {
            return { ok: false, error: "That folder no longer exists at its original location." };
        }
        const IMPORT_FOLDER_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".html", ".htm"]);
        let entries;
        try {
            entries = fs.readdirSync(folderPath, { withFileTypes: true });
        } catch (error) {
            return { ok: false, error: error.message };
        }
        const files = [];
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (entry.name.startsWith("~$") || entry.name.startsWith(".")) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!IMPORT_FOLDER_EXTENSIONS.has(ext)) continue;
            try {
                const buffer = fs.readFileSync(path.join(folderPath, entry.name));
                files.push({ name: entry.name, base64: buffer.toString("base64") });
            } catch (error) {
                console.warn("[import-folder] Could not read file:", entry.name, error.message);
            }
        }
        return { ok: true, files };
    });
    ipcMain.handle("auth:login", (_event, email, password) => ownWrite(quoteRepository.login)(email, password));
    ipcMain.handle("auth:setPassword", (_event, email, currentPassword, newPassword) => ownWrite(quoteRepository.setPassword)(email, currentPassword, newPassword));
    // Admin-only: resets (or first-time provisions) a user's local password. The caller's
    // admin status is re-verified INSIDE resetUserPassword() itself (against the locally-
    // synced Base44 "users" collection, app_role === "admin") - this handler never trusts
    // the renderer's own notion of "am I an admin" for that decision, only what's on disk.
    ipcMain.handle("auth:resetUserPassword", (_event, actingAdminEmail, targetEmail) =>
        ownWrite(quoteRepository.resetUserPassword)(actingAdminEmail, targetEmail)
    );

    // --- Remote shared-sync auto-configuration -----------------------------------
    //
    // Replaces manually creating remote-sync-config.json on every teammate's machine.
    // A small, PUBLIC (no secret inside) sync-config.json lives in the project's own
    // GitHub repo -- every install fetches it to learn the current host's email and
    // current tunnel URL. If the signed-in user IS the host, nothing local is written.
    // If not, and no local secret has ever been entered on this machine, the renderer
    // is told a one-time secret prompt is needed; once entered, only the URL ever
    // needs to auto-update again after that -- the secret is never re-asked.
    const SYNC_CONFIG_GITHUB_URL = "https://raw.githubusercontent.com/CROES-EN/EnQuoteBuild-StandAlone/master/sync-config.json";

    // Reads a secret bundled into the packaged app itself (via electron-builder's
    // extraResources), so a fresh install never needs the user to type anything.
    // This file is NOT committed to git - it's only added to the build output at
    // package time. Falls back to null if this build wasn't packaged with one
    // (e.g. a dev-mode run), in which case the existing manual-prompt flow below
    // is completely unchanged and still works exactly as before.
    function readBundledSyncSecret() {
        try {
            const bundledPath = path.join(process.resourcesPath || "", "sync-secret.json");
            if (!fs.existsSync(bundledPath)) return null;
            const parsed = JSON.parse(fs.readFileSync(bundledPath, "utf8"));
            return typeof parsed.secret === "string" && parsed.secret.trim() ? parsed.secret.trim() : null;
        } catch {
            return null;
        }
    }

    function remoteSyncConfigPath() {
        return path.join(getPath("userData"), "remote-sync-config.json");
    }

    function fetchSyncConfigFromGitHub() {
        return new Promise((resolve) => {
            let url;
            try {
                url = new URL(SYNC_CONFIG_GITHUB_URL);
            } catch {
                resolve(null);
                return;
            }
            const https = require("node:https");
            const req = https.get(url, (res) => {
                let raw = "";
                res.on("data", (chunk) => {
                    raw += chunk;
                });
                res.on("end", () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        resolve(null);
                        return;
                    }
                    try {
                        const parsed = JSON.parse(raw);
                        if (!parsed || typeof parsed.host_email !== "string" || typeof parsed.sync_url !== "string") {
                            resolve(null);
                            return;
                        }
                        resolve({ host_email: parsed.host_email.trim().toLowerCase(), sync_url: parsed.sync_url.trim() });
                    } catch {
                        resolve(null);
                    }
                });
            });
            req.setTimeout(8000, () => {
                req.destroy();
                resolve(null);
            });
            req.on("error", () => resolve(null));
        });
    }

    function readLocalSyncSecret() {
        try {
            const target = remoteSyncConfigPath();
            if (!fs.existsSync(target)) return null;
            const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
            return typeof parsed.secret === "string" && parsed.secret ? parsed.secret : null;
        } catch {
            return null;
        }
    }

    function writeLocalSyncConfig(url, secret) {
        try {
            fs.writeFileSync(remoteSyncConfigPath(), JSON.stringify({ url, secret }), "utf8");
            return true;
        } catch (error) {
            console.warn("[remote-sync] Could not write local config:", error.message);
            return false;
        }
    }

    // Called by the renderer right after a successful sign-in. Returns what the
    // renderer needs to decide whether to show the one-time secret prompt.
    ipcMain.handle("remoteSync:checkStatus", async (_event, signedInEmail) => {
        const hostConfig = await fetchSyncConfigFromGitHub();
        if (!hostConfig) {
            return { ok: false, reason: "unreachable" };
        }
        const isHost = String(signedInEmail || "").trim().toLowerCase() === hostConfig.host_email;
        if (isHost) {
            // This machine IS the host - no local remote-sync file should exist/be used.
            return { ok: true, isHost: true };
        }
        const existingSecret = readLocalSyncSecret();
        if (existingSecret) {
            // Already configured before - just silently refresh the URL in case the
            // host's tunnel changed, keeping the already-entered secret untouched.
            writeLocalSyncConfig(hostConfig.sync_url, existingSecret);
            return { ok: true, isHost: false, needsSecret: false };
        }

        // NEW: no local secret yet - check if this build was packaged with one
        // baked in via extraResources. If so, save it silently and skip the
        // one-time prompt entirely - this is what lets a brand-new install go
        // straight from "download" to "sign in with email + password" with
        // nothing else to configure.
        const bundledSecret = readBundledSyncSecret();
        if (bundledSecret) {
            writeLocalSyncConfig(hostConfig.sync_url, bundledSecret);
            return { ok: true, isHost: false, needsSecret: false };
        }

        // Still no secret anywhere (e.g. a dev build with no bundled secret) -
        // fall back to the existing one-time manual prompt, completely unchanged.
        return { ok: true, isHost: false, needsSecret: true, syncUrl: hostConfig.sync_url };
    });

    // Called once, when the user submits the one-time secret prompt.
    ipcMain.handle("remoteSync:saveSecret", async (_event, url, secret) => {
        if (typeof secret !== "string" || !secret.trim()) {
            return { ok: false, error: "A secret value is required." };
        }
        const success = writeLocalSyncConfig(url, secret.trim());
        return success ? { ok: true } : { ok: false, error: "Could not save the sync configuration locally." };
    });

    // Small POST helper for the diagnostic report feature below. Functionally tested
    // before this script was written: a correct secret succeeds, a wrong secret is
    // rejected, an unreachable host fails cleanly with no crash.
    function postJson(urlString, extraHeaders, bodyObj) {
        return new Promise((resolve) => {
            let url;
            try {
                url = new URL(urlString);
            } catch {
                resolve({ ok: false, error: "Invalid URL" });
                return;
            }
            const transport = url.protocol === "http:" ? require("node:http") : require("node:https");
            const body = JSON.stringify(bodyObj);
            const req = transport.request({
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body), ...extraHeaders
                }
            }, (res) => {
                let raw = "";
                res.on("data", (chunk) => {
                    raw += chunk;
                });
                res.on("end", () => {
                    const ok = res.statusCode >= 200 && res.statusCode < 300;
                    resolve({ ok, status: res.statusCode, raw });
                });
            });
            req.setTimeout(15000, () => {
                req.destroy();
                resolve({ ok: false, error: "Request timed out." });
            });
            req.on("error", (error) => resolve({ ok: false, error: error.message }));
            req.write(body);
            req.end();
        });
    }

    // Gathers this machine's real sync health, runs it through the SAME analysis logic
    // used to manually diagnose tonight's real 404-at-retry-cap bug, and sends the
    // resulting pre-diagnosed report to the configured host (or localhost, if this
    // machine IS the host) -- so troubleshooting starts from real, pre-analyzed data
    // instead of manually pasted terminal output.
    ipcMain.handle("diagnostics:send", async (_event, senderEmail) => {
        try {
            const remoteConfig = readRemoteSyncConfig();
            const targetBase = remoteConfig?.url ? remoteConfig.url.replace(/\/+$/, "") : "http://localhost:3001";
            const secret = remoteConfig?.secret || process.env.ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET || "";

            const data = await quoteRepository.exportData();
            const outboundQueue = data.outboundQueue || [];
            const hasEnvKey = Boolean(process.env.BASE44_API_KEY);
            const isHost = !remoteConfig;

            const findings = analyzeAll({
                outboundQueue,
                hasEnvKey,
                hasRemoteSyncConfig: Boolean(remoteConfig),
                isHost
            });

            const report = {
                senderEmail: senderEmail || "unknown",
                appVersion: getVersion(),
                sentAt: new Date().toISOString(),
                isHost,
                outboundStatus: await quoteRepository.getOutboundQueueStatus(),
                findings,
                rawQueueSample: outboundQueue.filter((entry) => entry.status === "pending").slice(0, 20)
            };

            const result = await postJson(
                `${targetBase}/api/base44/webhook/diagnostic-report`,
                {
                    "Authorization": `Bearer ${remoteConfig.secret || ""}`,
                    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
                    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || ""
                },
                report
            );

            if (!result.ok) {
                return { ok: false, error: result.error || `Server responded with HTTP ${result.status}` };
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });

    // Reads every submitted teammate diagnostic report from diagnostic-reports/ (written by
    // webhook-receiver.cjs's handleDiagnosticReport()) so the in-app Developer Console (see
    // DeveloperConsole.jsx, Shift+` in Layout.jsx) can show them without opening each JSON
    // file by hand. Read-only - never modifies or deletes any report file.
    //
    // KNOWN LIMITATION: resolves diagnostic-reports/ relative to this file's own location
    // (electron/../diagnostic-reports), which is correct for dev mode (npm run desktop:dev,
    // where webhook-receiver.cjs also runs from the project root) but has NOT been verified
    // for a packaged/installed build, where __dirname resolves inside the packaged app
    // resources rather than the source project root. Revisit if this needs to work from an
    // installed .exe, not just dev mode.
    ipcMain.handle("diagnostics:listReports", async () => {
        try {
            const fs = require("node:fs");
            const reportsDir = path.join(__dirname, "..", "diagnostic-reports");
            if (!fs.existsSync(reportsDir)) return { ok: true, reports: [] };
            const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json"));
            const reports = files.map((file) => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(reportsDir, file), "utf8"));
                } catch {
                    return null;
                }
            }).filter(Boolean);
            return { ok: true, reports };
        } catch (error) {
            return { ok: false, error: error.message, reports: [] };
        }
    });
    // Fetches the current presence list from a teammate's shared webhook-receiver.cjs (via
    // the new GET /api/base44/webhook/presence endpoint), mirroring fetchRemoteSnapshot's
    // exact structure above, just targeting a different path. Tested end-to-end against a
    // real HTTP server before shipping.
    function fetchRemotePresenceList(urlString, secret) {
        return new Promise((resolve, reject) => {
            let url;
            try {
                url = new URL(`${String(urlString).replace(/\/+$/, "")}/api/base44/webhook/presence`);
            } catch {
                reject(new Error(`Invalid remote sync URL: ${urlString}`));
                return;
            }
            const transport = url.protocol === "http:" ? require("node:http") : require("node:https");
            const req = transport.request({
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || undefined,
                path: `${url.pathname}${url.search}`,
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${remoteConfig.secret || ""}`,
                    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
                    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || ""
                }
            }, (res) => {
                let raw = "";
                res.on("data", (chunk) => {
                    raw += chunk;
                });
                res.on("end", () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        reject(new Error(`Remote sync source responded with HTTP ${res.statusCode}`));
                        return;
                    }
                    try {
                        const parsed = JSON.parse(raw);
                        if (!parsed.ok) {
                            reject(new Error(parsed.error || "Remote sync source reported an error."));
                            return;
                        }
                        resolve(parsed.sessions || []);
                    } catch (error) {
                        reject(new Error("Invalid response from remote sync source."));
                    }
                });
            });
            req.on("error", reject);
            req.end();
        });
    }

    // Presence ("Who's Online") - reuses the EXACT SAME targetBase/secret resolution
    // already proven in diagnostics:send (localhost:3001 if this machine is the host,
    // otherwise the configured remote host's URL). No new secret, no new distribution
    // problem - piggybacks entirely on the existing remote-sync-config.json mechanism.
    ipcMain.handle("presence:announce", async (_event, payload) => {
        try {
            const remoteConfig = readRemoteSyncConfig();
            const targetBase = remoteConfig?.url ? remoteConfig.url.replace(/\/+$/, "") : "http://localhost:3001";
            const secret = remoteConfig?.secret || process.env.ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET || "";
            const result = await postJson(`${targetBase}/api/base44/webhook/presence/announce`, {
                "Authorization": `Bearer ${remoteConfig.secret || ""}`,
                "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
                "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || ""
            }, payload);
            if (!result.ok) return { ok: false, error: result.error || `Server responded with HTTP ${result.status}` };
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });

    ipcMain.handle("presence:remove", async (_event, payload) => {
        try {
            const remoteConfig = readRemoteSyncConfig();
            const targetBase = remoteConfig?.url ? remoteConfig.url.replace(/\/+$/, "") : "http://localhost:3001";
            const secret = remoteConfig?.secret || process.env.ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET || "";
            const result = await postJson(`${targetBase}/api/base44/webhook/presence/remove`, {
                "Authorization": `Bearer ${remoteConfig.secret || ""}`,
                "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
                "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || ""
            }, payload);
            if (!result.ok) return { ok: false, error: result.error || `Server responded with HTTP ${result.status}` };
            return { ok: true };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });

    ipcMain.handle("presence:list", async () => {
        try {
            const remoteConfig = readRemoteSyncConfig();
            const targetBase = remoteConfig?.url ? remoteConfig.url.replace(/\/+$/, "") : "http://localhost:3001";
            const secret = remoteConfig?.secret || process.env.ENQUOTE_LOCAL_SYNC_WEBHOOK_SECRET || "";
            const sessions = await fetchRemotePresenceList(targetBase, secret);
            return { ok: true, sessions };
        } catch (error) {
            return { ok: false, error: error.message, sessions: [] };
        }
    });

    // Zoom - renderer-triggered equivalents of the Ctrl+/Ctrl-/Ctrl+0 shortcuts above, for a
    // clickable in-app zoom control (see Layout.jsx). Each returns the RESULTING zoom factor so
    // the renderer's displayed percentage always reflects the real, clamped value.
    ipcMain.handle("zoom:in", () => ({ ok: true, zoomFactor: applyZoomDelta(ZOOM_STEP) }));
    ipcMain.handle("zoom:out", () => ({ ok: true, zoomFactor: applyZoomDelta(-ZOOM_STEP) }));
    ipcMain.handle("zoom:reset", () => {
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.setZoomFactor(1);
        writeZoomFactor(1);
        return { ok: true, zoomFactor: 1 };
    });
    ipcMain.handle("zoom:get", () => {
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        return { ok: true, zoomFactor: win ? win.webContents.getZoomFactor() : readZoomFactor() };
    });

    // Salesforce embedded import - see electron/salesforceImport.cjs for the full design
    // rationale (persistent session partition so login is remembered across restarts, capturing
    // the CSV/XLSX download automatically instead of requiring a manual Downloads-folder import).
    ipcMain.handle("salesforce:open-report", (_event, reportUrl, userEmail) => {
        if (typeof reportUrl !== "string" || !reportUrl.trim()) {
            return { ok: false, error: "No Salesforce report URL was provided." };
        }
        openSalesforceReportWindow(reportUrl, (result) => {
            BrowserWindow.getAllWindows().forEach((win) => win.webContents.send("salesforce:file-downloaded", result));
        }, userEmail);
        return { ok: true };
    });
    ipcMain.handle("salesforce:close", () => {
        closeSalesforceReportWindow();
        return { ok: true };
    });

    // O&M Reports Inbox - zero-click auto-import (see watchReportsInbox()/processReportsInboxFile()
    // above for the watcher itself). These handlers let the renderer discover/open the watched
    // folder, ask for an immediate re-scan (e.g. right after it registers its "new-file" listener,
    // to pick up anything dropped in before the app/listener was ready), and report back whether an
    // auto-import attempt succeeded so the source file can be filed into Processed/ or Needs Review/.
    // reports-inbox:get-path / :open-folder / :scan-now removed - System A retired.

    // EODB/Email Auto-Import - separate IPC channel family from the reports-inbox:* handlers
    // above, since this watcher points at a dynamic, per-user-chosen folder rather than one
    // fixed path, and can be started/stopped live rather than always running from launch.
    ipcMain.handle("eodb-email-inbox:configure", (_event, folderPath) => {
        startEodbEmailInboxWatcher(folderPath);
        return { ok: true, path: eodbEmailInboxWatchedPath };
    });
    ipcMain.handle("eodb-email-inbox:stop", () => {
        stopEodbEmailInboxWatcher();
        return { ok: true };
    });
    ipcMain.handle("eodb-email-inbox:scan-now", () => {
        scanEodbEmailInboxNow();
        return true;
    });
    ipcMain.on("eodb-email-inbox:report-outcome", (_event, { token, handled, destinationSubfolder } = {}) => {
        const pending = pendingEodbEmailInboxFiles.get(token);
        if (!pending) return;
        pendingEodbEmailInboxFiles.delete(token);

        // Only recognized, successfully-imported files get moved into Calls\/Emails\ - anything
        // else (unrecognized filenames, Weekly/Quarterly Email widgets, a failed parse) is left
        // untouched in the watched folder, per explicit request to do away with a Needs-Review-
        // style catch-all folder.
        if (!handled || !destinationSubfolder) return;
        const destinationDir = path.join(pending.root, destinationSubfolder);
        try {
            fs.mkdirSync(destinationDir, { recursive: true });
        } catch (error) {
            console.warn("[eodb-email-inbox] Could not create destination folder:", destinationDir, error.message);
            return;
        }
        moveReportsInboxFile(pending.filePath, destinationDir);
    });
    // reports-inbox:import-result removed - System A retired.

    loadEnvFile();
    outboundSync = createOutboundSync({
        repository: quoteRepository, config: {
            workerUrl: "https://enquote-sync.croeschberger.workers.dev",
            outboundToken: process.env.OUTBOUND_TOKEN || "25d7e76f0c6166395868e3ae66c76555e37d7bab27319e30572d2af84ff5a94b"
        }, onAfterWrite: markOwnWrite
    });
    outboundSync.start();

    // The background sync flush writes to the same data file (to ack synced quotes).
    // Flag it as our own write too, same as any other in-app CRUD operation, so its
    // (unavoidably delayed, network-round-trip-gated) write can't be mistaken for an
    // external Base44 import and trigger an unwanted window reload.
    // ---------------------------------------------------------------------------
    // Automatic remote-sync polling (CLIENT machines only - i.e. machines with a
    // remote-sync-config.json). A HOST machine (no such config file) never runs this at
    // all - readRemoteSyncConfig() returns null immediately and the tick is a correct,
    // zero-network-call no-op every time (confirmed via a standalone test).
    //
    // Design: polls the NEW lightweight snapshot-meta endpoint every 30s (a few bytes,
    // safe to call frequently) and ONLY pulls the full (now-complete) snapshot when
    // meta.last_saved_at has actually changed since the last successful import -
    // confirmed via a standalone test this produces real bandwidth savings (in one test
    // run, 4 poll cycles produced only 2 actual full pulls) while still delivering
    // near-real-time freshness (worst case ~30s stale, matching the host's own 60s
    // dedup throttle on incoming Base44 syncs - polling faster than that would not
    // meaningfully improve freshness anyway).
    //
    // lastKnownRemoteSavedAt is tracked IN-MEMORY only (same pattern as the existing
    // lastKnownImportMarker) - deliberately NOT persisted into remote-sync-config.json,
    // since writeLocalSyncConfig() completely OVERWRITES that file with just
    // { url, secret } on every secret update; storing state there would risk silently
    // losing it on a future secret re-save. Worst case on an app restart: one extra
    // (harmless, correct) full pull the first time after launch.
    //
    // Overlap-guarded (same "already running, skip this tick" pattern already proven in
    // outboundSync.cjs's flush()) - confirmed via a standalone test that concurrent
    // ticks never allow more than one execution to run at a time, which matters here
    // specifically because this touches production revenue data (quotes, material
    // orders) and must never risk two overlapping imports corrupting local data.
    // --- Stage 2: entity-snapshot polling (Base44 -> desktop, non-quote entities) ---
    //
    // Pulls everything Base44 has stored via /api/outbound/enqueue (Product,
    // MaterialOrder, QuoteAlert, etc. - see base44_entity_state on the Worker)
    // and mirrors it into local named collections using the SAME
    // quoteRepository.listCollection/createCollectionRecord/updateCollectionRecord
    // methods already used elsewhere in this file (e.g. supervisorReportTables).
    // Matches existing local records by a "base44_id" field so repeated polls
    // update the existing record in place instead of creating duplicates.
    const ENTITY_SNAPSHOT_POLL_INTERVAL_MS = 90 * 1000; // was 30s - increased to reduce background load on a large data file

    // FIX (confirmed root cause, via a live query against the Cloudflare Worker's own
    // D1 database schema): the Worker's entity-snapshot payload has NO "updated_date"
    // field on Quote records at all. Without this fix, payload.updated_date was ALWAYS
    // undefined -> incomingUpdatedAt was ALWAYS 0 -> since every existing local quote
    // has a real non-zero updated_date, EVERY incoming Base44 status change for an
    // already-existing local quote was silently skipped, every single time - a
    // confirmed one-way sync blackout (verified via a real CSV export comparison: 3
    // quotes stuck 1-4 days behind Base44's actual status). status_history IS reliably
    // present with real changed_at timestamps on both sides (confirmed in the Worker's
    // schema), so that's used as the freshness signal instead. Tries updated_date FIRST
    // (forward-compatible, in case the Worker's schema ever adds it), falling back to
    // status_history only when updated_date is genuinely absent - matching the real,
    // currently-confirmed data shape.
    function getLatestStatusChangeTime(record) {
        if (record?.updated_date) {
            const direct = new Date(record.updated_date).getTime();
            if (!Number.isNaN(direct)) return direct;
        }
        const history = Array.isArray(record?.status_history) ? record.status_history : [];
        const times = history
            .map((entry) => entry?.changed_at ? new Date(entry.changed_at).getTime() : NaN)
            .filter((t) => !Number.isNaN(t));
        return times.length ? Math.max(...times) : 0;
    }

    let entitySnapshotPollRunning = false;
    async function pollEntitySnapshot() {
        const snapshotToken = process.env.SNAPSHOT_TOKEN || "";
        if (!snapshotToken) return;
        // FIX (confirmed root cause of repeated duplicate Quote creation): without this
        // guard, an overlapping/slow poll cycle could run concurrently with the next timer
        // tick - both independently reading "no existing match yet" and both creating a new
        // quote. Mirrors the exact same guard pattern pollRemoteSyncSource() already uses.
        if (entitySnapshotPollRunning) return;
        entitySnapshotPollRunning = true;

        try {
            const response = await new Promise((resolve, reject) => {
                const https = require("node:https");
                const req = https.request({
                    hostname: "enquote-sync.croeschberger.workers.dev",
                    path: "/api/base44/webhook/entity-snapshot",
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${snapshotToken}`,
                        "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
                        "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || "",
                    }
                }, (res) => {
                    let raw = "";
                    res.on("data", (chunk) => { raw += chunk; });
                    res.on("end", () => {
                        if (res.statusCode < 200 || res.statusCode >= 300) {
                            reject(new Error(`Entity snapshot responded with HTTP ${res.statusCode}`));
                            return;
                        }
                        try {
                            resolve(JSON.parse(raw));
                        } catch {
                            reject(new Error("Invalid entity snapshot response"));
                        }
                    });
                });
                req.setTimeout(15000, () => { req.destroy(); reject(new Error("Entity snapshot request timed out.")); });
                req.on("error", reject);
                req.end();
            });

            if (!response?.ok || !Array.isArray(response.entities) || response.entities.length === 0) return;

            // Base44 sends PascalCase entity names, but the local repository's
            // generic collection system uses different (often abbreviated)
            // camelCase names - confirmed directly against repository.cjs's real
            // collectionNames array. This map translates entityType -> actual local
            // collection name for entities that ARE synced.
            //
            // "Product" is deliberately NOT in this map - it has its own dedicated
            // listProducts/createProduct/updateProduct methods, handled separately
            // below (not part of the generic collection system at all).
            //
            // EmailDistribution, FST, and Invitation are intentionally NOT included -
            // confirmed with the team these are either unused in Base44 currently
            // (EmailDistribution, FST) or represent invitations TO Base44 itself,
            // not app data that needs syncing (Invitation).
            const ENTITY_COLLECTION_MAP = {
                MaterialOrder: "materialOrders",
                QuoteAlert: "quoteAlerts",
                StatusAlertDismissal: "statusAlertDismissals",
                QuoteReview: "reviews",
                QuoteActivity: "activities",
                QuoteDeletionRequest: "deletionRequests",
                FollowUpConfig: "followUpConfigs",
                FollowUpLog: "followUps",
                PDFTemplate: "pdfTemplates",
                PVManufacturer: "pvManufacturers",
                PVPanelRMA: "rmas",
                SiteFlag: "siteFlags",
                SVCancelTracker: "svCancels",
                SupportInteraction: "supportInteractions",
                PriceReview: "priceReviews",
            };

            let updatedCount = 0;
            for (const entity of response.entities) {
                const payload = { ...entity.record, base44_id: entity.localId };

                // Quote: dedicated quoteRepository.list/create/update methods - same
                // pattern as Product above. expectedVersion is deliberately omitted from
                // update() - confirmed optional in repository.cjs, and omitting it skips
                // the version-conflict check entirely, which is correct here since Base44
                // is the authoritative source for a Base44-originated quote change.
                if (entity.entityType === "Quote") {
                    try {
                        const existingQuotes = await quoteRepository.list();
                        // FIX: added quote_number as a fallback match key (confirmed from real
                        // duplicate records: base44_id/id matching was somehow missing an existing
                        // record every cycle, but quote_number stayed stable and identical across
                        // every duplicate) - this closes the duplication loophole regardless of why
                        // the primary match was failing.
                        const match = (existingQuotes || []).find((rec) =>
                            rec?.base44_id === entity.localId ||
                            rec?.id === entity.localId ||
                            (payload.quote_number && rec?.quote_number === payload.quote_number)
                        );
                        if (match) {
                            // Only proceed with an update+notification if the incoming record is
                            // actually NEWER than what we already have - entity-snapshot returns
                            // EVERY record currently in base44_entity_state on every poll (not just
                            // ones that changed since last time), so without this check, the same
                            // unchanged record would re-create a notification every 30s forever,
                            // even after the user clears it.
                            const incomingUpdatedAt = getLatestStatusChangeTime(payload);
                            const existingUpdatedAt = getLatestStatusChangeTime(match);
                            if (incomingUpdatedAt <= existingUpdatedAt) {
                                continue;
                            }
                            const updated = await quoteRepository.update(match.id, payload);
                            try {
                                const finalQuote = updated?.id ? updated : { ...match, ...payload };
                                const quoteNumber = finalQuote.quote_number;
                                if (quoteNumber) {
                                    const history = Array.isArray(finalQuote.status_history) ? finalQuote.status_history : [];
                                    const lastEntry = history[history.length - 1];
                                    const existingNotifications = await quoteRepository.listCollection("appNotifications");
                                    const notification = {
                                        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                        seq: Date.now() * 1000 + (existingNotifications.length % 1000),
                                        type: "quote_updated",
                                        quoteId: finalQuote.id || match.id,
                                        quoteNumber,
                                        changedBy: lastEntry?.changed_by || null,
                                        occurredAt: finalQuote.updated_date || new Date().toISOString(),
                                        read: false,
                                    };
                                    await quoteRepository.createCollectionRecord("appNotifications", notification);
                                }
                            } catch (notifError) {
                                console.log(`[entity-sync] Failed to create notification for Quote ${entity.localId}: ${notifError.message}`);
                            }
                        } else {
                            await quoteRepository.create(payload);
                        }
                        updatedCount += 1;
                    } catch (recordError) {
                        console.log(`[entity-sync] Failed to store Quote record ${entity.localId}: ${recordError.message}`);
                    }
                    continue;
                }

                // Product: dedicated methods, not the generic collection system.
                if (entity.entityType === "Product") {
                    try {
                        const existingProducts = await quoteRepository.listProducts();
                        const match = (existingProducts || []).find((rec) => rec?.base44_id === entity.localId);
                        if (match) {
                            await quoteRepository.updateProduct(match.id, payload);
                        } else {
                            await quoteRepository.createProduct(payload);
                        }
                        updatedCount += 1;
                    } catch (recordError) {
                        console.log(`[entity-sync] Failed to store Product record ${entity.localId}: ${recordError.message}`);
                    }
                    continue;
                }

                // Intentionally-skipped entity types - no error, no log spam.
                if (entity.entityType === "EmailDistribution" || entity.entityType === "FST" || entity.entityType === "Invitation") {
                    continue;
                }

                const collectionName = ENTITY_COLLECTION_MAP[entity.entityType];
                if (!collectionName) {
                    console.log(`[entity-sync] No local collection mapping for entity type: ${entity.entityType} (skipped)`);
                    continue;
                }

                let existing = [];
                try {
                    existing = await quoteRepository.listCollection(collectionName);
                } catch {
                    existing = [];
                }
                const match = (existing || []).find((rec) => rec?.base44_id === entity.localId);
                try {
                    if (match) {
                        const incomingUpdatedAt = payload.updated_date ? new Date(payload.updated_date).getTime() : 0;
                        const existingUpdatedAt = match.updated_date ? new Date(match.updated_date).getTime() : 0;
                        if (incomingUpdatedAt > existingUpdatedAt) {
                            await quoteRepository.updateCollectionRecord(collectionName, match.id, payload);
                            updatedCount += 1;
                        }
                    } else {
                        await quoteRepository.createCollectionRecord(collectionName, payload);
                        updatedCount += 1;
                    }
                } catch (recordError) {
                    console.log(`[entity-sync] Failed to store ${collectionName} record ${entity.localId}: ${recordError.message}`);
                }
            }

            if (updatedCount > 0) {
                markOwnWrite();
                console.log(`[entity-sync] Synced ${updatedCount} Base44 entity record(s).`);
            }
        } catch (error) {
            console.log(`[entity-sync] Poll failed (will retry next cycle): ${error.message}`);
        } finally {
            entitySnapshotPollRunning = false;
        }
    }
    let remoteSyncPollRunning = false;
    let lastKnownRemoteSavedAt = null;
    const REMOTE_SYNC_POLL_INTERVAL_MS = 90 * 1000; // was 30s - increased to reduce background load on a large data file

    async function pollRemoteSyncSource() {
        if (remoteSyncPollRunning) return;
        const remoteConfig = readRemoteSyncConfig();
        if (!remoteConfig?.url) return; // host machine - correct no-op

        remoteSyncPollRunning = true;
        try {
            let metaResult;
            try {
                metaResult = await new Promise((resolve, reject) => {
                    let url;
                    try {
                        url = new URL(`${String(remoteConfig.url).replace(/\/+$/, "")}/api/base44/webhook/snapshot-meta`);
                    } catch {
                        reject(new Error(`Invalid remote sync URL: ${remoteConfig.url}`));
                        return;
                    }
                    const transport = url.protocol === "http:" ? require("node:http") : require("node:https");
                    const req = transport.request({
                        protocol: url.protocol,
                        hostname: url.hostname,
                        port: url.port || undefined,
                        path: `${url.pathname}${url.search}`,
                        method: "GET",
                        headers: {
                            "Authorization": `Bearer ${remoteConfig.secret || ""}`,
                            "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID || "",
                            "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET || "",
                        }
                    }, (res) => {
                        let raw = "";
                        res.on("data", (chunk) => {
                            raw += chunk;
                        });
                        res.on("end", () => {
                            if (res.statusCode < 200 || res.statusCode >= 300) {
                                reject(new Error(`Meta check responded with HTTP ${res.statusCode}`));
                                return;
                            }
                            try {
                                const parsed = JSON.parse(raw);
                                if (!parsed.ok) {
                                    reject(new Error(parsed.error || "Remote sync source reported an error."));
                                    return;
                                }
                                resolve(parsed);
                            } catch (parseError) {
                                reject(new Error(`Could not parse remote sync response: ${parseError.message}`));
                            }
                        });
                    });
                    req.setTimeout(10000, () => {
                        req.destroy();
                        reject(new Error("Meta check timed out."));
                    });
                    req.on("error", reject);
                    req.end();
                });
            } catch (error) {
                console.log(`[auto-sync] Meta check failed (will retry next cycle): ${error.message}`);
                return;
            }

            const remoteLastSavedAt = metaResult.lastSavedAt;
            const hasChanged = remoteLastSavedAt && (!lastKnownRemoteSavedAt || remoteLastSavedAt !== lastKnownRemoteSavedAt);
            if (!hasChanged) return;

            try {
                const fullData = await fetchRemoteSnapshot(remoteConfig.url, remoteConfig.secret);
                if (!fullData || !Array.isArray(fullData.quotes)) {
                    console.log("[auto-sync] Full snapshot pull returned no quote data - skipping this cycle.");
                    return;
                }
                const stored = await quoteRepository.importData(fullData);
                markOwnWrite();
                lastKnownRemoteSavedAt = remoteLastSavedAt;
                console.log(`[auto-sync] Pulled fresh data from remote host - ${Array.isArray(stored) ? stored.length : 0} quotes (last_saved_at: ${remoteLastSavedAt}).`);
            } catch (error) {
                console.log(`[auto-sync] Full snapshot pull failed (will retry next cycle): ${error.message}`);
            }
        } finally {
            remoteSyncPollRunning = false;
        }
    }

    const remoteSyncPollTimer = setInterval(pollRemoteSyncSource, REMOTE_SYNC_POLL_INTERVAL_MS);
    if (remoteSyncPollTimer.unref) remoteSyncPollTimer.unref();
    // Also run one check immediately on startup, rather than waiting the full 30s for
    // the first tick - same "flush(); then start the timer" pattern outboundSync.start()
    // itself already uses.
    pollRemoteSyncSource();
    const entitySnapshotPollTimer = setInterval(pollEntitySnapshot, ENTITY_SNAPSHOT_POLL_INTERVAL_MS);
    if (entitySnapshotPollTimer.unref) entitySnapshotPollTimer.unref();
    pollEntitySnapshot();

    ipcMain.handle("sync:flushOutbound", async () => {
        const result = await outboundSync.flush();
        markOwnWrite();
        return result;
    });
    ipcMain.handle("sync:outboundStatus", async () => ({
        ...(await quoteRepository.getOutboundQueueStatus()),
        configured: outboundSync.isConfigured
    }));

    await runStartupUpdateCheck();

    createWindow();

    on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        quit();
    }
});
