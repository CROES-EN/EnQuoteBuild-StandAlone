/**
 * Cloudflare Access authentication controller (v1.1.4 two-stage sign-in, Part 2-6).
 * See the header comment in Patch-AddCloudflareAuthController.ps1 for the full design
 * rationale, confirmed Cloudflare configuration, and security notes - not repeated here
 * to keep this file focused.
 *
 * Owns: Cloudflare session verification, the auth-window lifecycle, verified identity
 * state, and full sign-out. Nothing outside this module should reach into these
 * internals directly - main.cjs and the renderer only ever go through the exported
 * functions below.
 */

const { BrowserWindow, session, net, screen } = require("electron");

const AUTH_PARTITION = "persist:enquote-cloudflare-auth";

// ASSUMPTION FLAGGED (see this patch's header comment): same base URL your existing
// outboundSync/pollEntitySnapshot code already uses. Change this ONE constant if
// enphase-enquote.com should be the primary hostname instead - nothing else in this
// file needs to change.
const WORKER_BASE_URL = "https://enquote-sync.croeschberger.workers.dev";
const AUTH_SESSION_PATH = "/auth/session";

// Confirmed directly from your Cloudflare Zero Trust dashboard this session - the real
// team domain Access redirects to for its login UI (One-Time PIN entry, since that is
// the only identity provider configured for this Access Application).
const CLOUDFLARE_TEAM_DOMAIN = "boise-enphase-om.cloudflareaccess.com";

// Extracts just the hostname from WORKER_BASE_URL once, for the navigation allowlist.
const WORKER_HOSTNAME = new URL(WORKER_BASE_URL).hostname;

let authWindow = null;
let verifiedIdentity = null; // { email } | null - main-process memory ONLY, never persisted.

// Very small syntactic check - mirrors the Worker's own auth-session.js validation.
// This is defense in depth (the Worker should never return a malformed email), not a
// substitute for the Worker's own check.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !EMAIL_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function isAllowedNavigationHost(hostname) {
  if (hostname === WORKER_HOSTNAME) return true;
  if (hostname === CLOUDFLARE_TEAM_DOMAIN) return true;
  if (hostname.endsWith(".cloudflareaccess.com")) return true;
  return false;
}

/**
 * Calls GET /auth/session through the SAME persistent partition the auth window uses,
 * so any Access session cookie established during interactive login is actually sent
 * along with this check. Uses Electron's session-aware net.fetch - NOT global fetch or
 * node's https module, neither of which carry a BrowserWindow's cookies (confirmed
 * Electron behavior, not an assumption).
 *
 * Returns { authenticated: true, email } | { authenticated: false, reason }.
 * Never throws - every failure mode (network error, malformed response, missing/invalid
 * email) resolves to a clear { authenticated: false, reason } instead.
 */
// Domains that may hold a CF_Authorization cookie for this app - confirmed directly
// from real cookie inspection tonight (both the Worker hostname and enphase-enquote.com
// each independently receive their own CF_Authorization cookie).
const COOKIE_DOMAINS = [
  new URL(WORKER_BASE_URL).hostname,
  "enphase-enquote.com"
];

/**
 * Reads the CF_Authorization JWT directly out of the persistent session's cookie jar -
 * NOT relying on the browser to send it correctly on a subsequent request (confirmed by
 * Cloudflare: the CF_Binding cookie's SameSite=None does not reliably transfer to a
 * fresh BrowserWindow's initial navigation, which is the actual root cause of tonight's
 * repeat-verification failures).
 */
async function getAccessJwt(partitionSession) {
  for (const domain of COOKIE_DOMAINS) {
    const cookies = await partitionSession.cookies.get({ name: "CF_Authorization", domain });
    if (cookies.length > 0) return cookies[0].value;
  }
  // Fallback: scan every cookie in the partition for any CF_Authorization value.
  const allCookies = await partitionSession.cookies.get({});
  const match = allCookies.find((c) => c.name === "CF_Authorization" && c.value);
  return match ? match.value : null;
}

/**
 * FIX (per Cloudflare's confirmed root-cause diagnosis): reads the CF_Authorization JWT
 * directly from the cookie jar and sends it as an EXPLICIT "Authorization: Bearer <jwt>"
 * header - this completely bypasses browser cookie-sending/binding-cookie behavior
 * entirely, rather than depending on it. The Worker's /auth/session endpoint
 * cryptographically validates this JWT against Access's own public signing keys, so this
 * is genuine, verifiable proof of a valid session - not just "a cookie happened to exist."
 */
/**
 * HIDDEN-WINDOW VERIFICATION (confirmed fix, replacing the earlier net.fetch approach):
 * every net.fetch()-based attempt tonight - regardless of header format (Authorization:
 * Bearer, Cookie header, with or without the binding cookie) - triggered a BRAND NEW
 * Access login challenge every time, proven by each attempt returning a completely
 * different JWT with fresh exp/nbf/iat timestamps. Access's edge never recognized any
 * of these as carrying real session context, no matter how the credential was attached.
 *
 * A REAL BrowserWindow.loadURL() navigation, using this same partition, was
 * independently verified to succeed and return the correct authenticated JSON. This is
 * that same proven method, used here for the repeated verification checks: creates a
 * genuine, invisible (show: false) window, performs a real navigation (which carries
 * the partition's cookies exactly the way a normal browser window does - no manual
 * header construction needed), reads the resulting page text, and parses it.
 *
 * Always destroys the hidden window before returning, even on error (try/finally) - this
 * can never leak windows across repeated calls.
 */
async function verifyCloudflareSession() {
  const partitionSession = session.fromPartition(AUTH_PARTITION);
  let hiddenWindow = null;

  try {
    hiddenWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: partitionSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    await hiddenWindow.loadURL(`${WORKER_BASE_URL}${AUTH_SESSION_PATH}`);

    const bodyText = await hiddenWindow.webContents.executeJavaScript("document.body.innerText");

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (parseError) {
      // A non-JSON body (e.g. Access's own login page HTML) means the user is not
      // currently authenticated in this partition - not a real error, just "not yet".
      return { authenticated: false, reason: "not_authenticated" };
    }

    if (!body || body.authenticated !== true) {
      return { authenticated: false, reason: "not_authenticated" };
    }

    const email = normalizeEmail(body.email);
    if (!email) {
      return { authenticated: false, reason: "invalid_email" };
    }

    return { authenticated: true, email };
  } catch (error) {
    return { authenticated: false, reason: "network_error", error: error.message };
  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) {
      hiddenWindow.destroy();
    }
  }
}
/**
 * Opens (or focuses, if already open) the embedded Cloudflare authentication window.
 * Loading /auth/session directly (rather than a separate /auth/login route, per the
 * spec's "optional convenience route" note) lets Access present its real login UI
 * itself before this protected endpoint ever responds - no custom login route needed.
 *
 * Returns a Promise that resolves with the SAME shape as verifyCloudflareSession() once
 * the user completes (or abandons) the flow - resolves on: a bounded-retry re-check
 * succeeding, the window being closed by the user, or a hard failure. Never hangs
 * forever - always resolves.
 */
function openCloudflareAuthWindow() {
  return new Promise((resolve) => {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.focus();
      // A caller awaiting a SECOND concurrent open (should not normally happen, but
      // guarded per spec's "deduplicate concurrent authentication failures" requirement)
      // just resolves as not-yet-authenticated; the ORIGINAL opener's promise is the one
      // that actually completes the flow.
      resolve({ authenticated: false, reason: "already_open" });
      return;
    }

    const partitionSession = session.fromPartition(AUTH_PARTITION);
    let settled = false;
    let retryTimer = null;
    let retryCount = 0;
    const MAX_RETRIES = 20; // ~20 * 1500ms = 30s bounded window after each navigation
    const RETRY_INTERVAL_MS = 1500;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (retryTimer) clearInterval(retryTimer);
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.removeAllListeners();
        authWindow.close();
      }
      authWindow = null;
      resolve(result);
    };

    // Opens on the SAME display the cursor is currently on - matches where the user is
    // actually looking/working, rather than defaulting to whatever Electron/the OS picks
    // (which can be a different monitor on a multi-display setup).
    const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const authWidth = 960;
    const authHeight = 760;
    const authX = Math.round(activeDisplay.bounds.x + (activeDisplay.bounds.width - authWidth) / 2);
    const authY = Math.round(activeDisplay.bounds.y + (activeDisplay.bounds.height - authHeight) / 2);

    authWindow = new BrowserWindow({
      width: authWidth,
      height: authHeight,
      x: authX,
      y: authY,
      minWidth: 760,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      title: "EnQuote Secure Sign-In",
      webPreferences: {
        session: partitionSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    authWindow.once("ready-to-show", () => {
      if (authWindow && !authWindow.isDestroyed()) authWindow.show();
    });

    // Navigation restriction (spec Part 4): only the Worker hostname and Cloudflare's
    // own Access team domain (One-Time PIN entry happens there) are ever allowed. Every
    // other destination is blocked outright - there is no third-party IdP domain to
    // allow, since this Access Application uses One-Time PIN only (confirmed), not an
    // external SSO provider.
    authWindow.webContents.on("will-navigate", (event, targetUrl) => {
      let hostname;
      try { hostname = new URL(targetUrl).hostname; } catch { hostname = ""; }
      if (!isAllowedNavigationHost(hostname)) {
        console.warn("[cloudflare-auth] Blocked unexpected navigation to:", targetUrl);
        event.preventDefault();
      }
    });

    authWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      let hostname;
      try { hostname = new URL(targetUrl).hostname; } catch { hostname = ""; }
      if (isAllowedNavigationHost(hostname)) {
        // Keep even an auxiliary popup inside EnQuote's own window, never the OS browser -
        // redirect the SAME window instead of allowing a real new popup window, since only
        // one auth window should ever exist at a time (spec: "prevent duplicate
        // authentication windows").
        if (authWindow && !authWindow.isDestroyed()) authWindow.loadURL(targetUrl);
      } else {
        console.warn("[cloudflare-auth] Blocked popup to unexpected host:", targetUrl);
      }
      return { action: "deny" };
    });

    authWindow.on("closed", () => {
      authWindow = null;
      // Spec Part 4/14: user closing the window is NOT silent success - if nothing else
      // has already settled this promise, treat it as an explicit cancellation.
      finish({ authenticated: false, reason: "window_closed" });
    });

    // FIX (confirmed real bug via testing: zero verification attempts were ever logged
    // during a real successful login, meaning did-navigate/did-finish-load did not
    // reliably fire a verification attempt at the right moments). Verification is now
    // triggered from MULTIPLE independent signals, each logged explicitly so the console
    // always shows exactly what happened:
    //   1. dom-ready - fires for every real page load, confirmed reliable per Electron's
    //      own documentation (unlike did-finish-load, which can be skipped for certain
    //      navigation types).
    //   2. did-navigate / did-finish-load - kept as additional signals, in case either
    //      fires when dom-ready does not.
    //   3. A recurring background poll every POLLING_INTERVAL_MS while the window is
    //      open - a safety net independent of ANY page event, bounded by MAX_RETRIES
    //      total (not per-navigation), so this can never become an uncontrolled loop.
    const POLLING_INTERVAL_MS = 2000;
    let totalAttempts = 0;
    const MAX_TOTAL_ATTEMPTS = 150; // ~150 * 2s = 5 minutes total - generous for a real user typing a One-Time PIN.

    async function attemptVerification(source) {
      if (settled || !authWindow || authWindow.isDestroyed()) return;
      totalAttempts += 1;
      console.log(`[cloudflare-auth] Verification attempt #${totalAttempts} (triggered by: ${source})`);

      // DIAGNOSTIC (temporary): REAL PARTITION COOKIE CHECK - reads cookies from the
      // SAME session object this window itself is using, from inside the real running
      // app process (not a separate standalone test), at the exact moment verification
      // is attempted.
      try {
        const liveCookies = await partitionSession.cookies.get({});
        console.log(`[cloudflare-auth] REAL PARTITION COOKIE CHECK - ${liveCookies.length} cookie(s) in the live partition right now:`);
        liveCookies.forEach((c) => {
          console.log(`[cloudflare-auth]   ${c.name} | domain=${c.domain} | path=${c.path} | secure=${c.secure} | httpOnly=${c.httpOnly} | sameSite=${c.sameSite}`);
        });
      } catch (cookieError) {
        console.log("[cloudflare-auth] Could not read live partition cookies:", cookieError.message);
      }

      const result = await verifyCloudflareSession();
      if (result.authenticated) {
        console.log(`[cloudflare-auth] Verification SUCCEEDED for ${result.email}`);
        finish(result);
        return;
      }
      console.log(`[cloudflare-auth] Not yet authenticated (reason: ${result.reason || "unknown"})`);
      if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
        console.warn("[cloudflare-auth] Max total verification attempts reached - stopping background poll.");
      }
    }

    authWindow.webContents.on("dom-ready", () => {
      attemptVerification("dom-ready").catch((e) => console.warn("[cloudflare-auth] attemptVerification error:", e.message));
    });
    authWindow.webContents.on("did-navigate", () => {
      attemptVerification("did-navigate").catch((e) => console.warn("[cloudflare-auth] attemptVerification error:", e.message));
    });
    authWindow.webContents.on("did-finish-load", () => {
      attemptVerification("did-finish-load").catch((e) => console.warn("[cloudflare-auth] attemptVerification error:", e.message));
    });
    authWindow.webContents.on("did-navigate-in-page", () => {
      attemptVerification("did-navigate-in-page").catch((e) => console.warn("[cloudflare-auth] attemptVerification error:", e.message));
    });

    authWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return; // ERR_ABORTED - typically just a redirect in progress, not a real failure.
      console.warn("[cloudflare-auth] Auth window failed to load:", errorDescription, `(code ${errorCode})`);
    });

    // Background safety-net poll - independent of any specific page event firing.
    retryTimer = setInterval(() => {
      if (settled || totalAttempts >= MAX_TOTAL_ATTEMPTS) {
        clearInterval(retryTimer);
        return;
      }
      attemptVerification("background-poll").catch((e) => console.warn("[cloudflare-auth] attemptVerification error:", e.message));
    }, POLLING_INTERVAL_MS);

    console.log(`[cloudflare-auth] Opening auth window, loading: ${WORKER_BASE_URL}${AUTH_SESSION_PATH}`);
    authWindow.loadURL(`${WORKER_BASE_URL}${AUTH_SESSION_PATH}`);
  });
}

/** Returns the current verified identity, or null. Never throws. */
function getVerifiedIdentity() {
  return verifiedIdentity;
}

/** Sets the in-memory verified identity - called once verifyCloudflareSession()/
 *  openCloudflareAuthWindow() succeed. Exported so main.cjs's startup gate can set this
 *  directly after its own initial check, without duplicating validation logic. */
function setVerifiedIdentity(identity) {
  verifiedIdentity = identity;
}

/**
 * Full sign-out (spec Part 11's "Sign out everywhere" / "Use another account"): clears
 * this app's OWN Cloudflare Access partition cookies/storage - and ONLY this partition,
 * never the user's normal Edge/Chrome session or any other app's data - and clears the
 * in-memory verified identity. Does not touch EnQuote business data.
 */
async function clearCloudflareSession() {
  verifiedIdentity = null;
  try {
    const partitionSession = session.fromPartition(AUTH_PARTITION);
    await partitionSession.clearStorageData();
    await partitionSession.clearCache();
  } catch (error) {
    console.warn("[cloudflare-auth] Could not fully clear auth partition:", error.message);
  }
}

/** Convenience: clears in-memory identity and re-opens the auth window, resolving with
 *  the same shape as openCloudflareAuthWindow(). Cookies are intentionally NOT cleared
 *  here (that is clearCloudflareSession()'s job) - reauthenticate() is for session
 *  EXPIRY recovery, where Access itself will naturally re-prompt if its own session
 *  already lapsed; a full sign-out is a separate, explicit user action. */
async function reauthenticate() {
  verifiedIdentity = null;
  return openCloudflareAuthWindow();
}

/**
 * Fetches dynamic sync credentials (outboundToken, snapshotToken) from the Worker's
 * /auth/sync-credentials endpoint - using the SAME proven hidden-window navigation
 * method as verifyCloudflareSession() (confirmed working through Access's edge, unlike
 * a raw net.fetch request). Called once, right after Cloudflare verification succeeds,
 * so these secrets are obtained dynamically per-session rather than ever being bundled
 * into the installer or requiring manual per-machine setup.
 *
 * Returns { ok: true, outboundToken, snapshotToken } on success, or
 * { ok: false, reason } on any failure - callers should treat failure as "sync stays
 * disabled this session" rather than a fatal error, since the user is already
 * correctly signed in at this point.
 */
async function fetchSyncCredentials() {
  const partitionSession = session.fromPartition(AUTH_PARTITION);
  let hiddenWindow = null;

  try {
    hiddenWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: partitionSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    await hiddenWindow.loadURL(`${WORKER_BASE_URL}/auth/sync-credentials`);
    const bodyText = await hiddenWindow.webContents.executeJavaScript("document.body.innerText");

    console.log(`[cloudflare-auth] RAW SYNC-CREDENTIALS RESPONSE: ${bodyText}`);

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (parseError) {
      console.log(`[cloudflare-auth] sync-credentials JSON.parse failed: ${parseError.message}`);
      return { ok: false, reason: "malformed_response" };
    }

    console.log(`[cloudflare-auth] Parsed sync-credentials body: ${JSON.stringify({ ok: body?.ok, reason: body?.reason, hasOutboundToken: Boolean(body?.outboundToken), hasSnapshotToken: Boolean(body?.snapshotToken) })}`);

    if (!body || body.ok !== true || !body.outboundToken || !body.snapshotToken) {
      return { ok: false, reason: body?.reason || "missing_credentials" };
    }

    return {
      ok: true,
      outboundToken: body.outboundToken,
      snapshotToken: body.snapshotToken,
      cfAccessClientId: body.cfAccessClientId,
      cfAccessClientSecret: body.cfAccessClientSecret
    };
  } catch (error) {
    return { ok: false, reason: "network_error", error: error.message };
  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) {
      hiddenWindow.destroy();
    }
  }
}

module.exports = {
  verifyCloudflareSession,
  fetchSyncCredentials,
  openCloudflareAuthWindow,
  getVerifiedIdentity,
  setVerifiedIdentity,
  clearCloudflareSession,
  reauthenticate,
  AUTH_PARTITION,
  WORKER_BASE_URL
};