const crypto = require("node:crypto");
const FORM_HOSTS = ["forms.cloud.microsoft", "forms.office.com", "forms.microsoft.com"];

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isFormUrl(value) {
  return isHttpsUrl(value) && FORM_HOSTS.includes(new URL(value).hostname);
}

function validateFormUrl(value) {
  if (typeof value !== "string" || !isFormUrl(value)) throw new Error("Use an HTTPS Microsoft Forms URL.");
  const url = new URL(value);
  url.searchParams.delete("embed");
  return url.href;
}

function createRefundFormWindow({BrowserWindow, WebContentsView, session, getMainWindow, getEmail, onStatus = () => {}, logger = console}) {
  let view = null, owner = null, partitionSession = null, authWindow = null;
  let parent = null, visible = false, formUrl = null, bounds = null;
  const popups = new Set();
  let removeMainListeners = null;

  function status(state, error) {
    onStatus({state, ...(error ? {error} : {})});
  }

  function detach() {
    if (parent && !parent.isDestroyed() && view) parent.contentView.removeChildView(view);
    parent = null;
  }

  function attach(window) {
    if (parent !== window) {
      detach();
      window.contentView.addChildView(view);
      parent = window;
    }
  }

  function layout() {
    if (!view) return;
    if (authWindow && !authWindow.isDestroyed()) {
      const [width, height] = authWindow.getContentSize();
      view.setBounds({x: 0, y: 0, width, height});
    } else if (visible && bounds) {
      const main = getMainWindow();
      if (!main || main.isDestroyed()) return;
      const zoom = main.webContents.getZoomFactor();
      view.setBounds(Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value * zoom)])));
    }
  }

  function hide() {
    visible = false;
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
    detach();
    return {ok: true};
  }

  function close() {
    removeMainListeners?.();
    removeMainListeners = null;
    detach();
    const oldView = view;
    view = null;
    if (oldView && !oldView.webContents.isDestroyed()) oldView.webContents.close();
    const oldAuth = authWindow;
    authWindow = null;
    if (oldAuth && !oldAuth.isDestroyed()) oldAuth.close();
    for (const popup of popups) if (!popup.isDestroyed()) popup.close();
    popups.clear();
    owner = null;
    partitionSession = null;
    formUrl = null;
    visible = false;
  }

  function configurePopups(contents) {
    for (const eventName of ["will-navigate", "will-redirect"]) {
      contents.on(eventName, (event, url) => {
        if (!isHttpsUrl(url)) event.preventDefault();
      });
    }
    contents.setWindowOpenHandler(({url}) => ({
      action: isHttpsUrl(url) ? "allow" : "deny",
      overrideBrowserWindowOptions: {
        width: 720, height: 800, autoHideMenuBar: true,
        webPreferences: {session: partitionSession, contextIsolation: true, nodeIntegration: false, sandbox: true}
      }
    }));
    contents.on("did-create-window", (child) => {
      popups.add(child);
      child.on("closed", () => popups.delete(child));
      configurePopups(child.webContents);
    });
  }

  function showSignIn() {
    if (!view || !visible) return;
    if (!authWindow || authWindow.isDestroyed()) {
      authWindow = new BrowserWindow({
        width: 1000, height: 850, title: "Microsoft Sign-in / 2FA - EnQuote",
        backgroundColor: "#ffffff", autoHideMenuBar: true,
        webPreferences: {session: partitionSession, contextIsolation: true, nodeIntegration: false, sandbox: true}
      });
      const window = authWindow;
      window.on("resize", layout);
      window.on("close", () => {
        if (authWindow !== window) return;
        detach();
        authWindow = null;
        if (visible) {
          attach(getMainWindow());
          layout();
        }
        status("sign-in-required");
      });
    }
    // Move the same top-level contents so redirects, POST bodies and cookies survive 2FA.
    attach(authWindow);
    layout();
    authWindow.focus();
    status("signing-in");
  }

  function returnToForm() {
    if (!view) return;
    if (authWindow) {
      detach();
      const oldAuth = authWindow;
      authWindow = null;
      oldAuth.close();
    }
    if (visible) {
      attach(getMainWindow());
      layout();
    }
    status("ready");
  }

  async function show(value, rectangle) {
    const url = validateFormUrl(value);
    const email = String(getEmail() || "").trim().toLowerCase();
    if (!email) throw new Error("Sign in to EnQuote before opening the refund form.");
    if (!rectangle || !["x", "y", "width", "height"].every((key) => Number.isFinite(rectangle[key])) ||
        rectangle.width < 1 || rectangle.height < 1 || rectangle.x < 0 || rectangle.y < 0) {
      throw new Error("Invalid embedded form bounds.");
    }
    const main = getMainWindow();
    if (!main || main.isDestroyed()) throw new Error("EnQuote window is unavailable.");
    if (owner !== email) close();
    if (!view) {
      partitionSession = session.fromPartition(`enquote-refund-form-${crypto.randomUUID()}`);
      partitionSession.webRequest.onBeforeRequest({
        urls: [
          "https://login.microsoftonline.com/*/oauth2/v2.0/authorize*",
          "https://login.microsoftonline.com/*/oauth2/authorize*"
        ]
      }, (details, callback) => {
        const authorizeUrl = new URL(details.url);
        if (!authorizeUrl.searchParams.has("login_hint")) {
          authorizeUrl.searchParams.set("login_hint", email);
          callback({redirectURL: authorizeUrl.href});
        } else {
          callback({});
        }
      });
      view = new WebContentsView({
        webPreferences: {session: partitionSession, contextIsolation: true, nodeIntegration: false, sandbox: true}
      });
      owner = email;
      const contents = view.webContents;
      const onMainNavigation = (_event, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame) close();
      };
      main.webContents.on("did-start-navigation", onMainNavigation);
      main.webContents.on("render-process-gone", close);
      main.on("closed", close);
      removeMainListeners = () => {
        main.webContents.removeListener("did-start-navigation", onMainNavigation);
        main.webContents.removeListener("render-process-gone", close);
        main.removeListener("closed", close);
      };
      configurePopups(contents);
      for (const eventName of ["will-navigate", "will-redirect"]) {
        contents.on(eventName, (_event, target, ...args) => {
          // will-redirect supplies isMainFrame after isInPlace.
          if (eventName === "will-redirect" && args[1] === false) return;
          if (isHttpsUrl(target) && !isFormUrl(target)) showSignIn();
        });
      }
      contents.on("did-finish-load", () => {
        if (view?.webContents === contents && isFormUrl(contents.getURL())) returnToForm();
      });
      contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) {
          logger.error("[refund-form] Page failed to load:", code, description);
          status("error", "Could not load Microsoft Forms. Use Open form in browser or retry sign-in.");
        }
      });
    }
    bounds = rectangle;
    visible = true;
    if (!authWindow) attach(main);
    layout();
    if (formUrl !== url) {
      formUrl = url;
      status("loading");
      try {
        await view.webContents.loadURL(url);
      } catch (error) {
        formUrl = null;
        logger.error("[refund-form] Could not open form:", error.code || "navigation_failed");
        throw new Error("Could not load Microsoft Forms. Use Open form in browser or retry sign-in.");
      }
    } else if (isHttpsUrl(view.webContents.getURL()) && !isFormUrl(view.webContents.getURL())) {
      showSignIn();
    }
    return {ok: true};
  }

  async function open(value) {
    const url = validateFormUrl(value);
    if (!view || owner !== String(getEmail() || "").trim().toLowerCase()) {
      throw new Error("Open Submit Request before starting Microsoft sign-in.");
    }
    showSignIn();
    try {
      await view.webContents.loadURL(url);
    } catch (error) {
      logger.error("[refund-form] Sign-in navigation failed:", error.code || "navigation_failed");
      throw new Error("Could not load Microsoft sign-in. Use Open form in browser.");
    }
    return {ok: true};
  }

  return {open, show, hide, close};
}

module.exports = {createRefundFormWindow, validateFormUrl};
