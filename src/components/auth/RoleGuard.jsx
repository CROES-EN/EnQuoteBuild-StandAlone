import {base44} from "@/api/base44Client";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "@/lib/AuthContext";
import {isReadonlyViewing} from "@/features/admin/readonlyViewing";
import {canAccessPage, pageFromPathname, toRoleList} from "@/lib/rolePageAccess";
import {useAccessPolicy} from "@/features/admin/adminApi";
import {useLocation} from "react-router-dom";
import {Card} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {LogIn, ShieldAlert} from "lucide-react";
import appPackage from "../../../package.json";
// Shared hook: fetches the current Base44 user, and -- critically -- surfaces
// an explicit "needs login" state instead of hanging forever when the
// session is missing or expired. Base44 remains the required source of
// truth for Quotes; this only fixes how we react to an unauthenticated call.
//
// FIX (sturdiness): this query is invalidated app-wide any time Base44 delivers new data
// (see Layout.jsx's onDataUpdated handler), which is CORRECT behavior for this query itself
// (re-verifying the signed-in user/role is reasonable) - the actual bug was in how RoleGuard
// below REACTED to that refetch. Confirmed root cause: every Base44 webhook delivery was
// invalidating this exact query, which correctly triggers a background refetch - but
// RoleGuard treated "isLoading" (React Query's flag for "no data has ever been fetched yet OR
// is currently (re)fetching") identically to "this is the user's very first visit," and
// blanked the ENTIRE page (every page RoleGuard wraps, including Workload and every
// Supervisor Dashboard tab) behind a full-screen spinner every single time - even though the
// user/role data was already known and almost certainly hadn't actually changed.
//
// The fix: this hook now separately tracks whether we've EVER successfully loaded a user
// (hasLoadedOnceRef, a ref so it never itself triggers a re-render/effect loop). RoleGuard
// below only shows the full-screen LoadingScreen on that TRUE first load - a later
// invalidation-triggered refetch happens silently in the background, and `children` stays
// mounted and visible the entire time, exactly like the Workload/Report Data non-flicker fix
// applied earlier tonight.
import {useEffect, useRef, useState} from "react";

const isLocalDemo = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);
const appVersion = appPackage?.version || "0.0.0";

function AppVersionBadge() {
 return (
 <div className="fixed bottom-4 left-4 z-10 rounded-md border border-border bg-card/90 px-2.5 py-1 text-[10px] font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm">
 v{appVersion}
 </div>
 );
}

function useCurrentUserQuery() {
 const localIdentity = isLocalDemo || isReadonlyViewing();
 const { isAuthenticated, user: authUser, navigateToLogin, refreshLocalUser } = useAuth();
 const hasLoadedOnceRef = useRef(false);

 const { data: queriedUser, isLoading: queryLoading, isFetching, isError, refetch: refetchUser } = useQuery({
 queryKey: ["currentUser"],
 queryFn: async () => {
 if (isAuthenticated && authUser) return authUser;
 const result = await base44.auth.me();
 if (!result) {
 // Treat an empty result as "not authenticated" rather than letting
 // React Query throw its generic "data cannot be undefined" error.
 throw new Error("Not authenticated");
 }
 return result;
 },
 enabled: !localIdentity,
 retry: false
 });

 const user = localIdentity ? authUser : queriedUser;

 // isLoading here means "no data has ever been fetched yet" - React Query's own `isLoading`
 // (as opposed to `isFetching`) already has almost this meaning, but is computed BEFORE the
 // local-demo short-circuit above, so it's recomputed directly from whether `user` has ever
 // been populated - this is what makes a later background refetch (isFetching=true,
 // isLoading effectively false since we already have a user) distinguishable from a genuine
 // first load (nothing has ever loaded yet).
 if (user && !hasLoadedOnceRef.current) {
 hasLoadedOnceRef.current = true;
 }
 const isFirstLoad = !hasLoadedOnceRef.current && (localIdentity ? !authUser : queryLoading);
 const isBackgroundRefetch = hasLoadedOnceRef.current && (localIdentity ? false : isFetching);

 const needsLogin = !localIdentity && !isFirstLoad && (isError || !user);
  // FIX (confirmed real bug): refetchUser (React Query's refetch) is a SILENT NO-OP in
  // local mode, since this query is `enabled: !isLocalDemo` - calling it never actually
  // re-fetches anything, which is why the auto-retry below used to hang forever instead
  // of ever reaching "Role Not Assigned". In local mode, use the REAL local refresh
  // (refreshLocalUser) instead; in remote/Base44 mode, keep using the original refetchUser.
  const realRefetch = localIdentity ? refreshLocalUser : refetchUser;
  return { user, isLoading: isFirstLoad, isBackgroundRefetch, needsLogin, navigateToLogin, refetchUser: realRefetch };
}

function LoadingScreen() {
 return (
 <div className="min-h-screen bg-background flex items-center justify-center">
 <div className="text-center">
 <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
 <p className="text-muted-foreground">Setting up your account...</p>
 </div>
 </div>
 );
}

function SignInRequired({ navigateToLogin }) {
 return (
 <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
 <AppVersionBadge />
 <Card className="max-w-md w-full p-8 text-center">
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
 <LogIn className="w-8 h-8 text-indigo-600" />
 </div>
 <h2 className="text-2xl font-bold text-foreground mb-2">Sign In Required</h2>
 <p className="text-muted-foreground mb-6">
 Your Base44 session has expired or you're not signed in. Sign in to access Quotes and other
 data stored in Base44.
 </p>
 <Button onClick={navigateToLogin} className="bg-indigo-600 hover:bg-indigo-700">
 <LogIn className="w-4 h-4 mr-2" />
 Sign In to Base44
 </Button>
 </Card>
 </div>
 );
}

function RoleNotAssigned({ onRetry, isRetrying }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-amber-600" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Role Not Assigned</h2>
        <p className="text-muted-foreground mb-4">
          Your account hasn't been assigned a role yet. Please contact an administrator to assign you a
          role (Submitter, Approver, or Admin).
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          If a role has already been assigned, this can sometimes be a brief sync delay -- try
          refreshing below before contacting an administrator.
        </p>
        <Button onClick={onRetry} disabled={isRetrying} variant="outline">
          {isRetrying ? "Checking..." : "Try Again"}
        </Button>
      </Card>
    </div>
  );
}

function AccessDenied({ role }) {
 return (
 <div className="min-h-screen bg-background flex items-center justify-center p-4">
 <Card className="max-w-md w-full p-8 text-center">
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-100 flex items-center justify-center">
 <ShieldAlert className="w-8 h-8 text-rose-600" />
 </div>
 <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
 <p className="text-muted-foreground">You don't have permission to access this page.</p>
 <p className="text-sm text-muted-foreground mt-2">Your role: {role}</p>
 </Card>
 </div>
 );
}

export default function RoleGuard({ children, allowedRoles }) {
  const { user, isLoading, needsLogin, navigateToLogin, refetchUser } = useCurrentUserQuery();
  const location = useLocation();
  const {policy: accessPolicy} = useAccessPolicy();
  // FIX (Denice's "Role Not Assigned" bug, confirmed against her real Base44 record which
  // already had app_role="submitter" set): showing this terminal error the FIRST instant
  // app_role appears missing risks a false alarm if the currentUser fetch simply beat a
  // brief sync delay -- the role really was set, the app just asked before it had fully
  // propagated. Before ever showing the error screen, this automatically retries the fetch
  // ONCE, silently, staying on the normal loading screen the whole time. Only if the role is
  // STILL missing after that one retry does the real "Role Not Assigned" screen show -- which
  // now also has its own manual "Try Again" button as a backstop.
  const [autoRetryState, setAutoRetryState] = useState("idle"); // idle | retrying | done
  useEffect(() => {
    if (isLoading || needsLogin) return;
    if (user?.app_role) return;
    if (autoRetryState !== "idle") return;
    setAutoRetryState("retrying");
    const timeout = setTimeout(() => {
      refetchUser().finally(() => setAutoRetryState("done"));
    }, 1200);
    return () => clearTimeout(timeout);
  }, [isLoading, needsLogin, user, autoRetryState, refetchUser]);
  if (isLoading) {
    return <LoadingScreen />;
  }
  if (needsLogin) {
    return <SignInRequired navigateToLogin={navigateToLogin} />;
  }
  if (!user?.app_role) {
    if (autoRetryState !== "done") {
      return <LoadingScreen />;
    }
    return (
      <RoleNotAssigned
        onRetry={() => { setAutoRetryState("retrying"); refetchUser().finally(() => setAutoRetryState("done")); }}
        isRetrying={autoRetryState === "retrying"}
      />
    );
  }
  const pageName = pageFromPathname(location.pathname);
  if (!canAccessPage(user, pageName, accessPolicy)) {
    return <AccessDenied role={user.app_role} />;
  }
  if (allowedRoles && !canAccessPage(user, pageName, accessPolicy)) {
    return <AccessDenied role={user.app_role} />;
  }
  return children;
}

// Hook to get current user role -- unchanged public shape, now also
// exposes needsLogin / navigateToLogin so pages/components using this hook
// directly (instead of via <RoleGuard>) can also react to a missing session.
export function useUserRole() {
 const { user, isLoading, needsLogin, navigateToLogin } = useCurrentUserQuery();
 const roles = [user?.app_role, ...toRoleList(user?.additional_roles)].filter(Boolean);
 const isSuperAdmin = roles.includes("super_admin");

 return {
 user,
 role: user?.app_role,
 roles,
 isAdmin: isSuperAdmin || roles.includes("admin"),
 isApprover: isSuperAdmin || roles.some((role) => ["approver", "admin"].includes(role)),
 isInvoicer: isSuperAdmin || roles.includes("invoicer"),
 isSubmitter: isSuperAdmin || roles.some((role) => ["submitter", "approver", "admin"].includes(role)),
 isSuperAdmin,
 isLoading,
 needsLogin,
 navigateToLogin
 };
}
