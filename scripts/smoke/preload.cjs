// Runs inside Electron with contextIsolation OFF so it can install a stand-in for the real
// preload bridge (window.enquoteLocal) directly in the page. Everything the app asks the main
// process for gets a harmless empty answer, with just enough real data (a signed-in admin) for
// the screens to render. Used only by scripts/smoke/main.cjs.
const IDENTITY = { email: "smoke.test@enphaseenergy.com" };
const USERS = [{ id: "smoke-user", email: IDENTITY.email, full_name: "Smoke Test", display_name: "Smoke Test", app_role: "admin", additional_roles: [] }];

function respond(path, args) {
  const key = path.join(".");
  const last = path[path.length - 1];
  if (/^on[A-Z]/.test(last)) return () => {};
  if (key === "auth.getVerifiedIdentity") return Promise.resolve(IDENTITY);
  if (key === "auth.hasAccount") return Promise.resolve(true);
  if (key === "collections.list") return Promise.resolve(args[0] === "users" ? USERS : []);
  if (key === "largeTables.get" || key === "updater.getState") return Promise.resolve(null);
  if (key === "ui.getInfo") return Promise.resolve({ appVersion: "smoke", uiVersion: null });
  if (key === "remoteSync.checkStatus") return Promise.resolve({ ok: true });
  if (/^(list|filter|getAll|getUsers)/.test(last) || key.endsWith(".list")) return Promise.resolve([]);
  if (/^get/.test(last)) return Promise.resolve(null);
  return Promise.resolve({ ok: true });
}

function makeNode(path) {
  return new Proxy(function () {}, {
    get: (_target, prop) => (prop === "then" || typeof prop === "symbol" ? undefined : makeNode([...path, prop])),
    apply: (_target, _this, args) => respond(path, args)
  });
}

window.enquoteLocal = makeNode(["enquoteLocal"]);
window.enquoteUpdater = makeNode(["updater"]);
// enquoteLocal.X.y -> path starts at "enquoteLocal"; strip it so keys read "auth.getVerifiedIdentity".
const originalRespond = respond;
window.enquoteLocal = new Proxy({}, { get: (_t, prop) => (typeof prop === "symbol" || prop === "then" ? undefined : makeNodeFrom([prop])) });
function makeNodeFrom(path) {
  return new Proxy(function () {}, {
    get: (_target, prop) => (prop === "then" || typeof prop === "symbol" ? undefined : makeNodeFrom([...path, prop])),
    apply: (_target, _this, args) => originalRespond(path, args)
  });
}
window.enquoteUpdater = makeNodeFrom(["updater"]);

// Collect anything that would show as an error to a user.
window.__smokeErrors = [];
window.addEventListener("error", (event) => window.__smokeErrors.push(`window.onerror: ${event.message}`));
window.addEventListener("unhandledrejection", (event) => window.__smokeErrors.push(`unhandledrejection: ${event.reason?.message || event.reason}`));
