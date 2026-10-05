import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {recordError} from '@/features/developerConsole/errorLog';
import {base44} from '@/api/base44Client';
import {appParams} from '@/lib/app-params';
import {getUsers} from '@/api/dataClient';

const AuthContext = createContext();
const isLocalDemo = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);
const demoUser = {
  id: "demo-user",
  email: "demo.manager@example.invalid",
  role: "admin",
  app_role: "admin",
  additional_roles: [],
  name: "Demo Manager"
};

// Users who always get admin role regardless of what the synced Base44 record says -
// mirrors the same list used by AutoAssignRole for the Base44-authenticated path.
const FORCED_ADMIN_EMAILS = new Set([
  "smosley@enphaseenergy.com",
  "croeschberger@enphaseenergy.com",
  "shawkins@enphaseenergy.com",
  "vseganos@enphaseenergy.com",
  "REDACTED-USER1@example.invalid",
  "jwood@enphaseenergy.com",
  "mjb@enphaseenergy.com"
]);

// Remembers which local account is signed in on this PC across the frequent full-page
// reloads the local-first sync design already triggers on its own. Without this,
// checkAppState() below had no way to tell a routine sync reload apart from a genuine
// app restart, so it forced the "sign in again" screen every time regardless.
const LOCAL_SESSION_EMAIL_KEY = "enquote_local_session_email";

function getPersistedLocalSessionEmail() {
  try {
    return globalThis.window?.localStorage?.getItem(LOCAL_SESSION_EMAIL_KEY) || null;
  } catch {
    return null;
  }
}

function setPersistedLocalSessionEmail(email) {
  try {
    if (email) {
      globalThis.window?.localStorage?.setItem(LOCAL_SESSION_EMAIL_KEY, email);
    } else {
      globalThis.window?.localStorage?.removeItem(LOCAL_SESSION_EMAIL_KEY);
    }
  } catch {
    // localStorage unavailable - session just won't survive a reload.
  }
}

// Centralizes access to the Electron preload bridge. IntelliJ/the type checker has no
// declared type for this global (it's injected at runtime by Electron's preload script,
// never declared anywhere), so every direct globalThis.window?.enquoteLocal access was
// flagged as "Unresolved variable enquoteLocal". This one helper isolates that single,
// intentional "any" cast in one place instead of repeating it at every call site.
function getEnquoteLocal() {
  return /** @type {any} */ (globalThis.window)?.enquoteLocal;
}

// FIX: Electron's IPC boundary wraps any error thrown in the main process with
// boilerplate like `Error invoking remote method 'auth:login': Error: <message>` before
// it reaches this renderer code. This strips that wrapper so the UI shows the clean,
// human-written message underneath (e.g. "Incorrect password.") instead of the raw
// technical wrapper text.
//
// Pattern moved to a module-level constant (built once, not on every call) and
// simplified to use the "s" (dotAll) flag instead of a [\s\S]* character class, which
// removes the nested-quantifier shape that was flagged as having super-linear
// backtracking risk.
const IPC_ERROR_PATTERN = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?(.*)$/s;

function cleanIpcErrorMessage(message) {
  if (!message) return message;
  const match = IPC_ERROR_PATTERN.exec(String(message));
  return match ? match[1].trim() : message;
}

// The email/password login flow only exists inside the real Electron desktop app (it needs
// the main process to own the local credential store). When this bridge is missing - e.g. a
// plain browser tab via `npm run dev` or `vite preview` - local mode falls back to the
// original frictionless demoUser behavior so that workflow keeps working.
function getLocalAuthBridge() {
  return getEnquoteLocal()?.auth || null;
}

const AuthProvider = ({children}) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  // Local login state remains available for legacy accounts.
  const [needsLocalLogin, setNeedsLocalLogin] = useState(false);
  // Cloudflare Access identity is set by Electron after live verification.
  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [needsAccountCreation, setNeedsAccountCreation] = useState(false);
  // { email, password } once sign-in succeeds with the temporary password, held only in
  // memory (never persisted) until the new password is saved.
  const [pendingPasswordChange, setPendingPasswordChange] = useState(null);
  const isLocalAuthActive = isLocalDemo && !!getLocalAuthBridge();

  // Turns a resolved identity (a real synced Base44 "User" record when we have one, or just
  // the email otherwise) into the shape the rest of the app expects from `user`. Note the
  // synced record's own "full_name" field is actually the short username (e.g. "jwood") -
  // the friendlier human name, when set, lives in "display_name".
  const buildUserFromRecord = (record, fallbackEmail) => {
    const email = String(record?.email || fallbackEmail || "").trim().toLowerCase();
    const isForcedAdmin = FORCED_ADMIN_EMAILS.has(email);
    // Cloudflare Access is the identity allow-list for packaged users. Give an authenticated
    // user without a synced role the least-privileged app role so a missing local User record
    // does not block first-run access; explicit roles and forced admins still take precedence.
    const resolvedRole = isForcedAdmin ? "admin" : (record?.app_role || "submitter");
    const displayName = record?.display_name || record?.full_name || email;

    return {
      id: record?.id || `local-${email || "user"}`,
      email,
      full_name: displayName,
      display_name: record?.display_name || displayName,
      name: displayName,
      role: resolvedRole,
      app_role: resolvedRole,
      additional_roles: record?.additional_roles || [],
      allow_pages: record?.allow_pages || [],
      deny_pages: record?.deny_pages || [],
      role_source: record?.role_source || "base44",
      department: record?.department || null
    };
  };

  // Loads the live synced users list (if any) to find the full record for the signed-in
  // email, then activates it as the current session user.
  // FIX (confirmed real bug - Denice's infinite "Setting up your account..." spinner):
  // RoleGuard.jsx's auto-retry mechanism needs a way to re-fetch this user's Base44 role
  // record WITHOUT going through the full sign-in flow (activateUser() also resets
  // isAuthenticated/needsLocalLogin/etc., which would be wrong to do mid-session just to
  // check for an updated role). This does the SAME core lookup - re-fetch getUsers(),
  // rebuild the user record - but ONLY updates `user`, nothing else about the session.
  const refreshLocalUser = useCallback(async () => {
    if (!user?.email) return;
    let record = null;
    try {
      const users = await Promise.race([
        getUsers(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("getUsers timed out")), 5000))
      ]);
      record = (users || []).find((candidate) => candidate.email?.toLowerCase() === user.email.toLowerCase()) || null;
    } catch (error) {
      console.warn('[Local Auth] refreshLocalUser could not load synced users list (or timed out):', error?.message || error);
      return;
    }
    if (record) {
      const refreshed = buildUserFromRecord(record, user.email);
      setUser(refreshed);
      getEnquoteLocal()?.presence?.announce?.({
        email: refreshed.email,
        name: refreshed.full_name || refreshed.name || refreshed.email,
        resolvedRole: refreshed.app_role
      })?.catch?.(() => {});
    }
  }, [user]);

  const activateUser = useCallback(async (email) => {
    let record = null;
    // FIX (confirmed real bug via live tester feedback - Denice's account hung forever on
    // "Setting up your account..."): the ORIGINAL try/catch below only protects against a
    // REJECTED getUsers() promise - not one that simply never resolves at all. If it hangs
    // (a slow first Base44 sync, a locked local data file, etc.), setUser()/
    // setIsAuthenticated() further below never run, leaving the user permanently stuck with
    // no way to recover short of force-quitting. A hard timeout guarantees activateUser()
    // ALWAYS completes within ACTIVATE_USER_TIMEOUT_MS, falling back to record=null (the
    // exact same fallback already used for a genuine error) if getUsers() is too slow - the
    // user still gets signed in and using the app; their display name/role simply
    // populates a moment later via the normal background refetch (RoleGuard's own
    // already-fixed mechanism), rather than blocking sign-in entirely.
    const ACTIVATE_USER_TIMEOUT_MS = 5000;
    try {
      const users = await Promise.race([
        getUsers(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("getUsers timed out")), ACTIVATE_USER_TIMEOUT_MS))
      ]);
      record = (users || []).find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) || null;
    } catch (error) {
      console.warn('[Local Auth] Could not load synced users list (or timed out):', error?.message || error);
    }

    setUser(buildUserFromRecord(record, email));
    setIsAuthenticated(true);
    setNeedsLocalLogin(false);
    setPendingPasswordChange(null);
    setPersistedLocalSessionEmail(email);

    // Announces this user as currently signed in, for the Developer Console's "Who's
    // Online" tab. Fire-and-forget and non-blocking by design (sign-in never waits on or
    // fails because of this). A failure is captured via recordError() instead of vanishing
    // silently.
    getEnquoteLocal()?.presence?.announce?.({
      email,
      name: record?.full_name || record?.name || email,
      resolvedRole: buildUserFromRecord(record, email).app_role
    })?.catch?.((presenceError) => {
      recordError({
        source: "presence.announce",
        message: presenceError?.message || String(presenceError)
      });
    });

  }, []);

  useEffect(() => {
    const appBridge = getEnquoteLocal()?.app;
    const adminBridge = getEnquoteLocal()?.admin;
    const unsubscribers = [];
    if (appBridge?.onDataUpdated) unsubscribers.push(appBridge.onDataUpdated(() => { void refreshLocalUser(); }));
    if (appBridge?.onUsersChanged) unsubscribers.push(appBridge.onUsersChanged(() => { void refreshLocalUser(); }));
    if (adminBridge?.onPolicyChanged) unsubscribers.push(adminBridge.onPolicyChanged(() => { void refreshLocalUser(); }));
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === "function") unsubscribe();
      }
    };
  }, [refreshLocalUser]);

  // Maps a failed remote app-state check onto the right authError shape. Split out of
  // checkRemoteAppState purely to keep that function's Cognitive Complexity low.
  const handleAppStateError = (appError) => {
    console.error('App state check failed:', appError);
    const errData = /** @type {any} */ (appError).data;

    if (appError.status === 403 && errData?.extra_data?.reason) {
      const reason = errData.extra_data.reason;
      if (reason === 'auth_required') {
        setAuthError({type: 'auth_required', message: 'Authentication required'});
      } else if (reason === 'user_not_registered') {
        setAuthError({type: 'user_not_registered', message: 'User not registered for this app'});
      } else {
        setAuthError({type: reason, message: appError.message});
      }
    } else {
      setAuthError({type: 'unknown', message: appError.message || 'Failed to load app'});
    }
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      // Race the auth call against a 10s timeout so the app never hangs forever
      const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Auth timeout')), 10000)
      );
      const currentUser = await Promise.race([base44.auth.me(), timeoutPromise]);
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);

      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
      // On timeout or other errors, fall through - user will be prompted to log in
    }
  };

  // Handles the "real" (non-local-demo) app-state check: loads public settings, then
  // checks user auth if a token is present. Split out of checkAppState purely to keep
  // Cognitive Complexity down (this piece + checkLocalAppState replace one much larger
  // function that previously scored 26 against a limit of 15).
  const checkRemoteAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      try {
        const settingsTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Settings timeout')), 10000)
        );
        const fetchSettings = fetch(`${appParams.serverUrl}/api/apps/public/prod/public-settings/by-id/${appParams.appId}`, {
          headers: {
            'X-App-Id': appParams.appId,
            ...(appParams.token ? {'Authorization': `Bearer ${appParams.token}`} : {})
          }
        }).then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const err = new Error(data?.message || 'Failed to load app settings');
            err.status = res.status;
            err.data = data;
            throw err;
          }
          return res.json();
        });

        const publicSettings = await Promise.race([fetchSettings, settingsTimeout]);
        setAppPublicSettings(publicSettings);

        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        handleAppStateError(appError);
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  // Handles the local-demo app-state check (dev/browser mode or the Electron local-auth
  // bridge). Split out of checkAppState for the same Cognitive Complexity reason as
  // checkRemoteAppState above.
  const checkLocalAppState = async () => {
    const authBridge = getLocalAuthBridge();
    if (!authBridge) {
      setUser(demoUser);
      setIsAuthenticated(true);
      setAppPublicSettings({id: "local-demo", public_settings: {}});
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
      return;
    }

    setAppPublicSettings({id: "local-demo", public_settings: {}});
    setIsLoadingPublicSettings(false);

    // Electron only creates the app window after Cloudflare Access has verified the
    // identity in the main process. Use that identity directly rather than requiring
    // users to create and maintain a second, machine-local password.
    const identity = await Promise.resolve(authBridge.getVerifiedIdentity?.()).catch((error) => {
      console.error("[Local Auth] Could not read Cloudflare-verified identity:", error?.message || error);
      return null;
    });
    if (identity?.email) {
      setVerifiedEmail(identity.email);
      await activateUser(identity.email);
      setIsLoadingAuth(false);
      return;
    }

    // Restore a previously-verified session instead of forcing a fresh sign-in on every
    // reload - see the LOCAL_SESSION_EMAIL_KEY comment above for why this matters.
    const persistedEmail = getPersistedLocalSessionEmail();
    if (persistedEmail) {
      await activateUser(persistedEmail);
      setIsLoadingAuth(false);
      return;
    }

    setNeedsLocalLogin(true);
    setIsLoadingAuth(false);
    // (No trailing `return;` here - this was the function's last statement anyway, so the
    // explicit return was redundant and flagged as an unnecessary/"redundant jump".)
  };

  const checkAppState = useCallback(async () => {
    if (!isLocalDemo) {
      await checkRemoteAppState();
    } else {
      await checkLocalAppState();
    }
  }, []);

  useEffect(() => {
    // checkAppState never throws on its own (every branch inside it catches its own
    // errors), but this .catch is kept as a safety net so a truly unexpected failure is
    // never a silently "ignored floating promise" per the linter.
    checkAppState().catch((error) => {
      console.error('checkAppState failed:', error);
    });
  }, []);

  const logout = useCallback(async (shouldRedirect = true) => {
    // Removes this user from the "Who's Online" presence list, captured BEFORE user
    // state is cleared below (user?.email would be null after setUser(null)).
    // Fire-and-forget, same reasoning as activateUser's announce call above.
    const signedOutEmail = user?.email || null;
    if (signedOutEmail) {
      getEnquoteLocal()?.presence?.remove?.({email: signedOutEmail})?.catch?.(() => {});
    }

    if (isLocalDemo) {
      setUser(null);
      setIsAuthenticated(false);
      setPendingPasswordChange(null);
      setPersistedLocalSessionEmail(null);
      setNeedsLocalLogin(isLocalAuthActive);
      if (isLocalAuthActive) {
        try {
          await getLocalAuthBridge()?.signOutEverywhere?.();
        } catch (error) {
          console.error("[cloudflare-auth] Could not clear the previous sign-in:", error?.message || error);
        }
      }
      return;
    }

    setUser(null);
    setIsAuthenticated(false);

    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  }, [user, isLocalAuthActive]);

  useEffect(() => {
    const unsubscribe = getEnquoteLocal()?.admin?.onSignOut?.(() => { void logout(false); });
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [logout]);

  const reauthenticateCloudflare = useCallback(async () => {
    const authBridge = getLocalAuthBridge();
    if (!authBridge?.reauthenticate) {
      throw new Error("Cloudflare sign-in is only available in the desktop app.");
    }
    const result = await authBridge.reauthenticate();
    if (!result?.authenticated || !result.email) {
      throw new Error("Cloudflare authentication was not completed.");
    }
    setVerifiedEmail(result.email);
    setNeedsAccountCreation(false);
    await activateUser(result.email);
    return result;
  }, [activateUser]);

  const navigateToLogin = useCallback(() => {
    // Use the SDK's redirectToLogin method
    base44.auth.redirectToLogin(window.location.href);
  }, []);

  // Validates the typed email/password against this PC's local credential store. Everyone
  // starts out on the shared temporary password - if that's still active, this signals the
  // caller to show the "set your own password" step instead of signing in.
  //
  // FIX: wraps the authBridge.login() call so any error it throws (pre-wrapped by
  // Electron's own IPC layer - see cleanIpcErrorMessage's comment above) is cleaned up
  // before it ever reaches the UI.
  const login = useCallback(async (email, password) => {
    const authBridge = getLocalAuthBridge();
    if (!authBridge) {
      throw new Error("Sign-in is only available in the desktop app.");
    }
    if (!email) {
      throw new Error("Choose your account first.");
    }

    let result;
    try {
      result = await authBridge.login(email, password);
    } catch (error) {
      throw new Error(cleanIpcErrorMessage(error?.message) || "Sign in failed.");
    }

    if (result.mustChangePassword) {
      setPendingPasswordChange({email: result.email, password});
      return {mustChangePassword: true};
    }

    await activateUser(result.email);
    return {mustChangePassword: false};
  }, [activateUser]);

  // Called from the "set your new password" step that follows a temporary-password sign-in.
  // Same IPC-error cleanup as login() above, for consistency (e.g. a wrong current password).
  // First-time self-service account setup (per explicit request: skip the admin-generated
  // temp password entirely for a Cloudflare-verified, already-recognized EnQuote user).
  // Mirrors completePasswordChange's exact structure/error-cleanup below.
  const createAccount = useCallback(async (newPassword) => {
    const authBridge = getLocalAuthBridge();
    if (!authBridge?.provisionNewAccount || !verifiedEmail) {
      throw new Error("Verify your identity again before creating a password.");
    }
    try {
      await authBridge.provisionNewAccount(verifiedEmail, newPassword);
    } catch (error) {
      throw new Error(cleanIpcErrorMessage(error?.message) || "Could not create your account.");
    }
    setNeedsAccountCreation(false);
    await activateUser(verifiedEmail);
  }, [verifiedEmail, activateUser]);

  const completePasswordChange = useCallback(async (newPassword) => {
    const authBridge = getLocalAuthBridge();
    if (!authBridge || !pendingPasswordChange) {
      throw new Error("Start sign-in again before choosing a new password.");
    }

    try {
      await authBridge.setPassword(pendingPasswordChange.email, pendingPasswordChange.password, newPassword);
    } catch (error) {
      throw new Error(cleanIpcErrorMessage(error?.message) || "Could not set your new password.");
    }
    await activateUser(pendingPasswordChange.email);
  }, [pendingPasswordChange, activateUser]);

  // The object passed to Context.Provider must keep the same reference across renders
  // unless something it depends on actually changed - otherwise every component that
  // consumes useAuth() re-renders on every AuthProvider render, regardless of whether
  // anything relevant changed. useMemo (plus useCallback above on the functions in this
  // object) keeps that reference stable.
  const contextValue = useMemo(() => ({
    user,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    appPublicSettings,
    logout,
    navigateToLogin,
    checkAppState,
    needsLocalLogin,
    pendingPasswordChange,
    isLocalAuthActive,
    login,
    completePasswordChange,
    verifiedEmail,
    needsAccountCreation,
    createAccount,
    refreshLocalUser,
    reauthenticateCloudflare
  }), [
    user,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    appPublicSettings,
    logout,
    navigateToLogin,
    checkAppState,
    needsLocalLogin,
    pendingPasswordChange,
    isLocalAuthActive,
    login,
    completePasswordChange,
    verifiedEmail,
    needsAccountCreation,
    createAccount,
    refreshLocalUser,
    reauthenticateCloudflare
  ]);

  return (
      <AuthContext.Provider value={contextValue}>
        {children}
      </AuthContext.Provider>
  );
};

export default AuthProvider;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
