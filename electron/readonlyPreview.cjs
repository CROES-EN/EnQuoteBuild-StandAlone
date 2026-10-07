const fs = require("node:fs/promises");
const path = require("node:path");
const {pathToFileURL} = require("node:url");

const PRIVATE_PAGES = new Set(["Messages", "Tasks", "Base44_DTO"]);
const COLLECTION_PAGES = {
  reviews: ["Quotes", "QuoteDetails", "RejectedQuoteReview"],
  activities: ["Dashboard", "Quotes", "QuoteDetails", "SupervisorDashboard"],
  followUps: ["Quotes", "QuoteDetails"],
  users: ["Users", "Quotes", "QuoteDetails", "Dashboard", "SupervisorDashboard", "Workload"],
  siteFlags: ["SiteFlagManager", "Quotes", "QuoteDetails", "Workload"],
  deletionRequests: ["QuoteDeletionRequests"],
  materialOrders: ["MaterialOrders"], rmas: ["PVPanelRMAs"], svCancels: ["SVCancelTracker"],
  supportInteractions: ["Quotes", "QuoteDetails"], pdfTemplates: ["PDFTemplateSettings", "Quotes", "QuoteDetails"],
  priceReviews: ["Products"], followUpConfigs: ["FollowUpSettings"], pvManufacturers: ["PVPanelRMAs"],
  supervisorDailyMetrics: ["SupervisorDashboard"],
  supervisorReportTables: ["SupervisorDashboard", "Workload", "AutoDrafter", "EnphaseCare", "Quotes", "QuoteDetails"],
  quoteAlerts: ["Quotes", "Dashboard"],
  autoDrafterGeneratedDrafts: ["AutoDrafter"]
};
const PUBLIC_USER_FIELDS = [
  "id", "email", "display_name", "full_name", "name", "app_role", "additional_roles",
  "allow_pages", "deny_pages", "role_source", "department"
];
const publicUser = user => Object.fromEntries(PUBLIC_USER_FIELDS.filter(key => user?.[key] !== undefined).map(key => [key, user[key]]));
const emailOf = user => String(user?.email || "").trim().toLowerCase();

function installPreviewIpcGuard(ipcMain, getController) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
    const controller = getController();
    if (controller?.isPreview(event.sender.id) && !["viewing:context", "viewing:recheck", "viewing:select-user", "viewing:exit"].includes(channel)) {
      return controller.read(event.sender.id, channel, args, () => listener(event, ...args));
    }
    return listener(event, ...args);
  });
  const on = ipcMain.on.bind(ipcMain);
  ipcMain.on = (channel, listener) => on(channel, (event, ...args) => {
    if (getController()?.isPreview(event.sender.id)) {
      console.warn(`[viewing-mode] Rejected send-only IPC: ${channel}`);
      return;
    }
    listener(event, ...args);
  });
}

function previewRequestAllowed(details, devOrigin) {
  try {
    const url = new URL(details.url);
    if (details.method !== "GET") return false;
    if (url.protocol === "enquote-preview:") return url.hostname === "app";
    if (!devOrigin) return false;
    const dev = new URL(devOrigin);
    if (url.origin === dev.origin) {
      const pathname = decodeURIComponent(url.pathname);
      return ["/", "/index.html", "/package.json", "/@react-refresh", "/electron/pageAccess.mjs"].includes(pathname) ||
        /^\/(?:src|assets|shared|node_modules\/(?:\.vite|@[^/]+|[^/.][^/]*?)|@vite|@id)\//.test(pathname) ||
        /^\/[^/]+\.(?:png|jpg|jpeg|gif|svg|ico|woff2?)$/i.test(pathname);
    }
    return url.protocol === "ws:" && url.host === dev.host;
  } catch {
    return false;
  }
}

function createReadonlyPreview({
  BrowserWindow, session, net, ipcMain, getMainWindow, getIdentity, getPolicy, getOverview,
  getRepository, getUserDataPath, getEntry, canAccessPage, rolesForUser, allPages,
  devUrl = "", logger = console, recheckMs = 30000, show = true, readyTimeoutMs = 10000
}) {
  const previews = new Map();

  function fail(message) {
    throw new Error(`[Read-only viewing mode] ${message}`);
  }

  async function liveAccess() {
    const actorEmail = emailOf(getIdentity());
    if (!actorEmail) fail("Verified identity is unavailable.");
    const policy = await getPolicy();
    if (policy?.ok !== true || policy.offline || emailOf(policy.me) !== actorEmail ||
        !rolesForUser(policy.me).includes("super_admin")) {
      fail("Live Super Admin authorization is required; cached policy cannot grant viewing mode.");
    }
    const overview = await getOverview();
    if (overview?.ok !== true || overview.offline || !Array.isArray(overview.users)) fail("Live service accounts are unavailable.");
    if (emailOf(getIdentity()) !== actorEmail) fail("The verified account changed during authorization.");
    return {actor: publicUser(policy.me), policy, users: overview.users.map(publicUser), rolePages: overview.rolePages};
  }

  function close(record, reason = "") {
    if (record.ending) return;
    record.ending = true;
    clearInterval(record.timer);
    if (!record.window.isDestroyed()) record.window.close();
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      if (reason) main.webContents.send("viewing:ended", {reason});
      main.show(); main.focus();
    }
  }

  async function authorize(record, force = false) {
    if (record.ending) fail("Viewing mode is closing; all access is blocked.");
    if (emailOf(getIdentity()) !== record.actorEmail) { close(record, "The real account changed."); fail("The real account changed. Viewing mode ended."); }
    if (!force && Date.now() - record.checkedAt < recheckMs) return record.access;
    if (record.checking) return record.checking;
    record.checking = (async () => {
      try {
        const access = await liveAccess();
        if (record.ending) fail("Viewing mode is closing; all access is blocked.");
        if (emailOf(access.actor) !== record.actorEmail) fail("The real account changed.");
        const target = access.users.find(user => emailOf(user) === record.targetEmail);
        if (!target) fail("The selected account is no longer available.");
        const changed = JSON.stringify([record.access.actor, record.access.target, record.access.rolePages]) !== JSON.stringify([access.actor, target, access.rolePages]);
        record.access = {...access, target};
        record.checkedAt = Date.now();
        if (changed) record.window.reload();
        return record.access;
      } catch (error) {
        logger.warn("[viewing-mode] Authorization lost:", error.message);
        close(record, error.message);
        throw error;
      } finally {
        record.checking = null;
      }
    })();
    return record.checking;
  }

  function hasPage(access, pages) {
    return pages.some(page => !PRIVATE_PAGES.has(page) &&
      canAccessPage(access.target, page, {rolePages: access.rolePages}) &&
      canAccessPage(access.actor, page, {rolePages: access.rolePages}));
  }

  async function read(id, channel, args, original) {
    const record = previews.get(id);
    if (!record) fail("Viewing window is no longer authorized.");
    const access = await authorize(record);
    const permitted = pages => { if (!hasPage(access, pages)) fail("This data is not granted by both accounts' current page permissions."); };
    if (channel === "auth:getVerifiedIdentity") return {email: access.target.email, viewingOnly: true};
    if (channel === "admin:policy") {
      return {ok: true, rolePages: access.rolePages, me: access.target, announcement: access.policy.announcement};
    }
    if (channel === "zoom:get") return {ok: true, zoomFactor: record.window.webContents.getZoomFactor()};
    if (channel === "ui:get-info") return original();
    if (channel === "quotes:list" || channel === "quotes:get") {
      permitted(["Dashboard", "Quotes", "QuoteDetails", "QuoteOverview", "SupervisorDashboard", "Workload", "AutoDrafter", "InactiveRevenueDashboard", "InactiveCollections", "Boneyard", "SLAReporting"]);
      return original();
    }
    if (channel === "products:list") { permitted(["Products", "Quotes", "QuoteDetails", "AutoDrafter"]); return original(); }
    if (channel === "collections:list") {
      const pages = typeof args[0] === "string" && Object.hasOwn(COLLECTION_PAGES, args[0]) ? COLLECTION_PAGES[args[0]] : null;
      if (!pages) fail("Private or unsupported collection reads are blocked.");
      permitted(pages);
      if (args[0] === "users") return access.users;
      const records = await original();
      return records;
    }
    if (channel === "largeTables:get") {
      permitted(["SupervisorDashboard", "EnphaseCare", "Quotes", "QuoteDetails"]);
      if (args[0] !== "care_subscriptions") fail("Unsupported large-table read.");
      try {
        return JSON.parse(await fs.readFile(path.join(getUserDataPath(), "large-tables", "care_subscriptions.json"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return (await getRepository().listCollection("supervisorReportTables")).find(row => row.id === "care_subscriptions") || null;
      }
    }
    if (["sops:list", "sops:versions", "sops:getFile"].includes(channel)) { permitted(["SOPLibrary"]); return original(); }
    if (["profiles:list", "profiles:getAvatar"].includes(channel)) return original();
    fail(`Private data and write actions are blocked (${channel}).`);
  }

  async function start(sender, targetEmail) {
    if (sender !== getMainWindow()?.webContents || previews.has(sender.id)) fail("Only the main app can start viewing mode.");
    const access = await liveAccess();
    const normalized = String(targetEmail || "").trim().toLowerCase();
    const target = access.users.find(user => emailOf(user) === normalized);
    if (!target) fail("Select a current service account.");
    const entry = getEntry();
    if (!entry && !devUrl) fail("The renderer entry is unavailable.");
    const previewSession = session.fromPartition(`enquote-readonly-${require("node:crypto").randomUUID()}`);
    previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    previewSession.setPermissionCheckHandler(() => false);
    previewSession.webRequest.onBeforeRequest((details, callback) => callback({cancel: !previewRequestAllowed(details, devUrl)}));
    if (!devUrl) {
      const root = path.dirname(entry);
      previewSession.protocol.handle("enquote-preview", request => {
        const url = new URL(request.url);
        const relative = decodeURIComponent(url.pathname);
        const file = path.resolve(root, `.${relative}`);
        if (url.hostname !== "app" || (file !== root && !file.startsWith(`${root}${path.sep}`))) {
          return new Response("Blocked preview resource", {status: 403});
        }
        return net.fetch(pathToFileURL(file).href, {bypassCustomProtocolHandlers: true});
      });
    }
    const window = new BrowserWindow({
      show, width: 1500, height: 960, minWidth: 1100, minHeight: 720, title: "EnQuote - read-only viewing mode",
      parent: getMainWindow(), autoHideMenuBar: true,
      webPreferences: {
        session: previewSession, preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        additionalArguments: ["--enquote-readonly-preview"]
      }
    });
    const record = {
      window, id: window.webContents.id, actorEmail: emailOf(access.actor), targetEmail: normalized,
      access: {...access, target}, checkedAt: Date.now(), checking: null, timer: null, ending: false,
      contextReady: null
    };
    const ready = new Promise(resolve => {record.contextReady = resolve;});
    previews.set(record.id, record);
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.on("closed", () => {clearInterval(record.timer); previews.delete(record.id);});
    record.timer = setInterval(() => { void authorize(record, true).catch(error => logger.warn("[viewing-mode] Closed:", error.message)); }, recheckMs);
    record.timer.unref?.();
    let readyTimer;
    try {
      await window.loadURL(devUrl || "enquote-preview://app/index.html");
      await Promise.race([ready, new Promise((_resolve, reject) => {
        readyTimer = setTimeout(() => reject(new Error("This renderer does not support normal-page viewing mode. Install the new desktop release with its matching UI.")), readyTimeoutMs);
      })]);
    } catch (error) {
      close(record);
      throw error;
    } finally {
      clearTimeout(readyTimer);
    }
    return {ok: true};
  }

  ipcMain.handle("viewing:start", (event, targetEmail) => start(event.sender, targetEmail));
  async function viewingContext(event, force = false) {
    const record = previews.get(event.sender.id);
    if (!record) fail("This is not a viewing window.");
    const access = await authorize(record, force);
    record.contextReady();
    const deniedByActor = allPages.filter(page => !canAccessPage(access.actor, page, {rolePages: access.rolePages}));
    return {
      ok: true, actor: access.actor, serviceUser: access.target, rolePages: access.rolePages,
      user: {...access.target, deny_pages: [...new Set([...(access.target.deny_pages || []), ...deniedByActor, ...PRIVATE_PAGES])]},
      users: access.users.map(user => ({email: user.email, name: user.display_name || user.full_name || user.email}))
    };
  }
  ipcMain.handle("viewing:context", event => viewingContext(event));
  ipcMain.handle("viewing:recheck", event => viewingContext(event, true));
  ipcMain.handle("viewing:select-user", async (event, email) => {
    const record = previews.get(event.sender.id);
    if (!record) fail("This is not a viewing window.");
    const access = await authorize(record, true);
    const normalized = String(email || "").trim().toLowerCase();
    if (!access.users.some(user => emailOf(user) === normalized)) fail("Select a current service account.");
    record.targetEmail = normalized;
    record.checkedAt = 0;
    await record.window.webContents.session.clearStorageData();
    record.window.reload();
    return {ok: true};
  });
  ipcMain.handle("viewing:exit", event => {
    const record = previews.get(event.sender.id);
    if (!record) fail("This is not a viewing window.");
    close(record);
    return {ok: true};
  });
  return {
    isPreview: id => previews.has(id), read,
    closeAll: () => [...previews.values()].forEach(close),
    revalidateAll: () => Promise.all([...previews.values()].map(record =>
      authorize(record, true).catch(error => logger.warn("[viewing-mode] Closed:", error.message))))
  };
}

module.exports = {createReadonlyPreview, installPreviewIpcGuard, previewRequestAllowed, publicUser};
