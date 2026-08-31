import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogIn } from "lucide-react";

const isLocalDemo = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);

// Shared hook: fetches the current Base44 user, and -- critically -- surfaces
// an explicit "needs login" state instead of hanging forever when the
// session is missing or expired. Base44 remains the required source of
// truth for Quotes; this only fixes how we react to an unauthenticated call.
function useCurrentUserQuery() {
  const { isAuthenticated, user: authUser, navigateToLogin } = useAuth();

  const { data: queriedUser, isLoading: queryLoading, isError } = useQuery({
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
    enabled: !isLocalDemo,
    retry: false
  });

  const user = isLocalDemo ? authUser : queriedUser;
  const isLoading = isLocalDemo ? !authUser : queryLoading;
  const needsLogin = !isLocalDemo && !isLoading && (isError || !user);

  return { user, isLoading, needsLogin, navigateToLogin };
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">Setting up your account...</p>
      </div>
    </div>
  );
}

function SignInRequired({ navigateToLogin }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
          <LogIn className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Sign In Required</h2>
        <p className="text-slate-600 mb-6">
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

function RoleNotAssigned() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-amber-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Role Not Assigned</h2>
        <p className="text-slate-600">
          Your account hasn't been assigned a role yet. Please contact an administrator to assign you a
          role (Submitter, Approver, or Admin).
        </p>
      </Card>
    </div>
  );
}

function AccessDenied({ role }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-100 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-rose-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
        <p className="text-slate-600">You don't have permission to access this page.</p>
        <p className="text-sm text-slate-400 mt-2">Your role: {role}</p>
      </Card>
    </div>
  );
}

export default function RoleGuard({ children, allowedRoles }) {
  const { user, isLoading, needsLogin, navigateToLogin } = useCurrentUserQuery();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (needsLogin) {
    return <SignInRequired navigateToLogin={navigateToLogin} />;
  }

  if (!user?.app_role) {
    return <RoleNotAssigned />;
  }

  const userRoles = [user.app_role, ...(user.additional_roles || [])];
  if (allowedRoles && !allowedRoles.some((role) => userRoles.includes(role))) {
    return <AccessDenied role={user.app_role} />;
  }

  return children;
}

// Hook to get current user role -- unchanged public shape, now also
// exposes needsLogin / navigateToLogin so pages/components using this hook
// directly (instead of via <RoleGuard>) can also react to a missing session.
export function useUserRole() {
  const { user, isLoading, needsLogin, navigateToLogin } = useCurrentUserQuery();
  const roles = [user?.app_role, ...(user?.additional_roles || [])].filter(Boolean);

  return {
    user,
    role: user?.app_role,
    roles,
    isAdmin: roles.includes("admin"),
    isApprover: roles.some((role) => ["approver", "admin"].includes(role)),
    isInvoicer: roles.includes("invoicer"),
    isSubmitter: roles.some((role) => ["submitter", "approver", "admin"].includes(role)),
    isLoading,
    needsLogin,
    navigateToLogin
  };
}
