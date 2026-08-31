$ErrorActionPreference = "Stop"

$path = ".\src\components\auth\AutoAssignRole.jsx"
if (-not (Test-Path $path)) {
  Write-Error "Could not find $path. Run this from your EnQuote project root."
  exit 1
}

Write-Host "Patching AutoAssignRole.jsx -- this is the component rendering"
Write-Host "'Setting up your account...' and it wraps EVERY page via Layout.jsx."
Write-Host "It had its own unguarded currentUser query, which is the real source"
Write-Host "of the infinite spinner / 'Query data cannot be undefined' error."
Write-Host ""

@'
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Loader2, LogIn } from "lucide-react";

// Users who always get admin role regardless of invitation
const FORCED_ADMIN_EMAILS = ["vseganos@enphaseenergy.com"];

const isLocalDemo = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);

export default function AutoAssignRole({ children }) {
  const queryClient = useQueryClient();
  const { navigateToLogin } = useAuth();
  const [isChecking, setIsChecking] = useState(true);

  // Base44 remains the required, authenticated source of truth here.
  // The only change from before: if the session is missing/expired,
  // base44.auth.me() resolving to nothing now throws a clear error
  // instead of returning undefined (which crashed React Query and hung
  // the page on "Setting up your account..." forever).
  const { data: user, isLoading: userLoading, isError: userError } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const result = await base44.auth.me();
      if (!result) {
        throw new Error("Not authenticated");
      }
      return result;
    },
    enabled: !isLocalDemo,
    retry: false
  });

  const { data: invitation, isLoading: invitationLoading } = useQuery({
    queryKey: ["userInvitation", user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      const invites = await base44.entities.Invitation.filter({
        email: user.email,
        status: "pending"
      });
      return invites[0] || null;
    },
    enabled: !!user?.email && !user?.app_role,
    staleTime: 0
  });

  const assignRoleMutation = useMutation({
    mutationFn: async () => {
      const role = FORCED_ADMIN_EMAILS.includes(user?.email) ? "admin" : (invitation?.invited_role || "submitter");
      await base44.auth.updateMe({
        app_role: role,
        account_setup_completed: true
      });
      if (invitation?.id) {
        await base44.entities.Invitation.update(invitation.id, {
          status: "accepted",
          accepted_date: new Date().toISOString()
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      queryClient.invalidateQueries({ queryKey: ["userInvitation"] });
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setIsChecking(false);
    },
    onError: () => {
      setIsChecking(false);
    }
  });

  useEffect(() => {
    if (user && !userLoading && !invitationLoading) {
      const needsForceAdmin = FORCED_ADMIN_EMAILS.includes(user?.email) && user?.app_role !== "admin";
      if (!user.app_role && invitation) {
        assignRoleMutation.mutate();
      } else if (needsForceAdmin) {
        base44.auth.updateMe({ app_role: "admin" }).then(() => {
          queryClient.invalidateQueries({ queryKey: ["currentUser"] });
          setIsChecking(false);
        });
      } else {
        setIsChecking(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, invitation, userLoading, invitationLoading]);

  if (isLocalDemo) {
    return children;
  }

  // Session missing or expired -- show a real sign-in screen instead of
  // hanging forever. Base44 sign-in is still required; this just makes
  // that requirement visible and actionable.
  if (userError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
            <LogIn className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Sign In Required</h2>
          <p className="text-slate-600 mb-6">
            Your Base44 session has expired or you're not signed in. Sign in to continue.
          </p>
          <Button onClick={navigateToLogin} className="bg-indigo-600 hover:bg-indigo-700">
            <LogIn className="w-4 h-4 mr-2" />
            Sign In to Base44
          </Button>
        </Card>
      </div>
    );
  }

  // Show loading while checking invitation
  if (userLoading || invitationLoading || (isChecking && assignRoleMutation.isPending)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Setting up your account...</p>
        </div>
      </div>
    );
  }

  // If user has no app_role and no invitation, deny access
  if (user && !user.app_role && !invitation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-100 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-rose-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-600 mb-4">
            This account has not been invited to use this system. Please contact an administrator to request access.
          </p>
          <button
            onClick={() => base44.auth.logout()}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Sign Out
          </button>
        </Card>
      </div>
    );
  }

  return children;
}
'@ | Set-Content -Encoding utf8 $path

Write-Host "Patched: $path"
Write-Host ""
Write-Host "=== Done ==="
Write-Host "Restart your dev server (Ctrl+C, then npm.cmd run dev) and hard-refresh the browser (Ctrl+Shift+R)."
Write-Host "Navigate to Quotes -- you should now see a 'Sign In Required' screen (if your session is"
Write-Host "expired) with a working Sign In button, instead of an infinite spinner or console error."
