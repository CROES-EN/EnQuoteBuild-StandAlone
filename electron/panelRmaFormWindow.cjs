const crypto = require("node:crypto");
const {isIP} = require("node:net");

function validatePanelFormUrl(value) {
  let url;
  try {url = new URL(value);} catch {throw new Error("Enter a valid HTTPS manufacturer form URL.");}
  if (url.protocol !== "https:" || url.username || url.password ||
      !url.hostname.includes(".") || isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      url.hostname.endsWith(".local")) throw new Error("Use a public HTTPS manufacturer form URL without embedded credentials.");
  return url.href;
}

function createPanelRmaFormWindow({BrowserWindow, session, getMainWindow, getEmail}) {
  let owner = "";
  let partitionSession;
  const windows = new Set();
  function close() {
    for (const window of windows) if (!window.isDestroyed()) window.close();
    windows.clear();
    partitionSession = null;
    owner = "";
  }
  function configure(window) {
    windows.add(window);
    window.on("closed", () => windows.delete(window));
    const contents = window.webContents;
    for (const eventName of ["will-navigate", "will-redirect"]) contents.on(eventName, (event, url) => {
      try {validatePanelFormUrl(url);} catch {event.preventDefault();}
    });
    contents.setWindowOpenHandler(({url}) => {
      try {validatePanelFormUrl(url);} catch {return {action:"deny"};}
      return {action:"allow", overrideBrowserWindowOptions: options()};
    });
    contents.on("did-create-window", child => configure(child));
    contents.on("did-fail-load", (_event, code, description, failedUrl, mainFrame) => {
      if (!mainFrame || code === -3 || failedUrl.startsWith("data:")) return;
      const text = `The manufacturer form could not load (${description}). Return to the wizard and retry, or use your normal browser if this site does not support embedded browsers.`;
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h2>Manufacturer form unavailable</h2><p>${text.replace(/[<>&"]/g, "")}</p>`)}`);
    });
  }
  function options() {
    return {width:1100, height:850, title:"Panel RMA manufacturer form - EnQuote", autoHideMenuBar:true,
      webPreferences:{session:partitionSession, contextIsolation:true, nodeIntegration:false, sandbox:true}};
  }
  async function open(value) {
    const url = validatePanelFormUrl(value);
    const email = String(getEmail() || "").trim().toLowerCase();
    if (!email) throw new Error("Sign in before opening a manufacturer form.");
    if (owner !== email) close();
    owner = email;
    if (!partitionSession) {
      partitionSession = session.fromPartition(`enquote-panel-rma-${crypto.randomUUID()}`);
      partitionSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    }
    const window = new BrowserWindow({...options(), parent:getMainWindow() || undefined});
    configure(window);
    try {await window.loadURL(url);} catch (error) {
      throw new Error(`Could not open the manufacturer form: ${error.message}`);
    }
    return {ok:true};
  }
  return {open, close};
}

module.exports = {createPanelRmaFormWindow, validatePanelFormUrl};
