const test = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {createRefundFormWindow, validateFormUrl} = require("../../electron/refundFormWindow.cjs");
const BOUNDS = {x: 40, y: 170, width: 1000, height: 600};

function fixture() {
  const windows = [], views = [], partitions = [], states = [], requests = [];
  let email = "first@example.com";
  class Contents extends EventEmitter {
    setWindowOpenHandler(handler) {this.popup = handler;}
    getZoomFactor() {return 1.5;}
    isDestroyed() {return Boolean(this.destroyed);}
    close() {this.destroyed = true;}
    getURL() {return this.url || "";}
    async loadURL(url) {this.url = url;}
  }
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new Contents();
      this.children = new Set();
      this.contentView = {
        addChildView: (view) => this.children.add(view),
        removeChildView: (view) => this.children.delete(view)
      };
      windows.push(this);
    }
    isDestroyed() {return Boolean(this.destroyed);}
    close() {this.emit("close"); this.destroyed = true; this.emit("closed");}
    focus() {this.focused = true;}
    getContentSize() {return [1000, 850];}
  }
  class FakeView {
    constructor(options) {this.options = options; this.webContents = new Contents(); views.push(this);}
    setBounds(bounds) {this.bounds = bounds;}
  }
  const main = new FakeWindow({});
  const service = createRefundFormWindow({
    BrowserWindow: FakeWindow, WebContentsView: FakeView,
    session: {fromPartition: (partition) => {
      partitions.push(partition);
      return {partition, webRequest: {onBeforeRequest: (filter, handler) => requests.push({filter, handler})}};
    }},
    getMainWindow: () => main, getEmail: () => email, onStatus: (state) => states.push(state)
  });
  return {service, main, windows, views, partitions, states, requests, FakeWindow, setEmail: (value) => {email = value;}};
}

test("embedded contents move into sign-in and return without recreating the Microsoft session", async () => {
  const {service, main, windows, views, partitions, states} = fixture();
  await service.show("https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test&embed=true", BOUNDS);
  const view = views[0], contents = view.webContents;
  assert.equal(contents.getURL(), "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test");
  assert.ok(main.children.has(view));
  assert.deepEqual(view.bounds, {x: 60, y: 255, width: 1500, height: 900});
  assert.equal(view.options.webPreferences.session.partition, partitions[0]);
  assert.equal(view.options.webPreferences.contextIsolation, true);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.ok(!partitions[0].startsWith("persist:"));
  contents.emit("will-redirect", {}, "https://login.microsoftonline.com/authorize", false, true);
  assert.equal(windows.length, 2);
  const auth = windows[1];
  assert.ok(auth.children.has(view));
  assert.equal(main.children.has(view), false);
  assert.equal(auth.focused, true);
  assert.deepEqual(view.bounds, {x: 0, y: 0, width: 1000, height: 850});
  assert.equal(auth.options.webPreferences.session, view.options.webPreferences.session);
  contents.url = "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test";
  contents.emit("did-finish-load");
  assert.equal(auth.destroyed, true);
  assert.ok(main.children.has(view));
  assert.equal(views.length, 1);
  assert.equal(states.at(-1).state, "ready");
  service.hide();
  assert.equal(main.children.has(view), false);
  await service.show("https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=test", BOUNDS);
  assert.equal(views.length, 1);
  assert.ok(main.children.has(view));
  service.close();
  assert.equal(contents.destroyed, true);
});

test("hidden tab does not reattach after 2FA; sign-in cancellation can be retried", async () => {
  const {service, main, views, windows, states} = fixture();
  await service.show("https://forms.office.com/test", BOUNDS);
  await service.open("https://forms.office.com/test");
  windows[1].close();
  assert.equal(states.at(-1).state, "sign-in-required");
  assert.ok(main.children.has(views[0]));
  await service.open("https://forms.office.com/test");
  service.hide();
  views[0].webContents.emit("did-finish-load");
  assert.equal(main.children.has(views[0]), false);
  assert.equal(windows[2].destroyed, true);
  service.close();
});

test("main renderer reload destroys native contents rather than leaving an overlay on the new page", async () => {
  const {service, main, views} = fixture();
  await service.show("https://forms.office.com/test", BOUNDS);
  main.webContents.emit("did-start-navigation", {}, "http://localhost:5173/", false, true);
  assert.equal(views[0].webContents.destroyed, true);
  assert.equal(main.children.size, 0);
  service.close();
});

test("embedded view validates bounds and resets isolated contents on account change", async () => {
  const {service, views, partitions, setEmail} = fixture();
  await assert.rejects(service.show("https://forms.office.com/test", {...BOUNDS, width: NaN}), /bounds/);
  await service.show("https://forms.office.com/test", BOUNDS);
  await service.show("https://forms.office.com/test", {...BOUNDS, height: 500});
  assert.equal(views.length, 1);
  setEmail("second@example.com");
  await service.show("https://forms.office.com/test", BOUNDS);
  assert.equal(views[0].webContents.destroyed, true);
  assert.notEqual(partitions[0], partitions[1]);
  service.close();
  setEmail("");
  await assert.rejects(service.show("https://forms.office.com/test", BOUNDS), /Sign in to EnQuote/);
});

test("embedded contents and login popups have no EnQuote bridge and reject non-HTTPS navigation", async () => {
  const {service, views, FakeWindow} = fixture();
  for (const url of ["https://example.com/", "https://forms.office.com.example.com/", "https://user@forms.office.com/"]) {
    assert.throws(() => validateFormUrl(url), /Microsoft Forms/);
  }
  await service.show("https://forms.office.com/test", BOUNDS);
  const contents = views[0].webContents;
  assert.equal(views[0].options.webPreferences.preload, undefined);
  assert.equal(contents.popup({url: "https://login.microsoftonline.com/authorize"}).action, "allow");
  for (const url of ["file:///C:/private", "javascript:alert(1)", "http://example.com/"]) {
    assert.equal(contents.popup({url}).action, "deny");
    let blocked = false;
    contents.emit("will-navigate", {preventDefault() {blocked = true;}}, url);
    assert.equal(blocked, true);
  }
  const child = new FakeWindow(contents.popup({url: "https://login.microsoftonline.com/"}).overrideBrowserWindowOptions);
  contents.emit("did-create-window", child);
  assert.equal(child.webContents.popup({url: "file:///C:/private"}).action, "deny");
  service.close();
  assert.equal(child.destroyed, true);
});

test("load failures are surfaced and retry uses the same embedded session", async () => {
  const {service, views, states} = fixture();
  await service.show("https://forms.office.com/test", BOUNDS);
  views[0].webContents.loadURL = async () => {throw Object.assign(new Error("blocked"), {code: "ERR_BLOCKED_BY_RESPONSE"});};
  await assert.rejects(service.show("https://forms.office.com/another", BOUNDS), /Open form in browser/);
  views[0].webContents.emit("did-fail-load", {}, -105, "NAME_NOT_RESOLVED", "", true);
  assert.equal(states.at(-1).state, "error");
  service.close();
});

test("Microsoft authorization defaults to the verified EnQuote email without replacing an existing hint", async () => {
  const {service, requests, setEmail} = fixture();
  await service.show("https://forms.office.com/test", BOUNDS);
  assert.deepEqual(requests[0].filter.urls, [
    "https://login.microsoftonline.com/*/oauth2/v2.0/authorize*",
    "https://login.microsoftonline.com/*/oauth2/authorize*"
  ]);
  const input = "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?state=preserve&client_id=test";
  let result;
  requests[0].handler({url: input}, (value) => {result = value;});
  const hinted = new URL(result.redirectURL);
  assert.equal(hinted.searchParams.get("login_hint"), "first@example.com");
  assert.equal(hinted.searchParams.get("state"), "preserve");
  requests[0].handler({url: hinted.href}, (value) => {result = value;});
  assert.deepEqual(result, {});
  setEmail("second@example.com");
  await service.show("https://forms.office.com/test", BOUNDS);
  requests[1].handler({url: input}, (value) => {result = value;});
  assert.equal(new URL(result.redirectURL).searchParams.get("login_hint"), "second@example.com");
  service.close();
});
