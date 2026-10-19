const test = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {createSalesforceWorkspace, validateWorkspaceUrl, SALESFORCE_HOME} = require("../electron/salesforceWorkspace.cjs");

function fixture() {
  const views = [], errors = [], notifications = [];
  class WebContentsView {
    constructor(options) {
      this.options = options;
      this.urls = [];
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        userAgent: "Chrome/123 Electron/44 enquote/1.4",
        setUserAgent: value => { this.userAgent = value; },
        setWindowOpenHandler: callback => { this.popup = callback; },
        getURL: () => this.urls.at(-1) || "",
        isDestroyed: () => Boolean(this.destroyed),
        isLoadingMainFrame: () => false,
        executeJavaScript: async () => ({ok: true, context: {caseNumber: "456", siteId: "123", contactName: "Jane Doe"}}),
        close: () => { this.destroyed = true; },
        loadURL: async url => {
          this.urls.push(url);
          if (this.failLoad) throw new Error("Salesforce unavailable");
        }
      });
      views.push(this);
    }
    setVisible(value) { this.visible = value; }
    getBounds() { return this.bounds || {x: 0, y: 0, width: 0, height: 0}; }
    setBounds(value) { this.bounds = value; this.boundsUpdates = (this.boundsUpdates || 0) + 1; }
  }
  function owner() {
    const window = new EventEmitter();
    window.views = new Set();
    window.webContents = new EventEmitter();
    window.webContents.getZoomFactor = () => window.zoom || 1;
    window.isDestroyed = () => false;
    window.getContentSize = () => [1400, 900];
    window.contentView = {
      addChildView: view => window.views.add(view),
      removeChildView: view => window.views.delete(view)
    };
    return window;
  }
  const partition = {};
  const session = {fromPartition(name) {
    assert.equal(name, "persist:enquote-salesforce");
    return partition;
  }};
  const first = owner(), second = owner();
  const workspace = createSalesforceWorkspace({
    WebContentsView, session, logger: {error: (...args) => errors.push(args)},
    onStateChanged: state => notifications.push([state(first), state(second)])
  });
  return {workspace, views, partition, first, second, errors, notifications};
}

test("cloud toggles a single isolated Salesforce view without reloading its page", () => {
  const {workspace, views, partition, first} = fixture();
  const caseUrl = "https://enphase.lightning.force.com/lightning/r/Case/500Ps00001k7UchIAE/view";
  try {
    workspace.open(caseUrl, first);
    const view = views[0];
    assert.equal(workspace.state(first).visible, true);
    assert.deepEqual(view.urls, [caseUrl]);
    assert.equal(view.options.webPreferences.session, partition);
    assert.equal(view.options.webPreferences.nodeIntegration, false);
    assert.equal(view.options.webPreferences.contextIsolation, true);
    assert.equal(view.options.webPreferences.sandbox, true);
    assert.equal(view.options.webPreferences.preload, undefined);
    assert.doesNotMatch(view.userAgent, /Electron|enquote/);
    assert.equal(view.popup().overrideBrowserWindowOptions.webPreferences.session, partition);
    workspace.toggle(first);
    assert.equal(workspace.state(first).visible, false);
    workspace.toggle(first);
    assert.equal(workspace.state(first).visible, true);
    assert.equal(views.length, 1);
    assert.deepEqual(view.urls, [caseUrl]);
    workspace.open(`${caseUrl}?next`, first);
    assert.equal(view.urls.length, 2);
  } finally {
    workspace.close();
  }
  assert.equal(views[0].destroyed, true);
});

test("opening the cloud in another EnQuote window moves the existing page there", () => {
  const {workspace, views, first, second} = fixture();
  try {
    workspace.open(undefined, first);
    const view = views[0];
    workspace.toggle(second);
    assert.equal(views.length, 1);
    assert.deepEqual(view.urls, [SALESFORCE_HOME]);
    assert.equal(first.views.has(view), false);
    assert.equal(second.views.has(view), true);
    assert.equal(workspace.state(first).visible, false);
    assert.equal(workspace.state(second).visible, true);
    workspace.hide(first);
    assert.equal(workspace.state(second).visible, true, "stale owner cannot hide the new owner's panel");
    assert.equal(first.listenerCount("close"), 0);
    assert.equal(second.listenerCount("close"), 1);
    second.emit("close");
    assert.equal(second.views.size, 0);
    assert.equal(workspace.state(second).visible, false);
    workspace.toggle(first);
    assert.equal(views.length, 1, "closing an owner preserves the reusable Salesforce view");
  } finally {
    workspace.close();
  }
});

test("panel bounds follow resize and zoom while reserving the cloud's right-side strip", () => {
  const {workspace, views, first, second} = fixture();
  try {
    workspace.open(undefined, first);
    workspace.setBounds({x: 400, y: 48, width: 1000, height: 1000}, first);
    assert.deepEqual(views[0].bounds, {x: 400, y: 48, width: 936, height: 852});
    first.zoom = 1.25;
    workspace.setBounds({x: 400, y: 48, width: 500, height: 600}, first);
    assert.deepEqual(views[0].bounds, {x: 500, y: 60, width: 625, height: 750});
    workspace.setBounds({x: 1400, y: 48, width: 500, height: 600}, first);
    assert.equal(views[0].visible, false, "sliding outside the owner clips the native content");
    assert.throws(() => workspace.setBounds({x: NaN, y: 0, width: 500, height: 600}, first), /Invalid/);
    const before = views[0].bounds;
    workspace.setBounds({x: 0, y: 0, width: 500, height: 600}, second);
    assert.deepEqual(views[0].bounds, before, "another window cannot resize the owner's view");
  } finally {
    workspace.close();
  }
});

test("hide detaches the native view after the slide animation and show preserves it", async () => {
  const {workspace, views, first} = fixture();
  try {
    workspace.toggle(first);
    workspace.setBounds({x: 400, y: 48, width: 500, height: 600}, first);
    workspace.toggle(first);
    assert.equal(workspace.state(first).visible, false);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(first.views.size, 0);
    assert.equal(views[0].visible, false);
    workspace.toggle(first);
    assert.equal(views.length, 1);
    assert.equal(first.views.size, 1);
  } finally {
    workspace.close();
  }
});

test("unchanged layout checks do not resize the native Salesforce view", () => {
  const {workspace, views, first} = fixture();
  try {
    workspace.open(undefined, first);
    const rectangle = {x: 400, y: 48, width: 500, height: 600};
    workspace.setBounds(rectangle, first);
    const view = views[0];
    const boundsUpdates = view.boundsUpdates;
    for (let check = 0; check < 10; check++) workspace.setBounds(rectangle, first);
    assert.equal(view.boundsUpdates, boundsUpdates);
    first.zoom = 1.25;
    workspace.setBounds(rectangle, first);
    assert.equal(view.boundsUpdates, boundsUpdates + 1, "zoom changes still update native bounds");
    workspace.setBounds({x: 0, y: 0, width: 0, height: 0}, first);
    assert.equal(view.visible, false);
    workspace.setBounds(rectangle, first);
    assert.equal(view.visible, true, "restoring bounds shows the view again");
  } finally {
    workspace.close();
  }
});

test("Escape inside the native Salesforce page tucks the panel away without destroying it", () => {
  const {workspace, views, first} = fixture();
  try {
    workspace.open(undefined, first);
    let prevented = false;
    views[0].webContents.emit("before-input-event", {preventDefault: () => { prevented = true; }},
      {type: "keyDown", key: "Escape"});
    assert.equal(prevented, true);
    assert.equal(workspace.state(first).visible, false);
    workspace.toggle(first);
    assert.equal(workspace.state(first).visible, true);
    assert.equal(views.length, 1);
    assert.deepEqual(views[0].urls, [SALESFORCE_HOME]);
  } finally {
    workspace.close();
  }
});
test("workspace rejects non-Enphase URLs and requires a live EnQuote owner", () => {
  const {workspace, views, first} = fixture();
  try {
    for (const url of ["javascript:alert(1)", "https://example.com", "https://enphase.lightning.force.com.evil.test",
      "https://user:password@enphase.lightning.force.com", "http://enphase.lightning.force.com", ""]) {
      assert.throws(() => validateWorkspaceUrl(url));
      assert.throws(() => workspace.open(url, first));
    }
    assert.equal(views.length, 0);
    assert.throws(() => workspace.open(), /unavailable/);
    workspace.open(undefined, first);
    assert.throws(() => workspace.open("https://example.com", first));
    assert.deepEqual(views[0].urls, [SALESFORCE_HOME]);
  } finally {
    workspace.close();
  }
});

test("navigation failures are reported to the panel and reload retries the current page", async () => {
  const {workspace, views, first, errors} = fixture();
  try {
    workspace.open(undefined, first);
    await new Promise(resolve => setImmediate(resolve));
    views[0].failLoad = true;
    workspace.open(SALESFORCE_HOME, first);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(workspace.state(first).error, /Could not load/);
    assert.equal(errors.length, 1);
    views[0].failLoad = false;
    workspace.reload(first);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(workspace.state(first).error, null);
    assert.equal(workspace.state(first).loading, false);
  } finally {
    workspace.close();
  }
});

test("inspection is restricted to the visible owner's Salesforce page and rejects page changes", async () => {
  const {workspace, views, first, second} = fixture();
  try {
    await assert.rejects(workspace.inspect(first), /Open the Salesforce panel/);
    workspace.open(undefined, first);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await workspace.inspect(first)).caseNumber, "456");
    await assert.rejects(workspace.inspect(second), /Open the Salesforce panel/);
    views[0].webContents.executeJavaScript = async () => {
      views[0].urls.push("https://enphase.lightning.force.com/changed-case");
      return {ok: true, context: {caseNumber: "456", siteId: "123", contactName: "Jane Doe"}};
    };
    await assert.rejects(workspace.inspect(first), /page changed/);
    views[0].urls.push("https://login.example.com");
    await assert.rejects(workspace.inspect(first), /Only Enphase/);
  } finally {
    workspace.close();
  }
});

test("Salesforce navigation and reload completion publish fresh lookup revisions", async () => {
  const {workspace, views, first} = fixture();
  try {
    workspace.open(undefined, first);
    await new Promise(resolve => setImmediate(resolve));
    const contents = views[0].webContents;
    const initial = workspace.state(first).pageRevision;
    contents.emit("did-navigate-in-page", {}, "https://enphase.lightning.force.com/new-case", false);
    assert.equal(workspace.state(first).pageRevision, initial, "iframe navigation must not reset quote selection");
    contents.emit("did-navigate-in-page", {}, "https://enphase.lightning.force.com/new-case", true);
    assert.equal(workspace.state(first).pageRevision, initial + 1);
    contents.emit("did-start-navigation", {}, contents.getURL(), false, false);
    contents.emit("did-stop-loading");
    assert.equal(workspace.state(first).pageRevision, initial + 1, "iframe loading must not reset quote selection");
    contents.emit("did-start-navigation", {}, contents.getURL(), false, true);
    assert.equal(workspace.state(first).loading, true);
    await assert.rejects(workspace.inspect(first), /still loading/);
    contents.emit("did-stop-loading");
    assert.equal(workspace.state(first).loading, false);
    assert.equal(workspace.state(first).pageRevision, initial + 2);
    contents.executeJavaScript = async () => {
      contents.emit("did-navigate-in-page", {}, contents.getURL(), true);
      return {ok: true, context: {caseNumber: "456", siteId: "123", contactName: "Jane Doe"}};
    };
    await assert.rejects(workspace.inspect(first), /page changed/, "same-URL console changes invalidate in-flight reads");
  } finally {
    workspace.close();
  }
});
