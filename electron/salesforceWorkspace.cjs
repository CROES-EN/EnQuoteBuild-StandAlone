const SALESFORCE_ORIGIN = "https://enphase.lightning.force.com";
const SALESFORCE_HOME = `${SALESFORCE_ORIGIN}/lightning/page/home`;
const {inspectSalesforceCase} = require("./salesforceCaseInspector.cjs");

function validateWorkspaceUrl(value) {
  const url = new URL(value);
  if (url.origin !== SALESFORCE_ORIGIN || url.username || url.password) {
    throw new Error("Only Enphase Salesforce links can open in the Salesforce workspace.");
  }
  return url.href;
}

function createSalesforceWorkspace({WebContentsView, session, onStateChanged = () => {}, logger = console}) {
  let view = null, parent = null, visible = false, loading = false, error = null;
  let removeParentListeners = null, hideTimer = null, navigation = 0, pageRevision = 0;

  function state(window) {
    return {visible: visible && parent === window, loading, error, pageRevision};
  }

  function notify() {
    onStateChanged(state);
  }

  function detach() {
    removeParentListeners?.();
    removeParentListeners = null;
    if (parent && !parent.isDestroyed() && view) parent.contentView.removeChildView(view);
    parent = null;
  }

  function cancelHide() {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  function hide(window) {
    if (parent !== window) return;
    visible = false;
    cancelHide();
    notify();
    // Keep the native page attached while the renderer slides its bounds out of view.
    hideTimer = setTimeout(() => {
      hideTimer = null;
      view?.setVisible(false);
      detach();
    }, 220);
  }

  function attach(window) {
    if (!window || window.isDestroyed()) throw new Error("EnQuote window is unavailable.");
    cancelHide();
    if (parent !== window) {
      view.setVisible(false);
      detach();
      window.contentView.addChildView(view);
      parent = window;
      const release = () => {
        cancelHide();
        visible = false;
        view?.setVisible(false);
        detach();
        notify();
      };
      const ownerContents = window.webContents;
      window.on("close", release);
      window.on("closed", release);
      ownerContents.on("did-start-navigation", onNavigation);
      function onNavigation(_event, _url, _inPlace, mainFrame) {
        if (mainFrame && !_inPlace) release();
      }
      removeParentListeners = () => {
        window.removeListener("close", release);
        window.removeListener("closed", release);
        ownerContents.removeListener("did-start-navigation", onNavigation);
      };
    }
    visible = true;
    notify();
  }

  function load(url) {
    const request = ++navigation;
    loading = true;
    error = null;
    notify();
    view.webContents.loadURL(url).then(() => {
      if (request !== navigation) return;
      loading = false;
      notify();
    }).catch(failure => {
      if (request !== navigation) return;
      loading = false;
      error = "Could not load Salesforce. Check your connection and use Reload to retry.";
      logger.error("[salesforce-workspace] Navigation failed:", failure.message);
      notify();
    });
  }

  function open(url, window) {
    const destination = url === undefined ? null : validateWorkspaceUrl(url);
    if (!window || window.isDestroyed()) throw new Error("EnQuote window is unavailable.");
    let created = false;
    if (!view || view.webContents.isDestroyed()) {
      detach();
      const partitionSession = session.fromPartition("persist:enquote-salesforce");
      view = new WebContentsView({
        webPreferences: {
          session: partitionSession, contextIsolation: true, nodeIntegration: false, sandbox: true
        }
      });
      created = true;
      view.setVisible(false);
      const contents = view.webContents;
      contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
        if (!isMainFrame || inPlace) return;
        loading = true;
        notify();
      });
      contents.on("did-stop-loading", () => {
        if (!loading) return;
        loading = false;
        pageRevision++;
        notify();
      });
      contents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
        if (!isMainFrame) return;
        pageRevision++;
        notify();
      });
      contents.setUserAgent(contents.userAgent
        .replace(/\s*Electron\/\S+/i, "").replace(/\s*enquote\S*\/\S+/i, ""));
      contents.setWindowOpenHandler(() => ({
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: parent || undefined, width: 640, height: 760, autoHideMenuBar: true,
          webPreferences: {
            session: partitionSession, contextIsolation: true, nodeIntegration: false, sandbox: true
          }
        }
      }));
      contents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "Escape" && visible) {
          event.preventDefault();
          hide(parent);
        }
      });
      contents.on("render-process-gone", (_event, details) => {
        loading = false;
        error = `Salesforce stopped (${details.reason}). Use Reload to reconnect.`;
        logger.error("[salesforce-workspace]", error);
        notify();
      });
    }
    attach(window);
    if (created || destination) load(destination || SALESFORCE_HOME);
    return state(window);
  }

  function toggle(window) {
    if (visible && parent === window) hide(window);
    else open(undefined, window);
    return state(window);
  }

  function setBounds(rectangle, window) {
    if (!view || !window || parent !== window || window.isDestroyed()) return;
    if (!rectangle || !["x", "y", "width", "height"].every(key => Number.isFinite(rectangle[key])) ||
        rectangle.width < 0 || rectangle.height < 0) throw new Error("Invalid Salesforce panel bounds.");
    const zoom = window.webContents.getZoomFactor();
    const [contentWidth, contentHeight] = window.getContentSize();
    const right = Math.max(0, contentWidth - Math.round(64 * zoom));
    const x = Math.max(0, Math.min(right, Math.round(rectangle.x * zoom)));
    const y = Math.max(0, Math.min(contentHeight, Math.round(rectangle.y * zoom)));
    const width = Math.min(Math.round(rectangle.width * zoom), right - x);
    const height = Math.min(Math.round(rectangle.height * zoom), contentHeight - y);
    const bounds = {x, y, width, height};
    const current = view.getBounds();
    if (Object.keys(bounds).some(key => bounds[key] !== current[key])) view.setBounds(bounds);
    view.setVisible(width > 0 && height > 0);
  }

  function reload(window) {
    if (parent !== window || !view) throw new Error("Open the Salesforce panel before reloading.");
    // Retry the current page, including an SSO redirect; do not reset the console to Home.
    load(view.webContents.getURL() || SALESFORCE_HOME);
  }

  async function inspect(window, {retry = true} = {}) {
    if (!view || !visible || parent !== window || view.webContents.isDestroyed()) {
      throw new Error("Open the Salesforce panel in this EnQuote window before reading case details.");
    }
    const contents = view.webContents;
    if (loading || contents.isLoadingMainFrame()) throw new Error("Salesforce is still loading. Wait for the case Details tab and retry.");
    const url = validateWorkspaceUrl(contents.getURL());
    const revision = pageRevision;
    const result = await contents.executeJavaScript(`(async () => {
      let failure;
      for (let attempt = 0; attempt < ${retry ? 12 : 1}; attempt++) {
        ${retry ? "await new Promise(resolve => setTimeout(resolve, 250));" : ""}
        try { return {ok: true, context: (${inspectSalesforceCase.toString()})()}; }
        catch (error) { failure = error.message || "Could not inspect Salesforce case details."; }
      }
      return {ok: false, error: failure};
    })()`);
    if (!view || view.webContents !== contents || !visible || parent !== window ||
        contents.isDestroyed() || contents.getURL() !== url || pageRevision !== revision || loading) {
      throw new Error("The Salesforce page changed during lookup. Retry on the intended case.");
    }
    if (!result?.ok) throw new Error(result?.error || "Could not inspect Salesforce case details.");
    return result.context;
  }

  function close() {
    cancelHide();
    navigation++;
    visible = false;
    detach();
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = null;
    loading = false;
    error = null;
    notify();
  }

  return {open, toggle, hide, state, setBounds, reload, close, inspect, notify};
}

module.exports = {createSalesforceWorkspace, validateWorkspaceUrl, SALESFORCE_HOME};
