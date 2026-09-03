import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { getUsers } from '@/api/dataClient';

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
const FORCED_ADMIN_EMAILS = [
  "smosley@enphaseenergy.com",
  "croeschberger@enphaseenergy.com",
  "shawkins@enphaseenergy.com",
  "vseganos@enphaseenergy.com",
  "REDACTED-USER1@example.invalid",
  "jwood@enphaseenergy.com",
  "mjb@enphaseenergy.com"
];

// Remembers which local account is signed in on this PC across the frequent full-page
// reloads the local-first sync design already triggers on its own - every scheduled
// Base44 webhook import (every 15-20 minutes) and every manual "Refresh" that pulls new
// data calls window.reload(). Without this, checkAppState() below had no way to tell a
// routine sync reload apart from a genuine app restart, so it forced the "sign in again"
// screen every time regardless, even though the person had already signed in correctly
// minutes earlier. The password itself is still verified by the main process the first
// time; this only remembers WHO last passed that check, the same way a browser doesn't
// log you out of a site on every page navigation.
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
    // localStorage unavailable (e.g. disabled) - session just won't survive a reload.
  }
}

// The email/password login flow only exists inside the real Electron desktop app (it needs
// the main process to own the local credential store). When this bridge is missing - e.g. a
// plain browser tab via `npm run dev` or `vite preview` - local mode falls back to the
// original frictionless demoUser behavior so that workflow keeps working.
function getLocalAuthBridge() {
  return globalThis.window?.enquoteLocal?.auth || null;
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  // Local (email/password) login state - only meaningful when isLocalDemo && the Electron
  // auth bridge exists.
  const [needsLocalLogin, setNeedsLocalLogin] = useState(false);
  // { email, password } once sign-in succeeds with the temporary password, held only in
  // memory (never persisted) until the new password is saved.
  const [pendingPasswordChange, setPendingPasswordChange] = useState(null);
  const isLocalAuthActive = isLocalDemo && !!getLocalAuthBridge();

  useEffect(() => {
    checkAppState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Turns a resolved identity (a real synced Base44 "User" record when we have one, or just
  // the email otherwise) into the shape the rest of the app expects from `user` (see
  // demoUser above for the reference shape). Note the synced record's own "full_name" field
  // is actually the short username (e.g. "jwood") - the friendlier human name, when set,
  // lives in "display_name".
  const buildUserFromRecord = (record, fallbackEmail) => {
    const email = record?.email || fallbackEmail || "";
    const isForcedAdmin = FORCED_ADMIN_EMAILS.includes(email);
    // Deliberately do NOT default a missing app_role to "submitter" - leaving it unset lets
    // the existing RoleGuard "Role Not Assigned" screen correctly ask the person to contact
    // an admin, the same as it already does for Base44-authenticated users with no role.
    const resolvedRole = isForcedAdmin ? "admin" : (record?.app_role || null);
    const displayName = record?.display_name || record?.full_name || email;

    return {
      id: record?.id || `local-${email || "user"}`,
      email,
      full_name: displayName,
      name: displayName,
      role: resolvedRole,
      app_role: resolvedRole,
      additional_roles: record?.additional_roles || []
    };
  };

  // Loads the live synced users list (if any) to find the full record for the signed-in
  // email, then activates it as the current session user.
  const activateUser = useCallback(async (email) => {
    let record = null;
    try {
      const users = await getUsers();
      record = (users || []).find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) || null;
    } catch (error) {
      console.warn('[Local Auth] Could not load synced users list:', error?.message || error);
    }

    setUser(buildUserFromRecord(record, email));
    setIsAuthenticated(true);
    setNeedsLocalLogin(false);
    setPendingPasswordChange(null);
    setPersistedLocalSessionEmail(email);
  }, []);

  const checkAppState = async () => {
    if (isLocalDemo) {
      const authBridge = getLocalAuthBridge();
      if (!authBridge) {
        setUser(demoUser);
        setIsAuthenticated(true);
        setAppPublicSettings({ id: "local-demo", public_settings: {} });
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
        return;
      }

      setAppPublicSettings({ id: "local-demo", public_settings: {} });
      setIsLoadingPublicSettings(false);

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
      return;
    }

    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      try {
        const settingsTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Settings timeout')), 10000)
        );
        const fetchSettings = fetch(`${appParams.serverUrl}/api/apps/public/prod/public-settings/by-id/${appParams.appId}`, {
          headers: {
            'X-App-Id': appParams.appId,
            ...(appParams.token ? { 'Authorization': `Bearer ${appParams.token}` } : {})
          }
        }).then(async res => {
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
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
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
      // On timeout or other errors, fall through — user will be prompted to log in
    }
  };

  const logout = (shouldRedirect = true) => {
    if (isLocalDemo) {
      setUser(null);
      setIsAuthenticated(false);
      setPendingPasswordChange(null);
      setPersistedLocalSessionEmail(null);
      // Only re-show the login screen if it's actually wired up (Electron bridge present);
      // otherwise there'd be nothing to sign back in with.
      setNeedsLocalLogin(isLocalAuthActive);
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
  };

  const navigateToLogin = () => {
    // Use the SDK's redirectToLogin method
    base44.auth.redirectToLogin(window.location.href);
  };

  // Validates the typed email/password against this PC's local credential store. Everyone
  // starts out on the shared temporary password ("Enquote1") - if that's still active, this
  // signals the caller to show the "set your own password" step instead of signing in.
  const login = useCallback(async (email, password) => {
    const authBridge = getLocalAuthBridge();
    if (!authBridge) {
      throw new Error("Sign-in is only available in the desktop app.");
    }
    if (!email) {
      throw new Error("Choose your account first.");
    }

    const result = await authBridge.login(email, password);
    if (result.mustChangePassword) {
      setPendingPasswordChange({ email: result.email, password });
      return { mustChangePassword: true };
    }

    await activateUser(result.email);
    return { mustChangePassword: false };
  }, [activateUser]);

  // Called from the "set your new password" step that follows a temporary-password sign-in.
  const completePasswordChange = useCallback(async (newPassword) => {
    const authBridge = getLocalAuthBridge();
    if (!authBridge || !pendingPasswordChange) {
      throw new Error("Start sign-in again before choosing a new password.");
    }

    await authBridge.setPassword(pendingPasswordChange.email, pendingPasswordChange.password, newPassword);
    await activateUser(pendingPasswordChange.email);
  }, [pendingPasswordChange, activateUser]);

  return (
    <AuthContext.Provider value={{ 
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
      completePasswordChange
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

