/**
 * Shared helper that namespaces a localStorage key by the CURRENTLY SIGNED-IN user, so
 * personal preferences (theme, column visibility, tile config, etc.) never leak between
 * different people signing in on the same shared PC - confirmed as a real bug: multiple
 * preference files (themeStore.js, tableColumnPreferences.js, workloadPreferences.js, etc.)
 * previously stored their values under one fixed key with no user scoping at all, so the
 * first person to sign in on a machine silently set that preference for every subsequent
 * person who signs in there too.
 *
 * Reads the SAME session key AuthContext.jsx already writes on successful local sign-in
 * (LOCAL_SESSION_EMAIL_KEY there / SESSION_EMAIL_KEY here - kept as the same literal string
 * intentionally), so this requires no new sign-in plumbing - it just reuses the identity
 * that's already being tracked.
 *
 * NOTE: automatic migration of old, pre-fix shared values was REMOVED after live testing
 * confirmed it caused a real cross-user leak (a second person signing in for the first time
 * would silently inherit the FIRST person's prior preference/identity). Every user now always
 * starts from a clean default until they personally set their own value - see themeStore.js,
 * workloadPreferences.js, etc. for the call sites this affects.
 *
 * SESSION-CHANGE NOTIFICATION: per explicit request - "reset theme to default as SOON as I'm
 * signed out" - notifyUserSessionChanged()/onUserSessionChanged() let any part of the app
 * react IMMEDIATELY the moment the signed-in identity changes (a fresh sign-in OR signing
 * out), instead of only picking up the new user-scoped values on the next full page reload.
 * AuthContext.jsx calls notifyUserSessionChanged() every time it changes who's signed in;
 * ThemeContext.jsx (and potentially other per-user UI state in the future) subscribes via
 * onUserSessionChanged() to immediately re-read and re-apply its own user-scoped value.
 */

const SESSION_EMAIL_KEY = "enquote_local_session_email";
const ANONYMOUS_NAMESPACE = "__anonymous__";
const SESSION_CHANGED_EVENT = "enquote_user_session_changed";

/** Returns a normalized (lowercased, trimmed) identifier for the currently signed-in user,
 *  or the shared anonymous namespace if nobody is signed in / running outside Electron. */
export function getCurrentUserNamespace() {
  try {
    const email = globalThis.window?.localStorage?.getItem(SESSION_EMAIL_KEY);
    if (email && email.trim()) return email.trim().toLowerCase();
  } catch {
    // localStorage unavailable - fall through to anonymous namespace.
  }
  return ANONYMOUS_NAMESPACE;
}

/**
 * Builds a per-user-scoped localStorage key from a base key name - e.g.
 * scopedKey("enquote_selected_theme_v1") -> "enquote_selected_theme_v1::carsten@example.com"
 * Use this EVERYWHERE a preference file currently does
 * `localStorage.getItem(SOME_FIXED_KEY)` / `localStorage.setItem(SOME_FIXED_KEY, ...)` -
 * replace SOME_FIXED_KEY with `scopedKey(SOME_FIXED_KEY)` and nothing else about that file's
 * logic needs to change.
 */
export function scopedKey(baseKey) {
  return `${baseKey}::${getCurrentUserNamespace()}`;
}

/**
 * Call this whenever the signed-in identity changes - a successful sign-in, OR signing out.
 * AuthContext.jsx is the single place this is called from (inside its
 * setPersistedLocalSessionEmail helper, which already runs on both paths).
 */
export function notifyUserSessionChanged() {
  try {
    globalThis.window?.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT));
  } catch {
    // CustomEvent should always be available in Electron's renderer, but never let a
    // notification-only side effect break the actual sign-in/sign-out flow if it somehow isn't.
  }
}

/**
 * Subscribes to session-identity changes (fired from AuthContext.jsx on every sign-in AND
 * sign-out) - returns an unsubscribe function. Use this anywhere a per-user preference needs
 * to immediately re-read and re-apply its value the moment the signed-in user changes, rather
 * than waiting for the next full component remount/page reload to pick up the new user's
 * (or the signed-out/anonymous) value.
 */
export function onUserSessionChanged(callback) {
  globalThis.window?.addEventListener(SESSION_CHANGED_EVENT, callback);
  return () => globalThis.window?.removeEventListener(SESSION_CHANGED_EVENT, callback);
}
