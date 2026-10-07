import {useEffect, useState} from "react";
import {rejectViewingAction} from "./readonlyViewing";

export default function ReadonlyAuthProvider({context: Context, children}) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    window.enquotePreview.context().then(result => {
      if (result?.ok !== true || !result.user?.email) throw new Error("The desktop service did not authorize this viewing window.");
      if (!cancelled) setSession(result);
    }).catch(loadError => {if (!cancelled) setError(loadError.message);});
    return () => {cancelled = true;};
  }, []);
  if (error) return <p role="alert" className="p-6 text-destructive">{error}</p>;
  if (!session) return <p role="status" className="p-6">Verifying read-only viewing mode...</p>;
  return (
    <Context.Provider value={{
      user: session.user, isAuthenticated: true, isLoadingAuth: false, isLoadingPublicSettings: false,
      authError: null, isLocalAuthActive: true, needsLocalLogin: false, needsAccountCreation: false,
      pendingPasswordChange: false, verifiedEmail: session.user.email, viewingSession: session,
      refreshLocalUser: async () => session.user,
      checkAppState: rejectViewingAction, logout: rejectViewingAction, navigateToLogin: rejectViewingAction,
      login: rejectViewingAction, completePasswordChange: rejectViewingAction,
      createAccount: rejectViewingAction, reauthenticateCloudflare: rejectViewingAction
    }}>
      {children}
    </Context.Provider>
  );
}
