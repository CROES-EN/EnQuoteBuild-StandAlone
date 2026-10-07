const assert = require("node:assert/strict");
const {app, BrowserWindow, ipcMain, session, protocol, net} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const {createReadonlyPreview, installPreviewIpcGuard} = require("../../electron/readonlyPreview.cjs");
protocol.registerSchemesAsPrivileged([{scheme: "enquote-preview", privileges: {standard: true, secure: true, supportFetchAPI: true}}]);
let controller;
installPreviewIpcGuard(ipcMain, () => controller);
app.setPath("userData", process.env.ENQUOTE_PREVIEW_TEST_DIR);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(window, code) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await window.webContents.executeJavaScript(code)) return;
    await sleep(100);
  }
  throw new Error(`Viewing window did not reach expected state: ${code}`);
}

app.whenReady().then(async () => {
  const access = await import("../../electron/pageAccess.mjs");
  const actor = {email: "operator@example.com", app_role: "super_admin"};
  let target = {id: "heather", email: "heather@example.com", full_name: "Heather", app_role: "admin", deny_pages: ["SupervisorDashboard"], password_hash: "private"};
  const main = new BrowserWindow({show: false, webPreferences: {preload: path.join(__dirname, "../../electron/preload.cjs"), contextIsolation: true, sandbox: true}});
  const mainHtml = path.join(process.env.ENQUOTE_PREVIEW_TEST_DIR, "main.html");
  fs.writeFileSync(mainHtml, "<html><body>Main account unchanged</body></html>");
  await main.loadFile(mainHtml);
  await main.webContents.executeJavaScript('localStorage.setItem("privateMainSession", "DO_NOT_COPY"); true');
  const calls = [];
  const quotes = [{
    id: "view-quote", quote_number: "Q-VIEW-001", status: "draft_without_internal",
    created_by: target.email, owner_email: target.email, is_current_version: true,
    created_date: new Date().toISOString(), updated_date: new Date().toISOString(), total: 125,
    items: [], site_id: "VIEW-SITE"
  }];
  const products = [{
    id: "view-product", name: "Preview Repair Service", sku: "VIEW-001", type: "service",
    unit_price: 125, unit: "each", is_active: true
  }];
  for (const channel of ["quotes:list", "products:list", "collections:list"]) {
    ipcMain.handle(channel, (_event, ...args) => {
      calls.push({channel, args});
      return channel === "quotes:list" ? quotes : channel === "products:list" ? products : [];
    });
  }
  ipcMain.handle("profiles:list", () => ({ok: true, profiles: []}));
  ipcMain.handle("ui:get-info", () => ({appVersion: "1.3.0"}));
  ipcMain.handle("zoom:get", () => ({ok: true, zoomFactor: 1}));
  ipcMain.handle("admin:policy", () => ({ok: true, me: actor}));
  ipcMain.handle("auth:getVerifiedIdentity", () => actor);
  ipcMain.handle("largeTables:get", () => null);
  for (const channel of ["chat:messages", "chat:me", "tasks:list", "quotes:update", "quotes:export", "collections:create", "auth:login"]) {
    ipcMain.handle(channel, () => assert.fail(`Blocked handler executed: ${channel}`));
  }
  controller = createReadonlyPreview({
    BrowserWindow, ipcMain, session, net, getMainWindow: () => main,
    getIdentity: () => actor, getPolicy: async () => ({ok: true, me: actor}),
    getOverview: async () => ({ok: true, users: [target, actor]}),
    getRepository: () => ({listCollection: async () => []}), getUserDataPath: () => process.env.ENQUOTE_PREVIEW_TEST_DIR,
    getEntry: () => path.resolve(__dirname, "../../dist/index.html"),
    canAccessPage: access.canAccessPage, rolesForUser: access.rolesForUser, allPages: access.ALL_PAGES,
    recheckMs: 3600000, show: false
  });
  await main.webContents.executeJavaScript('window.enquoteLocal.viewing.start("heather@example.com")');
  const preview = BrowserWindow.getAllWindows().find(window => controller.isPreview(window.webContents.id));
  assert.ok(preview);
  const errors = [];
  preview.webContents.on("console-message", event => {
    if (event.level === "error" && !/net::ERR|Error invoking remote method|Read-only viewing mode/.test(event.message)) errors.push(event.message);
  });
  await waitFor(preview, 'document.body.innerText.includes("Viewing as Heather")');
  assert.equal(await preview.webContents.executeJavaScript('localStorage.getItem("privateMainSession")'), null);
  assert.equal(await preview.webContents.executeJavaScript('document.querySelectorAll(\'a[href="#/Messages"],a[href="#/Tasks"]\').length'), 0);
  assert.equal(await preview.webContents.executeJavaScript('document.querySelectorAll(\'[aria-label="Read-only viewing mode"]\').length'), 1);
  await preview.webContents.executeJavaScript(`window.dispatchEvent(new ErrorEvent("error", {message: "Viewing-only regression error"}));
    [...document.querySelectorAll("button")].find(button => button.textContent === "Debugging Console").click(); true`);
  await waitFor(preview, 'document.body.innerText.includes("Viewing-session diagnostics")');
  await preview.webContents.executeJavaScript('document.querySelector(\'[role="dialog"] button[title="Installed version and bridge capabilities; extra native details when available."]\').click(); true');
  await waitFor(preview, 'document.body.innerText.includes("operator\\\'s computer")');
  await preview.webContents.executeJavaScript(`[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "errors").click(); true`);
  await waitFor(preview, 'document.body.innerText.includes("Viewing-only regression error")');
  assert.equal(await preview.webContents.executeJavaScript(`document.body.innerText.includes("Actions available on this build: refresh-view, recheck-permissions")`), true);
  for (const command of ["refresh-view", "recheck-permissions", "check-ui"]) {
    await preview.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[aria-label="Diagnostic command"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(command)});
      input.dispatchEvent(new Event("input", {bubbles: true}));
      return true;
    })()`);
    await sleep(100);
    await preview.webContents.executeJavaScript('document.querySelector(\'[role="dialog"] form\').requestSubmit(); true');
    await waitFor(preview, `document.body.innerText.includes('"command": "${command}"')`);
  }
  assert.equal(await preview.webContents.executeJavaScript('document.body.innerText.includes("Blocked in viewing mode")'), true);
  assert.equal(await preview.webContents.executeJavaScript('document.body.innerText.includes("Live authorization was rechecked")'), true);
  await preview.webContents.executeJavaScript('document.querySelector(\'[role="dialog"] button .sr-only\').parentElement.click(); true');
  await preview.webContents.executeJavaScript('window.dispatchEvent(new KeyboardEvent("keydown", {code: "Backquote", shiftKey: true})); true');
  await waitFor(preview, 'document.body.innerText.includes("Viewing-session diagnostics")');
  await preview.webContents.executeJavaScript('window.dispatchEvent(new KeyboardEvent("keydown", {code: "Backquote", shiftKey: true})); true');
  for (const page of ["Quotes", "Products", "Workload"]) {
    await preview.webContents.executeJavaScript(`location.hash = "#/${page}"; true`);
    await sleep(1500);
    const text = await preview.webContents.executeJavaScript("document.body.innerText");
    assert.ok(!/Something went wrong|page not found|Sign in to EnQuote/.test(text), text.slice(0, 500));
    assert.ok(text.includes("Viewing as Heather"));
    if (page === "Quotes") assert.ok(text.includes("Q-VIEW-001"), "the real quote card renders shared data");
    if (page === "Products") assert.ok(text.includes("Preview Repair Service"), "the real product catalog renders shared data");
  }
  await preview.webContents.executeJavaScript('location.hash = "#/SupervisorDashboard"; true');
  await waitFor(preview, 'document.body.innerText.includes("Access Not Granted")');
  for (const page of ["Messages", "Tasks", "Base44_DTO"]) {
    await preview.webContents.executeJavaScript(`location.hash = "#/${page}"; true`);
    await sleep(500);
    assert.ok(await preview.webContents.executeJavaScript('document.body.innerText.includes("Access Not Granted")'));
  }
  const blocked = await preview.webContents.executeJavaScript(`(async () => {
    const actions = [
      () => window.enquoteLocal.chat.messages({conversationId: "private"}),
      () => window.enquoteLocal.tasks.list(),
      () => window.enquoteLocal.quotes.update("id", {}),
      () => window.enquoteLocal.quotes.exportData(),
      () => window.enquoteLocal.collections.list("appNotifications"),
      () => window.enquoteLocal.auth.login("heather@example.com", "anything")
    ];
    return Promise.all(actions.map(async action => {
      try {await action(); return false;} catch (error) {return error.message.includes("blocked");}
    }));
  })()`);
  assert.ok(blocked.every(Boolean), JSON.stringify(blocked));
  assert.equal(await main.webContents.executeJavaScript('localStorage.getItem("privateMainSession")'), "DO_NOT_COPY");
  assert.ok(calls.some(call => call.channel === "quotes:list"));
  assert.ok(calls.some(call => call.channel === "products:list"));
  target = {...target, deny_pages: [], app_role: "admin"};
  await controller.revalidateAll();
  await waitFor(preview, 'document.body.innerText.includes("Viewing as Heather") && !document.body.innerText.includes("Verifying read-only")');
  await preview.webContents.executeJavaScript('location.hash = "#/SupervisorDashboard"; true');
  await sleep(2000);
  assert.equal(await preview.webContents.executeJavaScript('document.body.innerText.includes("Access Not Granted")'), false);
  assert.deepEqual(errors, [], "normal viewing pages have no unexpected renderer errors");
  const networkBlocked = await preview.webContents.executeJavaScript('fetch("https://127.0.0.1:1/api/chat").then(() => false, () => true)');
  assert.equal(networkBlocked, true);
  await preview.webContents.executeJavaScript('window.enquotePreview.selectUser("operator@example.com")');
  await waitFor(preview, 'document.body.innerText.includes("Viewing as operator@example.com")');
  const closed = new Promise(resolve => preview.once("closed", resolve));
  await preview.webContents.executeJavaScript('window.enquotePreview.exit()').catch(error => {
    if (!/destroyed|disposed|closed|frame/.test(error.message)) throw error;
  });
  await closed;
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  console.log("PASS: actual normal pages, private direct routes, native bypass attempts, isolated storage, permission refresh, user selection and Exit");
  app.exit(0);
}).catch(error => {console.error(error); controller?.closeAll(); app.exit(1);});
