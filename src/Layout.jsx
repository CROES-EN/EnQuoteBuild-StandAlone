import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  FileText, 
  Package,
  Users,
  Menu,
  X,
  Mail,
  Bell,
  FileOutput,
  Trash2,
  ShoppingCart,
  BarChart3,
  AlertTriangle,
  Route,
  Siren,
  Archive,
  LineChart,
  Recycle,
  Wallet,
  RefreshCw,
  Headset
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/components/auth/RoleGuard";
import { useAuth } from "@/lib/AuthContext";
import AutoAssignRole from "@/components/auth/AutoAssignRole";
import RefreshStatusDialog from "@/components/RefreshStatusDialog";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useLocalSyncStatus, REFRESH_REASON_LABELS } from "@/hooks/useLocalSyncStatus";
import { startAutoImportWatcher } from "@/features/supervisorDashboard/autoImportWatcher";
import appPackage from "../package.json";
import enquoteLogo from "@/assets/enquote-logo.png";

const isDemoMode = ["mock", "local", "salesforce-mock"].includes(import.meta.env.VITE_DATA_SOURCE);
const appVersion = appPackage?.version || "0.0.0";

const DATA_LAST_UPDATED_STORAGE_KEY = "enquote_data_last_updated";
// If the most recent successful sync is older than this, gently flag the "Data Last
// Updated" label so users have passive visibility into staleness without needing to
// guess or hit refresh "just in case".
const STALE_DATA_THRESHOLD_MS = 30 * 60 * 1000;
// How long a manually-triggered refresh's inline result message stays on screen before
// fading back to idle.
const REFRESH_SETTLE_DISPLAY_MS = 5000;

function readStoredLastUpdated() {
  try {
    const raw = globalThis.window?.localStorage?.getItem(DATA_LAST_UPDATED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function persistLastUpdated(date) {
  try {
    globalThis.window?.localStorage?.setItem(DATA_LAST_UPDATED_STORAGE_KEY, date.toISOString());
  } catch {
    // Persistence is best-effort only; it should never break the UI.
  }
}

// Formats as "MM/DD/YY h:mm AM/PM" - date part follows the OS/browser locale (i.e. the
// user's Windows date format setting) while the time is always forced to 12-hour + AM/PM
// per product requirements, regardless of the system's 24-hour clock setting.
function formatLastUpdated(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const datePart = date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${datePart} ${timePart}`;
}

export default function Layout({ children, currentPageName }) {
  const { isAdmin, roles, user } = useUserRole();
  const { isAuthenticated, isLocalAuthActive, logout } = useAuth();

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard, page: "Dashboard", roles: ["submitter", "approver", "admin"] },
    { name: "Quotes", icon: FileText, page: "Quotes", roles: ["submitter", "approver", "admin"] },
    { name: "Products & Services", icon: Package, page: "Products", roles: ["submitter", "approver", "admin"] },
    { name: "Material Orders", icon: ShoppingCart, page: "MaterialOrders", roles: ["submitter", "approver", "admin"] },
    { name: "PV Panel RMA Tracker", icon: Recycle, page: "PVPanelRMAs", roles: ["submitter", "approver", "admin"] },
    { name: "SLA Reporting", icon: BarChart3, page: "SLAReporting", roles: ["submitter", "approver", "admin"] },
    { name: "Users", icon: Users, page: "Users", roles: ["admin"] },
    { name: "Deletion Requests", icon: Trash2, page: "QuoteDeletionRequests", roles: ["admin"] },
    { name: "Email Notifications", icon: Mail, page: "EmailNotifications", roles: ["admin"] },
    { name: "Follow-Up Settings", icon: Bell, page: "FollowUpSettings", roles: ["admin"] },
    { name: "PDF Template", icon: FileOutput, page: "PDFTemplateSettings", roles: ["admin"] },
    { name: "Boneyard", icon: Archive, page: "Boneyard", roles: ["submitter", "approver", "admin"] },
    { name: "SV Cancel Tracker", icon: AlertTriangle, page: "SVCancelTracker", roles: ["submitter", "approver", "admin"] },
    { name: "Resource Planner", icon: Route, page: "ResourcePlanner", roles: ["submitter", "approver", "admin"] },
    { name: "Site Flags", icon: Siren, page: "SiteFlagManager", roles: ["submitter", "approver", "admin"] },
    { name: "Rejection Reviews", icon: AlertTriangle, page: "RejectedQuoteReview", roles: ["approver", "admin"] },
    { name: "Manager Dashboard", icon: LineChart, page: "ManagerDashboard", roles: ["admin", "submitter", "approver"] },
    { name: "Supervisor Dashboard", icon: Headset, page: "SupervisorDashboard", roles: ["admin", "approver"] },
    { name: "Inactive Revenue", icon: Wallet, page: "InactiveRevenueDashboard", roles: ["admin", "approver", "invoicer"] }
  ];
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(() => readStoredLastUpdated());
  // Forces a re-render every minute purely so the stale-data check below (computed from
  // Date.now() at render time) stays live without requiring any user interaction.
  const [, forceTick] = useState(0);
  const queryClient = useQueryClient();
  const { phase, lastAttempt, events, trigger, hasBridge } = useLocalSyncStatus();
  // Suppresses the passive "New data synced" toast when the background fs-watch
  // notification is just the natural side-effect of a manual refresh the user JUST
  // triggered - that flow already shows its own inline result message.
  const recentManualSettleRef = useRef(0);

  // Records a known-good data timestamp (never fabricated - only called with a real
  // finishedAt from the webhook receiver, or "now" when a soft refresh just re-fetched
  // everything from the data source) and keeps the newest value across renders/reloads.
  const recordDataRefresh = useCallback((date) => {
    setLastUpdated(prev => (prev && prev >= date) ? prev : date);
    persistLastUpdated(date);
  }, []);

  // Best-effort: on first mount, ask the local webhook receiver (if reachable) what the
  // last known-good import status was, so returning users see a real timestamp right away
  // instead of waiting for their next manual refresh.
  useEffect(() => {
    const bridge = globalThis.window?.enquoteLocal?.app;
    if (!bridge?.getRefreshStatus) return;
    let cancelled = false;

    bridge.getRefreshStatus().then((res) => {
      if (cancelled) return;
      const attempt = res?.lastAttempt;
      if (attempt?.ok && attempt?.finishedAt) {
        recordDataRefresh(new Date(attempt.finishedAt));
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [recordDataRefresh]);

  // Passive background sync: whenever the main process notifies us that new data landed
  // on disk (a Base44 webhook import, whether from the automatic 15-min schedule or a
  // manual refresh), soft-refresh in place - no page reload, so nothing the user is doing
  // gets interrupted or blanked.
  useEffect(() => {
    const bridge = globalThis.window?.enquoteLocal?.app;
    if (!bridge?.onDataUpdated) return;

    const unsubscribe = bridge.onDataUpdated((payload) => {
      queryClient.invalidateQueries();
      recordDataRefresh(payload?.at ? new Date(payload.at) : new Date());
      if (Date.now() - recentManualSettleRef.current > REFRESH_SETTLE_DISPLAY_MS) {
        toast.success("New quote data synced from Base44.");
      }
    });

    return unsubscribe;
  }, [queryClient, recordDataRefresh]);

  // O&M Daily Operations Snapshot: zero-click auto-import from the watched "O&M Reports Inbox"
  // local folder (see electron/main.cjs's watchReportsInbox()). Registered here - not inside the
  // Supervisor Dashboard page itself - so a file dropped in while the user is elsewhere in the
  // app still gets processed instead of silently missed because no listener was mounted yet.
  useEffect(() => {
    const unsubscribe = startAutoImportWatcher({
      onImported: () => queryClient.invalidateQueries({ queryKey: ["supervisor-daily-metrics"] })
    });
    return unsubscribe;
  }, [queryClient]);

  // Once a manually-triggered refresh settles (success/error/unreachable), soft-refresh
  // all currently-mounted data and record the timestamp. Deliberately does NOT reset the
  // shared hook's phase/lastAttempt back to idle - if the user has the details dialog
  // open, it should keep showing the real settled result, not revert to a misleading
  // "checking..." spinner. Only the transient inline bar/message (settledVisible, below)
  // fades on its own timer.
  const [settledVisible, setSettledVisible] = useState(false);
  useEffect(() => {
    if (phase !== "success" && phase !== "error" && phase !== "unreachable") return;

    if (phase !== "unreachable") {
      queryClient.invalidateQueries();
    }
    recentManualSettleRef.current = Date.now();
    if (phase === "success" && lastAttempt?.finishedAt) {
      recordDataRefresh(new Date(lastAttempt.finishedAt));
    }

    setSettledVisible(true);
    const timeout = setTimeout(() => setSettledVisible(false), REFRESH_SETTLE_DISPLAY_MS);
    return () => clearTimeout(timeout);
  }, [phase, lastAttempt, queryClient, recordDataRefresh]);

  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const lastUpdatedLabel = formatLastUpdated(lastUpdated);
  const isStale = !!lastUpdated && (Date.now() - lastUpdated.getTime() > STALE_DATA_THRESHOLD_MS);

  // Whether the inline slim bar/message should currently be visible: always while a
  // check is actively running, and for a few seconds after it settles.
  const showInlineStatus = phase === "running" || (settledVisible && phase !== "idle");

  const refreshMessage = {
    running: "Checking for new data…",
    success: REFRESH_REASON_LABELS[lastAttempt?.reason] || "Refresh complete",
    error: REFRESH_REASON_LABELS[lastAttempt?.reason] || "Refresh failed - see details",
    unreachable: "Local sync service unreachable"
  }[phase] || null;

  // Starts the refresh in the background - no blocking confirmation, no page reload.
  // The inline slim progress bar (and, if opened, the details dialog) reflect progress;
  // an inline message reports the outcome when it settles.
  function handleRefreshApp() {
    if (phase === "running") return;

    if (!hasBridge) {
      // No Electron bridge available (e.g. a plain browser preview) - there's nothing to
      // poll, so just soft-refresh whatever data source is active right now.
      queryClient.invalidateQueries();
      recordDataRefresh(new Date());
      toast.success("Data refreshed.");
      return;
    }

    trigger();
  }

  function handleSwitchAccount() {
    const confirmed = window.confirm("Sign out and let someone else sign in on this PC?");
    if (!confirmed) return;
    logout();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      {isAuthenticated && (
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col h-full bg-white border-r border-slate-200 overflow-hidden">
          {/* Logo */}
          <div className="h-16 flex items-center px-6 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <img src={enquoteLogo} alt="EnQuote" className="w-9 h-9 rounded-xl object-contain" />
              <span className="text-xl font-bold text-slate-900">EnQuote</span>
            </div>
          </div>
          {isDemoMode && <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-800">EnQuote Desktop Proof of Concept<br />Data Source: Local Demonstration Data<br />No Production Customer Data</div>}

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto min-h-0">
            {navItems.filter(item => !item.roles || isAdmin || item.roles.some(itemRole => roles.includes(itemRole))).map((item) => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                    isActive 
                      ? "bg-orange-50 text-orange-700" 
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <item.icon className={cn("w-5 h-5", isActive ? "text-orange-600" : "text-slate-400")} />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-slate-100 space-y-3">
            {isLocalAuthActive && user?.email && (
              <button
                type="button"
                onClick={handleSwitchAccount}
                className="w-full text-left px-4 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 transition"
              >
                <p className="text-xs text-slate-400">Signed in as</p>
                <p className="text-sm font-medium text-slate-700 truncate">{user.full_name || user.email}</p>
                <p className="text-xs text-indigo-600 mt-0.5">Switch account</p>
              </button>
            )}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleRefreshApp}
                disabled={phase === "running"}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <RefreshCw className={cn("w-4 h-4", phase === "running" && "animate-spin")} />
                Refresh App
              </button>

              {/* Slim progress bar - indeterminate while checking, solid color once settled */}
              {showInlineStatus && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      phase === "running" && "w-1/3 bg-orange-400 animate-refresh-slide",
                      phase === "success" && "w-full bg-emerald-500 transition-all",
                      (phase === "error" || phase === "unreachable") && "w-full bg-red-500 transition-all"
                    )}
                  />
                </div>
              )}

              {showInlineStatus && refreshMessage && (
                <p
                  className={cn(
                    "text-center text-[11px] font-medium leading-snug",
                    phase === "running" && "text-orange-500",
                    phase === "success" && "text-emerald-600",
                    (phase === "error" || phase === "unreachable") && "text-red-600"
                  )}
                >
                  {refreshMessage}
                  {(phase === "error" || phase === "unreachable" || phase === "success") && (
                    <button
                      type="button"
                      onClick={() => setDetailsOpen(true)}
                      className="ml-1.5 underline decoration-dotted underline-offset-2 hover:text-slate-700"
                    >
                      Details
                    </button>
                  )}
                </p>
              )}

              {!showInlineStatus && lastUpdatedLabel && (
                <p className={cn("text-center text-[11px] leading-snug", isStale ? "text-amber-600" : "text-slate-400")}>
                  Data Last Updated: <span className="font-medium">{lastUpdatedLabel}</span>
                  {isStale && " (stale)"}
                </p>
              )}
            </div>
            <div className="px-4 py-3 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100">
              <p className="text-xs text-slate-500">EnQuote Version</p>
              <p className="text-sm font-medium text-slate-700 mt-0.5">v{appVersion}</p>
            </div>
          </div>
        </div>
      </aside>
      )}

      {/* Mobile Header */}
      {isAuthenticated && (
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <img src={enquoteLogo} alt="EnQuote" className="w-9 h-9 rounded-xl object-contain" />
          <span className="text-xl font-bold text-slate-900">EnQuote</span>
        </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefreshApp}
            disabled={phase === "running"}
            aria-label="Refresh app"
            title={showInlineStatus ? refreshMessage : (lastUpdatedLabel ? `Data Last Updated: ${lastUpdatedLabel}` : "Refresh app")}
          >
            <RefreshCw className={cn("w-5 h-5", phase === "running" && "animate-spin")} />
          </Button>
          {showInlineStatus && (phase === "success" || phase === "error" || phase === "unreachable") && (
            <span
              className={cn(
                "absolute top-1 right-1 w-2 h-2 rounded-full ring-2 ring-white",
                phase === "success" ? "bg-emerald-500" : "bg-red-500"
              )}
            />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </div>
      </div>
      )}

      {/* Mobile Menu */}
      {isAuthenticated && mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-white pt-16">
          <nav className="p-4 space-y-1">
            {navItems.filter(item => !item.roles || isAdmin || item.roles.some(itemRole => roles.includes(itemRole))).map((item) => {
              const isActive = currentPageName === item.page;
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-4 rounded-xl text-base font-medium transition-all",
                    isActive 
                      ? "bg-orange-50 text-orange-700" 
                      : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <item.icon className={cn("w-5 h-5", isActive ? "text-orange-600" : "text-slate-400")} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className={cn(isAuthenticated && "lg:pl-64 pt-16 lg:pt-0")}>
        <ErrorBoundary>
          <AutoAssignRole>
            {children}
          </AutoAssignRole>
        </ErrorBoundary>
      </main>

      <RefreshStatusDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        phase={phase}
        lastAttempt={lastAttempt}
        events={events}
      />
    </div>
  );
}
